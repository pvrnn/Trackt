import { sql } from 'drizzle-orm';
import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
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
