import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import type { ExternalIds } from '@trackt/shared';
import {
  mediaKindEnum,
  mediaRelationTypeEnum,
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
 *
 * Removing a title from circulation is a two-tier product decision:
 *
 * - SOFT DELETE (`deleted_at`) is the sanctioned way to pull a title. The row
 *   and all dependent user data (logs, progress, favourites, list items) stay
 *   intact; the media just stops being visible/discoverable — enforced at the
 *   central visibility seam (apps/api/src/lib/visibility.ts) plus the
 *   own-data joins that sit outside it (home/profile/activity/moderation).
 *   Nothing sets `deleted_at` yet; this is groundwork. Federated search never
 *   resurrects a soft-deleted row.
 * - HARD `DELETE FROM media` remains cascade-by-design for deliberate purges
 *   (spam, illegal content): `user_media`, `favorite`, `list_item`, and (via
 *   `media_part`) `progress` cascade-delete, and the polymorphic tables
 *   (`rating`, `comment`, `activity`, `report`) reference media by bare
 *   (target_type, target_id) with no FK, so their rows silently dangle. That
 *   wipes user check-ins/logs irrecoverably — reach for `deleted_at` unless
 *   wiping is the point. No code path issues hard deletes today.
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
    /** Episodes (series/anime season) or chapters (manga/webtoon); null for movies (ADR-0003). */
    partCount: integer('part_count'),
    /** Which season this row is, for series/anime split per season (ADR-0003); null otherwise. */
    seasonNumber: integer('season_number'),
    /** Collision breaker for canonical identity (ADR-0005); null for the first claimant. */
    discriminator: text('discriminator'),
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
    /**
     * Soft-delete marker: non-null pulls the title from circulation (search,
     * detail, shelves) while keeping user logs/progress intact. NULL = live.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('media_slug_idx').on(t.slug),
    index('media_kind_idx').on(t.kind),
    // The daily creation limit counts per-creator rows on every POST /media.
    index('media_created_by_idx').on(t.createdBy),
    index('media_moderation_idx').on(t.moderation),
    index('media_external_ids_gin_idx').using('gin', t.externalIds),
    // Derived season-sibling lookup, run on every series detail page (ADR-0004).
    // The jsonb GIN index above serves containment, not `->>` equality.
    index('media_external_tmdb_idx').on(sql`(${t.externalIds} ->> 'tmdb')`),
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

/**
 * Typed, directed edges between media rows (ADR-0004): how ADR-0003's flat
 * per-season media reconnect (S1 →sequel→ S2) and how cross-kind works link
 * (manga →adaptation→ anime). Stored in ONE direction only; the inverse reading
 * (prequel/source/parent) comes from `relationLabel` in @trackt/shared.
 *
 * Every row here is a *published* fact, materialized once from the catalog's
 * `/v1/catalog/relations` (ADR-0002's one-time-snapshot posture, extended to
 * edges). Adjacent series seasons derivable from `external_ids.tmdb` +
 * `season_number` are computed per request and deliberately never written, so
 * this table needs no provenance column and "a stored edge wins over a derived
 * one" is true by construction.
 *
 * Edges carry no visibility of their own: every read path must filter targets
 * through `canViewMedia`/`visibleMediaSql`, or an `unverified` entry linked as a
 * sequel would leak and a soft-deleted row would resurface through its sibling.
 * Both endpoints cascade — unlike `media` itself, no user data hangs off an edge.
 */
export const mediaRelation = pgTable(
  'media_relation',
  {
    fromId: uuid('from_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    toId: uuid('to_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    type: mediaRelationTypeEnum('type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Type-inclusive so one pair can carry two true edges (a manga that is both
    // an anime's source and related to it), and so materializing is idempotent.
    primaryKey({ columns: [t.fromId, t.toId, t.type] }),
    // Reverse half of the bidirectional detail-page lookup (`to_id = $1`).
    index('media_relation_to_idx').on(t.toId),
    // Load-bearing, not hygiene: with no self-edges possible, the read query's
    // two branches are provably disjoint and can UNION ALL without a dedup sort.
    check('media_relation_no_self', sql`${t.fromId} <> ${t.toId}`),
  ],
);
