import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type CommandInteraction,
  type User,
} from 'discord.js';
import { PublicProfileSchema } from '@trackt/shared';
import type { BotContext } from '../context.js';
import { getJson } from '../lib/api.js';
import { findLinkedUser } from '../linking.js';
import { profileEmbed } from '../profile/embed.js';
import type { Command, UserCommand } from './index.js';

async function showProfile(interaction: CommandInteraction, target: User, ctx: BotContext) {
  const linked = await findLinkedUser(ctx.db, target.id);
  if (!linked) {
    await interaction.reply({
      content:
        target.id === interaction.user.id
          ? 'Link your Trackt account first with `/link`.'
          : `<@${target.id}> hasn't linked a Trackt account.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return;
  }

  await interaction.deferReply();
  const profile = await getJson(
    ctx.env,
    `users/${encodeURIComponent(linked.username)}/profile`,
    PublicProfileSchema,
  );
  if (!profile) {
    await interaction.editReply("That Trackt profile doesn't exist any more.");
    return;
  }
  await interaction.editReply({ embeds: [profileEmbed(profile, ctx.env.APP_URL)] });
}

export const profile: Command = {
  data: new SlashCommandBuilder()
    .setName('profile')
    .setDescription('Show a Trackt profile')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option.setName('member').setDescription('Whose profile (yours by default)'),
    )
    .toJSON(),
  async execute(interaction, ctx) {
    await showProfile(interaction, interaction.options.getUser('member') ?? interaction.user, ctx);
  },
};

export const profileContextMenu: UserCommand = {
  data: new ContextMenuCommandBuilder()
    .setName('Trackt profile')
    .setType(ApplicationCommandType.User)
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
  async execute(interaction, ctx) {
    await showProfile(interaction, interaction.targetUser, ctx);
  },
};
