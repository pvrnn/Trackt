import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  HistoryPageSchema,
  HistoryQuerySchema,
  decodeHistoryCursor,
} from '@trackt/shared';
import { loadHistory } from '../../lib/history.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * `GET /v1/me/history` (ADR-0007) — the viewer's own year view. The query and
 * its filing rule live in `lib/history.ts`, shared with the public route that
 * serves someone else's (`GET /v1/users/:username/history`).
 */
export const historyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/history',
    {
      schema: {
        tags: ['tracking'],
        querystring: HistoryQuerySchema,
        response: {
          200: HistoryPageSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const cursor = request.query.cursor ? decodeHistoryCursor(request.query.cursor) : null;
      if (request.query.cursor && !cursor)
        return reply.status(400).send({ error: 'invalid cursor' });

      return loadHistory(db, user.id, request.query, cursor);
    },
  );
};
