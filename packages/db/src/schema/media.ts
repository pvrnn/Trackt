import { sql } from 'drizzle-orm';
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { ExternalIds } from '@trackt/shared';
import {
  mediaKindEnum,
  mediaSourceEnum,
  mediaStatusEnum,
  moderationStatusEnum,
  partKindEnum,
} from './enums.js';
import { users } from './auth.js';

/**
 * Catalog entries: one row per work, all media kinds (PRD §5).
 * Provider-identified rows use deterministic canonical UUIDs and will be synced from
 * the central slim catalog (ADR-0001); user-created rows keep random UUIDs, start
 * `unverified`, and go through the per-instance moderation queue.
 */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: mediaKindEnum('kind').notNull(),
    title: text('title').notNull(),
    originalTitle: text('original_title'),
    slug: text('slug').notNull(),
    /** Alternative titles (original language, romanizations, aliases) — searched. */
    synonyms: text('synonyms').array().notNull().default([]),
    genres: text('genres').array().notNull().default([]),
    year: integer('year'),
    episodeCount: integer('episode_count'),
    seasonCount: integer('season_count'),
    chapterCount: integer('chapter_count'),
    volumeCount: integer('volume_count'),
    description: text('description'),
    coverUrl: text('cover_url'),
    releaseDate: date('release_date'),
    status: mediaStatusEnum('status'),
    /** {"tmdb": 123, "anilist": 456, ...} — dedup, cross-import, provider switching. */
    externalIds: jsonb('external_ids').$type<ExternalIds>().notNull().default({}),
    /** Type-specific fields: runtime, studios, demographics... */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    source: mediaSourceEnum('source').notNull().default('provider'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    moderation: moderationStatusEnum('moderation').notNull().default('verified'),
    /** Link to a shared community-catalog entry (v2, PRD §4). */
    communityUuid: uuid('community_uuid'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('media_slug_idx').on(t.slug),
    index('media_kind_idx').on(t.kind),
    index('media_moderation_idx').on(t.moderation),
    index('media_external_ids_gin_idx').using('gin', t.externalIds),
    // Typo-tolerant title search via pg_trgm (extension created in the initial migration).
    index('media_title_trgm_idx').using('gin', sql`${t.title} gin_trgm_ops`),
  ],
);

/**
 * Generic structural hierarchy: seasons→episodes for video, volumes→chapters for print.
 * `number` is numeric to support chapter 10.5 and similar.
 */
export const mediaPart = pgTable(
  'media_part',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    /** episode→season, chapter→volume; null for top-level parts. */
    parentId: uuid('parent_id').references((): AnyPgColumn => mediaPart.id, {
      onDelete: 'cascade',
    }),
    kind: partKindEnum('kind').notNull(),
    number: numeric('number', { precision: 8, scale: 2 }),
    title: text('title'),
    airDate: date('air_date'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    // Unique so lazy part creation (tracking check-ins) can ON CONFLICT DO NOTHING.
    uniqueIndex('media_part_media_id_idx').on(t.mediaId, t.kind, t.number),
    index('media_part_parent_id_idx').on(t.parentId),
  ],
);
