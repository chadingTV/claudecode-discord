import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("agents")
  .setDescription("Show available Claude Code agent types");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const agents = await sessionManager.getSupportedAgents(channelId);

  if (!agents) {
    await interaction.editReply({
      content: L(
        "No active session in this channel. Start a session first.",
        "이 채널에 활성 세션이 없습니다. 먼저 세션을 시작하세요.",
      ),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(L("Available Agents", "사용 가능한 에이전트"))
    .setColor(0x7c3aed)
    .setFooter({ text: L(`${agents.length} agents`, `${agents.length}개 에이전트`) })
    .setTimestamp();

  if (agents.length === 0) {
    embed.setDescription(L("No agents available.", "사용 가능한 에이전트가 없습니다."));
  } else {
    for (const agent of agents) {
      const modelInfo = agent.model ? `\n${L("Model", "모델")}: \`${agent.model}\`` : "";
      embed.addFields({
        name: agent.name,
        value: `${agent.description}${modelInfo}`,
        inline: false,
      });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}
