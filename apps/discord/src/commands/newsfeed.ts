import { and, eq } from 'drizzle-orm';
import {
  ActionRowBuilder,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { discordNewsFeed } from '@trackt/db';
import { MEDIA_KINDS, MediaKindSchema, type MediaKind } from '@trackt/shared';
import { KIND_LABELS, kindsLabel } from '../lib/labels.js';
import type { Command, ComponentHandler } from './index.js';

const PREFIX = 'newsfeed';
const ALL = 'all';

/** What the bot needs in a channel to post an embed there. */
export const FEED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
];

/** A selection that names "all", or every kind, is stored as the empty filter. */
export function kindsFromSelection(values: readonly string[]): MediaKind[] {
  if (values.includes(ALL)) return [];
  const kinds = MEDIA_KINDS.filter((kind) => values.includes(kind));
  return kinds.length === MEDIA_KINDS.length ? [] : kinds;
}

function kindsMenu(channelId: string, current: readonly MediaKind[]) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${PREFIX}:kinds:${channelId}`)
    .setPlaceholder('Media types to post')
    .setMinValues(1)
    .setMaxValues(MEDIA_KINDS.length + 1)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('All media types')
        .setValue(ALL)
        .setDefault(current.length === 0),
      ...MEDIA_KINDS.map((kind) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(KIND_LABELS[kind])
          .setValue(kind)
          .setDefault(current.includes(kind)),
      ),
    );
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

export const newsfeed: Command = {
  data: new SlashCommandBuilder()
    .setName('newsfeed')
    .setDescription('Post Trackt news in a channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Post news in a channel, filtered by media type')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('Where to post')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Stop posting news in a channel')
        .addChannelOption((option) =>
          option
            .setName('channel')
            .setDescription('The channel to stop posting in')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription("List this server's news feeds"))
    .toJSON(),

  async execute(interaction, { db }) {
    if (!interaction.inCachedGuild()) return;
    const guildId = interaction.guildId;
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'list') {
      const feeds = await db
        .select()
        .from(discordNewsFeed)
        .where(eq(discordNewsFeed.guildId, guildId));
      await interaction.reply({
        content:
          feeds.length === 0
            ? 'No news feeds yet — add one with `/newsfeed set`.'
            : feeds.map((feed) => `<#${feed.channelId}> — ${kindsLabel(feed.kinds)}`).join('\n'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = interaction.options.getChannel('channel', true);

    if (subcommand === 'remove') {
      const removed = await db
        .delete(discordNewsFeed)
        .where(and(eq(discordNewsFeed.guildId, guildId), eq(discordNewsFeed.channelId, channel.id)))
        .returning({ channelId: discordNewsFeed.channelId });
      await interaction.reply({
        content:
          removed.length > 0
            ? `Stopped posting news in <#${channel.id}>.`
            : `<#${channel.id}> has no news feed.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const me = interaction.guild.members.me;
    if (!me || !channel.permissionsFor(me).has(FEED_PERMISSIONS)) {
      await interaction.reply({
        content: `I need **View Channel**, **Send Messages** and **Embed Links** in <#${channel.id}> first.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [existing] = await db
      .select({ kinds: discordNewsFeed.kinds })
      .from(discordNewsFeed)
      .where(and(eq(discordNewsFeed.guildId, guildId), eq(discordNewsFeed.channelId, channel.id)));
    await interaction.reply({
      content: `Which media types should <#${channel.id}> get news about?`,
      components: [kindsMenu(channel.id, existing?.kinds ?? [])],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export const newsfeedComponents: ComponentHandler = {
  prefix: PREFIX,
  async handle(interaction, { db }) {
    if (!interaction.isStringSelectMenu() || !interaction.inCachedGuild()) return;
    // The menu is ephemeral to an admin, but component ids can be replayed.
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) return;

    const [, action, channelId] = interaction.customId.split(':');
    if (action !== 'kinds' || !channelId) return;

    const kinds = kindsFromSelection(
      interaction.values.filter(
        (value) => value === ALL || MediaKindSchema.safeParse(value).success,
      ),
    );
    await db
      .insert(discordNewsFeed)
      .values({
        guildId: interaction.guildId,
        channelId,
        kinds,
        cursorPublishedAt: new Date(),
        createdByDiscordId: interaction.user.id,
      })
      .onConflictDoUpdate({
        target: [discordNewsFeed.guildId, discordNewsFeed.channelId],
        set: { kinds },
      });
    await interaction.update({
      content: `<#${channelId}> will get Trackt news about: **${kindsLabel(kinds)}**.`,
      components: [],
    });
  },
};
