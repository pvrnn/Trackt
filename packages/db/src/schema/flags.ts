import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth.js';

/**
 * Feature-gating rules (ADR-0011). There is no FK to a registry table: the
 * registry is code (`@trackt/shared`), and a row for a key that was deleted
 * there is dead weight rather than an error — an instance must survive a
 * `main` that removed a flag before the operator cleaned up.
 *
 * **A row is a deviation, never the registry.** No row means the code default,
 * which is what stops a stale instance from resurrecting a feature deleted in
 * code, and makes an empty table a valid, fully working state.
 */
export const featureFlags = pgTable(
  'feature_flag',
  {
    key: text('key').primaryKey(),
    /** Global kill switch. Outranks per-user overrides and the country allowlist. */
    enabled: boolean('enabled').notNull().default(true),
    /** Percent of *eligible signed-in* users, 0–100. */
    rollout: smallint('rollout').notNull().default(100),
    /** ISO 3166-1 alpha-2 allowlist; empty means every country. */
    countries: text('countries')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** The whole audit trail: the Pino line on each write carries the diff. */
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [check('feature_flag_rollout_range', sql`${t.rollout} between 0 and 100`)],
);

/**
 * Per-user grant/deny, measured against the parent rule and dropped with it
 * (`onDelete: 'cascade'`). The index exists for the per-request
 * `WHERE user_id = $1` probe, which is deliberately uncached.
 */
export const featureFlagOverrides = pgTable(
  'feature_flag_override',
  {
    key: text('key')
      .notNull()
      .references(() => featureFlags.key, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.userId] }),
    index('feature_flag_override_user_idx').on(t.userId),
  ],
);
