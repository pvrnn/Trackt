import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '@trackt/db';
import {
  ApiErrorSchema,
  PublicProfileSchema,
  UserSearchQuerySchema,
  UserSearchResultSchema,
} from '@trackt/shared';
import { countFriends, friendStateFor, loadFriendshipRow, searchUsers } from '../../lib/friends.js';
import { loadActivity, loadFavorites, loadProfileStats } from '../../lib/me.js';
import { getSessionUser } from '../../lib/session.js';

const PUBLIC_ACTIVITY_LIMIT = 10;

/**
 * User discovery for friend requests. Separate from `/v1/search` (catalog
 * search, ADR-0002) — this is trgm over `user`, no catalog round-trip.
 * Session-required: unlike the public profile below, enumerating handles
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

  app.get(
    '/users/:username/profile',
    {
      schema: {
        tags: ['friends'],
        params: z.object({ username: z.string().min(1) }),
        response: {
          200: PublicProfileSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      // Optional session (ADR-0006 point 3): a public profile is
      // anonymous-readable, unlike /users/search above.
      const viewer = await getSessionUser(app, request);

      const [account] = await db
        .select({
          id: users.id,
          name: users.name,
          username: users.displayUsername,
          bio: users.bio,
          image: users.image,
          socialLinks: users.socialLinks,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.username, request.params.username.toLowerCase()));
      if (!account) return reply.status(404).send({ error: 'user not found' });

      const [favorites, stats, activity, friendCount, friendState] = await Promise.all([
        loadFavorites(db, account.id),
        loadProfileStats(db, account.id),
        loadActivity(db, account.id, PUBLIC_ACTIVITY_LIMIT),
        countFriends(db, account.id),
        viewer === null
          ? Promise.resolve('none' as const)
          : viewer.id === account.id
            ? Promise.resolve('self' as const)
            : loadFriendshipRow(db, viewer.id, account.id).then((row) =>
                friendStateFor(row, viewer.id),
              ),
      ]);

      return {
        userId: account.id,
        user: {
          name: account.name,
          username: account.username ?? account.name,
          bio: account.bio,
          image: account.image,
          socialLinks: account.socialLinks,
          joinedAt: account.createdAt.toISOString(),
        },
        stats,
        favorites,
        activity,
        friendState,
        friendCount,
      };
    },
  );
};
