import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import type { ActivityEntry, MediaKind } from '@trackt/shared';

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
 * The viewer's most recent check-ins/ratings/status changes, merged
 * newest-first. Soft-deleted media (`deleted_at` set) are hidden here like
 * everywhere else — the underlying rows stay, they just don't render.
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
): Promise<ActivityEntry[]> {
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
      WHERE p.user_id = ${userId} AND m.deleted_at IS NULL
      GROUP BY m.id, m.title, m.slug, m.kind, mp.kind, (p.watched_at AT TIME ZONE 'UTC')::date
      ORDER BY watched_at DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT m.title, m.slug, m.kind AS media_kind, r.score, r.updated_at FROM rating r
      JOIN media m ON m.id = r.target_id
      WHERE r.user_id = ${userId} AND r.target_type = 'media' AND r.score IS NOT NULL
        AND m.deleted_at IS NULL
      ORDER BY r.updated_at DESC
      LIMIT ${limit}
    `),
    db.execute(sql`
      SELECT m.title, m.slug, m.kind AS media_kind, um.status, um.updated_at FROM user_media um
      JOIN media m ON m.id = um.media_id
      WHERE um.user_id = ${userId} AND m.deleted_at IS NULL
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
