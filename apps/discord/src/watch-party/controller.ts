import { eq } from 'drizzle-orm';
import {
  ChannelType,
  DiscordAPIError,
  RESTJSONErrorCodes,
  type Client,
  type Guild,
} from 'discord.js';
import { discordWatchParty, discordWatchPartyRsvp } from '@trackt/db';
import type { BotContext } from '../context.js';
import { elapsedMs } from './clock.js';
import { itemLabel, renderParty } from './render.js';
import {
  cancelParty,
  claimCredit,
  creditWatchers,
  endParty,
  loadActiveParties,
  loadParty,
  loadPartyView,
  type PartyRow,
} from './service.js';

export const WATCH_PARTY_TICK_MS = 30_000;
/** The voice channel opens, and Going/Maybe get pinged, this long before the start. */
const OPEN_BEFORE_MS = 15 * 60_000;
/** A party nobody started, or left paused, is given up on after this. */
const ABANDON_AFTER_MS = 6 * 60 * 60_000;
/** A live party this far past its runtime (or this long in, runtime unknown) ends itself. */
const OVERRUN_MS = 3 * 60 * 60_000;
const UNKNOWN_RUNTIME_MAX_MS = 8 * 60 * 60_000;
/** Progress re-renders this often; Discord ticks the `<t:…:R>` end time on its own between. */
const RENDER_EVERY_MS = 60_000;
/** The voice channel outlives the party by this much, for goodbyes. */
const VOICE_GRACE_MS = 5 * 60_000;

function isGone(error: unknown): boolean {
  return (
    error instanceof DiscordAPIError &&
    (error.code === RESTJSONErrorCodes.UnknownChannel ||
      error.code === RESTJSONErrorCodes.UnknownMessage)
  );
}

async function announcementChannel(client: Client, row: PartyRow) {
  const channel = await client.channels.fetch(row.channelId).catch(() => null);
  return channel?.isSendable() && !channel.isDMBased() ? channel : null;
}

/** Re-render the announcement from the database. */
export async function refreshAnnouncement(client: Client, ctx: BotContext, id: string) {
  const row = await loadParty(ctx.db, id);
  if (!row?.messageId) return;
  const view = await loadPartyView(ctx.db, row);
  const channel = await announcementChannel(client, row);
  if (!view || !channel) return;
  try {
    await channel.messages.edit(row.messageId, renderParty(view, ctx.env.APP_URL, new Date()));
  } catch (error) {
    if (!isGone(error)) throw error;
    ctx.logger.info({ party: id }, 'watch party announcement is gone');
  }
  await ctx.db
    .update(discordWatchParty)
    .set({ renderedAt: new Date() })
    .where(eq(discordWatchParty.id, id));
}

async function say(client: Client, row: PartyRow, content: string, pingIds: string[] = []) {
  const channel = await announcementChannel(client, row);
  if (!channel) return;
  await channel.send({
    content,
    reply: row.messageId ? { messageReference: row.messageId, failIfNotExists: false } : undefined,
    allowedMentions: { users: pingIds },
  });
}

/** The category holding `channelId`, looking through a thread to its channel. */
function categoryOf(guild: Guild, channelId: string): string | undefined {
  let channel = guild.channels.cache.get(channelId);
  if (channel?.isThread()) channel = channel.parent ?? undefined;
  const parent = channel?.parent;
  return parent?.type === ChannelType.GuildCategory ? parent.id : undefined;
}

/** Open the party's voice channel, next to the announcement, and ping Going and Maybe. */
export async function openVoiceChannel(client: Client, ctx: BotContext, row: PartyRow) {
  if (row.voiceChannelId) return;
  const guild: Guild | null = await client.guilds.fetch(row.guildId).catch(() => null);
  const announcement = await announcementChannel(client, row);
  if (!guild || !announcement) return;
  const view = await loadPartyView(ctx.db, row);
  if (!view) return;

  const voice = await guild.channels.create({
    name: `🍿 ${itemLabel(view)}`.slice(0, 100),
    type: ChannelType.GuildVoice,
    parent: categoryOf(guild, row.channelId),
    reason: 'Trackt watch party',
  });
  await ctx.db
    .update(discordWatchParty)
    .set({ voiceChannelId: voice.id, remindedAt: new Date() })
    .where(eq(discordWatchParty.id, row.id));

  const invited = await ctx.db
    .select({ id: discordWatchPartyRsvp.discordUserId, response: discordWatchPartyRsvp.response })
    .from(discordWatchPartyRsvp)
    .where(eq(discordWatchPartyRsvp.partyId, row.id));
  const ping = invited.filter((rsvp) => rsvp.response !== 'declined').map((rsvp) => rsvp.id);
  const when = Math.floor(row.scheduledAt.getTime() / 1000);
  await say(
    client,
    row,
    `🍿 **${view.media.title}** starts <t:${when}:R> — join <#${voice.id}>. ${ping.map((id) => `<@${id}>`).join(' ')}`.trim(),
    ping,
  );
  await refreshAnnouncement(client, ctx, row.id);
}

