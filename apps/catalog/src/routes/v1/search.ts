import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogSearchQuerySchema,
  CatalogSearchResponseSchema,
  type CatalogSearchHit,
  type ExternalIds,
} from '@trackt/shared';

/**
 * Live federated-search surface (ADR-0002): instances query this in parallel
 * with their own local `media` table on every search and merge results by
 * canonical id — replaces the old bulk `/v1/catalog/changes` mirror. Same
 * pg_trgm pattern as apps/api/src/lib/search.ts, against `catalog_media`
 * instead of `media` — no moderation/visibility concept here, and tombstoned
 * rows are excluded outright rather than surfaced as deletions to apply.
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
        SELECT id, kind, title, synonyms, year, status, genres,
               episode_count, season_count, chapter_count, volume_count,
               external_ids, description, cover_url,
               GREATEST(similarity(title, ${q}),
                        similarity(immutable_array_to_string(synonyms, ' '), ${q})) AS rank
        FROM catalog_media
        WHERE deleted_at IS NULL
          AND (title % ${q}
               OR title ILIKE '%' || ${q} || '%'
               OR immutable_array_to_string(synonyms, ' ') ILIKE '%' || ${q} || '%')
          AND (${kind ?? null}::text IS NULL OR kind = ${kind ?? null}::text)
        ORDER BY rank DESC, title ASC
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
        episodeCount: row.episode_count as number | null,
        seasonCount: row.season_count as number | null,
        chapterCount: row.chapter_count as number | null,
        volumeCount: row.volume_count as number | null,
        externalIds: row.external_ids as ExternalIds,
        description: row.description as string | null,
        coverUrl: row.cover_url as string | null,
        rank: row.rank as number,
      }));
      return { results };
    },
  );
};
