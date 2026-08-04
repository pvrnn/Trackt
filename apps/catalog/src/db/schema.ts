import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  MEDIA_KINDS,
  MEDIA_RELATION_TYPES,
  MEDIA_STATUSES,
  type ExternalIds,
} from '@trackt/shared';

/**
 * The central slim catalog (ADR-0001): one row per work, only redistributable facts.
 * This schema belongs to the catalog service alone — instances share the zod contract
 * in @trackt/shared, not these tables. kind/status are text (not pgEnum) to keep the
 * two databases decoupled.
 */
export const catalogMedia = pgTable(
  'catalog_media',
  {
    /** Canonical uuidv5 assigned by the publisher — never generated here. */
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: MEDIA_KINDS }).notNull(),
    title: text('title').notNull(),
    synonyms: text('synonyms').array().notNull().default([]),
    year: integer('year'),
    status: text('status', { enum: MEDIA_STATUSES }),
    genres: text('genres').array().notNull().default([]),
    /** Episodes (series/anime season) or chapters (manga/webtoon); null for movies (ADR-0003). */
    partCount: integer('part_count'),
    /** Which season this row is, for series/anime split per season (ADR-0003); null otherwise. */
    seasonNumber: integer('season_number'),
    /** Collision breaker for canonical identity (ADR-0005); null for the first claimant. */
    discriminator: text('discriminator'),
    externalIds: jsonb('external_ids').$type<ExternalIds>().notNull().default({}),
    description: text('description'),
    coverUrl: text('cover_url'),
    /**
     * Monotonic change cursor, bumped by trigger on every insert/update (see the
     * custom migration). Catalog version = max(seq). Requires a single-writer
     * publish path: concurrent writers can commit seq values out of order.
     */
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    /** Tombstone — deletions must propagate through /v1/catalog/changes. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('catalog_media_seq_idx').on(t.seq),
    index('catalog_media_kind_idx').on(t.kind),
    // Typo-tolerant title search via pg_trgm (extension created in a hand-written
    // migration, ADR-0002) — mirrors the instance-side media_title_trgm_idx.
    index('catalog_media_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
  ],
);

/**
 * Typed, directed edges between catalog works (ADR-0004) — the navigation layer
 * over ADR-0003's flat per-season rows. Stored in ONE direction only
 * (`from_id →type→ to_id`); the inverse reading (prequel/source/parent) is
 * derived by consumers via `relationLabel` in @trackt/shared, never stored.
 * `type` is text rather than a pgEnum for the same reason kind/status are: the
 * two databases stay decoupled.
 *
 * No `seq` and no `deleted_at`. The pull feed both would have served was removed
 * in ADR-0002, catalog version stays defined as max(catalog_media.seq), and an
 * edge has no lifecycle worth tombstoning — a bad one is a hard DELETE, and a
 * tombstoned endpoint already drops its edges via the read route's join.
 */
export const catalogMediaRelation = pgTable(
  'catalog_media_relation',
  {
    fromId: uuid('from_id')
      .notNull()
      .references(() => catalogMedia.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => catalogMedia.id, { onDelete: 'cascade' }),
    type: text('type', { enum: MEDIA_RELATION_TYPES }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Type-inclusive so one pair can carry two true edges (a manga that is both
    // an anime's source and related to it), and so publishing is idempotent.
    primaryKey({ columns: [t.fromId, t.toId, t.type] }),
    // Reverse half of the bidirectional lookup (the `to_id = $1` branch).
    index('catalog_media_relation_to_idx').on(t.toId),
    // Load-bearing, not hygiene: with no self-edges possible, the read route's
    // two branches are provably disjoint and can UNION ALL without a dedup sort.
    check('catalog_media_relation_no_self', sql`${t.fromId} <> ${t.toId}`),
  ],
);

/**
 * Redirects a retired canonical id to the work that superseded it (ADR-0005).
 *
 * Under provider-keyed identity this table would have been optional — a TMDB id
 * was a stable handle, so a work's id essentially never moved. Attribute-derived
 * identity gives that up: an id is a function of kind+title+year, so a corrected
 * title, a corrected year, or two rows discovered to be the same work all leave
 * an id that instances have already handed out and users have already tracked
 * against. Deleting it would silently orphan that history, and re-minting under
 * the corrected attributes without a forwarding pointer would strand it.
 *
 * So: the superseded id is never reused and never deleted, it is aliased. Sync
 * resolves through this table, which makes the identity scheme's one structural
 * weakness recoverable instead of permanent.
 */
export const catalogMediaAlias = pgTable(
  'catalog_media_alias',
  {
    /** The retired id. Not a FK — its `catalog_media` row is gone by definition. */
    aliasId: uuid('alias_id').primaryKey(),
    canonicalId: uuid('canonical_id')
      .notNull()
      .references(() => catalogMedia.id, { onDelete: 'cascade' }),
    /** Why the id moved — a title correction, a merge, a discriminator fix. */
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A self-alias is an infinite redirect, and resolution has no cycle guard.
    check('catalog_media_alias_no_self', sql`${t.aliasId} <> ${t.canonicalId}`),
    index('catalog_media_alias_canonical_idx').on(t.canonicalId),
  ],
);
