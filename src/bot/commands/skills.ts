import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("skills")
  .setDescription("Show available Claude Code skills (slash commands)");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel as TextChannel;

  try {
    if (!sessionManager.isActive(channel.id)) {
      await interaction.editReply({ content: L("🔄 Starting session...", "🔄 세션 시작 중...") });
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

  const commands = await sessionManager.getSupportedCommands(channel.id);

  if (!commands) {
    await interaction.editReply({
      content: L(
        "Could not retrieve skills. The session may still be initializing.",
        "스킬 목록을 가져올 수 없습니다. 세션이 아직 초기화 중일 수 있습니다.",
      ),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(L("Available Skills", "사용 가능한 스킬"))
    .setColor(0x7c3aed)
    .setFooter({ text: L(`${commands.length} skills`, `${commands.length}개 스킬`) })
    .setTimestamp();

  if (commands.length === 0) {
    embed.setDescription(L("No skills available.", "사용 가능한 스킬이 없습니다."));
  } else {
    const lines = commands.map((cmd) => {
      const hint = cmd.argumentHint ? ` \`${cmd.argumentHint}\`` : "";
      return `**/${cmd.name}**${hint}\n${cmd.description}`;
    });
    embed.setDescription(lines.join("\n\n"));
  }

  await interaction.editReply({ embeds: [embed] });
}
