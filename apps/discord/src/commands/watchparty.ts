import { eq } from 'drizzle-orm';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { z } from 'zod';
import {
  canViewMedia,
  discordGuildSettings,
  discordWatchParty,
  ensureWatchMetadata,
  media,
} from '@trackt/db';
import { RsvpResponseSchema, SearchResultSchema, type SearchResult } from '@trackt/shared';
import type { BotContext } from '../context.js';
import { getJson } from '../lib/api.js';
import {
  creditCurrentItem,
  openVoiceChannel,
  refreshAnnouncement,
} from '../watch-party/controller.js';
import { renderParty, WP_PREFIX } from '../watch-party/render.js';
import {
  advanceParty,
  cancelParty,
  endParty,
  findNextItem,
  loadParty,
  loadPartyView,
  pauseParty,
  resolveDurationSeconds,
  resumeParty,
  setRsvp,
  startParty,
  type PartyRow,
} from '../watch-party/service.js';
import { isTimeZone, parseStartTime } from '../watch-party/start-time.js';
import type { Command, ComponentHandler } from './index.js';

const WATCHABLE = new Set(['movie', 'series', 'anime']);
/** What the bot needs where a party is announced: post, embed, and open a voice channel. */
const PARTY_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageChannels,
];
const CATALOG_TIMEOUT_MS = 5_000;

/** Autocomplete fires on every keystroke; the instance search allows 60 a minute. */
const SEARCH_CACHE_MS = 60_000;
const searchCache = new Map<string, { at: number; results: SearchResult[] }>();

async function searchWatchable(ctx: BotContext, query: string): Promise<SearchResult[]> {
  const key = query.toLowerCase();
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_MS) return cached.results;
  const results =
    (await getJson(
      ctx.env,
      `search?q=${encodeURIComponent(query)}&limit=20`,
      SearchResultSchema.array(),
    )) ?? [];
  const watchable = results.filter((result) => WATCHABLE.has(result.kind));
  if (searchCache.size > 500) searchCache.clear();
  searchCache.set(key, { at: Date.now(), results: watchable });
  return watchable;
}

export function choiceLabel(result: SearchResult): string {
  const year = result.year ? ` (${result.year})` : '';
  const detail =
    result.seasonNumber !== null
      ? `Season ${result.seasonNumber}`
      : result.kind === 'movie'
        ? 'Movie'
        : 'Anime';
  return `${result.title}${year} · ${detail}`.slice(0, 100);
}

