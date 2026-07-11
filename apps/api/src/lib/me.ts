import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import type { ActivityEntry } from '@trackt/shared';

/** Viewer-scoped tracking aggregates shared by the home and profile summaries. */

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

/** Check-ins since Jan 1, split by part kind. */
export async function loadYearCheckinCounts(
  db: Db,
  userId: string,
): Promise<{ episodes: number; chapters: number }> {
  const rows = await db.execute(sql`
    SELECT mp.kind, count(*)::int AS count FROM progress p
    JOIN media_part mp ON mp.id = p.part_id
    WHERE p.user_id = ${userId} AND p.watched_at >= date_trunc('year', now())
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

/** The viewer's most recent check-ins/ratings/status changes, merged newest-first. */
export async function loadActivity(
  db: Db,
  userId: string,
  limit: number,
): Promise<ActivityEntry[]> {
  const [checkins, ratings, logs] = await Promise.all([
    db.execute(sql`
      SELECT m.title, m.slug, mp.kind, mp.number, p.watched_at FROM progress p
      JOIN media_part mp ON mp.id = p.part_id
      JOIN media m ON m.id = mp.media_id
      WHERE p.user_id = ${userId}
      ORDER BY p.watched_at DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT m.title, m.slug, r.score, r.updated_at FROM rating r
      JOIN media m ON m.id = r.target_id
      WHERE r.user_id = ${userId} AND r.target_type = 'media' AND r.score IS NOT NULL
      ORDER BY r.updated_at DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT m.title, m.slug, um.status, um.updated_at FROM user_media um
      JOIN media m ON m.id = um.media_id
      WHERE um.user_id = ${userId}
      ORDER BY um.updated_at DESC
      LIMIT ${limit}
    `),
  ]);

  return [
    ...[...checkins].map((row) => ({
      verb: 'checked_in' as const,
      title: row.title as string,
      slug: row.slug as string,
      detail: `${row.kind === 'chapter' ? 'CH' : 'E'}${Number(row.number)}`,
      at: new Date(row.watched_at as string).toISOString(),
    })),
    ...[...ratings].map((row) => ({
      verb: 'rated' as const,
      title: row.title as string,
      slug: row.slug as string,
      detail: `★ ${Number(row.score).toFixed(1)}`,
      at: new Date(row.updated_at as string).toISOString(),
    })),
    ...[...logs].map((row) => ({
      verb: 'status' as const,
      title: row.title as string,
      slug: row.slug as string,
      detail: (row.status as string).replace('_', ' '),
      at: new Date(row.updated_at as string).toISOString(),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
