import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { getProject, getSession, upsertSession } from "../../db/database.js";
import { L } from "../../utils/i18n.js";

interface SessionInfo {
  sessionId: string;
  firstMessage: string;
  timestamp: string;
  fileSize: number;
}

/**
 * Find the Claude session directory for a given project path.
 * Claude Code stores sessions in ~/.claude/projects/<encoded-path>/
 * The encoding isn't just simple "/" -> "-" replacement (also replaces "_" etc.)
 * So we find the correct directory by checking JSONL file contents.
 */
export function findSessionDir(projectPath: string): string | null {
  const claudeDir = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(claudeDir)) return null;

  // Try simple conversion first (Claude Code encodes / and _ as -)
  const simpleName = projectPath.replace(/[\\/\_]/g, "-");
  const simplePath = path.join(claudeDir, simpleName);
  if (fs.existsSync(simplePath)) return simplePath;

  // Fallback: scan directories and match by reading JSONL cwd field
  const dirs = fs.readdirSync(claudeDir);
  for (const dir of dirs) {
    const dirPath = path.join(claudeDir, dir);
    if (!fs.statSync(dirPath).isDirectory()) continue;

    const jsonlFiles = fs.readdirSync(dirPath).filter((f) => f.endsWith(".jsonl"));
    if (jsonlFiles.length === 0) continue;

    // Read first few lines of the first JSONL to check cwd
    const firstFile = path.join(dirPath, jsonlFiles[0]);
    const content = fs.readFileSync(firstFile, { encoding: "utf-8" });
    const lines = content.split("\n").slice(0, 10);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.cwd === projectPath) return dirPath;
      } catch {
        // skip
      }
    }
  }

  return null;
}

/**
 * Read the last assistant text message from a JSONL session file.
 */
export async function getLastAssistantMessage(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lastText = "";

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "assistant" && entry.message?.content) {
        const content = entry.message.content;
        let raw = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              raw += block.text;
            }
          }
        } else if (typeof content === "string") {
          raw = content;
        }
        if (raw.trim()) {
          lastText = raw.trim();
        }
      }
    } catch {
      // skip
    }
  }

  rl.close();
  stream.destroy();

  if (!lastText) return "(no message)";

  // Extract the last meaningful sentence/line
  const lines = lastText.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] || lastText.slice(-200);
}

/**
 * Read the full last assistant text message from a JSONL session file.
 */
export async function getLastAssistantMessageFull(filePath: string): Promise<string> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lastText = "";

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === "assistant" && entry.message?.content) {
        const content = entry.message.content;
        let raw = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              raw += block.text;
            }
          }
        } else if (typeof content === "string") {
          raw = content;
        }
        if (raw.trim()) {
          lastText = raw.trim();
        }
      }
    } catch {
      // skip
    }
  }

  rl.close();
  stream.destroy();

  return lastText || "(no message)";
}

/**
 * Read the first user message from a JSONL session file.
 */
async function getFirstUserMessage(filePath: string): Promise<{ text: string; timestamp: string }> {
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let timestamp = "";
  let text = "";

  for await (const line of rl) {
    try {
      const entry = JSON.parse(line);

      // Grab timestamp from first line
      if (!timestamp && entry.timestamp) {
        timestamp = entry.timestamp;
      }

      // Find first user message with real text content (skip IDE-injected tags)
      if (entry.type === "user" && entry.message?.content) {
        const content = entry.message.content;
        let raw = "";
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text" && block.text) {
              raw = block.text;
              break;
            }
          }
        } else if (typeof content === "string") {
          raw = content;
        }
        // Strip system/IDE tags like <ide_opened_file>...</ide_opened_file>, <system-reminder>...
        const cleaned = raw.replace(/<[^>]+>[^<]*<\/[^>]+>/g, "").replace(/<[^>]+>/g, "").trim();
        if (cleaned) {
          text = cleaned;
          break;
        }
      }
    } catch {
      // skip malformed lines
    }
  }

  rl.close();
  stream.destroy();

  return { text: text || "(empty session)", timestamp };
}

/**
 * List all session JSONL files for a given project path.
 */
