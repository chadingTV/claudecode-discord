import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getProject } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

const STATUS_EMOJI: Record<string, string> = {
  connected: "🟢",
  pending: "🟡",
  "needs-auth": "🔑",
  failed: "🔴",
  disabled: "⚫",
};

export const data = new SlashCommandBuilder()
  .setName("mcp")
  .setDescription("Show available MCP servers and their connection status");

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

  if (!sessionManager.isActive(channelId)) {
    await interaction.editReply({
      content: L(
        "No active session in this channel. Send a message to start one.",
        "이 채널에 활성 세션이 없습니다. 메시지를 보내 세션을 시작하세요.",
      ),
    });
    return;
  }

  try {
    const servers = await sessionManager.getMcpStatus(channelId);
    if (!servers) {
      await interaction.editReply({
        content: L(
          "Could not retrieve MCP status. The session may still be initializing.",
          "MCP 상태를 가져올 수 없습니다. 세션이 아직 초기화 중일 수 있습니다.",
        ),
      });
      return;
    }

    if (servers.length === 0) {
      await interaction.editReply({
        content: L(
          "No MCP servers configured for this session.",
          "이 세션에 구성된 MCP 서버가 없습니다.",
        ),
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(L("🔌 MCP Servers", "🔌 MCP 서버"))
      .setColor(0x7c3aed)
      .setTimestamp();

    for (const server of servers) {
      const emoji = STATUS_EMOJI[server.status] ?? "❓";
      const lines: string[] = [
        `${L("Status", "상태")}: **${server.status}**`,
      ];

      if (server.scope) {
        lines.push(`${L("Scope", "범위")}: ${server.scope}`);
      }

      if (server.serverInfo) {
        lines.push(`${L("Version", "버전")}: ${server.serverInfo.version}`);
      }

      if (server.error) {
        lines.push(`${L("Error", "오류")}: \`${server.error}\``);
      }

      if (server.tools && server.tools.length > 0) {
        const toolNames = server.tools.map((t) => `\`${t.name}\``).join(", ");
        lines.push(`${L("Tools", "도구")} (${server.tools.length}): ${toolNames}`);
      }

      embed.addFields({
        name: `${emoji} ${server.name}`,
        value: lines.join("\n"),
        inline: false,
      });
    }

    const connected = servers.filter((s) => s.status === "connected").length;
    embed.setFooter({
      text: L(
        `${connected}/${servers.length} connected`,
        `${connected}/${servers.length} 연결됨`,
      ),
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[mcp] Failed to get MCP status:", error);
    await interaction.editReply({
      content: L(
        "Failed to retrieve MCP server status.",
        "MCP 서버 상태를 가져오는 데 실패했습니다.",
      ),
    });
  }
}
