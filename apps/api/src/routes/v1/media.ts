import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  buildProviderMediaRow,
  favorite,
  insertNewProviderMedia,
  media,
  rating,
  userMedia,
  type Db,
} from '@trackt/db';
import {
  ApiErrorSchema,
  GenreListSchema,
  MediaDetailSchema,
  MediaKindSchema,
  SHOWCASE_LIMIT,
  SHOWCASE_MAX_OFFSET,
  SearchResultSchema,
  StatusFilterSchema,
  fetchCatalogMedia,
  fetchCatalogSearch,
  fetchCatalogShowcase,
  type CatalogShowcaseQuery,
  type MediaDetail,
  type SearchResult,
  type ViewerState,
} from '@trackt/shared';
import { loadRelations } from '../../lib/relations.js';
import { mediaFilterSql } from '../../lib/search.js';
import { getSessionUser } from '../../lib/session.js';
import { canViewMedia, visibleMediaSql } from '../../lib/visibility.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadCommunity(db: Db, mediaId: string): Promise<MediaDetail['community']> {
  const [row] = await db
    .select({
      averageScore: sql<number | null>`avg(${rating.score})::float`,
      ratingCount: count(),
    })
    .from(rating)
    .where(
      and(
        eq(rating.targetType, 'media'),
        eq(rating.targetId, mediaId),
        sql`${rating.score} IS NOT NULL`,
      ),
    );
  return { averageScore: row?.averageScore ?? null, ratingCount: row?.ratingCount ?? 0 };
}

/**
 * Game rows whose release status has already been asked of the catalog, and
 * when. Most games have none upstream, so the row never gains the field and the
 * guard below would send the same search on every view; this makes it once per
 * row per process instead of once per render. Deliberately not persisted: the
 * stale cohort is finite, and a restart costs one request for each row that is
 * still being viewed.
 */
const STATUS_ASKED_TTL_MS = 6 * 60 * 60 * 1000;
const STATUS_ASKED_LIMIT = 10_000;
const statusAskedAt = new Map<string, number>();

async function loadCurrentMetadata(
  catalogUrl: string | undefined,
  row: { id: string; kind: string; title: string; metadata: Record<string, unknown> },
  timeoutMs: number,
  logger: FastifyBaseLogger,
): Promise<Record<string, unknown>> {
  if (row.kind !== 'game' || typeof row.metadata.igdbStatus === 'string' || !catalogUrl) {
    return row.metadata;
  }
  const now = Date.now();
  const askedAt = statusAskedAt.get(row.id);
  if (askedAt !== undefined && now - askedAt < STATUS_ASKED_TTL_MS) return row.metadata;
  // Recorded before the request so concurrent views of one row ask once.
  if (statusAskedAt.size >= STATUS_ASKED_LIMIT) statusAskedAt.clear();
  statusAskedAt.set(row.id, now);
  try {
    const response = await fetchCatalogSearch(catalogUrl, row.title, {
      kind: 'game',
      limit: 100,
      timeoutMs,
    });
    const central = response.results.find((hit) => hit.id === row.id);
    return central ? { ...row.metadata, ...central.metadata } : row.metadata;
  } catch (error) {
    logger.warn({ err: error, id: row.id }, 'failed to refresh game release status from catalog');
    return row.metadata;
  }
}

/**
 * Same-kind suggestions sharing at least one genre, strongest overlap first —
 * the labelled fallback the client shows under "You might also like" when a work
 * has no typed relations (ADR-0004). A suggestion heuristic, not a relation:
 * always computed and always sent, so the payload's meaning never depends on
 * whether `relations` happened to be empty.
 */
