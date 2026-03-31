import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  type ChatInputCommandInteraction,
  type Interaction,
} from "discord.js";
import { getConfig } from "../utils/config.js";
import { handleMessage } from "./handlers/message.js";
import { handleButtonInteraction, handleSelectMenuInteraction } from "./handlers/interaction.js";
import { isAllowedUser } from "../security/guard.js";
import { getAllProjects, unregisterProject } from "../db/database.js";
import { cleanupProjectFiles } from "../utils/cleanup.js";
import { L } from "../utils/i18n.js";

// Import commands
import * as startNewCmd from "./commands/start-new.js";
import * as statusCmd from "./commands/status.js";
import * as stopCmd from "./commands/stop.js";
import * as autoApproveCmd from "./commands/auto-approve.js";
import * as sessionsCmd from "./commands/sessions.js";
import * as clearSessionsCmd from "./commands/clear-sessions.js";
import * as lastCmd from "./commands/last.js";
import * as queueCmd from "./commands/queue.js";
import * as usageCmd from "./commands/usage.js";
import * as modelCmd from "./commands/model.js";
import * as contextCmd from "./commands/context.js";
import * as mcpCmd from "./commands/mcp.js";
import * as configCmd from "./commands/config.js";
import * as skillsCmd from "./commands/skills.js";
import * as modelsCmd from "./commands/models.js";
import * as agentsCmd from "./commands/agents.js";
import * as forceCmd from "./commands/force.js";

const commands = [startNewCmd, statusCmd, stopCmd, autoApproveCmd, sessionsCmd, clearSessionsCmd, lastCmd, queueCmd, usageCmd, modelCmd, contextCmd, mcpCmd, configCmd, skillsCmd, modelsCmd, agentsCmd, forceCmd];
const commandMap = new Collection<
  string,
  { execute: (interaction: ChatInputCommandInteraction) => Promise<void> }
>();

for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

export async function startBot(): Promise<Client> {
  const config = getConfig();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Register slash commands after successful login (network guaranteed)
  client.on("ready", async () => {
    console.log(`Bot logged in as ${client.user?.tag}`);
    try {
      const rest = new REST({ version: "10" }).setToken(config.DISCORD_BOT_TOKEN);
      const commandData = commands.map((c) => c.data.toJSON());
      await rest.put(
        Routes.applicationGuildCommands(
          (await rest.get(Routes.currentApplication()) as { id: string }).id,
          config.DISCORD_GUILD_ID,
        ),
        { body: commandData },
      );
      console.log(`Registered ${commandData.length} slash commands`);
    } catch (error) {
      console.error("Failed to register slash commands:", error);
    }

    // Clean up orphaned projects for deleted channels
    cleanupOrphanedProjects(client, config.DISCORD_GUILD_ID);
    setInterval(() => cleanupOrphanedProjects(client, config.DISCORD_GUILD_ID), 60 * 60 * 1000);
  });

  // Handle interactions (slash commands + buttons)
  client.on("interactionCreate", async (interaction: Interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        const command = commandMap.get(interaction.commandName);
        if (command && "autocomplete" in command) {
          await (command as any).autocomplete(interaction);
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        // Auth check
        if (!isAllowedUser(interaction.user.id)) {
          await interaction.reply({
            content: L("You are not authorized to use this bot.", "이 봇을 사용할 권한이 없습니다."),
            flags: ["Ephemeral"],
          });
          return;
        }

        // Defer reply to avoid 3-second timeout
        await interaction.deferReply();

        const command = commandMap.get(interaction.commandName);
        if (command) {
          await command.execute(interaction);
        }
      } else if (interaction.isButton()) {
        await handleButtonInteraction(interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenuInteraction(interaction);
      }
    } catch (error) {
      console.error("Interaction error:", error);
      const content = L("An error occurred while processing your command.", "명령을 처리하는 중 오류가 발생했습니다.");
      try {
        if (interaction.isRepliable()) {
          if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content, flags: ["Ephemeral"] });
          } else {
            await interaction.reply({ content, flags: ["Ephemeral"] });
          }
        }
      } catch {
        // ignore follow-up errors
      }
    }
  });

  // Handle messages (wrapped with error handler to prevent silent hangs)
  client.on("messageCreate", async (message) => {
    try {
      await handleMessage(message);
    } catch (error) {
      console.error("messageCreate error:", error);
      try {
        if (message.channel.isSendable()) {
          await message.reply(L("An error occurred while processing your message.", "메시지를 처리하는 중 오류가 발생했습니다."));
        }
      } catch {
        // ignore reply error
      }
    }
  });

  // Discord.js error handlers — prevent silent disconnects
  client.on("error", (error) => {
    console.error("Discord client error:", error);
  });

  client.on("warn", (warning) => {
    console.warn("Discord warning:", warning);
  });

  client.on("shardDisconnect", (event, shardId) => {
    console.warn(`Shard ${shardId} disconnected (code ${event.code}). Reconnecting...`);
  });

  client.on("shardReconnecting", (shardId) => {
    console.log(`Shard ${shardId} reconnecting...`);
  });

  client.on("shardResume", (shardId, replayedEvents) => {
    console.log(`Shard ${shardId} resumed (${replayedEvents} events replayed)`);
  });

  client.on("shardError", (error, shardId) => {
    console.error(`Shard ${shardId} error:`, error);
  });

  // Login with retry (network may not be ready on boot)
  await loginWithRetry(client, config.DISCORD_BOT_TOKEN);
  return client;
}

function cleanupOrphanedProjects(client: Client, guildId: string): void {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const projects = getAllProjects(guildId);
  let cleaned = 0;
  for (const project of projects) {
    if (!guild.channels.cache.has(project.channel_id)) {
      cleanupProjectFiles(project.project_path);
      unregisterProject(project.channel_id);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[cleanup] Removed ${cleaned} orphaned project(s) for deleted channels`);
  }
}

async function loginWithRetry(client: Client, token: string): Promise<void> {
  const delays = [5, 10, 15, 30, 30, 30]; // seconds — escalating, then steady 30s
  let attempt = 0;

  while (true) {
    try {
      await client.login(token);
      if (attempt > 0) {
        console.log(`Discord login successful after ${attempt} retries`);
      }
      return;
    } catch (error) {
      attempt++;
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      console.error(`Discord login attempt ${attempt} failed: ${(error as Error).message}`);
      console.error(`Retrying in ${delay}s...`);
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }
  }
}
