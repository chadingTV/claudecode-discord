import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
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
  .setDescription("Show or toggle MCP servers")
  .addStringOption((opt) =>
    opt
      .setName("server")
      .setDescription("Server name to toggle on/off")
      .setRequired(false)
      .setAutocomplete(true),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channel = interaction.channel as TextChannel;
  const serverArg = interaction.options.getString("server");

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

  try {
    // Toggle mode
    if (serverArg) {
      const servers = await sessionManager.getMcpStatus(channel.id);
      if (!servers || servers.length === 0) {
        await interaction.editReply({
          content: L(
            "No MCP servers configured for this session.",
            "이 세션에 구성된 MCP 서버가 없습니다.",
          ),
        });
        return;
      }

      const target = servers.find((s) => s.name === serverArg);
      if (!target) {
        const available = servers.map((s) => `\`${s.name}\``).join(", ");
        await interaction.editReply({
          content: L(
            `Server \`${serverArg}\` not found. Available: ${available}`,
            `서버 \`${serverArg}\`을(를) 찾을 수 없습니다. 사용 가능: ${available}`,
          ),
        });
        return;
      }

      const newEnabled = target.status === "disabled";
      await sessionManager.toggleMcpServer(channel.id, serverArg, newEnabled);

      const emoji = newEnabled ? "🟢" : "⚫";
      const stateText = newEnabled
        ? L("enabled", "활성화")
        : L("disabled", "비활성화");

      const embed = new EmbedBuilder()
        .setTitle(L("🔌 MCP Server Toggled", "🔌 MCP 서버 전환"))
        .setColor(newEnabled ? 0x22c55e : 0x6b7280)
        .addFields({
          name: `${emoji} ${serverArg}`,
          value: `${L("Status", "상태")}: **${stateText}**`,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Status mode (existing behavior)
    const servers = await sessionManager.getMcpStatus(channel.id);
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
    console.error("[mcp] Failed:", error);
    await interaction.editReply({
      content: L(
        "Failed to process MCP command.",
        "MCP 명령을 처리하는 데 실패했습니다.",
      ),
    });
  }
}

export async function autocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const channel = interaction.channel as TextChannel;
  const focused = interaction.options.getFocused();

  try {
    if (!sessionManager.isActive(channel.id)) {
      await interaction.respond([]);
      return;
    }
    const servers = await sessionManager.getMcpStatus(channel.id);
    if (!servers) {
      await interaction.respond([]);
      return;
    }

    const choices = servers
      .filter((s) => s.name.toLowerCase().includes(focused.toLowerCase()))
      .map((s) => {
        const emoji = s.status === "disabled" ? "⚫" : "🟢";
        return { name: `${emoji} ${s.name} (${s.status})`, value: s.name };
      })
      .slice(0, 25);

    await interaction.respond(choices);
  } catch {
    await interaction.respond([]);
  }
}