async function loadRelated(
  db: Db,
  row: { id: string; kind: string; genres: string[] },
): Promise<SearchResult[]> {
  if (row.genres.length === 0) return [];
  // Self-join on the source row: its genres never leave Postgres (array params
  // don't survive drizzle's sql interpolation).
  const rows = await db.execute(sql`
    SELECT m.id, m.slug, m.kind, m.title, m.year, m.status, m.season_number, m.cover_url, m.description,
           cardinality(ARRAY(SELECT unnest(m.genres) INTERSECT SELECT unnest(src.genres))) AS overlap
    FROM media m
    JOIN media src ON src.id = ${row.id}
    WHERE m.kind = src.kind
      AND m.id <> src.id
      AND m.genres && src.genres
      AND ${visibleMediaSql(sql.raw('m.'))}
    ORDER BY overlap DESC, m.year DESC NULLS LAST, m.title ASC
    LIMIT 3
  `);
  return [...rows].map((related) => ({
    id: related.id as string,
    slug: related.slug as string,
    kind: related.kind as SearchResult['kind'],
    title: related.title as string,
    year: related.year as number | null,
    status: related.status as SearchResult['status'],
    seasonNumber: related.season_number as number | null,
    coverUrl: related.cover_url as string | null,
    description: related.description as string | null,
  }));
}

async function loadViewer(db: Db, userId: string, mediaId: string): Promise<ViewerState> {
  const [log] = await db
    .select({
      status: userMedia.status,
      startedAt: userMedia.startedAt,
      finishedAt: userMedia.finishedAt,
    })
    .from(userMedia)
    .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, mediaId)));
  const [own] = await db
    .select({ score: rating.score })
    .from(rating)
    .where(
      and(eq(rating.userId, userId), eq(rating.targetType, 'media'), eq(rating.targetId, mediaId)),
    );
  const watchedRows = await db.execute(sql`
    SELECT mp.number FROM progress p
    JOIN media_part mp ON mp.id = p.part_id
    WHERE p.user_id = ${userId} AND mp.media_id = ${mediaId}
    ORDER BY mp.number ASC
  `);
  const [fav] = await db
    .select({ mediaId: favorite.mediaId })
    .from(favorite)
    .where(and(eq(favorite.userId, userId), eq(favorite.mediaId, mediaId)));
  return {
    status: log?.status ?? null,
    score: own?.score !== undefined && own.score !== null ? Number(own.score) : null,
    watched: [...watchedRows].map((row) => Number(row.number)),
    favorited: fav !== undefined,
    startedAt: log?.startedAt ?? null,
    finishedAt: log?.finishedAt ?? null,
  };
}

/**
 * A permalink by id to a work this instance has never seen: pull it from the
 * central catalog and materialize it, as a search hit would be. Degrades to a
 * 404 when the catalog is off, down, or has no such work.
 */
async function materializeFromCatalog(
  db: Db,
  catalogUrl: string | undefined,
  id: string,
  timeoutMs: number,
  logger: FastifyBaseLogger,
) {
  if (!catalogUrl) return undefined;
  try {
    const hit = await fetchCatalogMedia(catalogUrl, id, { timeoutMs });
    if (!hit) return undefined;
    const [persisted] = await insertNewProviderMedia(db, [buildProviderMediaRow(hit)]);
    return persisted;
  } catch (error) {
    logger.warn({ err: error, id }, 'failed to materialize a work from the central catalog');
    return undefined;
  }
}

/** A shelf batch plus whether another follows it (`x-has-more`). */
interface ShowcaseShelf {
  results: SearchResult[];
  hasMore: boolean;
}

type ShowcaseQuery = Omit<CatalogShowcaseQuery, 'limit'>;

/**
 * The catalog's own shelf, materialized like a search page so every card links
 * to a local slug. Null — and the caller falls back to local rows — when no
 * catalog is configured, it predates the route, or it fails: the landing band
 * must not go blank because the catalog is down.
 */
