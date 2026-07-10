import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ApiErrorSchema, SearchQuerySchema, SearchResultSchema } from '@trackt/shared';
import { searchMedia } from '../../lib/search.js';

/**
 * Catalog search against the instance's local `media` table (ADR-0001) — every
 * instance serves the same catalog once synced, so search needs no upstream calls.
 */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      schema: {
        tags: ['catalog'],
        querystring: SearchQuerySchema,
        response: {
          200: z.array(SearchResultSchema),
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      return searchMedia(db, request.query);
    },
  );
};
