import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("skills")
  .setDescription("Show available Claude Code skills (slash commands)");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const commands = await sessionManager.getSupportedCommands(channelId);

  if (!commands) {
    await interaction.editReply({
      content: L(
        "No active session in this channel. Start a session first.",
        "이 채널에 활성 세션이 없습니다. 먼저 세션을 시작하세요.",
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