async function catalogShowcase(
  db: Db,
  catalogUrl: string | undefined,
  { kind, year, genres, status, offset }: ShowcaseQuery,
  { timeoutMs, logger }: { timeoutMs: number; logger: FastifyBaseLogger },
): Promise<ShowcaseShelf | null> {
  if (!catalogUrl) return null;
  try {
    const response = await fetchCatalogShowcase(catalogUrl, {
      kind,
      year,
      genres,
      status,
      offset,
      limit: SHOWCASE_LIMIT + 1,
      timeoutMs,
    });
    if (!response) return null;
    if (response.skipped.length > 0) {
      logger.warn(
        { skipped: response.skipped },
        'skipping central showcase works that do not match this build (upgrade to pick them up)',
      );
    }
    const hasMore = response.results.length + response.skipped.length > SHOWCASE_LIMIT;
    const page = response.results.slice(0, SHOWCASE_LIMIT);
    const persisted = await insertNewProviderMedia(db, page.map(buildProviderMediaRow));
    const byId = new Map(persisted.map((row) => [row.id, row]));
    // A row this instance pulled or rejected stays off its shelf, as it does off search.
    const results = page.flatMap((work): SearchResult[] => {
      const row = byId.get(work.id);
      if (!row || row.deletedAt !== null || row.moderation !== 'verified') return [];
      return [
        {
          id: row.id,
          slug: row.slug,
          kind: row.kind,
          title: row.title,
          year: row.year,
          status: row.status,
          seasonNumber: row.seasonNumber,
          coverUrl: row.coverUrl,
          description: row.description,
        },
      ];
    });
    return { results, hasMore };
  } catch (error) {
    logger.warn({ err: error }, 'central catalog showcase failed, serving local rows');
    return null;
  }
}

