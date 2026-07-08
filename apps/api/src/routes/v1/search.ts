import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { SearchQuerySchema, SearchResultSchema } from '@trackt/shared';

/**
 * Catalog search across metadata providers (PRD §3.5).
 * v0.1 queries providers live; results are cached into `media` when a user tracks one.
 */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      schema: {
        tags: ['catalog'],
        querystring: SearchQuerySchema,
        response: { 200: z.array(SearchResultSchema) },
      },
    },
    async (request) => {
      const { q, kind } = request.query;
      if (!app.deps.registry) return [];
      return app.deps.registry.search(q, kind);
    },
  );
};
