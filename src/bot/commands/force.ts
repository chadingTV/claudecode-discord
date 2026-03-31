import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { getProject } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("force")
  .setDescription("Stop current task, clear queue, and send a new message")
  .addStringOption((option) =>
    option
      .setName("message")
      .setDescription("The message to send to Claude")
      .setRequired(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L(
        "This channel is not registered to any project.",
        "이 채널은 어떤 프로젝트에도 등록되어 있지 않습니다.",
      ),
    });
    return;
  }

  const prompt = interaction.options.getString("message", true);

  // Stop current session if active
  const wasActive = sessionManager.isBusy(channelId);
  const queueCleared = sessionManager.clearQueue(channelId);
  if (wasActive) {
    await sessionManager.stopSession(channelId);
  }

  const parts: string[] = [];
  if (wasActive) parts.push(L("Stopped active task", "활성 작업 중지됨"));
  if (queueCleared > 0)
    parts.push(
      L(
        `Cleared ${queueCleared} queued message(s)`,
        `대기 중인 메시지 ${queueCleared}개 제거됨`,
      ),
    );
  const status =
    parts.length > 0 ? parts.join(", ") + ". " : "";

  await interaction.editReply({
    content: `⚡ ${status}${L("Sending new message...", "새 메시지 전송 중...")}`,
  });

  const channel = interaction.channel as TextChannel;
  await sessionManager.sendMessage(channel, prompt);
}
