import { sql } from 'drizzle-orm';
import { index, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { mediaKindEnum, rsvpResponseEnum, watchPartyStatusEnum } from './enums.js';
import { media } from './media.js';

/**
 * State owned by the optional Discord bot (`apps/discord`). Discord snowflakes
 * are 64-bit, so they are stored as `text` — never as a JS number.
 */

/**
 * A channel that receives the News feed. The cursor is the keyset position of
 * the last article posted, in the catalog feed's own `(published_at, id)`
 * order; a new feed starts at its creation time so it never back-posts.
 */
export const discordNewsFeed = pgTable(
  'discord_news_feed',
  {
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    /** Empty means every kind. */
    kinds: mediaKindEnum('kinds')
      .array()
      .notNull()
      .default(sql`'{}'`),
    cursorPublishedAt: timestamp('cursor_published_at', { withTimezone: true }).notNull(),
    cursorArticleId: uuid('cursor_article_id'),
    createdByDiscordId: text('created_by_discord_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.channelId] })],
);

/** One Discord account per Trackt account, and one Trackt account per Discord account. */
export const discordLink = pgTable('discord_link', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  discordUserId: text('discord_user_id').notNull().unique(),
  /** As it was when linked; for display only, Discord names change. */
  discordUsername: text('discord_username').notNull(),
  linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A pending `/link`. Only a SHA-256 of the code is stored: the code itself
 * lives in the ephemeral reply only the Discord user can see, which is what
 * proves the Discord side of the link.
 */
export const discordLinkCode = pgTable(
  'discord_link_code',
  {
    codeHash: text('code_hash').primaryKey(),
    discordUserId: text('discord_user_id').notNull(),
    discordUsername: text('discord_username').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('discord_link_code_expires_at_idx').on(t.expiresAt)],
);

export const discordGuildSettings = pgTable('discord_guild_settings', {
  guildId: text('guild_id').primaryKey(),
  /** IANA zone that wall-clock watch party start times are read in. */
  timezone: text('timezone').notNull().default('UTC'),
});

/**
 * A watch party. The "item" is what is on screen now: the movie, or episode
 * `part_number` of the season `media_id`; Next moves both. The clock is
 * `item_started_at` plus pauses, so a restarted bot recomputes where the party
 * is instead of having kept count.
 */
export const discordWatchParty = pgTable(
  'discord_watch_party',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guildId: text('guild_id').notNull(),
    channelId: text('channel_id').notNull(),
    /** The announcement; null only between the insert and the post. */
    messageId: text('message_id'),
    voiceChannelId: text('voice_channel_id'),
    hostDiscordId: text('host_discord_id').notNull(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    /** Null for a movie. */
    partNumber: integer('part_number'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    status: watchPartyStatusEnum('status').notNull().default('scheduled'),
    /** The host's duration, used whenever the catalog has no runtime. */
    fallbackMinutes: integer('fallback_minutes'),
    /** Null when no runtime is known: the party then only ends by hand. */
    durationSeconds: integer('duration_seconds'),
    itemStartedAt: timestamp('item_started_at', { withTimezone: true }),
    pausedAt: timestamp('paused_at', { withTimezone: true }),
    pausedMs: integer('paused_ms').notNull().default(0),
    /** Set once the item's watchers were marked on Trackt, so it happens once. */
    itemCreditedAt: timestamp('item_credited_at', { withTimezone: true }),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    renderedAt: timestamp('rendered_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('discord_watch_party_status_idx').on(t.status, t.scheduledAt)],
);

export const discordWatchPartyRsvp = pgTable(
  'discord_watch_party_rsvp',
  {
    partyId: uuid('party_id')
      .notNull()
      .references(() => discordWatchParty.id, { onDelete: 'cascade' }),
    discordUserId: text('discord_user_id').notNull(),
    response: rsvpResponseEnum('response').notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.discordUserId] })],
);
