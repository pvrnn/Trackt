import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ApiErrorSchema, SearchQuerySchema, SearchResultSchema } from '@trackt/shared';
import { searchFederated } from '../../lib/federated-search.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * Federated catalog search (ADR-0002): merges the instance's local `media`
 * table with a live query against the central catalog. Central-only hits are
 * materialized locally on first sight; a slow/unreachable catalog degrades
 * to local-only results rather than failing the request.
 */
export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      // Anonymous and the most expensive read — tighter bucket than the global limit.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
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
      const viewer = await getSessionUser(app, request);
      return searchFederated(db, app.deps.env.CATALOG_URL, request.query, viewer, {
        timeoutMs: app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
        logger: app.log,
      });
    },
  );
};
