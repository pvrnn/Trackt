import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  NewsArticleDetailSchema,
  NewsByMediaQuerySchema,
  NewsListQuerySchema,
  NewsListResponseSchema,
} from '@trackt/shared';
import { loadNewsArticle, loadNewsForMedia, loadNewsList } from '../../lib/news.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * The instance's news surface (ADR-0005): a thin read-through to the central
 * catalog, which is the only place articles live.
 *
 * Anonymous, like `/search` — news is public, and requiring a session would make
 * the landing-page link a dead end. The session is still resolved on the detail
 * route, because the works an article links to are visibility-filtered per
 * viewer.
 */
export const newsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/news',
    {
      // Anonymous and fanning out to a third-party service — same bucket as
      // /search, which has the same shape of cost.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['news'],
        querystring: NewsListQuerySchema,
        // No 503: a catalog failure degrades to an empty feed, never an error.
        response: { 200: NewsListResponseSchema },
      },
    },
    async (request) =>
      loadNewsList(app.deps.env.CATALOG_URL, request.query, {
        timeoutMs: app.deps.env.CATALOG_NEWS_TIMEOUT_MS,
        logger: app.log,
      }),
  );

  // Registered before '/news/:slug' to read in contract order; find-my-way ranks
  // the static segment above the parametric one either way, so 'by-media' is
  // never mistaken for a slug.
  app.get(
    '/news/by-media',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['news'],
        querystring: NewsByMediaQuerySchema,
        // No 503, for the same reason as the feed: a work's page loses its news
        // strip when the catalog is down, it does not fail to render.
        response: { 200: NewsListResponseSchema },
      },
    },
    async (request) =>
      loadNewsForMedia(app.deps.env.CATALOG_URL, request.query, {
        timeoutMs: app.deps.env.CATALOG_NEWS_TIMEOUT_MS,
        logger: app.log,
      }),
  );

  app.get(
    '/news/:slug',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['news'],
        params: z.object({ slug: z.string().min(1).max(300) }),
        response: {
          200: NewsArticleDetailSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const viewer = await getSessionUser(app, request);

      const result = await loadNewsArticle(
        db,
        app.deps.env.CATALOG_URL,
        request.params.slug,
        viewer,
        { timeoutMs: app.deps.env.CATALOG_NEWS_TIMEOUT_MS, logger: app.log },
      );

      // Unlike the feed, a single article has no meaningful degraded form —
      // there is no "empty article". 503 says "try again", 404 says "never
      // existed", and the page renders a different thing for each.
      if (result.status === 'unavailable') {
        return reply.status(503).send({ error: 'news is temporarily unavailable' });
      }
      if (result.status === 'not-found') {
        return reply.status(404).send({ error: 'article not found' });
      }
      return result.article;
    },
  );
};
