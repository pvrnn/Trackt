import { sql } from 'drizzle-orm';
import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth.js';
import { mediaKindEnum } from './enums.js';

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
