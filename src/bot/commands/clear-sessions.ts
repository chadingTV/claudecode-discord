import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";
import { getProject, clearSession } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { cleanupProjectFiles } from "../../utils/cleanup.js";
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

  // Delete session files, session directory, and uploaded files
  const cleaned = cleanupProjectFiles(project.project_path);

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
          cleaned.sessionDir
            ? L("Session directory deleted", "세션 디렉토리 삭제됨")
            : L("No session directory found", "세션 디렉토리 없음"),
          cleaned.uploads
            ? L("Uploads directory deleted", "업로드 디렉토리 삭제됨")
            : L("No uploads directory found", "업로드 디렉토리 없음"),
          L(`Cleared **${messagesDeleted}** message(s)`, `**${messagesDeleted}**개의 메시지를 삭제했습니다`),
        ].join("\n"),
        color: 0xff6b6b,
      },
    ],
  });
}
