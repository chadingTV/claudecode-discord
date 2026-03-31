import { query, type Query, type SDKControlGetContextUsageResponse, type McpServerStatus, type McpStdioServerConfig, type McpSSEServerConfig, type McpHttpServerConfig, type SlashCommand, type ModelInfo, type AgentInfo, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import type { TextChannel } from "discord.js";
import {
  getModel,
  upsertSession,
  updateSessionStatus,
  getProject,
  getSession,
  setAutoApprove,
  clearSession,
  registerProject,
  getDisabledMcps,
  setDisabledMcps,
} from "../db/database.js";
import { getConfig } from "../utils/config.js";
import { L } from "../utils/i18n.js";
import {
  createToolApprovalEmbed,
  createAskUserQuestionEmbed,
  createResultEmbed,
  createStopButton,
  createCompletedButton,
  splitMessage,
  type AskQuestionData,
} from "./output-formatter.js";
import { renderChart, type ChartFileConfig } from "../utils/chart.js";
import { AttachmentBuilder } from "discord.js";

type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig;

function loadMcpServers(): Record<string, McpServerConfig> | undefined {
  const mcpJsonPath = path.resolve(process.cwd(), ".mcp.json");
  try {
    const raw = fs.readFileSync(mcpJsonPath, "utf-8");
    const parsed = JSON.parse(raw);
    const servers = parsed.mcpServers ?? parsed;
    if (typeof servers === "object" && servers !== null && !Array.isArray(servers)) {
      console.log(`[mcp] Loaded ${Object.keys(servers).length} MCP server(s) from .mcp.json`);
      return servers as Record<string, McpServerConfig>;
    }
  } catch {
    // No .mcp.json or invalid — that's fine
  }
  return undefined;
}

const globalMcpServers = loadMcpServers();

interface TurnState {
  responseBuffer: string;
  lastEditTime: number;
  currentMessage: import("discord.js").Message;
  heartbeatInterval: NodeJS.Timeout;
  startTime: number;
  lastActivity: string;
  toolUseCount: number;
  hasTextOutput: boolean;
  hasResult: boolean;
  resolve: () => void;
}

/**
 * Simple async queue for feeding messages to the Query via streamInput.
 */
class MessageChannel {
  private queue: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private done = false;

  push(msg: SDKUserMessage): void {
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: msg, done: false });
    } else {
      this.queue.push(msg);
    }
  }

  end(): void {
    this.done = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as unknown as SDKUserMessage, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as SDKUserMessage, done: true });
        }
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
    };
  }
}

interface ActiveSession {
  queryInstance: Query;
  channelId: string;
  sessionId: string | null; // Claude Agent SDK session ID
  dbId: string;
  channel: TextChannel;
  messageChannel: MessageChannel; // for feeding messages to the query
  currentTurn: TurnState | null; // active only while processing a message
  initialized: boolean; // true once the session is ready for SDK calls
  initPromise: Promise<void>; // resolves when session is initialized
  resolveInit: () => void; // call to resolve initPromise
}

// Pending approval requests: requestId -> resolve function
const pendingApprovals = new Map<
  string,
  {
    resolve: (decision: { behavior: "allow" | "deny"; message?: string }) => void;
    channelId: string;
  }
>();

// Pending AskUserQuestion requests: requestId -> resolve function
const pendingQuestions = new Map<
  string,
  {
    resolve: (answer: string | null) => void;
    channelId: string;
  }
>();

// Pending custom text inputs: channelId -> requestId
const pendingCustomInputs = new Map<string, { requestId: string }>();

const EDIT_INTERVAL = 1500; // ms between edits (Discord rate limit friendly)
const SDK_CALL_TIMEOUT = 15_000; // 15s timeout for SDK metadata calls