/** The shelf from this instance's own rows, for an instance with no reachable catalog. */
async function localShowcase(
  db: Db,
  { kind, year, offset, ...filters }: ShowcaseQuery,
): Promise<ShowcaseShelf> {
  const rows = await db.execute(sql`
    WITH visible AS (
      SELECT id, slug, kind, title, year, status, season_number, cover_url, description
      FROM media
      WHERE deleted_at IS NULL AND moderation = 'verified'
        -- Anonymous marketing surface: keep adult-leaning covers off it.
        AND NOT EXISTS (
          SELECT 1 FROM unnest(genres) AS genre
          WHERE lower(genre) IN ('ecchi', 'hentai')
        )
        ${kind ? sql`AND kind = ${kind}` : sql``}
        ${year ? sql`AND year = ${year}` : sql``}
        ${mediaFilterSql(filters)}
    ),
    one_per_title AS (
      -- A series is one media *per season* (ADR-0003), so "Breaking Bad"
      -- is several rows with one title. A shelf would show it twice for
      -- no reason a visitor could work out; keep the earliest season.
      SELECT *, row_number() OVER (
               PARTITION BY kind, title
               ORDER BY (cover_url IS NOT NULL) DESC, season_number ASC NULLS FIRST, id
             ) AS title_rank
      FROM visible
    ),
    ranked AS (
      SELECT *, row_number() OVER (
               PARTITION BY kind
               ORDER BY (cover_url IS NOT NULL) DESC, year DESC NULLS LAST, id
             ) AS kind_rank
      FROM one_per_title
      WHERE title_rank = 1
    )
    SELECT id, slug, kind, title, year, status, season_number, cover_url, description
    FROM ranked
    ORDER BY kind_rank, kind
    LIMIT ${SHOWCASE_LIMIT + 1}
    OFFSET ${offset}
  `);

  // One row past the batch is how "there is another page" is known without a
  // second count over a table this endpoint exists to sample.
  const page = [...rows];
  return {
    hasMore: page.length > SHOWCASE_LIMIT,
    results: page.slice(0, SHOWCASE_LIMIT).map((row): SearchResult => ({
      id: row.id as string,
      slug: row.slug as string,
      kind: row.kind as SearchResult['kind'],
      title: row.title as string,
      year: row.year as number | null,
      status: row.status as SearchResult['status'],
      seasonNumber: row.season_number as number | null,
      coverUrl: row.cover_url as string | null,
      description: row.description as string | null,
    })),
  };
}

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * The landing page's cover band, and the Discover page's shelf when nothing
   * has been typed yet: the central catalog's most-followed works
   * (`/v1/catalog/showcase`), materialized as they are served. Only an instance
   * with no reachable catalog falls back to its own rows, newest first.
   * Anonymous and viewer-independent by construction: it serves `verified` rows
   * only, so there is no session to read and nothing that varies per caller —
   * which is what makes it safe to cache at the edge.
   *
   * Kinds are round-robined rather than taken in one ranked run, so the first
   * page shows the breadth (series, anime, webtoons, and games) that the pitch
   * above it claims, instead of 24 rows of whichever kind the instance has
   * most of. Titles with real artwork sort first — this is the one surface
   * where a generated gradient is a visible downgrade.
   *
   * `?offset=` continues that same order past the first page, so Discover's
   * shelf can be scrolled rather than paged; `x-has-more` says whether a calling
   * client should ask again. The order is a total one (`kind_rank`, then kind),
   * so consecutive pages cannot repeat or skip a row. The round-robin is only
   * interleaved while every kind still has rows at that depth — deep into a
   * catalog with one huge kind, that kind's tail is what remains, which is the
   * same order a single ranked run would have produced.
   *
   * `?kind=` narrows it to one kind and drops the round-robin: a caller that
   * asked for series wants a screenful of series, not five of them and nineteen
   * others. `?year=` narrows it to one release year — Discover's year pill
   * applies to the browse shelf as well as to results, or it would look dead
   * until something was typed. Still anonymous and still the same for every
   * caller, so the cache directive stays `public` — an edge cache keys a CDN
   * entry on the query string, so each kind, year and offset is cached apart.
   *
   * Registered before `/media/:idOrSlug` so `showcase` can't be read as a slug.
   */
  app.get(
    '/media/showcase',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['catalog'],
        querystring: z.object({
          kind: MediaKindSchema.optional(),
          /** Narrows the shelf to one release year (Discover's year filter). */
          year: z.coerce.number().int().min(1800).max(2200).optional(),
          genres: GenreListSchema.optional(),
          status: StatusFilterSchema.optional(),
          /** Batches already read, in the same order the first one came in. */
          offset: z.coerce.number().int().min(0).max(SHOWCASE_MAX_OFFSET).default(0),
        }),
        response: {
          200: z.array(SearchResultSchema),
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const shelf =
        (await catalogShowcase(db, app.deps.env.CATALOG_URL, request.query, {
          timeoutMs: app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
          logger: app.log,
        })) ?? (await localShowcase(db, request.query));

      // Anonymous and identical for everyone, so it may sit in a shared cache.
      // Short enough that a freshly populated catalog shows up promptly.
      reply.header('cache-control', 'public, max-age=300');
      reply.header('x-has-more', String(shelf.hasMore));
      return shelf.results;
    },
  );

  app.get(
    '/media/:idOrSlug',
    {
      schema: {
        tags: ['catalog'],
        params: z.object({ idOrSlug: z.string().min(1) }),
        response: {
          200: MediaDetailSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { idOrSlug } = request.params;
      const byId = UUID_RE.test(idOrSlug);
      const [local] = await db
        .select()
        .from(media)
        .where(eq(byId ? media.id : media.slug, idOrSlug))
        .limit(1);
      const row =
        local ??
        (byId
          ? await materializeFromCatalog(
              db,
              app.deps.env.CATALOG_URL,
              idOrSlug.toLowerCase(),
              app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
              request.log,
            )
          : undefined);
      const user = await getSessionUser(app, request);
      // 404 (not 403) for entries the viewer can't see — don't leak existence.
      if (!row || !canViewMedia(row)) {
        return reply.status(404).send({ error: 'media not found' });
      }

      const [community, relations, related, viewer, metadata] = await Promise.all([
        loadCommunity(db, row.id),
        loadRelations(db, app.deps.env.CATALOG_URL, row, {
          timeoutMs: app.deps.env.CATALOG_RELATIONS_TIMEOUT_MS,
          logger: request.log,
        }),
        loadRelated(db, row),
        user ? loadViewer(db, user.id, row.id) : Promise.resolve(null),
        loadCurrentMetadata(
          app.deps.env.CATALOG_URL,
          row,
          app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
          request.log,
        ),
      ]);

      return { ...row, metadata, community, relations, related, viewer };
    },
  );
};
