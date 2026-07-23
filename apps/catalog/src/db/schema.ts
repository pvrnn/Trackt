import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { MEDIA_KINDS, MEDIA_STATUSES, type ExternalIds } from '@trackt/shared';

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