export const watchparty: Command = {
  data: new SlashCommandBuilder()
    .setName('watchparty')
    .setDescription('Watch a movie or an episode together')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Schedule a watch party')
        .addStringOption((option) =>
          option
            .setName('title')
            .setDescription('Movie or season to watch')
            .setAutocomplete(true)
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName('start')
            .setDescription('now, in 45m, 20:30, or 2026-10-02 20:30')
            .setRequired(true),
        )
        .addIntegerOption((option) =>
          option
            .setName('episode')
            .setDescription('Episode of the season (default 1)')
            .setMinValue(1),
        )
        .addIntegerOption((option) =>
          option
            .setName('duration')
            .setDescription('Minutes, if Trackt does not know the runtime')
            .setMinValue(1)
            .setMaxValue(600),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('timezone')
        .setDescription("Set the server's time zone for start times (Manage Server)")
        .addStringOption((option) =>
          option.setName('zone').setDescription('IANA zone, e.g. Europe/Paris').setRequired(true),
        ),
    )
    .toJSON(),

  async autocomplete(interaction, ctx) {
    const query = interaction.options.getFocused().trim();
    if (query.length < 2) {
      await interaction.respond([]);
      return;
    }
    const results = await searchWatchable(ctx, query);
    await interaction.respond(
      results.slice(0, 25).map((result) => ({ name: choiceLabel(result), value: result.id })),
    );
  },

  async execute(interaction, ctx) {
    if (!interaction.inCachedGuild()) return;
    const { db, env, logger } = ctx;
    const ephemeral = (content: string) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral });

    if (interaction.options.getSubcommand() === 'timezone') {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        await ephemeral('Setting the time zone needs **Manage Server**.');
        return;
      }
      const zone = interaction.options.getString('zone', true).trim();
      if (!isTimeZone(zone)) {
        await ephemeral(`\`${zone}\` isn't a time zone — try one like \`Europe/Paris\`.`);
        return;
      }
      await db
        .insert(discordGuildSettings)
        .values({ guildId: interaction.guildId, timezone: zone })
        .onConflictDoUpdate({ target: discordGuildSettings.guildId, set: { timezone: zone } });
      await ephemeral(`Watch party start times are now read in **${zone}**.`);
      return;
    }

    const channel = interaction.channel;
    if (!channel?.isSendable() || !interaction.appPermissions.has(PARTY_PERMISSIONS)) {
      await ephemeral(
        'I need **View Channel**, **Send Messages**, **Embed Links** and **Manage Channels** here.',
      );
      return;
    }

    const mediaId = interaction.options.getString('title', true);
    const [work] = z.uuid().safeParse(mediaId).success
      ? await db.select().from(media).where(eq(media.id, mediaId))
      : [];
    if (!work || !canViewMedia(work) || !WATCHABLE.has(work.kind)) {
      await ephemeral('Pick a movie or a season from the list.');
      return;
    }

    const episode = interaction.options.getInteger('episode');
    let partNumber: number | null = null;
    if (work.kind === 'movie') {
      if (episode !== null) {
        await ephemeral('A movie has no episodes.');
        return;
      }
    } else {
      partNumber = episode ?? 1;
      if (work.partCount !== null && partNumber > work.partCount) {
        await ephemeral(`This season has ${work.partCount} episodes.`);
        return;
      }
    }

    const [settings] = await db
      .select({ timezone: discordGuildSettings.timezone })
      .from(discordGuildSettings)
      .where(eq(discordGuildSettings.guildId, interaction.guildId));
    const zone = settings?.timezone ?? 'UTC';
    const start = parseStartTime(interaction.options.getString('start', true), zone, new Date());
    if (!start.ok) {
      await ephemeral(start.error);
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (env.CATALOG_URL) {
      try {
        await ensureWatchMetadata(db, env.CATALOG_URL, work.id, { timeoutMs: CATALOG_TIMEOUT_MS });
      } catch (error) {
        logger.warn({ err: error, media: work.id }, 'could not fetch runtimes from the catalog');
      }
    }
    const fallbackMinutes = interaction.options.getInteger('duration');
    const durationSeconds = await resolveDurationSeconds(db, work.id, partNumber, fallbackMinutes);

    const [row] = await db
      .insert(discordWatchParty)
      .values({
        guildId: interaction.guildId,
        channelId: channel.id,
        hostDiscordId: interaction.user.id,
        mediaId: work.id,
        partNumber,
        scheduledAt: start.at,
        fallbackMinutes,
        durationSeconds,
      })
      .returning();
    await setRsvp(db, row!, interaction.user.id, 'going');
    const view = await loadPartyView(db, row!);
    const message = await channel.send(renderParty(view!, env.APP_URL, new Date()));
    await db
      .update(discordWatchParty)
      .set({ messageId: message.id, renderedAt: new Date() })
      .where(eq(discordWatchParty.id, row!.id));

    await interaction.editReply(
      [
        `Watch party posted: ${message.url}`,
        ...(durationSeconds === null
          ? [
              "Trackt doesn't know this runtime yet, so the party can't tell when it's over — pass `duration`, or press End when you finish.",
            ]
          : []),
        ...(zone === 'UTC' && /:/.test(interaction.options.getString('start', true))
          ? ['Times are read in UTC; an admin can change that with `/watchparty timezone`.']
          : []),
      ].join('\n'),
    );
  },
};

function canRun(interaction: ButtonInteraction, row: PartyRow): boolean {
  return (
    interaction.user.id === row.hostDiscordId ||
    (interaction.memberPermissions?.has(PermissionFlagsBits.ManageEvents) ?? false)
  );
}

