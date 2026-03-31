import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { getProject, clearSession } from "../../db/database.js";
import { findSessionDir } from "./sessions.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("clear-sessions")
  .setDescription("Delete all Claude Code session files for this project")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const channelId = interaction.channelId;
  const project = getProject(channelId);

  if (!project) {
    await interaction.editReply({
      content: L("This channel is not registered. Set a workspace with `/workspace` and send a message first.", "이 채널은 등록되지 않았습니다. `/workspace`로 워크스페이스를 설정한 후 메시지를 보내세요."),
    });
    return;
  }

  const sessionDir = findSessionDir(project.project_path);
  if (!sessionDir) {
    await interaction.editReply({
      content: L(`No session directory found for \`${project.project_path}\``, `\`${project.project_path}\`에 대한 세션 디렉토리를 찾을 수 없습니다`),
    });
    return;
  }

  const files = fs.readdirSync(sessionDir).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) {
    await interaction.editReply({
      content: L("No session files to delete.", "삭제할 세션 파일이 없습니다."),
    });
    return;
  }

  let deleted = 0;
  for (const file of files) {
    try {
      fs.unlinkSync(path.join(sessionDir, file));
      deleted++;
    } catch {
      // skip files that can't be deleted
    }
  }

  // Also clear the session record from DB so the bot doesn't try to resume a deleted session
  clearSession(channelId);

  await interaction.editReply({
    embeds: [
      {
        title: L("Sessions Cleared", "세션 정리됨"),
        description: [
          `Project: \`${project.project_path}\``,
          L(`Deleted **${deleted}** session file(s)`, `**${deleted}**개의 세션 파일이 삭제되었습니다`),
        ].join("\n"),
        color: 0xff6b6b,
      },
    ],
  });
}
