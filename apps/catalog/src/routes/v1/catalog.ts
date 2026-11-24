import { and, count, eq, isNull, max } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogMediaParamsSchema,
  CatalogVersionSchema,
  SlimMediaSchema,
} from '@trackt/shared';
import { catalogMedia } from '../../db/index.js';

/**
 * Stats/introspection endpoint — independent of the sync mechanism it used to
 * back. The bulk `/v1/catalog/changes` pull feed was removed in ADR-0002:
 * instances now query `GET /v1/catalog/search` live instead of mirroring the
 * whole catalog. `seq` (and its bump trigger) stay in the schema regardless —
 * still useful for future admin/audit tooling.
 */
export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog/version',
    {
      schema: {
        tags: ['catalog'],
        response: { 200: CatalogVersionSchema, 503: ApiErrorSchema },
      },
    },
    async (_request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const [row] = await db
        .select({ version: max(catalogMedia.seq), mediaCount: count() })
        .from(catalogMedia);
      return {
        version: row?.version ?? 0,
        mediaCount: row?.mediaCount ?? 0,
        generatedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    '/catalog/media/:id',
    {
      schema: {
        tags: ['catalog'],
        params: CatalogMediaParamsSchema,
        response: { 200: SlimMediaSchema, 404: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const [row] = await db
        .select()
        .from(catalogMedia)
        .where(and(eq(catalogMedia.id, request.params.id), isNull(catalogMedia.deletedAt)))
        .limit(1);
      if (!row) return reply.status(404).send({ error: 'media not found' });
      return {
        id: row.id,
        kind: row.kind,
        title: row.title,
        synonyms: row.synonyms,
        year: row.year,
        status: row.status,
        genres: row.genres,
        partCount: row.partCount,
        seasonNumber: row.seasonNumber,
        externalIds: row.externalIds,
        metadata: row.metadata ?? {},
        description: row.description,
        coverUrl: row.coverUrl,
        bannerUrl: row.bannerUrl ?? null,
      };
    },
  );
};
