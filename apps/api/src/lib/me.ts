import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { favorite, media, type Db } from '@trackt/db';
import {
  MEDIA_KINDS,
  type ActivityEntry,
  type FavoriteEntry,
  type MediaKind,
} from '@trackt/shared';
import type { SessionUser } from './session.js';
import { visibleMediaSql } from './visibility.js';

/** Subject-scoped tracking aggregates shared by the home and profile summaries. */

/** Consecutive days with a check-in, ending today or yesterday (grace day). */
export function computeStreak(days: string[], today: Date): number {
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

/** Ranked favourite shelves, one rank sequence per kind. Shared by own and public profiles. */
export async function loadFavorites(db: Db, userId: string): Promise<FavoriteEntry[]> {
  const rows = await db
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
    // Soft-deleted titles vanish from the shelves; the favourite row stays.
    .where(and(eq(favorite.userId, userId), isNull(media.deletedAt)))
    .orderBy(asc(favorite.kind), asc(favorite.position));

  // Rank restarts at 1 within each kind block (favourites are per-kind shelves).
  const rankByKind = new Map<string, number>();
  return [...rows]
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
}

interface ProfileStats {
  episodesThisYear: number;
  chaptersThisYear: number;
  completed: number;
  titlesTracked: number;
  meanRating: number | null;
  dayStreak: number;
}

/** The stats strip both profile summaries share: this-year activity, lifetime totals, streak. */
export async function loadProfileStats(db: Db, userId: string): Promise<ProfileStats> {
  const [yearCounts, dayStreak, [stats]] = await Promise.all([
    loadYearCheckinCounts(db, userId),
    loadStreak(db, userId),
    db.execute(sql`
      SELECT
        (SELECT count(*)::int FROM user_media
          WHERE user_id = ${userId} AND status = 'completed') AS completed,
        (SELECT count(*)::int FROM user_media WHERE user_id = ${userId}) AS titles,
        (SELECT avg(score)::float FROM rating
          WHERE user_id = ${userId} AND target_type = 'media' AND score IS NOT NULL) AS mean_rating
    `),
  ]);
  return {
    episodesThisYear: yearCounts.episodes,
    chaptersThisYear: yearCounts.chapters,
    completed: Number(stats?.completed ?? 0),
    titlesTracked: Number(stats?.titles ?? 0),
    meanRating: stats?.mean_rating !== null ? Number(stats?.mean_rating) : null,
    dayStreak,
  };
}

export async function loadStreak(db: Db, userId: string): Promise<number> {
  const rows = await db.execute(sql`
    SELECT DISTINCT (watched_at AT TIME ZONE 'UTC')::date::text AS day FROM progress
    WHERE user_id = ${userId}
    ORDER BY day DESC
    LIMIT 60
  `);
  return computeStreak(
    [...rows].map((row) => row.day as string),
    new Date(),
  );
}

/**
 * Check-ins split by part kind, in a date window — since Jan 1 by default,
 * which is what the profile and home strips ask for.
 *
 * A window is the history page's year/season narrowing (ADR-0007), as inclusive
 * ISO dates against the check-in's UTC day; `'all'` drops the bound entirely
 * (the page's ALL TIME scope). It counts *check-ins in the window*, not parts of
 * the titles filed there: a show finished in January whose episodes were watched
 * across two years contributes to both counts, which is the honest answer to
 * "how much did I watch that year".
 *
 * `kind` narrows to one media kind, so the history page's stats strip agrees
 * with its own kind tab — a strip reading "1 EPISODE" under a MOVIES filter is
 * just wrong. Soft-deleted titles are still counted, unlike every shelf and the
 * history's own entry list: an aggregate is the viewer's own history, and a
 * title the moderators removed does not un-watch the episodes they watched
 * (asserted by `home.integration.test.ts`).
 */
export type CheckinWindow = { from: string; to: string } | 'all' | 'this-year';

export async function loadYearCheckinCounts(
  db: Db,
  userId: string,
  window: CheckinWindow = 'this-year',
  kind?: MediaKind,
): Promise<{ episodes: number; chapters: number }> {
  const bounds =
    window === 'all'
      ? sql`TRUE`
      : window === 'this-year'
        ? sql`p.watched_at >= date_trunc('year', now())`
        : sql`(p.watched_at AT TIME ZONE 'UTC')::date BETWEEN ${window.from}::date AND ${window.to}::date`;
  const rows = await db.execute(sql`
    SELECT mp.kind, count(*)::int AS count FROM progress p
    JOIN media_part mp ON mp.id = p.part_id
    JOIN media m ON m.id = mp.media_id
    WHERE p.user_id = ${userId} AND ${bounds}
      AND ${kind ? sql`m.kind = ${kind}` : sql`TRUE`}
    GROUP BY mp.kind
  `);
  let episodes = 0;
  let chapters = 0;
  for (const row of rows) {
    if (row.kind === 'episode') episodes = row.count as number;
    if (row.kind === 'chapter') chapters = row.count as number;
  }
  return { episodes, chapters };
}

/**
 * `detail` for a run of check-ins collapsed into one entry: 'CH2' for a single
 * part, 'CH2–12' when the run is contiguous, '11 chapters' when it has gaps
 * (a range would overstate what was actually read).
 */
function checkinDetail(partKind: string, from: number, to: number, partCount: number): string {
  const prefix = partKind === 'chapter' ? 'CH' : 'E';
  if (partCount === 1) return `${prefix}${from}`;
  // Parts are numeric(8,2) (chapter 10.5 exists), so a contiguous run is only
  // provable for whole numbers; fractional runs fall back to the count.
  const contiguous = Number.isInteger(from) && Number.isInteger(to) && to - from + 1 === partCount;
  if (contiguous) return `${prefix}${from}–${to}`;
  return `${partCount} ${partKind === 'chapter' ? 'chapters' : 'episodes'}`;
}

/**
 * The subject's most recent check-ins/ratings/status changes, merged
 * newest-first. Filtered through `visibleMediaSql(viewer)`, not just
 * `deleted_at IS NULL`: on the own-profile call `viewer === subject` so
 * nothing changes, but a public-profile visitor must not see the title of an
 * `unverified` entry the subject tracked that someone else created — media
 * rules and social rules both apply (mirrors `routes/v1/lists.ts`).
 *
 * Check-ins are grouped per title per UTC day before the limit is applied:
 * binging 12 chapters is one line ('CH2–12'), not 12. Grouping has to happen
 * in SQL rather than in the client, because `limit` caps the merged feed — a
 * raw-row query would spend the whole budget on one title and push every
 * rating and status change out of the response entirely.
 */
export async function loadActivity(
  db: Db,
  userId: string,
  limit: number,
  viewer: SessionUser | null,
): Promise<ActivityEntry[]> {
  const visible = visibleMediaSql(viewer, sql.raw('m.'));
  const [checkins, ratings, logs] = await Promise.all([
    db.execute(sql`
      SELECT m.title, m.slug,
             m.kind  AS media_kind,
             mp.kind AS part_kind,
             min(mp.number) AS from_number,
             max(mp.number) AS to_number,
             count(*)::int  AS part_count,
             max(p.watched_at) AS watched_at
      FROM progress p
      JOIN media_part mp ON mp.id = p.part_id
      JOIN media m ON m.id = mp.media_id
      WHERE p.user_id = ${userId} AND ${visible}
      GROUP BY m.id, m.title, m.slug, m.kind, mp.kind, (p.watched_at AT TIME ZONE 'UTC')::date
      ORDER BY watched_at DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT m.title, m.slug, m.kind AS media_kind, r.score, r.updated_at FROM rating r
      JOIN media m ON m.id = r.target_id
      WHERE r.user_id = ${userId} AND r.target_type = 'media' AND r.score IS NOT NULL
        AND ${visible}
      ORDER BY r.updated_at DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT m.title, m.slug, m.kind AS media_kind, um.status, um.updated_at FROM user_media um
      JOIN media m ON m.id = um.media_id
      WHERE um.user_id = ${userId} AND ${visible}
      ORDER BY um.updated_at DESC
      LIMIT ${limit}
    `),
  ]);

  return [
    ...[...checkins].map((row) => ({
      verb: 'checked_in' as const,
      title: row.title as string,
      slug: row.slug as string,
      kind: row.media_kind as MediaKind,
      // `part_kind` is the episode/chapter of the run, not the media kind above.
      detail: checkinDetail(
        row.part_kind as string,
        Number(row.from_number),
        Number(row.to_number),
        row.part_count as number,
      ),
      at: new Date(row.watched_at as string).toISOString(),
    })),
    ...[...ratings].map((row) => ({
      verb: 'rated' as const,
      title: row.title as string,
      slug: row.slug as string,
      kind: row.media_kind as MediaKind,
      detail: `★ ${Number(row.score).toFixed(1)}`,
      at: new Date(row.updated_at as string).toISOString(),
    })),
    ...[...logs].map((row) => ({
      verb: 'status' as const,
      title: row.title as string,
      slug: row.slug as string,
      kind: row.media_kind as MediaKind,
      detail: (row.status as string).replace('_', ' '),
      at: new Date(row.updated_at as string).toISOString(),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
