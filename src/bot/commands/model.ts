import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { getProject, getModel, setModel } from "../../db/database.js";
import { L } from "../../utils/i18n.js";

const MODELS = [
  { name: "Opus 4.6", value: "claude-opus-4-6" },
  { name: "Sonnet 4.6", value: "claude-sonnet-4-6" },
  { name: "Haiku 4.5", value: "claude-haiku-4-5-20251001" },
  { name: "Default (use CLI default)", value: "default" },
];

export const data = new SlashCommandBuilder()
  .setName("model")
  .setDescription("Set or view the Claude model for this channel")
  .addStringOption((opt) =>
    opt
      .setName("name")
      .setDescription("Model to use (leave empty to see current)")
      .setRequired(false)
      .addChoices(...MODELS),
  );

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

  const modelArg = interaction.options.getString("name");

  if (!modelArg) {
    const current = getModel(channelId);
    await interaction.editReply({
      embeds: [
        {
          title: L("Current Model", "현재 모델"),
          description: current ?? L("Default (CLI default)", "기본값 (CLI 기본)"),
          color: 0x7c3aed,
        },
      ],
    });
    return;
  }

  const model = modelArg === "default" ? null : modelArg;
  setModel(channelId, model);

  await interaction.editReply({
    embeds: [
      {
        title: L("Model Updated", "모델 변경됨"),
        description: model ?? L("Default (CLI default)", "기본값 (CLI 기본)"),
        color: 0x7c3aed,
      },
    ],
  });
}
