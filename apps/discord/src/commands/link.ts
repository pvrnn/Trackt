import { eq } from 'drizzle-orm';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import { discordLink, issueLinkCode } from '@trackt/db';
import { findLinkedUser } from '../linking.js';
import { instanceUrl } from '../lib/urls.js';
import type { Command, ComponentHandler } from './index.js';

const PREFIX = 'link';

/**
 * The code only ever appears in an ephemeral reply to the Discord user it was
 * issued for: that is the Discord half of the proof, and the signed-in
 * redemption on the web is the Trackt half.
 */
export const link: Command = {
  data: new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your Trackt account')
    .toJSON(),
  async execute(interaction, { db, env }) {
    const linked = await findLinkedUser(db, interaction.user.id);
    if (linked) {
      await interaction.reply({
        content: `You're linked to Trackt account **@${linked.username}**.`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${PREFIX}:unlink`)
              .setLabel('Unlink')
              .setStyle(ButtonStyle.Danger),
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { code, expiresAt } = await issueLinkCode(db, {
      discordUserId: interaction.user.id,
      discordUsername: interaction.user.username,
    });
    const url = instanceUrl(`/link/discord?code=${code}`, env.APP_URL);
    await interaction.reply({
      content: `Open this link while signed in to Trackt to finish linking. It works once and expires <t:${Math.floor(expiresAt.getTime() / 1000)}:R>. Don't share it.`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel('Link on Trackt').setStyle(ButtonStyle.Link).setURL(url),
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  },
};

async function removeLink(db: Parameters<Command['execute']>[1]['db'], discordUserId: string) {
  const removed = await db
    .delete(discordLink)
    .where(eq(discordLink.discordUserId, discordUserId))
    .returning({ userId: discordLink.userId });
  return removed.length > 0;
}

export const unlink: Command = {
  data: new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink your Discord account from Trackt')
    .toJSON(),
  async execute(interaction, { db }) {
    const removed = await removeLink(db, interaction.user.id);
    await interaction.reply({
      content: removed ? 'Unlinked from Trackt.' : "You weren't linked to a Trackt account.",
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const linkComponents: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction, { db }) {
    if (!interaction.isButton() || interaction.customId !== `${PREFIX}:unlink`) return;
    await removeLink(db, interaction.user.id);
    await interaction.update({ content: 'Unlinked from Trackt.', components: [] });
  },
};
