import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { reportStatusEnum, targetTypeEnum } from './enums.js';
import { users } from './auth.js';

/**
 * Ratings target either a whole work (`media`) or a single episode/chapter (`part`) —
 * polymorphic via (target_type, target_id) (PRD §3.2). Score is 0–10 in half points;
 * a null score with a review is a review-only entry.
 */
export const rating = pgTable(
  'rating',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: targetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    score: numeric('score', { precision: 3, scale: 1 }),
    review: text('review'),
    hasSpoilers: boolean('has_spoilers').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('rating_user_target_unique').on(t.userId, t.targetType, t.targetId),
    index('rating_target_idx').on(t.targetType, t.targetId),
    check('rating_score_range', sql`${t.score} >= 0 AND ${t.score} <= 10`),
  ],
);

/** Threaded comments on any media, season, episode, or chapter (PRD §3.3). */
export const comment = pgTable(
  'comment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: targetTypeEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    parentCommentId: uuid('parent_comment_id').references((): AnyPgColumn => comment.id, {
      onDelete: 'cascade',
    }),
    body: text('body').notNull(),
    hasSpoilers: boolean('has_spoilers').notNull().default(false),
    /** Shadow-hide for moderation (PRD §7). */
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('comment_target_idx').on(t.targetType, t.targetId),
    index('comment_user_id_idx').on(t.userId),
    index('comment_parent_idx').on(t.parentCommentId),
  ],
);

export const follow = pgTable(
  'follow',
  {
    followerId: uuid('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: uuid('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index('follow_followee_idx').on(t.followeeId),
    check('follow_no_self', sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

/**
 * Activity feed events: "X rated Y", "Z finished W" (PRD §3.3).
 * Consumed fan-out-on-read; append-only — partition by month when volume demands it.
 */
export const activity = pgTable(
  'activity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** e.g. 'rated', 'completed', 'checked_in', 'reviewed', 'followed', 'created_list' */
    verb: text('verb').notNull(),
    /** 'media' | 'part' | 'user' | 'list' */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('activity_user_created_idx').on(t.userId, t.createdAt),
    index('activity_created_idx').on(t.createdAt),
  ],
);

/** Report/moderation queue for comments, media entries, users (PRD §7). */
export const report = pgTable(
  'report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'comment' | 'media' | 'user' | 'rating' */
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    status: reportStatusEnum('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('report_status_idx').on(t.status, t.createdAt)],
);
