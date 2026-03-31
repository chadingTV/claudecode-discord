import {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { isAllowedUser } from "../../security/guard.js";
import { sessionManager } from "../../claude/session-manager.js";
import { upsertSession, getProject, getSession } from "../../db/database.js";
import { findSessionDir, getLastAssistantMessage } from "../commands/sessions.js";
import { L } from "../../utils/i18n.js";

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
): Promise<void> {
  if (!isAllowedUser(interaction.user.id)) {
    await interaction.reply({
      content: L("You are not authorized.", "권한이 없습니다."),
      ephemeral: true,
    });
    return;
  }

  const customId = interaction.customId;
  // Use split with limit to handle session IDs that might contain colons
  const colonIndex = customId.indexOf(":");
  const action = colonIndex === -1 ? customId : customId.slice(0, colonIndex);
  const requestId = colonIndex === -1 ? "" : customId.slice(colonIndex + 1);

  if (!requestId) {
    await interaction.reply({
      content: L("Invalid button interaction.", "잘못된 버튼 상호작용입니다."),
      ephemeral: true,
    });
    return;
  }

  // Handle stop button
  if (action === "stop") {
    const channelId = requestId;
    const stopped = await sessionManager.stopSession(channelId);
    await interaction.update({
      content: L("⏹️ Task has been stopped.", "⏹️ 작업이 중지되었습니다."),
      components: [],
    });
    if (!stopped) {
      await interaction.followUp({
        content: L("No active session.", "활성 세션이 없습니다."),
        ephemeral: true,
      });
    }
    return;
  }

  // Handle queue confirmation
  if (action === "queue-yes") {
    const channelId = requestId;
    const confirmed = sessionManager.confirmQueue(channelId);
    if (!confirmed) {
      await interaction.update({
        content: L("⏳ Queue request has expired.", "⏳ 큐 요청이 만료되었습니다."),
        components: [],
      });
      return;
    }
    const queueSize = sessionManager.getQueueSize(channelId);
    await interaction.update({
      content: L(`📨 Message added to queue (${queueSize}/5). It will be processed after the current task.`, `📨 메시지가 큐에 추가되었습니다 (${queueSize}/5). 이전 작업 완료 후 자동으로 처리됩니다.`),
      components: [],
    });
    return;
  }

  // Handle queue cancellation
  if (action === "queue-no") {
    const channelId = requestId;
    sessionManager.cancelQueue(channelId);
    await interaction.update({
      content: L("Cancelled.", "취소되었습니다."),
      components: [],
    });
    return;
  }

  // Handle session resume button
  if (action === "session-resume") {
    const sessionId = requestId;
    const channelId = interaction.channelId;
    const { randomUUID } = await import("node:crypto");
    // Close existing in-memory session before switching
    await sessionManager.stopSession(channelId);
    upsertSession(randomUUID(), channelId, sessionId, "idle");

    await interaction.update({
      embeds: [
        {
          title: L("Session Resumed", "세션 재개됨"),
          description: L(
            `Session: \`${sessionId.slice(0, 8)}...\`\n\nNext message you send will resume this conversation.`,
            `세션: \`${sessionId.slice(0, 8)}...\`\n\n다음 메시지부터 이 대화가 재개됩니다.`
          ),
          color: 0x00ff00,
        },
      ],
      components: [],
    });
    return;
  }

  // Handle session cancel button
  if (action === "session-cancel") {
    await interaction.update({
      content: L("Cancelled.", "취소되었습니다."),
      embeds: [],
      components: [],
    });
    return;
  }

  // Handle AskUserQuestion option selection
  if (action === "ask-opt") {
    // requestId format: "uuid:optionIndex"
    const lastColon = requestId.lastIndexOf(":");
    const actualRequestId = requestId.slice(0, lastColon);
    const selectedLabel = ("label" in interaction.component ? interaction.component.label : null) ?? "Unknown";

    const resolved = sessionManager.resolveQuestion(actualRequestId, selectedLabel);
    if (!resolved) {
      await interaction.reply({ content: L("This question has expired.", "이 질문은 만료되었습니다."), ephemeral: true });
      return;
    }

    await interaction.update({
      content: L(`✅ Selected: **${selectedLabel}**`, `✅ 선택됨: **${selectedLabel}**`),
      embeds: [],
      components: [],
    });
    return;
  }

  // Handle AskUserQuestion custom text input
  if (action === "ask-other") {
    sessionManager.enableCustomInput(requestId, interaction.channelId);

    await interaction.update({
      content: L("✏️ Type your answer...", "✏️ 답변을 입력하세요..."),
      embeds: [],
      components: [],
    });
    return;
  }

  // Handle queue clear button
  if (action === "queue-clear") {
    const channelId = requestId;
    const cleared = sessionManager.clearQueue(channelId);
    await interaction.update({
      embeds: [
        {
          title: L("Queue Cleared", "큐 초기화됨"),
          description: L(
            `Cleared ${cleared} queued message(s).`,
            `${cleared}개의 대기 중이던 메시지를 취소했습니다.`
          ),
          color: 0xff6600,
        },
      ],
      components: [],
    });
    return;
  }

  // Handle queue remove individual item button
  if (action === "queue-remove") {
    // requestId format: "channelId:index"
    const lastColon = requestId.lastIndexOf(":");
    const channelId = requestId.slice(0, lastColon);
    const index = parseInt(requestId.slice(lastColon + 1), 10);
    const removed = sessionManager.removeFromQueue(channelId, index);

    if (!removed) {
      await interaction.update({
        content: L("This item is no longer in the queue.", "이 항목은 이미 큐에 없습니다."),
        embeds: [],
        components: [],
      });
      return;
    }

    const preview = removed.length > 60 ? removed.slice(0, 60) + "…" : removed;

    // Show updated queue
    const queue = sessionManager.getQueue(channelId);
    if (queue.length === 0) {
      await interaction.update({
        embeds: [
          {
            title: L("Message Removed", "메시지 취소됨"),
            description: L(`Removed: ${preview}\n\nQueue is now empty.`, `취소됨: ${preview}\n\n큐가 비었습니다.`),
            color: 0xff6600,
          },
        ],
        components: [],
      });
      return;
    }

    // Rebuild list and buttons with updated queue
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = await import("discord.js");
    const list = queue
      .map((item: { prompt: string }, idx: number) => {
        const p = item.prompt.length > 100 ? item.prompt.slice(0, 100) + "…" : item.prompt;
        return `**${idx + 1}.** ${p}`;
      })
      .join("\n\n");

    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    const itemButtons = queue.map((_: unknown, idx: number) =>
      new ButtonBuilder()
        .setCustomId(`queue-remove:${channelId}:${idx}`)
        .setLabel(`❌ ${idx + 1}`)
        .setStyle(ButtonStyle.Secondary)
    );
    const clearButton = new ButtonBuilder()
      .setCustomId(`queue-clear:${channelId}`)
      .setLabel(L("Clear All", "모두 취소"))
      .setStyle(ButtonStyle.Danger);

    const allButtons = [...itemButtons.slice(0, 19), clearButton];
    for (let i = 0; i < allButtons.length; i += 5) {
      const chunk = allButtons.slice(i, i + 5);
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...chunk));
    }

    await interaction.update({
      embeds: [
        {
          title: L(
            `📋 Message Queue (${queue.length})`,
            `📋 메시지 큐 (${queue.length}개)`
          ),
          description: `~~${preview}~~ ${L("removed", "취소됨")}\n\n${list}`,
          color: 0x5865f2,
        },
      ],
      components: rows,
    });
    return;
  }

  // Handle session delete button
  if (action === "session-delete") {
    const sessionId = requestId;
    const channelId = interaction.channelId;
    const project = getProject(channelId);

    if (!project) {
      await interaction.update({
        content: L("Project not found.", "프로젝트를 찾을 수 없습니다."),
        embeds: [],
        components: [],
      });
      return;
    }

    const sessionDir = findSessionDir(project.project_path);
    if (sessionDir) {
      const filePath = path.join(sessionDir, `${sessionId}.jsonl`);
      try {
        fs.unlinkSync(filePath);

        // If deleting the currently active session, reset DB so next message creates fresh session
        const dbSession = getSession(channelId);
        if (dbSession?.session_id === sessionId) {
          const { randomUUID } = await import("node:crypto");
          upsertSession(randomUUID(), channelId, null, "idle");
        }

        await interaction.update({
          embeds: [
            {
              title: L("Session Deleted", "세션 삭제됨"),
              description: L(
                `Session \`${sessionId.slice(0, 8)}...\` has been deleted.\nYour next message will start a new conversation.`,
                `세션 \`${sessionId.slice(0, 8)}...\`이(가) 삭제되었습니다.\n다음 메시지부터 새로운 대화가 시작됩니다.`
              ),
              color: 0xff6b6b,
            },
          ],
          components: [],
        });
      } catch {
        await interaction.update({
          content: L("Failed to delete session file.", "세션 파일 삭제에 실패했습니다."),
          embeds: [],
          components: [],
        });
      }
    }
    return;
  }

  let decision: "approve" | "deny" | "approve-all";
  if (action === "approve") {
    decision = "approve";
  } else if (action === "deny") {
    decision = "deny";
  } else if (action === "approve-all") {
    decision = "approve-all";
  } else {
    return;
  }

  const resolved = sessionManager.resolveApproval(requestId, decision);
  if (!resolved) {
    await interaction.reply({
      content: L("This approval request has expired.", "이 승인 요청은 만료되었습니다."),
      ephemeral: true,
    });
    return;
  }

  const labels: Record<string, string> = {
    approve: L("✅ Approved", "✅ 승인됨"),
    deny: L("❌ Denied", "❌ 거부됨"),
    "approve-all": L("⚡ Auto-approve enabled for this channel", "⚡ 이 채널에서 자동 승인이 활성화되었습니다"),
  };

  await interaction.update({
    content: labels[decision],
    components: [], // remove buttons
  });
}