async function updateFrom(interaction: ButtonInteraction, ctx: BotContext, id: string) {
  const row = await loadParty(ctx.db, id);
  const view = row && (await loadPartyView(ctx.db, row));
  if (view) await interaction.editReply(renderParty(view, ctx.env.APP_URL, new Date()));
}

async function goToNext(client: Client, ctx: BotContext, row: PartyRow): Promise<boolean> {
  const [work] = await ctx.db.select().from(media).where(eq(media.id, row.mediaId));
  const next = work && (await findNextItem(ctx.db, work, row.partNumber));
  if (!next) return false;
  await creditCurrentItem(client, ctx, row);
  if (next.mediaId !== row.mediaId && ctx.env.CATALOG_URL) {
    await ensureWatchMetadata(ctx.db, ctx.env.CATALOG_URL, next.mediaId, {
      timeoutMs: CATALOG_TIMEOUT_MS,
    }).catch((error: unknown) =>
      ctx.logger.warn({ err: error, media: next.mediaId }, 'could not fetch runtimes'),
    );
  }
  const duration = await resolveDurationSeconds(
    ctx.db,
    next.mediaId,
    next.partNumber,
    row.fallbackMinutes,
  );
  return (await advanceParty(ctx.db, row, next, duration, new Date())) !== null;
}

export const watchpartyComponents: ComponentHandler = {
  prefix: WP_PREFIX,
  async handle(interaction, ctx) {
    if (!interaction.isButton()) return;
    const [, action, id, arg] = interaction.customId.split(':');
    const row = id ? await loadParty(ctx.db, id) : null;
    if (!action || !row) {
      await interaction.reply({
        content: 'This watch party no longer exists.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === 'rsvp') {
      const response = RsvpResponseSchema.safeParse(arg);
      if (!response.success) return;
      await interaction.deferUpdate();
      await setRsvp(ctx.db, row, interaction.user.id, response.data);
      await updateFrom(interaction, ctx, row.id);
      return;
    }

    if (!canRun(interaction, row)) {
      await interaction.reply({
        content: `Only <@${row.hostDiscordId}> (or someone with **Manage Events**) can do that.`,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const now = new Date();
    const client = interaction.client;
    switch (action) {
      case 'start': {
        await interaction.deferUpdate();
        const started = await startParty(ctx.db, row.id, now);
        if (started && !started.voiceChannelId) await openVoiceChannel(client, ctx, started);
        await updateFrom(interaction, ctx, row.id);
        return;
      }
      case 'pause':
      case 'resume':
        await interaction.deferUpdate();
        await (action === 'pause' ? pauseParty : resumeParty)(ctx.db, row.id, now);
        await updateFrom(interaction, ctx, row.id);
        return;
      case 'cancel':
        await interaction.deferUpdate();
        await cancelParty(ctx.db, row.id, now);
        await updateFrom(interaction, ctx, row.id);
        return;
      case 'next':
        await interaction.deferUpdate();
        if (!(await goToNext(client, ctx, row))) {
          await interaction.followUp({
            content: 'There is no next episode on Trackt yet.',
            flags: MessageFlags.Ephemeral,
          });
        }
        await updateFrom(interaction, ctx, row.id);
        return;
      case 'end':
        await interaction.reply({
          content: 'Did everyone in voice finish it?',
          components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
              new ButtonBuilder()
                .setCustomId(`${WP_PREFIX}:end-credit:${row.id}`)
                .setLabel('Finished — mark watched')
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`${WP_PREFIX}:end-stop:${row.id}`)
                .setLabel('Stop without marking')
                .setStyle(ButtonStyle.Secondary),
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      case 'end-credit':
      case 'end-stop':
        await interaction.update({ content: 'Ending the watch party…', components: [] });
        if (action === 'end-credit') await creditCurrentItem(client, ctx, row);
        await endParty(ctx.db, row.id, now);
        await refreshAnnouncement(client, ctx, row.id);
        await interaction.editReply({ content: 'Watch party ended.' });
        return;
    }
  },
};
