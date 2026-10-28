import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogSearchQuerySchema,
  CatalogSearchResponseSchema,
  DERIVATIVE_FORMATS,
  SEARCH_RANK_WEIGHTS,
  UNKNOWN_POPULARITY,
  type CatalogSearchHit,
  type ExternalIds,
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

      const { q, kind, limit } = request.query;
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
          WHERE deleted_at IS NULL
            AND (immutable_unaccent(lower(title)) % immutable_unaccent(lower(${q}))
                 OR immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
                 OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%')
            AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null}::text)
        ) scored
        ORDER BY rank DESC, title ASC, id ASC
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
};