class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private static readonly MAX_QUEUE_SIZE = 5;
  private messageQueue = new Map<string, { channel: TextChannel; prompt: string }[]>();
  private pendingQueuePrompts = new Map<string, { channel: TextChannel; prompt: string }>();

  /**
   * Ensure a session exists for the channel. Creates one if needed.
   * Auto-registers the channel if not registered.
   * Returns the ActiveSession once initialized.
   */
  async ensureSession(channel: TextChannel): Promise<ActiveSession> {
    const channelId = channel.id;

    // Auto-register channel if not registered
    let project = getProject(channelId);
    if (!project) {
      const projectPath = path.join(getConfig().BASE_PROJECT_DIR, channel.name);
      fs.mkdirSync(projectPath, { recursive: true });
      registerProject(channelId, projectPath, channel.guildId!);
      project = getProject(channelId)!;
    }

    const existing = this.sessions.get(channelId);
    if (existing) {
      await this.waitForInit(existing);
      return existing;
    }

    // Check DB for previous session_id (for bot restart resume)
    const dbSession = getSession(channelId);
    const dbId = dbSession?.id ?? randomUUID();
    const resumeSessionId = dbSession?.session_id ?? undefined;

    // Don't await init here — the SDK may need the first message push before emitting init.
    // Callers that need the session ready (sdkCall) wait for init themselves.
    return this.createSession(channel, project.project_path, dbId, resumeSessionId);
  }

  private static readonly INIT_TIMEOUT = 60_000; // 60s max wait for session init

  private async waitForInit(session: ActiveSession): Promise<void> {
    if (session.initialized) return;
    await Promise.race([
      session.initPromise,
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("Session initialization timed out (60s). Try again.")), SessionManager.INIT_TIMEOUT),
      ),
    ]);
  }

  /**
   * Create a new session and start the background message loop.
   */
  private createSession(
    channel: TextChannel,
    projectPath: string,
    dbId: string,
    resumeSessionId?: string,
  ): ActiveSession {
    const channelId = channel.id;
    const channelModel = getModel(channelId);
    const messageChannel = new MessageChannel();

    let resolveInit!: () => void;
    const initPromise = new Promise<void>((r) => { resolveInit = r; });

    const queryInstance = query({
      prompt: messageChannel as unknown as AsyncIterable<SDKUserMessage>,
      options: {
        cwd: projectPath,
        permissionMode: "default",
        ...(channelModel ? { model: channelModel } : {}),
        env: { ...process.env, ANTHROPIC_API_KEY: undefined, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
        ...(globalMcpServers ? { mcpServers: globalMcpServers } : {}),
        ...(resumeSessionId ? { resume: resumeSessionId } : {}),

        canUseTool: async (
          toolName: string,
          input: Record<string, unknown>,
        ) => {
          const session = this.sessions.get(channelId);
          const turn = session?.currentTurn;
          if (turn) {
            turn.toolUseCount++;

            // Tool activity labels for Discord display
            const toolLabels: Record<string, string> = {
              Read: L("Reading files", "파일 읽는 중"),
              Glob: L("Searching files", "파일 검색 중"),
              Grep: L("Searching code", "코드 검색 중"),
              Write: L("Writing file", "파일 작성 중"),
              Edit: L("Editing file", "파일 편집 중"),
              Bash: L("Running command", "명령어 실행 중"),
              WebSearch: L("Searching web", "웹 검색 중"),
              WebFetch: L("Fetching URL", "URL 가져오는 중"),
              TodoWrite: L("Updating tasks", "작업 업데이트 중"),
            };
            const filePath = typeof input.file_path === "string"
              ? ` \`${(input.file_path as string).split(/[\\/]/).pop()}\``
              : "";
            turn.lastActivity = `${toolLabels[toolName] ?? `Using ${toolName}`}${filePath}`;

            // Update status message if no text output yet
            if (!turn.hasTextOutput) {
              const elapsed = Math.round((Date.now() - turn.startTime) / 1000);
              const timeStr = elapsed > 60
                ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
                : `${elapsed}s`;
              try {
                const stopRow = createStopButton(channelId);
                await turn.currentMessage.edit({
                  content: `⏳ ${turn.lastActivity} (${timeStr}) [${turn.toolUseCount} tools used]`,
                  components: [stopRow],
                });
              } catch (e) {
                console.warn(`[tool-status] Failed to edit message for ${channelId}:`, e instanceof Error ? e.message : e);
              }
            }
          }

          // Handle AskUserQuestion with interactive Discord UI
          if (toolName === "AskUserQuestion") {
            const questions = (input.questions as AskQuestionData[]) ?? [];
            if (questions.length === 0) {
              return { behavior: "allow" as const, updatedInput: input };
            }

            const answers: Record<string, string> = {};

            for (let qi = 0; qi < questions.length; qi++) {
              const q = questions[qi];
              const qRequestId = randomUUID();
              const { embed, components } = createAskUserQuestionEmbed(
                q,
                qRequestId,
                qi,
                questions.length,
              );

              updateSessionStatus(channelId, "waiting");
              await channel.send({ embeds: [embed], components });

              const answer = await new Promise<string | null>((resolve) => {
                const timeout = setTimeout(() => {
                  pendingQuestions.delete(qRequestId);
                  // Clean up custom input if pending
                  const ci = pendingCustomInputs.get(channelId);
                  if (ci?.requestId === qRequestId) {
                    pendingCustomInputs.delete(channelId);
                  }
                  resolve(null);
                }, 5 * 60 * 1000);

                pendingQuestions.set(qRequestId, {
                  resolve: (ans) => {
                    clearTimeout(timeout);
                    pendingQuestions.delete(qRequestId);
                    resolve(ans);
                  },
                  channelId,
                });
              });

              if (answer === null) {
                updateSessionStatus(channelId, "online");
                return {
                  behavior: "deny" as const,
                  message: L("Question timed out", "질문 시간 초과"),
                };
              }

              answers[q.header] = answer;
            }

            updateSessionStatus(channelId, "online");
            return {
              behavior: "allow" as const,
              updatedInput: { ...input, answers },
            };
          }

          // Auto-approve read-only tools
          const readOnlyTools = ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "TodoWrite"];
          if (readOnlyTools.includes(toolName)) {
            return { behavior: "allow" as const, updatedInput: input };
          }

          // Auto-approve .chart.json writes (harmless chart data)
          if (toolName === "Write" && typeof input.file_path === "string" && input.file_path.endsWith(".chart.json")) {
            return { behavior: "allow" as const, updatedInput: input };
          }

          // Check auto-approve setting
          const currentProject = getProject(channelId);
          if (currentProject?.auto_approve) {
            return { behavior: "allow" as const, updatedInput: input };
          }

          // Ask user via Discord buttons
          const requestId = randomUUID();
          const { embed, row } = createToolApprovalEmbed(
            toolName,
            input,
            requestId,
          );

          updateSessionStatus(channelId, "waiting");
          await channel.send({
            embeds: [embed],
            components: [row],
          });

          // Wait for user decision (timeout 5 min)
          return new Promise((resolve) => {
            const timeout = setTimeout(() => {
              pendingApprovals.delete(requestId);
              updateSessionStatus(channelId, "online");
              resolve({ behavior: "deny" as const, message: "Approval timed out" });
            }, 5 * 60 * 1000);

            pendingApprovals.set(requestId, {
              resolve: (decision) => {
                clearTimeout(timeout);
                pendingApprovals.delete(requestId);
                updateSessionStatus(channelId, "online");
                resolve(
                  decision.behavior === "allow"
                    ? { behavior: "allow" as const, updatedInput: input }
                    : { behavior: "deny" as const, message: decision.message ?? "Denied by user" },
                );
              },
              channelId,
            });
          });
        },
      },
    });

    const session: ActiveSession = {
      queryInstance,
      channelId,
      sessionId: resumeSessionId ?? null,
      dbId,
      channel,
      messageChannel,
      currentTurn: null,
      initialized: false,
      initPromise,
      resolveInit,
    };

    this.sessions.set(channelId, session);
    upsertSession(dbId, channelId, resumeSessionId ?? null, "idle");

    // Start background message loop
    this.runSessionLoop(session).then(() => {
      // Session ended normally (generator exhausted)
      this.cleanupSession(channelId);
    }).catch((error) => {
      const rawMsg = error instanceof Error ? error.message : "Unknown error occurred";

      // If session resume failed (stale session), clear it
      if (rawMsg.includes("No conversation found with session ID")) {
        console.warn(`[session] Stale session for ${channelId}, clearing`);
        clearSession(channelId);
        this.cleanupSession(channelId);
        return;
      }

      // Handle error in current turn if any
      const turn = session.currentTurn;
      if (turn) {
        this.handleTurnError(session, rawMsg).catch((e) => {
          console.error(`[session] Error handling turn error for ${channelId}:`, e);
        });
      } else {
        console.error(`[session] Session error for ${channelId}:`, rawMsg);
      }

      this.cleanupSession(channelId);
    });

    return session;
  }

  /**
   * Background loop that processes all messages from the Query generator.
   */
  private async runSessionLoop(session: ActiveSession): Promise<void> {
    const { queryInstance, channelId } = session;

    for await (const message of queryInstance) {
      // Capture session ID from init
      if (
        message.type === "system" &&
        "subtype" in message &&
        message.subtype === "init"
      ) {
        const sdkSessionId = (message as { session_id?: string }).session_id;
        if (sdkSessionId) {
          session.sessionId = sdkSessionId;
          upsertSession(session.dbId, channelId, sdkSessionId, "idle");
        }
        session.initialized = true;
        session.resolveInit();

        // Apply per-channel disabled MCPs
        const disabledMcps = getDisabledMcps(channelId);
        for (const name of disabledMcps) {
          try { await queryInstance.toggleMcpServer(name, false); } catch { /* server may not exist */ }
        }
      }

      const turn = session.currentTurn;
      if (!turn) {
        // No active turn — messages outside a turn (e.g., init) are handled above
        continue;
      }

      // Handle streaming text
      if (message.type === "assistant" && "content" in message) {
        const content = message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if ("text" in block && typeof block.text === "string") {
              turn.responseBuffer += block.text;
              turn.hasTextOutput = true;
            }
          }
        }

        // Throttled message edit
        const now = Date.now();
        if (now - turn.lastEditTime >= EDIT_INTERVAL && turn.responseBuffer.length > 0) {
          turn.lastEditTime = now;
          const chunks = splitMessage(turn.responseBuffer);
          try {
            await turn.currentMessage.edit({ content: chunks[0] || "...", components: [] });
            for (let i = 1; i < chunks.length; i++) {
              turn.currentMessage = await session.channel.send(chunks[i]);
              turn.responseBuffer = chunks.slice(i + 1).join("");
            }
          } catch (e) {
            console.warn(`[stream] Failed to edit message for ${channelId}, sending new:`, e instanceof Error ? e.message : e);
            turn.currentMessage = await session.channel.send(
              chunks[chunks.length - 1] || "...",
            );
          }
        }
      }

      // Handle result — end of turn
      if ("result" in message) {
        const resultMsg = message as {
          result?: string;
          total_cost_usd?: number;
          duration_ms?: number;
          usage?: {
            input_tokens: number;
            output_tokens: number;
          };
        };

        // Flush remaining buffer
        if (turn.responseBuffer.length > 0) {
          const chunks = splitMessage(turn.responseBuffer);
          try {
            await turn.currentMessage.edit(chunks[0] || L("Done.", "완료."));
            for (let i = 1; i < chunks.length; i++) {
              await session.channel.send(chunks[i]);
            }
          } catch (e) {
            console.warn(`[flush] Failed to edit final message for ${channelId}:`, e instanceof Error ? e.message : e);
          }
        }

        // Replace stop button with completed button
        try {
          await turn.currentMessage.edit({
            components: [createCompletedButton()],
          });
        } catch (e) {
          console.warn(`[complete] Failed to update completed button for ${channelId}:`, e instanceof Error ? e.message : e);
        }

        // Send result embed
        const resultText = resultMsg.result ?? L("Task completed", "작업 완료");
        const { embed: resultEmbed, file: resultFile } = createResultEmbed(
          resultText,
          resultMsg.usage?.input_tokens ?? 0,
          resultMsg.usage?.output_tokens ?? 0,
          resultMsg.duration_ms ?? 0,
        );
        await session.channel.send({
          embeds: [resultEmbed],
          ...(resultFile && { files: [resultFile] }),
        });

        // Render and send any .chart.json files created during this turn
        await this.sendPendingCharts(session);

        // Detect auth/credit errors in result and suggest re-login
        const resultAuthKeywords = ["credit balance", "not authenticated", "unauthorized", "authentication", "login required", "auth token", "expired", "not logged in", "please run /login"];
        const lowerResult = resultText.toLowerCase();
        if (resultAuthKeywords.some((kw) => lowerResult.includes(kw))) {
          await session.channel.send(L(
            "🔑 Claude Code is not logged in. Please open a terminal on the host PC and run `claude login` to authenticate, then try again.",
            "🔑 Claude Code 로그인이 필요합니다. 호스트 PC에서 터미널을 열고 `claude login`을 실행하여 인증 후 다시 시도해 주세요.",
          ));
        }

        turn.hasResult = true;
        clearInterval(turn.heartbeatInterval);
        session.currentTurn = null;
        updateSessionStatus(channelId, "idle");
        turn.resolve();

        // Process next queued message if any
        this.processQueue(channelId);
      }
    }
  }

  /**
   * Handle errors that occur during a turn.
   */
  private async handleTurnError(session: ActiveSession, rawMsg: string): Promise<void> {
    const { channelId, channel } = session;
    const turn = session.currentTurn;

    if (turn) {
      // Skip error if result was already delivered
      if (turn.hasResult) {
        console.warn(`[session] Ignoring post-result error for ${channelId}:`, rawMsg);
        clearInterval(turn.heartbeatInterval);
        session.currentTurn = null;
        turn.resolve();
        return;
      }

      clearInterval(turn.heartbeatInterval);
      session.currentTurn = null;
      turn.resolve();
    }

    // Parse API error JSON to show clean message
    let errMsg = rawMsg;
    const jsonMatch = rawMsg.match(
      /API Error: (\d+)\s*(\{.*\})/s,
    );
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[2]);
        const statusCode = jsonMatch[1];
        const message =
          parsed?.error?.message ?? parsed?.message ?? "Unknown error";
        errMsg = `API Error ${statusCode}: ${message}. Please try again later.`;
      } catch (parseErr) {
        console.warn(`[error-parse] Failed to parse API error JSON for ${channelId}:`, parseErr instanceof Error ? parseErr.message : parseErr);
        errMsg = `API Error ${jsonMatch[1]}. Please try again later.`;
      }
    } else if (rawMsg.includes("process exited with code")) {
      errMsg = `${rawMsg}. The server may be temporarily unavailable — please try again later.`;
    }

    // Detect auth/credit errors and suggest re-login
    const authKeywords = ["credit balance", "not authenticated", "unauthorized", "authentication", "login required", "auth token", "expired", "not logged in", "please run /login"];
    const lowerMsg = rawMsg.toLowerCase();
    if (authKeywords.some((kw) => lowerMsg.includes(kw))) {
      errMsg += L(
        "\n\n🔑 Claude Code is not logged in. Please open a terminal on the host PC and run `claude login` to authenticate, then try again.",
        "\n\n🔑 Claude Code 로그인이 필요합니다. 호스트 PC에서 터미널을 열고 `claude login`을 실행하여 인증 후 다시 시도해 주세요.",
      );
    }

    await channel.send(`❌ ${errMsg}`);
    updateSessionStatus(channelId, "offline");
  }

  /**
   * Clean up a session fully (remove from map, clean pending state).
   */
  private cleanupSession(channelId: string): void {
    const session = this.sessions.get(channelId);
    if (session) {
      // Resolve init promise so waitForInit doesn't hang forever
      if (!session.initialized) {
        session.initialized = true;
        session.resolveInit();
      }
      if (session.currentTurn) {
        clearInterval(session.currentTurn.heartbeatInterval);
        session.currentTurn.resolve();
        session.currentTurn = null;
      }
    }

    this.sessions.delete(channelId);

    // Clean up any pending approvals/questions for this channel
    for (const [id, entry] of pendingApprovals) {
      if (entry.channelId === channelId) pendingApprovals.delete(id);
    }
    for (const [id, entry] of pendingQuestions) {
      if (entry.channelId === channelId) pendingQuestions.delete(id);
    }
    pendingCustomInputs.delete(channelId);

    updateSessionStatus(channelId, "offline");
  }

  /**
   * Scan for .chart.json files in the project directory, render them, send as images, and clean up.
   */
  private async sendPendingCharts(session: ActiveSession): Promise<void> {
    const project = getProject(session.channelId);
    if (!project) return;

    const projectDir = project.project_path;
    let files: string[];
    try {
      files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".chart.json"));
    } catch {
      return;
    }

    for (const file of files) {
      const filePath = path.join(projectDir, file);
      try {
        const raw = fs.readFileSync(filePath, "utf-8");
        const config: ChartFileConfig = JSON.parse(raw);
        const pngBuffer = await renderChart(config);
        const chartName = file.replace(".chart.json", ".png");
        const attachment = new AttachmentBuilder(pngBuffer, { name: chartName });
        await session.channel.send({ files: [attachment] });
      } catch (e) {
        console.warn(`[chart] Failed to render ${file}:`, e instanceof Error ? e.message : e);
      } finally {
        // Clean up the chart JSON file
        try { fs.unlinkSync(filePath); } catch { /* ignore */ }
      }
    }
  }

  /**
   * Process next queued message for a channel.
   */
  private processQueue(channelId: string): void {
    const queue = this.messageQueue.get(channelId);
    if (queue && queue.length > 0) {
      const next = queue.shift()!;
      if (queue.length === 0) this.messageQueue.delete(channelId);
      const remaining = queue.length;
      const preview = next.prompt.length > 40 ? next.prompt.slice(0, 40) + "…" : next.prompt;
      const msg = remaining > 0
        ? L(`📨 Processing queued message... (remaining: ${remaining})\n> ${preview}`, `📨 대기 중이던 메시지를 처리합니다... (남은 큐: ${remaining}개)\n> ${preview}`)
        : L(`📨 Processing queued message...\n> ${preview}`, `📨 대기 중이던 메시지를 처리합니다...\n> ${preview}`);
      next.channel.send(msg).catch(() => {});
      this.sendMessage(next.channel, next.prompt).catch((err) => {
        console.error("Queue sendMessage error:", err);
      });
    }
  }

  async sendMessage(
    channel: TextChannel,
    prompt: string,
  ): Promise<void> {
    const channelId = channel.id;

    // Ensure session exists (auto-register + create if needed)
    let session: ActiveSession;
    try {
      session = await this.ensureSession(channel);
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : "Unknown error";

      // If stale session, clear and retry
      if (rawMsg.includes("No conversation found with session ID")) {
        console.warn(`[session] Stale session for ${channelId}, clearing and retrying fresh`);
        clearSession(channelId);
        this.cleanupSession(channelId);
        await this.sendMessage(channel, prompt);
        return;
      }

      await channel.send(`❌ Failed to start session: ${rawMsg}`);
      return;
    }

    // Set up per-turn state
    const stopRow = createStopButton(channelId);
    const currentMessage = await channel.send({
      content: L("⏳ Thinking...", "⏳ 생각 중..."),
      components: [stopRow],
    });

    const turnPromise = new Promise<void>((resolve) => {
      const turn: TurnState = {
        responseBuffer: "",
        lastEditTime: 0,
        currentMessage,
        heartbeatInterval: setInterval(async () => {
          if (turn.hasTextOutput) return;
          const elapsed = Math.round((Date.now() - turn.startTime) / 1000);
          const mins = Math.floor(elapsed / 60);
          const secs = elapsed % 60;
          const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
          try {
            await turn.currentMessage.edit({
              content: `⏳ ${turn.lastActivity} (${timeStr})`,
              components: [stopRow],
            });
          } catch (e) {
            console.warn(`[heartbeat] Failed to edit message for ${channelId}:`, e instanceof Error ? e.message : e);
          }
        }, 15_000),
        startTime: Date.now(),
        lastActivity: L("Thinking...", "생각 중..."),
        toolUseCount: 0,
        hasTextOutput: false,
        hasResult: false,
        resolve,
      };

      session.currentTurn = turn;
    });

    // Update status
    updateSessionStatus(channelId, "online");

    // Send the message via the session's message channel
    const userMessage: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: prompt },
      parent_tool_use_id: null,
    };

    session.messageChannel.push(userMessage);

    // Wait for the turn to complete (resolved by the session loop when result is received)
    await turnPromise;
  }

  async stopSession(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session) return false;

    try {
      session.messageChannel.end();
      session.queryInstance.close();
    } catch {
      // already stopped
    }

    this.cleanupSession(channelId);
    return true;
  }

  isActive(channelId: string): boolean {
    return this.sessions.has(channelId);
  }

  /**
   * Check if the session is currently processing a message.
   */
  isBusy(channelId: string): boolean {
    const session = this.sessions.get(channelId);
    return session?.currentTurn !== null && session?.currentTurn !== undefined;
  }

  /**
   * Call an SDK method with a timeout. If it hangs (zombie session), clean up,
   * recreate the session, and retry once.
   */
  private async sdkCall<T>(channelId: string, fn: (q: Query) => Promise<T>, retried = false): Promise<T | null> {
    const session = this.sessions.get(channelId);
    if (!session) return null;
    try {
      await this.waitForInit(session);
      return await Promise.race([
        fn(session.queryInstance),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("SDK call timed out")), SDK_CALL_TIMEOUT),
        ),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "SDK call timed out") {
        console.warn(`[session] SDK call timed out for ${channelId}${retried ? " (retry)" : ""}, cleaning up`);
        await this.stopSession(channelId);
        if (!retried && session.channel) {
          console.log(`[session] Retrying SDK call for ${channelId} with fresh session`);
          try {
            await this.ensureSession(session.channel);
            return this.sdkCall(channelId, fn, true);
          } catch {
            return null;
          }
        }
      }
      return null;
    }
  }

  async getContextUsage(channelId: string): Promise<SDKControlGetContextUsageResponse | null> {
    return this.sdkCall(channelId, (q) => q.getContextUsage());
  }

  async getMcpStatus(channelId: string): Promise<McpServerStatus[] | null> {
    return this.sdkCall(channelId, (q) => q.mcpServerStatus());
  }

  async toggleMcpServer(channelId: string, serverName: string, enabled: boolean): Promise<void> {
    await this.sdkCall(channelId, (q) => q.toggleMcpServer(serverName, enabled));
    // Persist to DB
    const disabled = getDisabledMcps(channelId);
    if (enabled) {
      const updated = disabled.filter((n) => n !== serverName);
      setDisabledMcps(channelId, updated);
    } else {
      if (!disabled.includes(serverName)) {
        setDisabledMcps(channelId, [...disabled, serverName]);
      }
    }
  }

  async getSupportedCommands(channelId: string): Promise<SlashCommand[] | null> {
    return this.sdkCall(channelId, (q) => q.supportedCommands());
  }

  async getSupportedModels(channelId: string): Promise<ModelInfo[] | null> {
    return this.sdkCall(channelId, (q) => q.supportedModels());
  }

  async getSupportedAgents(channelId: string): Promise<AgentInfo[] | null> {
    return this.sdkCall(channelId, (q) => q.supportedAgents());
  }

  resolveApproval(
    requestId: string,
    decision: "approve" | "deny" | "approve-all",
  ): boolean {
    const pending = pendingApprovals.get(requestId);
    if (!pending) return false;

    if (decision === "approve-all") {
      // Enable auto-approve for this channel
      setAutoApprove(pending.channelId, true);
      pending.resolve({ behavior: "allow" });
    } else if (decision === "approve") {
      pending.resolve({ behavior: "allow" });
    } else {
      pending.resolve({ behavior: "deny", message: "Denied by user" });
    }

    return true;
  }

  resolveQuestion(requestId: string, answer: string): boolean {
    const pending = pendingQuestions.get(requestId);
    if (!pending) return false;
    pending.resolve(answer);
    return true;
  }

  enableCustomInput(requestId: string, channelId: string): void {
    pendingCustomInputs.set(channelId, { requestId });
  }

  resolveCustomInput(channelId: string, text: string): boolean {
    const ci = pendingCustomInputs.get(channelId);
    if (!ci) return false;
    pendingCustomInputs.delete(channelId);

    const pending = pendingQuestions.get(ci.requestId);
    if (!pending) return false;
    pending.resolve(text);
    return true;
  }

  hasPendingCustomInput(channelId: string): boolean {
    return pendingCustomInputs.has(channelId);
  }

  // --- Message queue ---

  setPendingQueue(channelId: string, channel: TextChannel, prompt: string): void {
    this.pendingQueuePrompts.set(channelId, { channel, prompt });
  }

  confirmQueue(channelId: string): boolean {
    const pending = this.pendingQueuePrompts.get(channelId);
    if (!pending) return false;
    this.pendingQueuePrompts.delete(channelId);
    const queue = this.messageQueue.get(channelId) ?? [];
    queue.push(pending);
    this.messageQueue.set(channelId, queue);
    return true;
  }

  cancelQueue(channelId: string): void {
    this.pendingQueuePrompts.delete(channelId);
  }

  isQueueFull(channelId: string): boolean {
    const queue = this.messageQueue.get(channelId) ?? [];
    return queue.length >= SessionManager.MAX_QUEUE_SIZE;
  }

  getQueueSize(channelId: string): number {
    return (this.messageQueue.get(channelId) ?? []).length;
  }

  hasQueue(channelId: string): boolean {
    return this.pendingQueuePrompts.has(channelId);
  }

  getQueue(channelId: string): { channel: TextChannel; prompt: string }[] {
    return this.messageQueue.get(channelId) ?? [];
  }

  clearQueue(channelId: string): number {
    const queue = this.messageQueue.get(channelId) ?? [];
    const count = queue.length;
    this.messageQueue.delete(channelId);
    this.pendingQueuePrompts.delete(channelId);
    return count;
  }

  removeFromQueue(channelId: string, index: number): string | null {
    const queue = this.messageQueue.get(channelId);
    if (!queue || index < 0 || index >= queue.length) return null;
    const [removed] = queue.splice(index, 1);
    if (queue.length === 0) {
      this.messageQueue.delete(channelId);
      this.pendingQueuePrompts.delete(channelId);
    }
    return removed.prompt;
  }
}

export const sessionManager = new SessionManager();
