import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { media, userMedia, type Db } from '@trackt/db';
import {
  ApiErrorSchema,
  HomeSummarySchema,
  type ActivityEntry,
  type HomeSummary,
  type MediaKind,
} from '@trackt/shared';
import { getSessionUser } from '../../lib/session.js';

/**
 * Home dashboard summary: up-next targets, in-progress shelf, the viewer's own
 * recent activity, and this-year stats — all derived from tracking rows
 * (PRD §3.1). The Friends feed arrives with the v1.x follow system.
 */

const IN_PROGRESS_LIMIT = 12;
const UP_NEXT_LIMIT = 3;
const ACTIVITY_LIMIT = 6;

const PART_KIND_BY_MEDIA: Partial<Record<MediaKind, 'episode' | 'chapter'>> = {
  series: 'episode',
  anime: 'episode',
  manga: 'chapter',
  webtoon: 'chapter',
};

function partTotal(row: {
  kind: MediaKind;
  episodeCount: number | null;
  chapterCount: number | null;
}) {
  const partKind = PART_KIND_BY_MEDIA[row.kind];
  if (!partKind) return null;
  return partKind === 'episode' ? row.episodeCount : row.chapterCount;
}

/** Consecutive days with a check-in, ending today or yesterday (grace day). */
function computeStreak(days: string[], today: Date): number {
  const dayMs = 24 * 60 * 60 * 1000;
  const toUtcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
  const todayUtc = Date.parse(`${today.toISOString().slice(0, 10)}T00:00:00Z`);
  let streak = 0;
  let expected = todayUtc;
  for (const day of days) {
    const value = toUtcDay(day);
    if (streak === 0 && value === todayUtc - dayMs) expected = value; // grace: streak alive from yesterday
    if (value !== expected) break;
    streak += 1;
    expected -= dayMs;
  }
  return streak;
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
          episodeCount: media.episodeCount,
          chapterCount: media.chapterCount,
        })
        .from(userMedia)
        .innerJoin(media, eq(media.id, userMedia.mediaId))
        .where(and(eq(userMedia.userId, user.id), eq(userMedia.status, 'in_progress')))
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

      const [checkinStats, completedStats, streakDays, recentCheckins, recentRatings, recentLogs] =
        await Promise.all([
          db.execute(sql`
            SELECT mp.kind, count(*)::int AS count FROM progress p
            JOIN media_part mp ON mp.id = p.part_id
            WHERE p.user_id = ${user.id} AND p.watched_at >= date_trunc('year', now())
            GROUP BY mp.kind
          `),
          db.execute(sql`
            SELECT count(*)::int AS count FROM user_media
            WHERE user_id = ${user.id} AND status = 'completed'
              AND updated_at >= date_trunc('year', now())
          `),
          db.execute(sql`
            SELECT DISTINCT (watched_at AT TIME ZONE 'UTC')::date::text AS day FROM progress
            WHERE user_id = ${user.id}
            ORDER BY day DESC
            LIMIT 60
          `),
          db.execute(sql`
            SELECT m.title, m.slug, mp.kind, mp.number, p.watched_at FROM progress p
            JOIN media_part mp ON mp.id = p.part_id
            JOIN media m ON m.id = mp.media_id
            WHERE p.user_id = ${user.id}
            ORDER BY p.watched_at DESC
            LIMIT ${ACTIVITY_LIMIT}
          `),
          db.execute(sql`
            SELECT m.title, m.slug, r.score, r.updated_at FROM rating r
            JOIN media m ON m.id = r.target_id
            WHERE r.user_id = ${user.id} AND r.target_type = 'media' AND r.score IS NOT NULL
            ORDER BY r.updated_at DESC
            LIMIT ${ACTIVITY_LIMIT}
          `),
          db.execute(sql`
            SELECT m.title, m.slug, um.status, um.updated_at FROM user_media um
            JOIN media m ON m.id = um.media_id
            WHERE um.user_id = ${user.id}
            ORDER BY um.updated_at DESC
            LIMIT ${ACTIVITY_LIMIT}
          `),
        ]);

      let episodesThisYear = 0;
      let chaptersThisYear = 0;
      for (const row of checkinStats) {
        if (row.kind === 'episode') episodesThisYear = row.count as number;
        if (row.kind === 'chapter') chaptersThisYear = row.count as number;
      }

      const activity: ActivityEntry[] = [
        ...[...recentCheckins].map((row) => ({
          verb: 'checked_in' as const,
          title: row.title as string,
          slug: row.slug as string,
          detail: `${row.kind === 'chapter' ? 'CH' : 'E'}${Number(row.number)}`,
          at: new Date(row.watched_at as string).toISOString(),
        })),
        ...[...recentRatings].map((row) => ({
          verb: 'rated' as const,
          title: row.title as string,
          slug: row.slug as string,
          detail: `★ ${Number(row.score).toFixed(1)}`,
          at: new Date(row.updated_at as string).toISOString(),
        })),
        ...[...recentLogs].map((row) => ({
          verb: 'status' as const,
          title: row.title as string,
          slug: row.slug as string,
          detail: (row.status as string).replace('_', ' '),
          at: new Date(row.updated_at as string).toISOString(),
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, ACTIVITY_LIMIT);

      return {
        upNext,
        inProgress,
        activity,
        stats: {
          episodesThisYear,
          chaptersThisYear,
          dayStreak: computeStreak(
            [...streakDays].map((row) => row.day as string),
            new Date(),
          ),
          completedThisYear: Number([...completedStats][0]?.count ?? 0),
        },
      };
    },
  );
};