async function closeVoiceChannel(client: Client, ctx: BotContext, row: PartyRow) {
  if (!row.voiceChannelId) return;
  try {
    const guild = await client.guilds.fetch(row.guildId);
    await guild.channels.delete(row.voiceChannelId, 'Trackt watch party over');
  } catch (error) {
    if (!isGone(error)) throw error;
  }
  await ctx.db
    .update(discordWatchParty)
    .set({ voiceChannelId: null })
    .where(eq(discordWatchParty.id, row.id));
}

/** Non-bot members in the party's voice channel right now, from the gateway's voice states. */
async function membersInVoice(client: Client, row: PartyRow): Promise<string[]> {
  if (!row.voiceChannelId) return [];
  const guild = await client.guilds.fetch(row.guildId).catch(() => null);
  const channel = guild?.channels.cache.get(row.voiceChannelId);
  if (!channel?.isVoiceBased()) return [];
  return [...channel.members.values()].filter((member) => !member.user.bot).map((m) => m.id);
}

/**
 * Mark the current item watched for linked members in voice, once per item,
 * and say who got it.
 */
export async function creditCurrentItem(client: Client, ctx: BotContext, row: PartyRow) {
  const claimed = await claimCredit(ctx.db, row, new Date());
  if (!claimed) return;
  const present = await membersInVoice(client, claimed);
  const { credited, unlinked } = await creditWatchers(ctx.db, claimed, present);
  const view = await loadPartyView(ctx.db, claimed);
  const label = view ? itemLabel(view) : 'it';
  const lines: string[] = [];
  if (credited.length > 0) {
    lines.push(
      `✅ Marked **${label}** watched on Trackt for ${credited.map((id) => `<@${id}>`).join(', ')}.`,
    );
  } else if (present.length === 0) {
    lines.push(`Nobody was in the voice channel for **${label}**, so nothing was marked watched.`);
  }
  if (unlinked.length > 0) {
    lines.push(
      `${unlinked.map((id) => `<@${id}>`).join(', ')} ${unlinked.length === 1 ? "isn't" : "aren't"} linked — \`/link\` to get credit next time.`,
    );
  }
  if (lines.length > 0) await say(client, claimed, lines.join('\n'));
}

async function tickParty(client: Client, ctx: BotContext, row: PartyRow, now: Date) {
  if (row.status === 'ended' || row.status === 'cancelled') {
    if (row.endedAt && now.getTime() - row.endedAt.getTime() >= VOICE_GRACE_MS) {
      await closeVoiceChannel(client, ctx, row);
    }
    return;
  }

  if (row.status === 'scheduled') {
    if (now.getTime() - row.scheduledAt.getTime() >= ABANDON_AFTER_MS) {
      await cancelParty(ctx.db, row.id, now);
      await refreshAnnouncement(client, ctx, row.id);
    } else if (!row.voiceChannelId && row.scheduledAt.getTime() - now.getTime() <= OPEN_BEFORE_MS) {
      await openVoiceChannel(client, ctx, row);
    }
    return;
  }

  const elapsed = elapsedMs(
    { itemStartedAt: row.itemStartedAt, pausedAt: row.pausedAt, pausedMs: row.pausedMs },
    now,
  );
  const durationMs = row.durationSeconds === null ? null : row.durationSeconds * 1000;
  const abandoned = row.pausedAt
    ? now.getTime() - row.pausedAt.getTime() >= ABANDON_AFTER_MS
    : elapsed >= (durationMs === null ? UNKNOWN_RUNTIME_MAX_MS : durationMs + OVERRUN_MS);
  if (abandoned) {
    await endParty(ctx.db, row.id, now);
    await refreshAnnouncement(client, ctx, row.id);
    return;
  }

  if (durationMs !== null && elapsed >= durationMs && !row.itemCreditedAt) {
    await creditCurrentItem(client, ctx, row);
    const view = await loadPartyView(ctx.db, row);
    // Nothing comes next: the party is over. Otherwise it waits on the host's Next.
    if (!view?.hasNext) await endParty(ctx.db, row.id, now);
    await refreshAnnouncement(client, ctx, row.id);
    return;
  }

  if (
    !row.pausedAt &&
    (!row.renderedAt || now.getTime() - row.renderedAt.getTime() >= RENDER_EVERY_MS)
  ) {
    await refreshAnnouncement(client, ctx, row.id);
  }
}

export async function tickWatchParties(client: Client, ctx: BotContext): Promise<void> {
  const now = new Date();
  for (const row of await loadActiveParties(ctx.db)) {
    try {
      await tickParty(client, ctx, row, now);
    } catch (error) {
      ctx.logger.warn({ err: error, party: row.id }, 'watch party tick failed');
    }
  }
}
