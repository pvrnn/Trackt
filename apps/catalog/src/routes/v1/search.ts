import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogSearchKindsQuerySchema,
  CatalogSearchKindsResponseSchema,
  CatalogSearchQuerySchema,
  CatalogGenresQuerySchema,
  CatalogGenresResponseSchema,
  CatalogSearchResponseSchema,
  CatalogShowcaseQuerySchema,
  CatalogShowcaseResponseSchema,
  DERIVATIVE_FORMATS,
  GENRE_SUGGESTION_LIMIT,
  SEARCH_RANK_WEIGHTS,
  SEARCH_SORT_TEXT_FLOOR,
  UNKNOWN_POPULARITY,
  mediaStatusesFor,
  type CatalogSearchHit,
  type ExternalIds,
  type SearchSort,
  type StatusFilter,
} from '@trackt/shared';

/**
 * `metadata.format IN (...)` over the shared derivative vocabulary. The
 * vocabulary arrives space-separated (`tv short`, `one shot`), so the
 * `tv_short` spelling matches nothing — see `DERIVATIVE_FORMATS`.
 */
const derivativeFormatSql = sql.join(
  Object.entries(DERIVATIVE_FORMATS).map(
    ([kind, formats]) =>
      sql`(kind = ${kind} AND metadata->>'format' IN (${sql.join(
        formats.map((format) => sql`${format}`),
        sql`, `,
      )}))`,
  ),
  sql` OR `,
);

interface MatchFilters {
  year?: number | undefined;
  genres?: string[] | undefined;
  status?: StatusFilter | undefined;
}

/** The rows a query matches, shared by the ranked search and its per-kind counts. */
function matchSql(q: string, filters: MatchFilters) {
  return sql`deleted_at IS NULL
    AND (immutable_unaccent(lower(title)) % immutable_unaccent(lower(${q}))
         OR immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
         OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%')
    ${filterSql(filters)}`;
}

/** Discover's narrowing filters, as `AND` clauses over `catalog_media`. */
function filterSql({ year, genres, status }: MatchFilters) {
  return sql`AND (${year ?? null}::int IS NULL OR year = ${year ?? null}::int)
    ${
      genres?.length
        ? sql`AND genres @> ARRAY[${sql.join(
            genres.map((genre) => sql`${genre}`),
            sql`, `,
          )}]::text[]`
        : sql``
    }
    ${
      status
        ? sql`AND status IN (${sql.join(
            mediaStatusesFor(status).map((value) => sql`${value}`),
            sql`, `,
          )})`
        : sql``
    }`;
}

/**
 * The relevance floor a reordering sort applies (`SEARCH_SORT_TEXT_FLOOR`),
 * spelled over the base row so the per-kind counts can apply it too: tier ≥ 2
 * is exactly "the title or a synonym contains the query".
 */
function sortFloorSql(q: string, sort: SearchSort) {
  if (sort === 'relevance') return sql``;
  return sql`AND (immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
    OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
    OR GREATEST(
         similarity(immutable_unaccent(lower(title)), immutable_unaccent(lower(${q}))),
         similarity(immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))), immutable_unaccent(lower(${q})))
       ) >= ${SEARCH_SORT_TEXT_FLOOR})`;
}

/** Mirrors `compareSearchHits` in `@trackt/shared`, which merges federated pages. */
function orderSql(sort: SearchSort) {
  if (sort === 'newest') return sql`year DESC NULLS LAST, rank DESC, title ASC, id ASC`;
  if (sort === 'az') return sql`immutable_unaccent(lower(title)) ASC, rank DESC, id ASC`;
  return sql`rank DESC, title ASC, id ASC`;
}

