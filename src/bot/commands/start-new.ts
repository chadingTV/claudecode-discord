import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { registerProject, getWorkspace } from "../../db/database.js";
import { sessionManager } from "../../claude/session-manager.js";
import { slugifyChannelName } from "../../utils/channel-name.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("start-new")
  .setDescription("Create a new channel and start a Claude session")
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("First message to send to Claude")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("channel-name")
      .setDescription("Custom channel name (defaults to slugified first message)")
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const firstMessage = interaction.options.getString("message", true);
  const customChannelName = interaction.options.getString("channel-name");
  const guildId = interaction.guildId!;
  const guild = interaction.guild!;

  // Check workspace is set
  const workspace = getWorkspace(guildId);
  if (!workspace) {
    await interaction.editReply({
      content: L(
        "No workspace set. Use `/workspace path:<directory>` first.",
        "워크스페이스가 설정되지 않았습니다. 먼저 `/workspace path:<디렉토리>`를 사용하세요.",
      ),
    });
    return;
  }

  // Derive channel name
  const channelName = customChannelName ?? slugifyChannelName(firstMessage);
  const projectPath = path.join(workspace.workspace_path, channelName);

  // Create project directory
  fs.mkdirSync(projectPath, { recursive: true });

  // Create Discord channel in the same category as the command channel
  let newChannel: TextChannel;
  try {
    const sourceChannel = interaction.channel;
    const parentId = sourceChannel && "parentId" in sourceChannel ? sourceChannel.parentId : undefined;

    newChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      ...(parentId ? { parent: parentId } : {}),
    });
  } catch (e) {
    await interaction.editReply({
      content: L(
        `Failed to create channel: ${e instanceof Error ? e.message : "Unknown error"}`,
        `채널 생성 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`,
      ),
    });
    return;
  }

  // Register the new channel
  registerProject(newChannel.id, projectPath, guildId);

  await interaction.editReply({
    embeds: [
      {
        title: L("New Session Started", "새 세션 시작됨"),
        description: [
          L(`Channel: <#${newChannel.id}>`, `채널: <#${newChannel.id}>`),
          L(`Project: \`${projectPath}\``, `프로젝트: \`${projectPath}\``),
        ].join("\n"),
        color: 0x00ff00,
      },
    ],
  });

  // Start the Claude session
  sessionManager.sendMessage(newChannel, firstMessage).catch((err) => {
    console.error(`[start-new] Failed to send first message in ${newChannel.id}:`, err);
    newChannel.send(L(
      `❌ Failed to start session: ${err instanceof Error ? err.message : "Unknown error"}`,
      `❌ 세션 시작 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
    )).catch(() => {});
  });
}
