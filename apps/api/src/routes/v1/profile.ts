import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { favorite, media, users } from '@trackt/db';
import {
  ApiErrorSchema,
  AVATAR_MIME_TYPES,
  AvatarResponseSchema,
  MEDIA_KINDS,
  ProfileSummarySchema,
  UpdateProfileBodySchema,
} from '@trackt/shared';
import { loadActivity, loadStreak, loadYearCheckinCounts } from '../../lib/me.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * Own-profile summary and edits (PRD §3.4): identity, tracking stats, ranked
 * favourites, recent activity, plus name/bio updates and avatar upload.
 * Public profiles + visibility land with the v1.x social layer.
 */

const ACTIVITY_LIMIT = 10;

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Best-effort removal of a previously uploaded avatar file. */
async function removeStoredAvatar(uploadsRoot: string, image: string | null): Promise<void> {
  if (!image?.startsWith('/uploads/avatars/')) return; // never touch external URLs
  await unlink(join(uploadsRoot, image.replace('/uploads/', ''))).catch(() => undefined);
}

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

      const [favoriteRows, yearCounts, dayStreak, activity, trackingStats] = await Promise.all([
        db
          .select({
            id: media.id,
            slug: media.slug,
            kind: favorite.kind,
            title: media.title,
            coverUrl: media.coverUrl,
            position: favorite.position,
          })
          .from(favorite)
          .innerJoin(media, eq(media.id, favorite.mediaId))
          .where(eq(favorite.userId, user.id))
          .orderBy(asc(favorite.kind), asc(favorite.position)),
        loadYearCheckinCounts(db, user.id),
        loadStreak(db, user.id),
        loadActivity(db, user.id, ACTIVITY_LIMIT),
        db.execute(sql`
          SELECT
            (SELECT count(*)::int FROM user_media
              WHERE user_id = ${user.id} AND status = 'completed') AS completed,
            (SELECT count(*)::int FROM user_media WHERE user_id = ${user.id}) AS titles,
            (SELECT avg(score)::float FROM rating
              WHERE user_id = ${user.id} AND target_type = 'media' AND score IS NOT NULL) AS mean_rating
        `),
      ]);

      // Rank restarts at 1 within each kind block (favourites are per-kind shelves).
      const rankByKind = new Map<string, number>();
      const favorites = [...favoriteRows]
        .sort(
          (a, b) =>
            MEDIA_KINDS.indexOf(a.kind) - MEDIA_KINDS.indexOf(b.kind) || a.position - b.position,
        )
        .map((row) => {
          const rank = (rankByKind.get(row.kind) ?? 0) + 1;
          rankByKind.set(row.kind, rank);
          return {
            id: row.id,
            slug: row.slug,
            kind: row.kind,
            title: row.title,
            coverUrl: row.coverUrl,
            rank,
          };
        });

      const [stats] = [...trackingStats];
      return {
        user: {
          name: account?.name ?? user.name,
          username: account?.username ?? user.name,
          bio: account?.bio ?? null,
          image: account?.image ?? null,
          socialLinks: account?.socialLinks ?? {},
          joinedAt: (account?.createdAt ?? new Date()).toISOString(),
        },
        stats: {
          episodesThisYear: yearCounts.episodes,
          chaptersThisYear: yearCounts.chapters,
          completed: Number(stats?.completed ?? 0),
          titlesTracked: Number(stats?.titles ?? 0),
          meanRating: stats?.mean_rating !== null ? Number(stats?.mean_rating) : null,
          dayStreak,
        },
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

      const file = await request.file();
      if (!file) return reply.status(400).send({ error: 'expected a file field' });
      const extension = EXTENSION_BY_MIME[file.mimetype];
      if (!extension) {
        return reply
          .status(400)
          .send({ error: `unsupported image type — use ${AVATAR_MIME_TYPES.join(', ')}` });
      }

      const uploadsRoot = resolve(app.deps.env.UPLOADS_DIR);
      await mkdir(join(uploadsRoot, 'avatars'), { recursive: true });
      const filename = `${user.id}-${randomUUID().slice(0, 8)}.${extension}`;
      const image = `/uploads/avatars/${filename}`;
      try {
        await pipeline(file.file, createWriteStream(join(uploadsRoot, 'avatars', filename)));
      } catch (error) {
        await unlink(join(uploadsRoot, 'avatars', filename)).catch(() => undefined);
        // @fastify/multipart aborts the stream when the size limit is hit.
        if (file.file.truncated || (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
          return reply.status(400).send({ error: 'image too large — 2MB max' });
        }
        throw error;
      }
      if (file.file.truncated) {
        await unlink(join(uploadsRoot, 'avatars', filename)).catch(() => undefined);
        return reply.status(400).send({ error: 'image too large — 2MB max' });
      }

      const [previous] = await db
        .select({ image: users.image })
        .from(users)
        .where(eq(users.id, user.id));
      await db.update(users).set({ image }).where(eq(users.id, user.id));
      await removeStoredAvatar(uploadsRoot, previous?.image ?? null);
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
      await removeStoredAvatar(resolve(app.deps.env.UPLOADS_DIR), previous?.image ?? null);
      return { image: null };
    },
  );
};
