import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getAllProjects, getSession } from "../../db/database.js";
import type { Session } from "../../db/types.js";
import { getConfig } from "../../utils/config.js";
import { L } from "../../utils/i18n.js";

const STATUS_EMOJI: Record<string, string> = {
  online: "🟢",
  waiting: "🟡",
  idle: "⚪",
  offline: "🔴",
};

export function formatSessionUsage(
  session: Pick<Session, "turn_count" | "total_cost_usd"> | undefined,
  showCost: boolean,
): string {
  const turns = `${L("Turns", "턴 수")}: ${session?.turn_count ?? 0}`;
  if (!showCost) return turns;
  const cost = (session?.total_cost_usd ?? 0).toFixed(4);
  return `${turns}  |  ${L("Cost (est.)", "비용 (추정)")}: $${cost}`;
}

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Show status of all registered project sessions");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const projects = getAllProjects(guildId);

  if (projects.length === 0) {
    await interaction.editReply({
      content: L("No projects registered. Use `/register` in a channel first.", "등록된 프로젝트가 없습니다. 먼저 채널에서 `/register`를 사용하세요."),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(L("Claude Code Sessions", "Claude Code 세션"))
    .setColor(0x7c3aed)
    .setTimestamp();

  for (const project of projects) {
    const session = getSession(project.channel_id);
    const status = session?.status ?? "offline";
    const emoji = STATUS_EMOJI[status] ?? "🔴";
    const lastActivity = session?.last_activity ?? "never";

    embed.addFields({
      name: `${emoji} <#${project.channel_id}>`,
      value: [
        `\`${project.project_path}\``,
        `${L("Status", "상태")}: **${status}**`,
        `${L("Auto-approve", "자동 승인")}: ${project.auto_approve ? L("On", "켜짐") : L("Off", "꺼짐")}`,
        `${L("Last activity", "마지막 활동")}: ${lastActivity}`,
        formatSessionUsage(session, getConfig().SHOW_COST),
      ].join("\n"),
      inline: false,
    });
  }

  await interaction.editReply({ embeds: [embed] });
}
