import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { media, userMedia } from '@trackt/db';
import {
  ApiErrorSchema,
  HomeSummarySchema,
  PART_KIND_BY_MEDIA,
  type HomeSummary,
  type MediaKind,
} from '@trackt/shared';
import { loadActivity, loadStreak, loadYearCheckinCounts } from '../../lib/me.js';
import { getSessionUser } from '../../lib/session.js';

/**
 * Home dashboard summary: up-next targets, in-progress shelf, the viewer's own
 * recent activity, and this-year stats — all derived from tracking rows
 * (PRD §3.1). The Friends feed arrives with the v1.x follow system.
 */

const IN_PROGRESS_LIMIT = 12;
const UP_NEXT_LIMIT = 3;
const ACTIVITY_LIMIT = 6;

function partTotal(row: { kind: MediaKind; partCount: number | null }) {
  // Movies have no parts to progress through; everything else counts in partCount.
  return PART_KIND_BY_MEDIA[row.kind] ? row.partCount : null;
}

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/home',
    {
      schema: {
        tags: ['tracking'],
        response: {
          200: HomeSummarySchema,
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

      const inProgressRows = await db
        .select({
          id: media.id,
          slug: media.slug,
          kind: media.kind,
          title: media.title,
          coverUrl: media.coverUrl,
          partCount: media.partCount,
        })
        .from(userMedia)
        .innerJoin(media, eq(media.id, userMedia.mediaId))
        .where(
          and(
            eq(userMedia.userId, user.id),
            eq(userMedia.status, 'in_progress'),
            // Soft-deleted titles vanish from the shelves; the log row stays.
            isNull(media.deletedAt),
          ),
        )
        .orderBy(desc(userMedia.updatedAt))
        .limit(IN_PROGRESS_LIMIT);

      const watchedByMedia = new Map<string, Set<number>>();
      if (inProgressRows.length > 0) {
        const ids = inProgressRows.map((row) => row.id);
        const watchedRows = await db.execute(sql`
          SELECT mp.media_id, mp.number FROM progress p
          JOIN media_part mp ON mp.id = p.part_id
          WHERE p.user_id = ${user.id} AND mp.media_id IN ${ids}
        `);
        for (const row of watchedRows) {
          const mediaId = row.media_id as string;
          const set = watchedByMedia.get(mediaId) ?? new Set<number>();
          set.add(Number(row.number));
          watchedByMedia.set(mediaId, set);
        }
      }

      const inProgress: HomeSummary['inProgress'] = inProgressRows.map((row) => ({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        title: row.title,
        coverUrl: row.coverUrl,
        watched: watchedByMedia.get(row.id)?.size ?? 0,
        total: partTotal(row),
      }));

      const upNext: HomeSummary['upNext'] = [];
      for (const row of inProgressRows) {
        if (upNext.length >= UP_NEXT_LIMIT) break;
        const partKind = PART_KIND_BY_MEDIA[row.kind];
        if (!partKind) continue;
        const total = partTotal(row);
        const watched = watchedByMedia.get(row.id) ?? new Set<number>();
        let next = 1;
        while (watched.has(next)) next += 1;
        if (total !== null && next > total) continue; // everything known is watched
        upNext.push({
          id: row.id,
          slug: row.slug,
          kind: row.kind,
          title: row.title,
          coverUrl: row.coverUrl,
          next,
          total,
          partKind,
        });
      }

      const [yearCounts, completedStats, dayStreak, activity] = await Promise.all([
        loadYearCheckinCounts(db, user.id),
        db.execute(sql`
          SELECT count(*)::int AS count FROM user_media
          WHERE user_id = ${user.id} AND status = 'completed'
            AND updated_at >= date_trunc('year', now())
        `),
        loadStreak(db, user.id),
        loadActivity(db, user.id, ACTIVITY_LIMIT),
      ]);

      return {
        upNext,
        inProgress,
        activity,
        stats: {
          episodesThisYear: yearCounts.episodes,
          chaptersThisYear: yearCounts.chapters,
          dayStreak,
          completedThisYear: Number([...completedStats][0]?.count ?? 0),
        },
      };
    },
  );
};
