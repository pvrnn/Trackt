import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogRelationsQuerySchema,
  CatalogRelationsResponseSchema,
  type CatalogRelationEdge,
  type ExternalIds,
} from '@trackt/shared';

/**
 * Typed relations touching one work (ADR-0004). Edges are stored in a single
 * direction, so both halves of the lookup are served here: `from_id = id` yields
 * `forward` edges, `to_id = id` yields `reverse` ones. The stored `type` is
 * returned unflipped — turning `{sequel, reverse}` into "prequel" is display
 * vocabulary and belongs to the consumer, not this service.
 *
 * The no-self CHECK on the table makes the two branches disjoint, hence
 * UNION ALL rather than UNION. Tombstoned endpoints drop out via the join, the
 * same way `catalog_media`'s tombstones are excluded from search. Ordering here
 * is advisory — instances re-sort by their own display rules.
 */
export const relationsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog/relations',
    {
      schema: {
        tags: ['catalog'],
        querystring: CatalogRelationsQuerySchema,
        response: { 200: CatalogRelationsResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { id, limit } = request.query;
      const rows = await db.execute(sql`
        SELECT t.id, t.kind, t.title, t.synonyms, t.year, t.status, t.genres,
               t.part_count, t.season_number, t.discriminator,
               t.external_ids, t.description, t.cover_url,
               r.type, r.direction
        FROM (
          SELECT to_id AS target_id, type, 'forward' AS direction
            FROM catalog_media_relation WHERE from_id = ${id}
          UNION ALL
          SELECT from_id AS target_id, type, 'reverse' AS direction
            FROM catalog_media_relation WHERE to_id = ${id}
        ) r
        JOIN catalog_media t ON t.id = r.target_id AND t.deleted_at IS NULL
        ORDER BY r.type ASC, t.season_number ASC NULLS LAST, t.year ASC NULLS LAST, t.title ASC
        LIMIT ${limit}
      `);

      const relations: CatalogRelationEdge[] = [...rows].map((row) => ({
        id: row.id as string,
        kind: row.kind as CatalogRelationEdge['kind'],
        title: row.title as string,
        synonyms: row.synonyms as string[],
        year: row.year as number | null,
        status: row.status as CatalogRelationEdge['status'],
        genres: row.genres as string[],
        partCount: row.part_count as number | null,
        seasonNumber: row.season_number as number | null,
        discriminator: row.discriminator as string | null,
        externalIds: row.external_ids as ExternalIds,
        description: row.description as string | null,
        coverUrl: row.cover_url as string | null,
        type: row.type as CatalogRelationEdge['type'],
        direction: row.direction as CatalogRelationEdge['direction'],
      }));
      return { relations };
    },
  );
};
