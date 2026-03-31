import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("models")
  .setDescription("Show available Claude models");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const models = await sessionManager.getSupportedModels(channelId);

  if (!models) {
    await interaction.editReply({
      content: L(
        "No active session in this channel. Start a session first.",
        "이 채널에 활성 세션이 없습니다. 먼저 세션을 시작하세요.",
      ),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(L("Available Models", "사용 가능한 모델"))
    .setColor(0x7c3aed)
    .setFooter({ text: L(`${models.length} models`, `${models.length}개 모델`) })
    .setTimestamp();

  if (models.length === 0) {
    embed.setDescription(L("No models available.", "사용 가능한 모델이 없습니다."));
  } else {
    for (const model of models) {
      embed.addFields({
        name: model.displayName,
        value: [
          `\`${model.value}\``,
          model.description,
        ].join("\n"),
        inline: false,
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}
