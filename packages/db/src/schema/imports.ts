import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { logStatusEnum, mediaKindEnum } from './enums.js';
import { users } from './auth.js';
import { media } from './media.js';

/**
 * What an import could not decide: a work the instance *might* carry, scored
 * below the match threshold, or several rows that scored alike.
 *
 * The importer never guesses these — writing someone's history onto the wrong
 * work is the one mistake an import cannot ask forgiveness for — but leaving
 * them in a log file wastes the only person who can settle them. So they land
 * here, with the candidates and the entry that produced them, and a client can
 * ask the viewer which row it is.
 *
 * One row per (user, source, entry): a re-run replaces the unresolved set
 * rather than appending, so a stale candidate list cannot outlive the plan that
 * produced it. `resolvedAt` is the frontend's answer; rows already answered are
 * left alone by later runs.
 */

export const IMPORT_MATCH_OUTCOMES = ['below-threshold', 'tie'] as const;
export type ImportMatchOutcome = (typeof IMPORT_MATCH_OUTCOMES)[number];
export const importMatchOutcomeEnum = pgEnum('import_match_outcome', IMPORT_MATCH_OUTCOMES);

export const IMPORT_MATCH_ORIGINS = ['local', 'catalog'] as const;
export type ImportMatchOrigin = (typeof IMPORT_MATCH_ORIGINS)[number];

/** One row the import could have chosen, as the picker renders it. */
export interface ImportMatchCandidate {
  id: string;
  title: string;
  year: number | null;
  /** 0–1, from `scoreMatch`. */
  score: number;
  /** Where the row lives: this instance's `media`, or the central catalog. */
  origin: ImportMatchOrigin;
}

export const importMatch = pgTable(
  'import_match',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `mal` | `anilist` | `letterboxd` | `trakt`. */
    source: text('source').notNull(),
    /** The provider's id for the row (a MAL id, a Letterboxd slug…). */
    externalId: text('external_id').notNull(),
    /** The plan's subject key — one entry per (source, kind, id, season). */
    entryKey: text('entry_key').notNull(),
    kind: mediaKindEnum('kind').notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    seasonNumber: integer('season_number'),
    status: logStatusEnum('status').notNull(),
    outcome: importMatchOutcomeEnum('outcome').notNull(),
    /** The best score any candidate reached — 0.5–0.8, or the tie's score. */
    bestScore: real('best_score').notNull(),
    /** `ImportMatchCandidate[]`, best first. */
    candidates: jsonb('candidates').$type<ImportMatchCandidate[]>().notNull(),
    /**
     * The provider row as the plan saw it (`ImportEntry`), so answering a pick
     * later can write the log without re-reading the provider.
     */
    entry: jsonb('entry').$type<Record<string, unknown>>().notNull(),
    /** The viewer's answer, once a client records one. */
    resolvedMediaId: uuid('resolved_media_id').references(() => media.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One live row per subject: a re-run upserts rather than duplicating.
    uniqueIndex('import_match_subject_idx').on(t.userId, t.source, t.entryKey),
    // The picker's query: this viewer's unanswered rows, newest first.
    index('import_match_open_idx').on(t.userId, t.resolvedAt),
  ],
);

/**
 * One account import the viewer asked for, as it moves through the `importer`
 * queue. BullMQ's own job is the work item and is reaped or reused per
 * (viewer, source); this row is the record a client reads back afterwards.
 * Previews (`dryRun`) are not recorded: they are discarded once read.
 */
export const IMPORT_RUN_STATES = ['queued', 'running', 'completed', 'failed'] as const;
export type ImportRunState = (typeof IMPORT_RUN_STATES)[number];
export const importRunStateEnum = pgEnum('import_run_state', IMPORT_RUN_STATES);

export const importRun = pgTable(
  'import_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Registry id; text so a new source needs no migration. */
    source: text('source').notNull(),
    /** The provider username, or a file source's label (`export 2026-07-07`). */
    profile: text('profile').notNull(),
    overwrite: boolean('overwrite').notNull().default(false),
    state: importRunStateEnum('state').notNull().default('queued'),
    /** The BullMQ job carrying this run; stable per (viewer, source), so not unique. */
    jobId: text('job_id').notNull(),
    done: integer('done').notNull().default(0),
    total: integer('total').notNull().default(0),
    /** `ImportJobResult` once completed. */
    result: jsonb('result').$type<Record<string, unknown>>(),
    /** `ImportError.kind`, or `lost` when the queue dropped the job. */
    errorKind: text('error_kind'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('import_run_user_idx').on(t.userId, t.createdAt),
    // Mirrors the queue's one-job-per-(viewer, source): at most one live run.
    uniqueIndex('import_run_live_idx')
      .on(t.userId, t.source)
      .where(sql`${t.state} in ('queued', 'running')`),
  ],
);
