import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
  NEWS_ITEM_STATUSES,
  NEWS_MEDIA_ROLES,
  NEWS_STATUSES,
  NEWS_TOPICS,
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
    externalIds: jsonb('external_ids').$type<ExternalIds>().notNull().default({}),
    description: text('description'),
    coverUrl: text('cover_url'),
    /**
     * Monotonic change cursor, bumped by trigger on every insert/update (see the
     * custom migration). Catalog version = max(seq). Requires a single-writer
     * publish path: concurrent writers can commit seq values out of order.
     */
    seq: bigint('seq', { mode: 'number' }).notNull().default(0),
    /**
     * Tombstone. The `/v1/catalog/changes` feed it was built to propagate
     * through is gone (ADR-0002); it now only hides a row from search and
     * relation reads, and blocks it as a relation endpoint. Republishing the
     * same canonical id clears it.
     */
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

/* ------------------------------------------------------------------ *
 * News (ADR-0005). Central-only: instances read these through
 * `GET /v1/news`, exactly as they read media through federated search
 * (ADR-0002). No instance mirrors them, so — like
 * `catalog_media_relation` and for the same reason — none of these
 * tables carries `seq` or `deleted_at`. Catalog version stays defined
 * as max(catalog_media.seq).
 * ------------------------------------------------------------------ */

/**
 * The registry of RSS/Atom feeds the project operator has registered. Sources
 * are data, not code: adding one is an API call, not a redeploy, and disabling
 * one stops the agent reading it immediately (ADR-0005).
 */
export const newsSource = pgTable(
  'news_source',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    feedUrl: text('feed_url').notNull().unique(),
    homepageUrl: text('homepage_url'),
    /** Which kinds this outlet covers; advisory, steers the agent's attention. */
    kinds: text('kinds', { enum: MEDIA_KINDS }).array().notNull().default([]),
    enabled: boolean('enabled').notNull().default(true),
    /** Conditional-GET state, so a poll of an unchanged feed costs one 304. */
    etag: text('etag'),
    lastModified: text('last_modified'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('news_source_enabled_idx').on(t.enabled)],
);

/**
 * The dedup ledger: every feed entry ever seen. This is what stops the agent
 * rewriting the same story on the next run — enforced by the composite primary
 * key, not by asking a model to remember.
 *
 * `(source_id, guid)` rather than the URL alone, because feeds disagree about
 * canonical URLs (tracking parameters, http/https) while the guid is stable
 * within a feed by definition.
 */
export const newsSourceItem = pgTable(
  'news_source_item',
  {
    sourceId: uuid('source_id')
      .notNull()
      .references(() => newsSource.id, { onDelete: 'cascade' }),
    guid: text('guid').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
    status: text('status', { enum: NEWS_ITEM_STATUSES }).notNull().default('pending'),
    /**
     * The article written from this item. `set null` rather than `cascade`: a
     * deleted article must not take the ledger row with it, or the next run
     * would treat the entry as unseen and write the story again.
     */
    articleId: uuid('article_id').references(() => newsArticle.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.sourceId, t.guid] }),
    // The agent's ingest step reads exactly this: what is still unwritten.
    index('news_source_item_status_idx').on(t.status, t.seenAt),
  ],
);

/**
 * An article. Created `draft` by whoever writes it (an operator by hand today,
 * the newsroom agent in Phase 4) and made public only by an explicit PATCH to
 * `published` — publication is human-gated by design (ADR-0005).
 *
 * `body` is markdown and, once the agent lands, model-authored: consumers must
 * render it through an allow-listed renderer, never as raw HTML.
 */
export const newsArticle = pgTable(
  'news_article',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    dek: text('dek'),
    body: text('body').notNull(),
    topic: text('topic', { enum: NEWS_TOPICS }).notNull(),
    kinds: text('kinds', { enum: MEDIA_KINDS }).array().notNull().default([]),
    coverUrl: text('cover_url'),
    status: text('status', { enum: NEWS_STATUSES }).notNull().default('draft'),
    /** Null until published; stamped by the publish transition, never by the client. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Serves the public feed's keyset scan whole: the WHERE on status, then the
    // (published_at DESC, id DESC) ordering the cursor pages through.
    index('news_article_feed_idx').on(t.status, t.publishedAt.desc(), t.id.desc()),
    // Array containment for the ?kind= filter.
    index('news_article_kinds_idx').using('gin', t.kinds),
    index('news_article_topic_idx').on(t.topic),
  ],
);

/** Attribution rows. PK on `(article_id, url)` makes re-submitting a source idempotent. */
export const newsArticleSource = pgTable(
  'news_article_source',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => newsArticle.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    outlet: text('outlet').notNull(),
    title: text('title').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.url] })],
);

/**
 * Which works a story is about. The FK to `catalog_media` is what keeps the link
 * honest: an article can only point at a work the catalog actually has, so no
 * model can invent a canonical id by writing one here (ADR-0001, ADR-0005).
 */
export const newsArticleMedia = pgTable(
  'news_article_media',
  {
    articleId: uuid('article_id')
      .notNull()
      .references(() => newsArticle.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => catalogMedia.id, { onDelete: 'cascade' }),
    role: text('role', { enum: NEWS_MEDIA_ROLES }).notNull(),
  },
  (t) => [
    // Role-inclusive so the PK can't silently collapse two different readings.
    primaryKey({ columns: [t.articleId, t.mediaId, t.role] }),
    // Serves /v1/news/by-media — the media detail page's "In the news" block.
    index('news_article_media_media_idx').on(t.mediaId),
  ],
);
