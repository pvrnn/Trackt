import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { users } from '@trackt/db';
import {
  ApiErrorSchema,
  AvatarResponseSchema,
  ProfileSummarySchema,
  UpdateProfileBodySchema,
} from '@trackt/shared';
import { countFriends, countIncomingRequests } from '../../lib/friends.js';
import { loadActivity, loadFavorites, loadProfileStats } from '../../lib/me.js';
import { getSessionUser } from '../../lib/session.js';
import { removeStoredUpload, storeUploadedImage } from '../../lib/uploads.js';

/**
 * Own-profile summary and edits (PRD §3.4): identity, tracking stats, ranked
 * favourites, recent activity, plus name/bio updates and avatar upload.
 * Badges wait for the v1.x social layer; the public counterpart lives at
 * `GET /v1/users/:username/profile` (`routes/v1/users.ts`, ADR-0006 phase 3).
 */

const ACTIVITY_LIMIT = 10;

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/profile',
    {
      schema: {
        tags: ['tracking'],
        response: {
          200: ProfileSummarySchema,
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

      const [account] = await db
        .select({
          name: users.name,
          username: users.displayUsername,
          bio: users.bio,
          image: users.image,
          socialLinks: users.socialLinks,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, user.id));

      const [favorites, stats, activity, friendCount, incomingRequestCount] = await Promise.all([
        loadFavorites(db, user.id),
        loadProfileStats(db, user.id),
        loadActivity(db, user.id, ACTIVITY_LIMIT, user),
        countFriends(db, user.id),
        countIncomingRequests(db, user.id),
      ]);

      return {
        user: {
          name: account?.name ?? user.name,
          username: account?.username ?? user.name,
          bio: account?.bio ?? null,
          image: account?.image ?? null,
          socialLinks: account?.socialLinks ?? {},
          joinedAt: (account?.createdAt ?? new Date()).toISOString(),
        },
        stats: { ...stats, friendCount, incomingRequestCount },
        favorites,
        activity,
      };
    },
  );

  app.patch(
    '/me/profile',
    {
      schema: {
        tags: ['tracking'],
        body: UpdateProfileBodySchema,
        response: {
          200: UpdateProfileBodySchema,
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

      const { name, bio, socialLinks } = request.body;
      if (name === undefined && bio === undefined && socialLinks === undefined) {
        return reply.status(400).send({ error: 'nothing to update' });
      }
      await db
        .update(users)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(bio !== undefined ? { bio } : {}),
          ...(socialLinks !== undefined ? { socialLinks } : {}),
        })
        .where(eq(users.id, user.id));
      return { name, bio, socialLinks };
    },
  );

  app.post(
    '/me/avatar',
    {
      schema: {
        tags: ['tracking'],
        // Multipart body — validated by hand below, not by the zod serializer.
        response: {
          200: AvatarResponseSchema,
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

      const stored = await storeUploadedImage(
        request,
        app.deps.env.UPLOADS_DIR,
        'avatars',
        user.id,
      );
      if (stored.error !== undefined) return reply.status(400).send({ error: stored.error });
      const image = stored.publicPath;

      const [previous] = await db
        .select({ image: users.image })
        .from(users)
        .where(eq(users.id, user.id));
      await db.update(users).set({ image }).where(eq(users.id, user.id));
      await removeStoredUpload(app.deps.env.UPLOADS_DIR, 'avatars', previous?.image ?? null);
      return { image };
    },
  );

  app.delete(
    '/me/avatar',
    {
      schema: {
        tags: ['tracking'],
        response: {
          200: AvatarResponseSchema,
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

      const [previous] = await db
        .select({ image: users.image })
        .from(users)
        .where(eq(users.id, user.id));
      await db.update(users).set({ image: null }).where(eq(users.id, user.id));
      await removeStoredUpload(app.deps.env.UPLOADS_DIR, 'avatars', previous?.image ?? null);
      return { image: null };
    },
  );
};
