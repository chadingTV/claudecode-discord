import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TextChannel } from "discord.js";
import {
  upsertSession,
  updateSessionStatus,
  getProject,
  getSession,
  setAutoApprove,
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

interface ActiveSession {
  queryInstance: Query;
  channelId: string;
  sessionId: string | null; // Claude Agent SDK session ID
  dbId: string;
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

class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private static readonly MAX_QUEUE_SIZE = 5;
  private messageQueue = new Map<string, { channel: TextChannel; prompt: string }[]>();
  private pendingQueuePrompts = new Map<string, { channel: TextChannel; prompt: string }>();

  async sendMessage(
    channel: TextChannel,
    prompt: string,
  ): Promise<void> {
    const channelId = channel.id;
    const project = getProject(channelId);
    if (!project) return;

    const existingSession = this.sessions.get(channelId);
    // If no in-memory session, check DB for previous session_id (for bot restart resume)
    const dbSession = !existingSession ? getSession(channelId) : undefined;
    const dbId = existingSession?.dbId ?? dbSession?.id ?? randomUUID();
    const resumeSessionId = existingSession?.sessionId ?? dbSession?.session_id ?? undefined;

    // Update status to online
    upsertSession(dbId, channelId, resumeSessionId ?? null, "online");

    // Streaming state
    let responseBuffer = "";
    let lastEditTime = 0;
    const stopRow = createStopButton(channelId);
    let currentMessage = await channel.send({
      content: L("⏳ Thinking...", "⏳ 생각 중..."),
      components: [stopRow],
    });
    const EDIT_INTERVAL = 1500; // ms between edits (Discord rate limit friendly)

    // Activity tracking for progress display
    const startTime = Date.now();
    let lastActivity = L("Thinking...", "생각 중...");
    let toolUseCount = 0;
    let hasTextOutput = false;
    let hasResult = false;

    // Heartbeat timer - updates status message every 15s when no text output yet
    const heartbeatInterval = setInterval(async () => {
      if (hasTextOutput) return; // stop heartbeat once real content is streaming
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      try {
        await currentMessage.edit({
          content: `⏳ ${lastActivity} (${timeStr})`,
          components: [stopRow],
        });
      } catch (e) {
        console.warn(`[heartbeat] Failed to edit message for ${channelId}:`, e instanceof Error ? e.message : e);
      }
    }, 15_000);

    const runQuery = (useResume: boolean) => query({
      prompt,
      options: {
        cwd: project.project_path,
        permissionMode: "default",
        env: { ...process.env, ANTHROPIC_API_KEY: undefined, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ""}` },
        ...(useResume && resumeSessionId ? { resume: resumeSessionId } : {}),

        canUseTool: async (
          toolName: string,
          input: Record<string, unknown>,
        ) => {
          toolUseCount++;

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
          lastActivity = `${toolLabels[toolName] ?? `Using ${toolName}`}${filePath}`;

          // Update status message if no text output yet
          if (!hasTextOutput) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            const timeStr = elapsed > 60
              ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
              : `${elapsed}s`;
            try {
              await currentMessage.edit({
                content: `⏳ ${lastActivity} (${timeStr}) [${toolUseCount} tools used]`,
                components: [stopRow],
              });
            } catch (e) {
              console.warn(`[tool-status] Failed to edit message for ${channelId}:`, e instanceof Error ? e.message : e);
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

    let queryInstance = runQuery(Boolean(resumeSessionId));
    let attemptedResume = Boolean(resumeSessionId);

    try {
      retry: while (true) {
        // Store the active session (update each iteration so Stop button uses current instance)
        this.sessions.set(channelId, {
          queryInstance,
          channelId,
          sessionId: resumeSessionId ?? null,
          dbId,
        });

        try {
          for await (const message of queryInstance) {
            // Capture session ID
            if (
              message.type === "system" &&
              "subtype" in message &&
              message.subtype === "init"
            ) {
              const sdkSessionId = (message as { session_id?: string }).session_id;
              if (sdkSessionId) {
                const active = this.sessions.get(channelId);
                if (active) active.sessionId = sdkSessionId;
                upsertSession(dbId, channelId, sdkSessionId, "online");
              }
            }

            // Handle streaming text
            if (message.type === "assistant" && "content" in message) {
              const content = message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if ("text" in block && typeof block.text === "string") {
                    responseBuffer += block.text;
                    hasTextOutput = true;
                  }
                }
              }

              // Throttled message edit
              const now = Date.now();
              if (now - lastEditTime >= EDIT_INTERVAL && responseBuffer.length > 0) {
                lastEditTime = now;
                const chunks = splitMessage(responseBuffer);
                try {
                  await currentMessage.edit({ content: chunks[0] || "...", components: [] });
                  // Send additional chunks as new messages
                  for (let i = 1; i < chunks.length; i++) {
                    currentMessage = await channel.send(chunks[i]);
                    responseBuffer = chunks.slice(i + 1).join("");
                  }
                } catch (e) {
                  console.warn(`[stream] Failed to edit message for ${channelId}, sending new:`, e instanceof Error ? e.message : e);
                  currentMessage = await channel.send(
                    chunks[chunks.length - 1] || "...",
                  );
                }
              }
            }

            // Handle result
            if ("result" in message) {
              const resultMsg = message as {
                result?: string;
                total_cost_usd?: number;
                duration_ms?: number;
              };

              // Flush remaining buffer
              if (responseBuffer.length > 0) {
                const chunks = splitMessage(responseBuffer);
                try {
                  await currentMessage.edit(chunks[0] || L("Done.", "완료."));
                  for (let i = 1; i < chunks.length; i++) {
                    await channel.send(chunks[i]);
                  }
                } catch (e) {
                  console.warn(`[flush] Failed to edit final message for ${channelId}:`, e instanceof Error ? e.message : e);
                }
              }

              // Replace stop button with completed button
              try {
                await currentMessage.edit({
                  components: [createCompletedButton()],
                });
              } catch (e) {
                console.warn(`[complete] Failed to update completed button for ${channelId}:`, e instanceof Error ? e.message : e);
              }

              // Send result embed
              const resultText = resultMsg.result ?? L("Task completed", "작업 완료");
              const resultEmbed = createResultEmbed(
                resultText,
                resultMsg.total_cost_usd ?? 0,
                resultMsg.duration_ms ?? 0,
                getConfig().SHOW_COST,
              );
              await channel.send({ embeds: [resultEmbed] });

              // Detect auth/credit errors in result and suggest re-login
              const resultAuthKeywords = ["credit balance", "not authenticated", "unauthorized", "authentication", "login required", "auth token", "expired", "not logged in", "please run /login"];
              const lowerResult = resultText.toLowerCase();
              if (resultAuthKeywords.some((kw) => lowerResult.includes(kw))) {
                await channel.send(L(
                  "🔑 Claude Code is not logged in. Please open a terminal on the host PC and run `claude login` to authenticate, then try again.",
                  "🔑 Claude Code 로그인이 필요합니다. 호스트 PC에서 터미널을 열고 `claude login`을 실행하여 인증 후 다시 시도해 주세요.",
                ));
              }

              updateSessionStatus(channelId, "idle");
              hasResult = true;
            }
          }
          break;
        } catch (innerError) {
          // If the resume attempt crashed before any user-visible output, the saved
          // session_id is likely stale. Silently retry once without resume.
          const rawMsg = innerError instanceof Error ? innerError.message : String(innerError);
          const resumeStale =
            attemptedResume &&
            !hasTextOutput &&
            !hasResult &&
            (rawMsg.includes("process exited with code") ||
              rawMsg.includes("No conversation found") ||
              rawMsg.includes("session not found") ||
              /resume/i.test(rawMsg));
          if (!resumeStale) throw innerError;

          console.warn(`[session] Resume failed for ${channelId}, retrying without resume:`, rawMsg);
          upsertSession(dbId, channelId, null, "online");
          queryInstance = runQuery(false);
          attemptedResume = false;
          continue retry;
        }
      }
    } catch (error) {
      // Skip error if result was already delivered (e.g., "Credit balance is too low" + exit code 1)
      if (hasResult) {
        console.warn(`[session] Ignoring post-result error for ${channelId}:`, error instanceof Error ? error.message : error);
        return;
      }
      const rawMsg =
        error instanceof Error ? error.message : "Unknown error occurred";

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
          // Fall back to extracting just the status code
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
    } finally {
      clearInterval(heartbeatInterval);
      this.sessions.delete(channelId);

      // Clean up any pending approvals/questions for this channel
      for (const [id, entry] of pendingApprovals) {
        if (entry.channelId === channelId) pendingApprovals.delete(id);
      }
      for (const [id, entry] of pendingQuestions) {
        if (entry.channelId === channelId) pendingQuestions.delete(id);
      }
      pendingCustomInputs.delete(channelId);

      // Process next queued message if any
      const queue = this.messageQueue.get(channelId);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        if (queue.length === 0) this.messageQueue.delete(channelId);
        const remaining = queue.length;
        const preview = next.prompt.length > 40 ? next.prompt.slice(0, 40) + "…" : next.prompt;
        const msg = remaining > 0
          ? L(`📨 Processing queued message... (remaining: ${remaining})\n> ${preview}`, `📨 대기 중이던 메시지를 처리합니다... (남은 큐: ${remaining}개)\n> ${preview}`)
          : L(`📨 Processing queued message...\n> ${preview}`, `📨 대기 중이던 메시지를 처리합니다...\n> ${preview}`);
        channel.send(msg).catch(() => {});
        this.sendMessage(next.channel, next.prompt).catch((err) => {
          console.error("Queue sendMessage error:", err);
        });
      }
    }
  }

  async stopSession(channelId: string): Promise<boolean> {
    const session = this.sessions.get(channelId);
    if (!session) return false;

    try {
      await session.queryInstance.interrupt();
    } catch {
      // already stopped
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
    return true;
  }

  isActive(channelId: string): boolean {
    return this.sessions.has(channelId);
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
