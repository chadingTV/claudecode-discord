import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { setWorkspace, getWorkspace } from "../../db/database.js";
import { getConfig } from "../../utils/config.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("workspace")
  .setDescription("Set or view the workspace directory for this server")
  .addStringOption((opt) =>
    opt
      .setName("path")
      .setDescription("Workspace directory path")
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId!;
  const inputPath = interaction.options.getString("path");

  // Show current workspace if no path given
  if (!inputPath) {
    const workspace = getWorkspace(guildId);
    if (!workspace) {
      await interaction.editReply({
        content: L(
          "No workspace set. Use `/workspace path:<directory>` to set one.",
          "워크스페이스가 설정되지 않았습니다. `/workspace path:<디렉토리>`로 설정하세요.",
        ),
      });
      return;
    }
    await interaction.editReply({
      embeds: [
        {
          title: L("Current Workspace", "현재 워크스페이스"),
          description: `\`${workspace.workspace_path}\``,
          color: 0x5865f2,
        },
      ],
    });
    return;
  }

  const config = getConfig();
  const workspacePath = path.isAbsolute(inputPath)
    ? inputPath
    : path.join(config.BASE_PROJECT_DIR, inputPath);

  // Security: must be within BASE_PROJECT_DIR
  const resolved = path.resolve(workspacePath);
  const baseDir = path.resolve(config.BASE_PROJECT_DIR);
  if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
    await interaction.editReply({
      content: L(
        `Invalid path: must be within \`${baseDir}\``,
        `잘못된 경로: \`${baseDir}\` 내에 있어야 합니다`,
      ),
    });
    return;
  }

  if (workspacePath.includes("..")) {
    await interaction.editReply({
      content: L(
        "Invalid path: must not contain '..'",
        "잘못된 경로: '..'을 포함할 수 없습니다",
      ),
    });
    return;
  }

  // Create directory if needed
  if (!fs.existsSync(workspacePath)) {
    fs.mkdirSync(workspacePath, { recursive: true });
  }

  setWorkspace(guildId, workspacePath);

  await interaction.editReply({
    embeds: [
      {
        title: L("Workspace Set", "워크스페이스 설정됨"),
        description: L(
          `All channels will use project directories under:\n\`${workspacePath}\``,
          `모든 채널이 다음 경로 아래에 프로젝트 디렉토리를 사용합니다:\n\`${workspacePath}\``,
        ),
        color: 0x00ff00,
      },
    ],
  });
}
