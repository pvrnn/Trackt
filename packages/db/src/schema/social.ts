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
import { friendshipStatusEnum, reportStatusEnum, targetTypeEnum } from './enums.js';
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

/**
 * Mutual friendship, request + accept (ADR-0006). Canonical-pair rather than a
 * directed `(requester, addressee)` row: is-friend is a single PK probe, and
 * the reverse-request race is impossible by construction — A requesting B
 * while B requests A hits the PK and resolves in one `ON CONFLICT` statement
 * instead of a racy read-then-write.
 */
export const friendship = pgTable(
  'friendship',
  {
    /** Ordered pair: user_a_id < user_b_id, so one row is the *whole* relationship. */
    userAId: uuid('user_a_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userBId: uuid('user_b_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Who sent the request — the only asymmetry a mutual relationship keeps. */
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: friendshipStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId] }),
    index('friendship_user_b_idx').on(t.userBId, t.status),
    // The ordering invariant that makes one-row-per-pair possible; subsumes a no-self check.
    check('friendship_pair_ordered', sql`${t.userAId} < ${t.userBId}`),
    check(
      'friendship_requester_member',
      sql`${t.requestedBy} = ${t.userAId} OR ${t.requestedBy} = ${t.userBId}`,
    ),
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
