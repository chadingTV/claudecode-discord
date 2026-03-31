import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { getProject, clearSession } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { findSessionDir } from "./sessions.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("clear-sessions")
  .setDescription("Delete all Claude Code session files for this project")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

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

  // Stop active session first to avoid race conditions
  if (sessionManager.isActive(channelId)) {
    await sessionManager.stopSession(channelId);
  }

  // Delete session JSONL files if directory exists
  let deleted = 0;
  const sessionDir = findSessionDir(project.project_path);
  if (sessionDir) {
    const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(sessionDir, file));
        deleted++;
      } catch {
        // skip files that can't be deleted
      }
    }
  }

  // Clear the session record from DB so the bot doesn't try to resume a deleted session
  clearSession(channelId);

  // Clear channel messages (bulk delete only works for messages <14 days old)
  // Get the deferred reply message ID so we don't delete it
  const replyMessage = await interaction.fetchReply();
  const replyId = replyMessage.id;
  let messagesDeleted = 0;
  try {
    const channel = interaction.channel as TextChannel;
    let fetched;
    do {
      fetched = await channel.messages.fetch({ limit: 100 });
      if (fetched.size === 0) break;
      const deletable = fetched.filter(
        (m) =>
          m.id !== replyId &&
          Date.now() - m.createdTimestamp < 14 * 24 * 60 * 60 * 1000,
      );
      if (deletable.size === 0) break;
      await channel.bulkDelete(deletable, true);
      messagesDeleted += deletable.size;
    } while (fetched.size === 100);
  } catch (e) {
    console.warn(`[clear-sessions] Failed to clear messages for ${channelId}:`, e instanceof Error ? e.message : e);
  }

  await interaction.editReply({
    embeds: [
      {
        title: L("Sessions Cleared", "세션 정리됨"),
        description: [
          `Project: \`${project.project_path}\``,
          L(`Deleted **${deleted}** session file(s)`, `**${deleted}**개의 세션 파일이 삭제되었습니다`),
          L(`Cleared **${messagesDeleted}** message(s)`, `**${messagesDeleted}**개의 메시지를 삭제했습니다`),
        ].join("\n"),
        color: 0xff6b6b,
      },
    ],
  });
}
