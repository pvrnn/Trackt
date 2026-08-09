import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ApiErrorSchema, UserSearchQuerySchema, UserSearchResultSchema } from '@trackt/shared';
import { searchUsers } from '../../lib/friends.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * User discovery for friend requests. Separate from `/v1/search` (catalog
 * search, ADR-0002) — this is trgm over `user`, no catalog round-trip.
 * Session-required: unlike a public profile (v1.x), enumerating handles
 * anonymously isn't a surface we want to open yet.
 */
export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/users/search',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['friends'],
        querystring: UserSearchQuerySchema,
        response: {
          200: z.array(UserSearchResultSchema),
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
      return searchUsers(db, request.query.q, request.query.limit, user.id);
    },
  );
};
