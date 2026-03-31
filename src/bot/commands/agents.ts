import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("agents")
  .setDescription("Show available Claude Code agent types");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel as TextChannel;

  try {
    if (!sessionManager.isActive(channel.id)) {
      await interaction.editReply({ content: L("🔄 Loading...", "🔄 로딩 중...") });
    }
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

  const agents = await sessionManager.getSupportedAgents(channel.id);

  if (!agents) {
    await interaction.editReply({
      content: L(
        "Could not retrieve agents. The session may still be initializing.",
        "에이전트 목록을 가져올 수 없습니다. 세션이 아직 초기화 중일 수 있습니다.",
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
