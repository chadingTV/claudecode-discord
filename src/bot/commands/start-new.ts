import {
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from "discord.js";
import fs from "node:fs";
import path from "node:path";
import { registerProject } from "../../db/database.js";
import { validateProjectPath } from "../../security/guard.js";
import { sessionManager } from "../../claude/session-manager.js";
import { getConfig } from "../../utils/config.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("start-new")
  .setDescription("Create a new channel, register it to a project, and send the first message")
  .addStringOption((opt) =>
    opt
      .setName("path")
      .setDescription(`Project folder name (${getConfig().BASE_PROJECT_DIR})`)
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("message")
      .setDescription("First message to send to Claude")
      .setRequired(true),
  )
  .addStringOption((opt) =>
    opt
      .setName("channel-name")
      .setDescription("Custom channel name (defaults to project folder name)")
      .setRequired(false),
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const input = interaction.options.getString("path", true);
  const firstMessage = interaction.options.getString("message", true);
  const customChannelName = interaction.options.getString("channel-name");
  const config = getConfig();
  const guildId = interaction.guildId!;
  const guild = interaction.guild!;

  // Resolve project path
  const projectPath = path.isAbsolute(input)
    ? input
    : path.join(config.BASE_PROJECT_DIR, input);

  // Create directory if it doesn't exist
  if (!fs.existsSync(projectPath)) {
    const resolved = path.resolve(projectPath);
    const baseDir = path.resolve(config.BASE_PROJECT_DIR);
    if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
      await interaction.editReply({
        content: L(`Invalid path: Path must be within ${baseDir}`, `잘못된 경로: ${baseDir} 내에 있어야 합니다`),
      });
      return;
    }
    if (projectPath.includes("..")) {
      await interaction.editReply({
        content: L("Invalid path: Path must not contain '..'", "잘못된 경로: '..'을 포함할 수 없습니다"),
      });
      return;
    }
    fs.mkdirSync(projectPath, { recursive: true });
  }

  // Validate path
  const error = validateProjectPath(projectPath);
  if (error) {
    await interaction.editReply({
      content: L(`Invalid path: ${error}`, `잘못된 경로: ${error}`),
    });
    return;
  }

  // Derive channel name from project folder name
  const folderName = projectPath.split(/[\\/]/).pop() ?? "claude-session";
  const channelName = customChannelName ?? folderName;

  // Create the channel
  let newChannel: TextChannel;
  try {
    // Place in the same category as the command channel, if any
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

  // Register the new channel to the project
  registerProject(newChannel.id, projectPath, guildId);

  await interaction.editReply({
    embeds: [
      {
        title: L("New Session Started", "새 세션 시작됨"),
        description: [
          L(`Channel: <#${newChannel.id}>`, `채널: <#${newChannel.id}>`),
          L(`Project: \`${projectPath}\``, `프로젝트: \`${projectPath}\``),
          L(`First message: "${firstMessage.length > 100 ? firstMessage.slice(0, 100) + "…" : firstMessage}"`, `첫 메시지: "${firstMessage.length > 100 ? firstMessage.slice(0, 100) + "…" : firstMessage}"`),
        ].join("\n"),
        color: 0x00ff00,
      },
    ],
  });

  // Send the first message to start the Claude session
  sessionManager.sendMessage(newChannel, firstMessage).catch((err) => {
    console.error(`[start-new] Failed to send first message in ${newChannel.id}:`, err);
    newChannel.send(L(
      `❌ Failed to start session: ${err instanceof Error ? err.message : "Unknown error"}`,
      `❌ 세션 시작 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`,
    )).catch(() => {});
  });
}

export async function autocomplete(
  interaction: AutocompleteInteraction,
): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== "path") {
    await interaction.respond([]);
    return;
  }

  const value = focused.value;
  const config = getConfig();
  const baseDir = config.BASE_PROJECT_DIR;

  try {
    const lastSlash = value.lastIndexOf("/");
    const parentPart = lastSlash >= 0 ? value.slice(0, lastSlash) : "";
    const currentPrefix = lastSlash >= 0 ? value.slice(lastSlash + 1) : value;

    const listDir = parentPart ? path.join(baseDir, parentPart) : baseDir;

    const resolvedList = path.resolve(listDir);
    const resolvedBase = path.resolve(baseDir);
    if (!resolvedList.startsWith(resolvedBase)) {
      await interaction.respond([]);
      return;
    }

    const entries = fs.readdirSync(listDir, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .filter((name) => name.toLowerCase().includes(currentPrefix.toLowerCase()))
      .slice(0, 24);

    const choices: { name: string; value: string }[] = [];

    if (!parentPart && (!value || ".".includes(value.toLowerCase()) || baseDir.toLowerCase().includes(value.toLowerCase()))) {
      choices.push({ name: `. (${baseDir})`, value: baseDir });
    }

    choices.push(
      ...dirs.map((name) => {
        const dirValue = parentPart ? `${parentPart}/${name}` : name;
        return { name: dirValue, value: dirValue };
      }),
    );

    if (value && !dirs.some((d) => d.toLowerCase() === currentPrefix.toLowerCase())) {
      choices.push({ name: `📁 Create new: ${value}`, value });
    }

    await interaction.respond(choices.slice(0, 25));
  } catch {
    await interaction.respond([]);
  }
}
