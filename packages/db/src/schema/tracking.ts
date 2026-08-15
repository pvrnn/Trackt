import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { logStatusEnum } from './enums.js';
import { users } from './auth.js';
import { media, mediaPart } from './media.js';

/**
 * One row per user per media: the "log" (PRD §5).
 * `user_id` leads every user-owned table — the future shard key.
 *
 * NOTE: `media_id` cascade-deletes from `media` (as do `favorite`, `list_item`,
 * and `progress` via `media_part`) — see the warning on the `media` table before
 * deleting catalog rows.
 */
export const userMedia = pgTable(
  'user_media',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    status: logStatusEnum('status').notNull().default('planned'),
    /** Rewatch / reread count (PRD §3.1). */
    repeats: integer('repeats').notNull().default(0),
    /**
     * When the viewer started and finished the work (ADR-0007). Stamped by the
     * tracking routes, editable by hand through `PATCH /v1/media/:id/log`.
     * `date`, not `timestamp`: a viewing start is a day, and a day typed in by
     * hand has no timezone to get wrong.
     */
    startedAt: date('started_at'),
    finishedAt: date('finished_at'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.mediaId] }),
    index('user_media_media_id_idx').on(t.mediaId),
    index('user_media_status_idx').on(t.userId, t.status),
    // `/me/history` filters one user's rows by the date they're filed under and
    // pages in that order (ADR-0007). COALESCE is IMMUTABLE, so it indexes.
    index('user_media_user_logged_idx').on(
      t.userId,
      sql`COALESCE(${t.finishedAt}, ${t.startedAt}) DESC`,
    ),
  ],
);

/**
 * Granular check-ins: one row per watched episode / read chapter, per repeat.
 * Append-only and write-heavy — first candidate for native partitioning by month
 * on the scaling ladder (PRD §5).
 */
export const progress = pgTable(
  'progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    partId: uuid('part_id')
      .notNull()
      .references(() => mediaPart.id, { onDelete: 'cascade' }),
    watchedAt: timestamp('watched_at', { withTimezone: true }).notNull().defaultNow(),
    /** 0 for the first watch/read, 1 for the first rewatch, ... */
    repeatIndex: integer('repeat_index').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.partId, t.repeatIndex] }),
    index('progress_part_id_idx').on(t.partId),
    index('progress_user_watched_idx').on(t.userId, t.watchedAt),
  ],
);
