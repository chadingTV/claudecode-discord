import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  TextChannel,
} from "discord.js";
import { sessionManager } from "../../claude/session-manager.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("context")
  .setDescription("Show current session's context window and token usage");

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toString();
}

function progressBar(pct: number, width = 20): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

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

  try {
    const usage = await sessionManager.getContextUsage(channel.id);
    if (!usage) {
      await interaction.editReply({
        content: L(
          "Could not retrieve context usage. The session may still be initializing.",
          "컨텍스트 사용량을 가져올 수 없습니다. 세션이 아직 초기화 중일 수 있습니다.",
        ),
      });
      return;
    }

    const pct = Math.round(usage.percentage);

    // Main context bar
    const lines: string[] = [
      `\`${progressBar(pct)}\`  **${pct}%**  (${formatTokens(usage.totalTokens)} / ${formatTokens(usage.maxTokens)})`,
    ];

    // Category breakdown
    if (usage.categories.length > 0) {
      lines.push("");
      lines.push(`**${L("Breakdown", "항목별")}**`);
      for (const cat of usage.categories) {
        if (cat.tokens === 0) continue;
        const catPct = usage.totalTokens > 0
          ? ((cat.tokens / usage.totalTokens) * 100).toFixed(1)
          : "0";
        lines.push(`> ${cat.name}: **${formatTokens(cat.tokens)}** (${catPct}%)`);
      }
    }

    // API usage (cumulative input/output tokens)
    if (usage.apiUsage) {
      lines.push("");
      lines.push(`**${L("API Token Usage", "API 토큰 사용량")}**`);
      lines.push(`> ${L("Input", "입력")}: **${formatTokens(usage.apiUsage.input_tokens)}**`);
      lines.push(`> ${L("Output", "출력")}: **${formatTokens(usage.apiUsage.output_tokens)}**`);
      if (usage.apiUsage.cache_read_input_tokens > 0) {
        lines.push(`> ${L("Cache read", "캐시 읽기")}: **${formatTokens(usage.apiUsage.cache_read_input_tokens)}**`);
      }
      if (usage.apiUsage.cache_creation_input_tokens > 0) {
        lines.push(`> ${L("Cache write", "캐시 쓰기")}: **${formatTokens(usage.apiUsage.cache_creation_input_tokens)}**`);
      }
    }

    // Message breakdown
    if (usage.messageBreakdown) {
      const mb = usage.messageBreakdown;
      lines.push("");
      lines.push(`**${L("Message Breakdown", "메시지 상세")}**`);
      if (mb.userMessageTokens > 0)
        lines.push(`> ${L("User messages", "사용자 메시지")}: **${formatTokens(mb.userMessageTokens)}**`);
      if (mb.assistantMessageTokens > 0)
        lines.push(`> ${L("Assistant messages", "어시스턴트 메시지")}: **${formatTokens(mb.assistantMessageTokens)}**`);
      if (mb.toolCallTokens > 0)
        lines.push(`> ${L("Tool calls", "도구 호출")}: **${formatTokens(mb.toolCallTokens)}**`);
      if (mb.toolResultTokens > 0)
        lines.push(`> ${L("Tool results", "도구 결과")}: **${formatTokens(mb.toolResultTokens)}**`);
    }

    // Auto-compact info
    if (usage.isAutoCompactEnabled && usage.autoCompactThreshold) {
      lines.push("");
      lines.push(`💡 ${L(
        `Auto-compact at ${usage.autoCompactThreshold}%`,
        `${usage.autoCompactThreshold}%에서 자동 압축`,
      )}`);
    }

    const embed = new EmbedBuilder()
      .setTitle(L("📊 Context Window Usage", "📊 컨텍스트 윈도우 사용량"))
      .setDescription(lines.join("\n"))
      .setColor(0x7c3aed)
      .setFooter({ text: `${L("Model", "모델")}: ${usage.model}` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error("[context] Failed to get context usage:", error);
    await interaction.editReply({
      content: L(
        "Failed to retrieve context usage information.",
        "컨텍스트 사용량 정보를 가져오는 데 실패했습니다.",
      ),
    });
  }
}
