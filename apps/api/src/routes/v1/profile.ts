import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { favorite, media, users } from '@trackt/db';
import { ApiErrorSchema, MEDIA_KINDS, ProfileSummarySchema } from '@trackt/shared';
import { loadActivity, loadStreak, loadYearCheckinCounts } from '../../lib/me.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * Own-profile summary (PRD §3.4): identity, tracking stats, ranked favourites,
 * recent activity. Public profiles + visibility land with the v1.x social layer.
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
};
