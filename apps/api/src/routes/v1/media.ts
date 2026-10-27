import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyBaseLogger } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { favorite, media, rating, userMedia, type Db } from '@trackt/db';
import {
  ApiErrorSchema,
  MediaDetailSchema,
  SHOWCASE_LIMIT,
  SHOWCASE_PER_KIND,
  SearchResultSchema,
  fetchCatalogSearch,
  type MediaDetail,
  type SearchResult,
  type ViewerState,
} from '@trackt/shared';
import { loadRelations } from '../../lib/relations.js';
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

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  /**
   * A sample of what this instance actually carries, for the landing page's
   * cover band. Anonymous and viewer-independent by construction: it serves
   * `verified` rows only, so there is no session to read and nothing that
   * varies per caller — which is what makes it safe to cache at the edge.
   *
   * Kinds are round-robined rather than taken in one ranked run, so the band
   * shows the breadth (series, anime, webtoons, and games) that the pitch above
   * it claims, instead of 24 rows of whichever kind the instance has most of.
   * Titles with real artwork sort first — the band is the one surface where a
   * generated gradient is a visible downgrade.
   *
   * Registered before `/media/:idOrSlug` so `showcase` can't be read as a slug.
   */
  app.get(
    '/media/showcase',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['catalog'],
        response: {
          200: z.array(SearchResultSchema),
          503: ApiErrorSchema,
        },
      },
    },
    async (_request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const rows = await db.execute(sql`
        WITH visible AS (
          SELECT id, slug, kind, title, year, status, season_number, cover_url, description
          FROM media
          WHERE deleted_at IS NULL AND moderation = 'verified'
        ),
        one_per_title AS (
          -- A series is one media *per season* (ADR-0003), so "Breaking Bad"
          -- is several rows with one title. The band would show it twice for
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
        WHERE kind_rank <= ${SHOWCASE_PER_KIND}
        ORDER BY kind_rank, kind
        LIMIT ${SHOWCASE_LIMIT}
      `);

      // Anonymous and identical for everyone, so it may sit in a shared cache.
      // Short enough that a freshly populated catalog shows up promptly.
      reply.header('cache-control', 'public, max-age=300');

      return [...rows].map((row): SearchResult => ({
        id: row.id as string,
        slug: row.slug as string,
        kind: row.kind as SearchResult['kind'],
        title: row.title as string,
        year: row.year as number | null,
        status: row.status as SearchResult['status'],
        seasonNumber: row.season_number as number | null,
        coverUrl: row.cover_url as string | null,
        description: row.description as string | null,
      }));
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
      const column = UUID_RE.test(idOrSlug) ? media.id : media.slug;
      const [row] = await db.select().from(media).where(eq(column, idOrSlug)).limit(1);
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
