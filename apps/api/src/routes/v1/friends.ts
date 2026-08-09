import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users, type Db } from '@trackt/db';
import {
  ApiErrorSchema,
  FRIEND_REQUEST_PENDING_MAX,
  FriendSchema,
  FriendshipStateSchema,
  FriendsOverviewSchema,
  SendFriendRequestBodySchema,
  type UserSummary,
} from '@trackt/shared';
import {
  acceptFriendRequest,
  countPendingOutgoing,
  friendStateFor,
  loadFriendsOverview,
  removeFriendship,
  sendFriendRequest,
} from '../../lib/friends.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * Mutual friendship: request → accept, symmetric thereafter (ADR-0006).
 * `DELETE /me/friends/:userId` is the one endpoint for all three tear-down
 * verbs — cancel, decline, unfriend — since which one applies falls out of
 * the row it deletes rather than anything the caller needs to know.
 */

async function loadUserSummary(db: Db, userId: string): Promise<UserSummary | undefined> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.displayUsername,
      name: users.name,
      image: users.image,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || row.username === null) return undefined;
  return { id: row.id, username: row.username, name: row.name, image: row.image };
}

export const friendRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/friends',
    {
      schema: {
        tags: ['friends'],
        response: { 200: FriendsOverviewSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      return loadFriendsOverview(db, user.id);
    },
  );

  app.post(
    '/me/friends/requests',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        tags: ['friends'],
        body: SendFriendRequestBodySchema,
        response: {
          200: FriendshipStateSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          429: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const [target] = await db
        .select({
          id: users.id,
          username: users.displayUsername,
          name: users.name,
          image: users.image,
        })
        .from(users)
        .where(eq(users.username, request.body.username.toLowerCase()))
        .limit(1);
      if (!target || target.username === null) {
        return reply.status(404).send({ error: 'user not found' });
      }
      if (target.id === user.id) {
        return reply.status(400).send({ error: 'cannot friend yourself' });
      }

      const pending = await countPendingOutgoing(db, user.id);
      if (pending >= FRIEND_REQUEST_PENDING_MAX) {
        return reply.status(429).send({ error: 'too many pending friend requests' });
      }

      const row = await sendFriendRequest(db, user.id, target.id);
      return {
        user: { id: target.id, username: target.username, name: target.name, image: target.image },
        friendState: friendStateFor(row, user.id),
      };
    },
  );

  app.post(
    '/me/friends/requests/:userId/accept',
    {
      schema: {
        tags: ['friends'],
        params: z.object({ userId: z.uuid() }),
        response: {
          200: FriendSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const accepted = await acceptFriendRequest(db, user.id, request.params.userId);
      if (!accepted) return reply.status(404).send({ error: 'friend request not found' });

      const summary = await loadUserSummary(db, request.params.userId);
      if (!summary) return reply.status(404).send({ error: 'friend request not found' });
      return { ...summary, since: new Date(accepted.respondedAt).toISOString() };
    },
  );

  app.delete(
    '/me/friends/:userId',
    {
      schema: {
        tags: ['friends'],
        params: z.object({ userId: z.uuid() }),
        response: { 204: z.null(), 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      await removeFriendship(db, user.id, request.params.userId);
      return reply.status(204).send(null);
    },
  );
};
