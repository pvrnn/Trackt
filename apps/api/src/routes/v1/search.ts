import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  SearchGenresQuerySchema,
  SearchGenresSchema,
  SearchKindCountsSchema,
  SearchKindsQuerySchema,
  SearchQuerySchema,
  SearchResultSchema,
} from '@trackt/shared';
import { countSearchKinds, listSearchGenres, searchFederated } from '../../lib/federated-search.js';
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
      const result = await searchFederated(db, app.deps.env.CATALOG_URL, request.query, viewer, {
        timeoutMs: app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
        logger: app.log,
      });
      reply.header('x-has-more', String(result.hasMore));
      return result.results;
    },
  );

  app.get(
    '/search/kinds',
    {
      // Fired beside every search, so it shares search's budget shape.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['catalog'],
        querystring: SearchKindsQuerySchema,
        response: { 200: SearchKindCountsSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      return countSearchKinds(db, app.deps.env.CATALOG_URL, request.query, {
        timeoutMs: app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
        logger: app.log,
      });
    },
  );

  app.get(
    '/search/genres',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['catalog'],
        querystring: SearchGenresQuerySchema,
        response: { 200: SearchGenresSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      reply.header('cache-control', 'public, max-age=3600');
      return listSearchGenres(db, app.deps.env.CATALOG_URL, request.query, {
        timeoutMs: app.deps.env.CATALOG_SEARCH_TIMEOUT_MS,
        logger: app.log,
      });
    },
  );
};
