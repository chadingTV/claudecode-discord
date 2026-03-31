import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
} from "discord.js";
import { getConfig } from "../../utils/config.js";
import { L } from "../../utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Show current bot configuration");

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const config = getConfig();

  const embed = new EmbedBuilder()
    .setTitle(L("Bot Configuration", "봇 설정"))
    .setColor(0x7c3aed)
    .setTimestamp()
    .addFields(
      {
        name: "DISCORD_BOT_TOKEN",
        value: `\`${config.DISCORD_BOT_TOKEN.slice(0, 20)}...${config.DISCORD_BOT_TOKEN.slice(-4)}\``,
        inline: false,
      },
      {
        name: "DISCORD_GUILD_ID",
        value: `\`${config.DISCORD_GUILD_ID}\``,
        inline: true,
      },
      {
        name: "ALLOWED_USER_IDS",
        value: config.ALLOWED_USER_IDS.map((id) => `\`${id}\``).join(", "),
        inline: false,
      },
      {
        name: "BASE_PROJECT_DIR",
        value: `\`${config.BASE_PROJECT_DIR}\``,
        inline: false,
      },
      {
        name: "RATE_LIMIT_PER_MINUTE",
        value: `\`${config.RATE_LIMIT_PER_MINUTE}\``,
        inline: true,
      },
      {
        name: "SHOW_COST",
        value: `\`${config.SHOW_COST}\``,
        inline: true,
      },
    );

  await interaction.editReply({ embeds: [embed] });
}
