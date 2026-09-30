import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogMediaParamsSchema,
  CatalogPartsResponseSchema,
  SlimMediaSchema,
  type ExternalIds,
} from '@trackt/shared';
import { catalogMedia, catalogMediaPart } from '../../db/index.js';

/**
 * One work by canonical id, and its per-part facts (ADR-0009). Instances
 * materialize a work once and never refresh it (ADR-0002), so these are how
 * they fill in what a snapshot taken before the catalog knew it lacks.
 */
export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
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
        .where(and(eq(catalogMedia.id, request.params.id), isNull(catalogMedia.deletedAt)));
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
        externalIds: row.externalIds as ExternalIds,
        description: row.description,
        coverUrl: row.coverUrl,
        runtimeMinutes: row.runtimeMinutes,
      };
    },
  );

  app.get(
    '/catalog/media/:id/parts',
    {
      schema: {
        tags: ['catalog'],
        params: CatalogMediaParamsSchema,
        response: { 200: CatalogPartsResponseSchema, 404: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { id } = request.params;
      const [work] = await db
        .select({ id: catalogMedia.id })
        .from(catalogMedia)
        .where(and(eq(catalogMedia.id, id), isNull(catalogMedia.deletedAt)));
      if (!work) return reply.status(404).send({ error: 'media not found' });

      const parts = await db
        .select({
          number: catalogMediaPart.number,
          title: catalogMediaPart.title,
          runtimeMinutes: catalogMediaPart.runtimeMinutes,
          airDate: catalogMediaPart.airDate,
        })
        .from(catalogMediaPart)
        .where(eq(catalogMediaPart.mediaId, id))
        .orderBy(asc(catalogMediaPart.number));
      return { mediaId: id, parts };
    },
  );
};
