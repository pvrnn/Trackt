import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  LeaderboardQuerySchema,
  LeaderboardSchema,
  TrophyCabinetSchema,
} from '@trackt/shared';
import { loadCabinet, loadLeaderboard } from '../../lib/trophies.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * The viewer's trophy cabinet and the two leaderboards. Both evaluate the
 * viewer (and, for the friends board, their friends) before reading, so what
 * they show is never older than the request; the worker's sweep keeps
 * everyone else's rows current for the global board.
 */
export const trophyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/trophies',
    {
      schema: {
        tags: ['tracking'],
        response: { 200: TrophyCabinetSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      return loadCabinet(db, user.id);
    },
  );

  app.get(
    '/me/trophies/leaderboard',
    {
      schema: {
        tags: ['tracking'],
        querystring: LeaderboardQuerySchema,
        response: { 200: LeaderboardSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      return loadLeaderboard(db, user.id, request.query.scope, request.query.period);
    },
  );
};