async function listSessions(projectPath: string): Promise<SessionInfo[]> {
  const sessionDir = findSessionDir(projectPath);
  if (!sessionDir) return [];

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  const sessions: SessionInfo[] = [];

  for (const file of files) {
    const filePath = path.join(sessionDir, file);
    const stat = fs.statSync(filePath);

    // Skip very small files (likely empty/abandoned sessions)
    if (stat.size < 512) continue;

    const sessionId = file.replace(".jsonl", "");
    const { text } = await getFirstUserMessage(filePath);

    // Skip sessions with no actual user message
    if (text === "(empty session)") continue;

    sessions.push({
      sessionId,
      firstMessage: text.slice(0, 80),
      timestamp: stat.mtime.toISOString(),
      fileSize: stat.size,
    });
  }

  // Sort by most recent first
  sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return sessions;
}

export const data = new SlashCommandBuilder()
  .setName("sessions")
  .setDescription("List and resume existing Claude Code sessions for this project");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L("This channel has no project. Send a message first to auto-register.", "이 채널에는 프로젝트가 없습니다. 먼저 메시지를 보내 자동 등록하세요."),
    });
    return;
  }

  const sessions = await listSessions(project.project_path);

  if (sessions.length === 0) {
    const { randomUUID } = await import("node:crypto");
    upsertSession(randomUUID(), channelId, null, "idle");
    await interaction.editReply({
      embeds: [
        {
          title: L("✨ New Session", "✨ 새 세션"),
          description: L(
            `No existing sessions found for \`${project.project_path}\`.\nA new session is ready — your next message will start a new conversation.`,
            `\`${project.project_path}\`에 대한 기존 세션이 없습니다.\n새 세션이 준비되었습니다 — 다음 메시지부터 새로운 대화가 시작됩니다.`
          ),
          color: 0x00ff00,
        },
      ],
    });
    return;
  }

  // Check currently active session for this channel
  const dbSession = getSession(channelId);
  const activeSessionId = dbSession?.session_id ?? null;

  // Build select menu (max 25 options, reserve 1 for "New Session")
  const options: Array<{ label: string; description: string; value: string; default?: boolean }> = [
    {
      label: L("✨ Create New Session", "✨ 새 세션 만들기"),
      description: L("Start a new conversation without an existing session", "기존 세션 없이 새로운 대화를 시작합니다"),
      value: "__new_session__",
    },
  ];

  const sessionOptions = sessions.slice(0, 24).map((s, i) => {
    const date = new Date(s.timestamp);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);
    const timeStr =
      diffMin < 1 ? L("just now", "방금") :
      diffMin < 60 ? L(`${diffMin}m ago`, `${diffMin}분 전`) :
      diffHr < 24 ? L(`${diffHr}h ago`, `${diffHr}시간 전`) :
      diffDay < 7 ? L(`${diffDay}d ago`, `${diffDay}일 전`) :
      date.toLocaleDateString(L("en-US", "ko-KR"), { month: "short", day: "numeric" });

    const sizeKB = Math.round(s.fileSize / 1024);
    const isActive = s.sessionId === activeSessionId;
    const label = isActive
      ? `▶ ${s.firstMessage.slice(0, 48)}`
      : s.firstMessage.slice(0, 50) || `Session ${i + 1}`;
    const desc = isActive
      ? `${L("Active", "사용 중")} | ${timeStr} | ${sizeKB}KB`
      : `${timeStr} | ${sizeKB}KB | ${s.sessionId.slice(0, 8)}...`;

    return {
      label,
      description: desc.slice(0, 100),
      value: s.sessionId,
      default: isActive,
    };
  });

  options.push(...sessionOptions);

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("session-select")
    .setPlaceholder(L("Select a session to resume...", "재개할 세션을 선택하세요..."))
    .addOptions(options);

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);

  await interaction.editReply({
    embeds: [
      {
        title: L("Claude Code Sessions", "Claude Code 세션"),
        description: [
          `Project: \`${project.project_path}\``,
          L(`Found **${sessions.length}** session(s)`, `**${sessions.length}**개의 세션을 찾았습니다`),
          "",
          L("Select a session below to resume or delete it.", "아래에서 세션을 선택하여 재개하거나 삭제하세요."),
        ].join("\n"),
        color: 0x7c3aed,
      },
    ],
    components: [row],
  });
}
