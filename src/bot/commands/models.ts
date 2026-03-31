import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("models")
  .setDescription("Show available Claude models");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel as TextChannel;

  try {
    await sessionManager.ensureSession(channel);
  } catch (error) {
    await interaction.editReply({
      content: L(
        `Failed to start session: ${error instanceof Error ? error.message : "Unknown error"}`,
        `세션 시작 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      ),
    });
    return;
  }

  const models = await sessionManager.getSupportedModels(channel.id);

  if (!models) {
    await interaction.editReply({
      content: L(
        "Could not retrieve models. The session may still be initializing.",
        "모델 목록을 가져올 수 없습니다. 세션이 아직 초기화 중일 수 있습니다.",
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