/**
 * Live federated-search surface (ADR-0002): instances query this in parallel
 * with their own local `media` table on every search and merge results by
 * canonical id — replaces the old bulk `/v1/catalog/changes` mirror. Same
 * ranking as `apps/api/src/lib/search.ts` (ADR-0010: string-match tier, then
 * text relevance, format class and provider score from the shared weights)
 * against `catalog_media` instead of `media` — no moderation/visibility concept
 * here, and tombstoned rows are excluded outright rather than surfaced as
 * deletions to apply.
 */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog/search',
    {
      schema: {
        tags: ['catalog'],
        querystring: CatalogSearchQuerySchema,
        response: { 200: CatalogSearchResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { q, kind, sort, limit, ...filters } = request.query;
      const rows = await db.execute(sql`
        SELECT scored.*,
               scored.tier
               + ${SEARCH_RANK_WEIGHTS.text} * scored.text_score
               + ${SEARCH_RANK_WEIGHTS.formatClass}
                 * (CASE WHEN scored.tier >= 4 THEN scored.format_class ELSE 0 END)
               + ${SEARCH_RANK_WEIGHTS.popularity} * scored.popularity AS rank
        FROM (
          SELECT id, kind, title, synonyms, year, status, genres,
                 part_count, season_number,
                 external_ids, metadata, description, cover_url, banner_url,
                 (CASE
                    WHEN immutable_unaccent(lower(title)) = immutable_unaccent(lower(${q})) THEN 5
                    WHEN immutable_unaccent(lower(title)) LIKE immutable_unaccent(lower(${q})) || '%' THEN 4
                    WHEN immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%' THEN 3
                    WHEN immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%' THEN 2
                    ELSE 1
                  END) AS tier,
                 GREATEST(
                   similarity(immutable_unaccent(lower(title)), immutable_unaccent(lower(${q}))),
                   similarity(immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))), immutable_unaccent(lower(${q})))
                 ) AS text_score,
                 (CASE WHEN ${derivativeFormatSql} THEN 0 ELSE 1 END)::double precision AS format_class,
                 (CASE
                    WHEN metadata->>'providerScore' ~ '^[0-9]+([.][0-9]+)?$'
                      THEN LEAST(100, GREATEST(0, (metadata->>'providerScore')::double precision)) / 100
                    ELSE ${UNKNOWN_POPULARITY}
                  END) AS popularity
          FROM catalog_media
          WHERE ${matchSql(q, filters)}
            AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null}::text)
            ${sortFloorSql(q, sort)}
        ) scored
        ORDER BY ${orderSql(sort)}
        LIMIT ${limit}
      `);

      const results: CatalogSearchHit[] = [...rows].map((row) => ({
        id: row.id as string,
        kind: row.kind as CatalogSearchHit['kind'],
        title: row.title as string,
        synonyms: row.synonyms as string[],
        year: row.year as number | null,
        status: row.status as CatalogSearchHit['status'],
        genres: row.genres as string[],
        partCount: row.part_count as number | null,
        seasonNumber: row.season_number as number | null,
        externalIds: row.external_ids as ExternalIds,
        metadata: (row.metadata as Record<string, unknown> | null) ?? {},
        description: row.description as string | null,
        coverUrl: row.cover_url as string | null,
        bannerUrl: (row.banner_url as string | null) ?? null,
        rank: row.rank as number,
      }));
      return { results };
    },
  );

  /**
   * Discover's shelf before anything is typed, and the landing page's cover
   * band: the works most people follow, so a fresh instance opens on the
   * catalog rather than on the handful of rows it happens to have materialized.
   * The audience is `providerPopularity` (AniList list users) or `ratingCount`
   * (IGDB, TMDB); the two scales never meet because kinds are round-robined,
   * each ranked on its own. Covers first, derived formats (specials, music
   * videos) after the main works, one row per title so a series shows once.
   */
  app.get(
    '/catalog/showcase',
    {
      schema: {
        tags: ['catalog'],
        querystring: CatalogShowcaseQuerySchema,
        response: { 200: CatalogShowcaseResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const { kind, offset, limit, ...filters } = request.query;
      const rows = await db.execute(sql`
        WITH visible AS (
          SELECT id, kind, title, synonyms, year, status, genres,
                 part_count, season_number,
                 external_ids, metadata, description, cover_url, banner_url,
                 (CASE WHEN ${derivativeFormatSql} THEN 0 ELSE 1 END) AS format_class,
                 COALESCE(
                   CASE WHEN metadata->>'providerPopularity' ~ '^[0-9]+$'
                     THEN (metadata->>'providerPopularity')::bigint END,
                   CASE WHEN metadata->>'ratingCount' ~ '^[0-9]+$'
                     THEN (metadata->>'ratingCount')::bigint END,
                   0
                 ) AS audience
          FROM catalog_media
          WHERE deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM unnest(genres) AS genre
              WHERE lower(genre) IN ('ecchi', 'hentai')
            )
            AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null}::text)
            ${filterSql(filters)}
        ),
        one_per_title AS (
          SELECT *, row_number() OVER (
                   PARTITION BY kind, title
                   ORDER BY (cover_url IS NOT NULL) DESC, season_number ASC NULLS FIRST, id
                 ) AS title_rank
          FROM visible
        ),
        ranked AS (
          SELECT *, row_number() OVER (
                   PARTITION BY kind
                   ORDER BY (cover_url IS NOT NULL) DESC, format_class DESC, audience DESC, id
                 ) AS kind_rank
          FROM one_per_title
          WHERE title_rank = 1
        )
        SELECT * FROM ranked
        ORDER BY kind_rank, kind
        LIMIT ${limit}
        OFFSET ${offset}
      `);
      reply.header('cache-control', 'public, max-age=300');
      return {
        results: [...rows].map((row) => ({
          id: row.id as string,
          kind: row.kind as CatalogSearchHit['kind'],
          title: row.title as string,
          synonyms: row.synonyms as string[],
          year: row.year as number | null,
          status: row.status as CatalogSearchHit['status'],
          genres: row.genres as string[],
          partCount: row.part_count as number | null,
          seasonNumber: row.season_number as number | null,
          externalIds: row.external_ids as ExternalIds,
          metadata: (row.metadata as Record<string, unknown> | null) ?? {},
          description: row.description as string | null,
          coverUrl: row.cover_url as string | null,
          bannerUrl: (row.banner_url as string | null) ?? null,
        })),
      };
    },
  );

  // Counts for the kind strip, over every kind at once: the same match and
  // floor as the ranked search, so ALL equals the full result set.
  app.get(
    '/catalog/search/kinds',
    {
      schema: {
        tags: ['catalog'],
        querystring: CatalogSearchKindsQuerySchema,
        response: { 200: CatalogSearchKindsResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const { q, sort, ...filters } = request.query;
      const rows = await db.execute(sql`
        SELECT kind, count(*)::int AS count
        FROM catalog_media
        WHERE ${matchSql(q, filters)}
          ${sortFloorSql(q, sort)}
        GROUP BY kind
      `);
      const kinds: Record<string, number> = {};
      for (const row of rows) kinds[row.kind as string] = row.count as number;
      return { kinds };
    },
  );

  // The vocabulary for Discover's genre filter: a few dozen tags, so one
  // aggregate over the table is cheap and an hour of caching hides even that.
  app.get(
    '/catalog/genres',
    {
      schema: {
        tags: ['catalog'],
        querystring: CatalogGenresQuerySchema,
        response: { 200: CatalogGenresResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const { kind, q } = request.query;
      const rows = await db.execute(sql`
        SELECT genre, count(*)::int AS count
        FROM catalog_media, unnest(genres) AS genre
        WHERE deleted_at IS NULL
          ${kind ? sql`AND kind = ${kind}` : sql``}
          ${q ? sql`AND strpos(genre, ${q}) > 0` : sql``}
        GROUP BY genre
        ORDER BY ${q ? sql`(left(genre, ${q.length}) = ${q}) DESC,` : sql``} count DESC, genre ASC
        ${q ? sql`LIMIT ${GENRE_SUGGESTION_LIMIT}` : sql``}
      `);
      reply.header('cache-control', 'public, max-age=3600');
      return {
        genres: [...rows].map((row) => ({
          genre: row.genre as string,
          count: row.count as number,
        })),
      };
    },
  );
};