export async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (!isAllowedUser(interaction.user.id)) {
    await interaction.reply({
      content: L("You are not authorized.", "권한이 없습니다."),
      ephemeral: true,
    });
    return;
  }

  // Handle AskUserQuestion multi-select
  if (interaction.customId.startsWith("ask-select:")) {
    const askRequestId = interaction.customId.slice("ask-select:".length);
    const options = (interaction.component as any).options ?? [];
    const selectedLabels = interaction.values.map((val: string) => {
      const opt = options.find((o: any) => o.value === val);
      return opt?.label ?? val;
    });
    const answer = selectedLabels.join(", ");

    const resolved = sessionManager.resolveQuestion(askRequestId, answer);
    if (!resolved) {
      await interaction.reply({ content: L("This question has expired.", "이 질문은 만료되었습니다."), ephemeral: true });
      return;
    }

    await interaction.update({
      content: L(`✅ Selected: **${answer}**`, `✅ 선택됨: **${answer}**`),
      embeds: [],
      components: [],
    });
    return;
  }

  if (interaction.customId === "session-select") {
    const selectedSessionId = interaction.values[0];

    // Handle "New Session" option
    if (selectedSessionId === "__new_session__") {
      const channelId = interaction.channelId;
      const { randomUUID } = await import("node:crypto");
      // Close existing in-memory session before starting fresh
      await sessionManager.stopSession(channelId);
      // Set session_id to null so next message creates a fresh session
      upsertSession(randomUUID(), channelId, null, "idle");

      await interaction.update({
        embeds: [
          {
            title: L("✨ New Session", "✨ 새 세션"),
            description: L("New session is ready.\nA new conversation will start from your next message.", "새 세션이 준비되었습니다.\n다음 메시지부터 새로운 대화가 시작됩니다."),
            color: 0x00ff00,
          },
        ],
        components: [],
      });
      return;
    }

    // Defer first to avoid 3s timeout while reading JSONL
    await interaction.deferUpdate();

    // Read last assistant message from session file
    const channelId = interaction.channelId;
    const project = getProject(channelId);
    let lastMessage = "";
    if (project) {
      const sessionDir = findSessionDir(project.project_path);
      if (sessionDir) {
        const filePath = path.join(sessionDir, `${selectedSessionId}.jsonl`);
        try {
          lastMessage = await getLastAssistantMessage(filePath);
        } catch {
          // ignore
        }
      }
    }

    // Show Resume / Delete buttons
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`session-resume:${selectedSessionId}`)
        .setLabel(L("Resume", "재개"))
        .setStyle(ButtonStyle.Success)
        .setEmoji("▶️"),
      new ButtonBuilder()
        .setCustomId(`session-delete:${selectedSessionId}`)
        .setLabel(L("Delete", "삭제"))
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️"),
      new ButtonBuilder()
        .setCustomId(`session-cancel:_`)
        .setLabel(L("Cancel", "취소"))
        .setStyle(ButtonStyle.Secondary),
    );

    const preview = lastMessage && lastMessage !== "(no message)"
      ? `\n\n${L("**Last conversation:**", "**마지막 대화:**")}\n${lastMessage.slice(0, 300)}${lastMessage.length > 300 ? "..." : ""}`
      : "";

    await interaction.editReply({
      embeds: [
        {
          title: L("Session Selected", "세션 선택됨"),
          description: L(`Session: \`${selectedSessionId.slice(0, 8)}...\`\n\nResume or delete this session?`, `세션: \`${selectedSessionId.slice(0, 8)}...\`\n\n이 세션을 재개 또는 삭제하시겠습니까?`) + preview,
          color: 0x7c3aed,
        },
      ],
      components: [row],
    });
  }
}
