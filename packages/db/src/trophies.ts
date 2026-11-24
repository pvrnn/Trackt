import { sql, type SQL } from 'drizzle-orm';
import { TROPHIES, type MediaKind, type TrophyId } from '@trackt/shared';
import type { Db } from './index.js';

/**
 * The trophy evaluator. Every trophy is a pure function of a user's tracking
 * rows, so evaluation is idempotent and can run anywhere: the API runs it for
 * the viewer and their friends on read, the worker sweeps everyone else so the
 * global board stays honest. Each metric is one query over a batch of users.
 */

export interface TrophyEvidenceRow {
  mediaId: string;
  slug: string;
  kind: MediaKind;
  title: string;
  at: Date;
}

export interface TrophyState {
  id: TrophyId;
  /** Raw count toward the target, uncapped. */
  value: number;
  /** When the target was first reached in the data; null while it isn't. */
  reachedAt: Date | null;
  evidence: TrophyEvidenceRow[];
}

interface NthResult {
  count: number;
  /** rn → when the rn-th event happened. */
  at: Map<number, Date>;
}

const toDate = (value: unknown): Date => (value instanceof Date ? value : new Date(String(value)));

function idsArray(userIds: string[]): SQL {
  return sql`ARRAY[${sql.join(
    userIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
}

/**
 * Counts `(user_id, at)` events per user and returns when each threshold-th
 * one happened. Row 1 is always kept so a user below every threshold still
 * reports a count.
 */
async function nth(db: Db, events: SQL, thresholds: number[]): Promise<Map<string, NthResult>> {
  const wanted = [1, ...thresholds];
  const rows = await db.execute(sql`
    SELECT user_id, rn::int AS rn, n::int AS n, at FROM (
      SELECT user_id, at,
             row_number() OVER (PARTITION BY user_id ORDER BY at) AS rn,
             count(*) OVER (PARTITION BY user_id) AS n
      FROM (${events}) ev
    ) x
    WHERE rn IN (${sql.join(
      wanted.map((n) => sql`${n}`),
      sql`, `,
    )})
  `);
  const out = new Map<string, NthResult>();
  for (const row of rows) {
    const userId = row.user_id as string;
    const entry = out.get(userId) ?? { count: Number(row.n), at: new Map<number, Date>() };
    entry.at.set(Number(row.rn), toDate(row.at));
    out.set(userId, entry);
  }
  return out;
}

const completedAt = sql`COALESCE(um.finished_at::timestamptz, um.updated_at)`;

export async function computeTrophies(
  db: Db,
  userIds: string[],
): Promise<Map<string, TrophyState[]>> {
  const result = new Map<string, TrophyState[]>();
  if (userIds.length === 0) return result;
  const ids = idsArray(userIds);

  const [
    logs,
    completions,
    ratings,
    lists,
    friends,
    favorites,
    services,
    checkins,
    dayOne,
    kindRows,
    bingeRows,
    haulRows,
  ] = await Promise.all([
    // An imported log can predate its own row, so its dates count too.
    nth(
      db,
      sql`SELECT user_id, LEAST(created_at, started_at::timestamptz, finished_at::timestamptz) AS at
          FROM user_media WHERE user_id = ANY(${ids})`,
      [],
    ),
    nth(
      db,
      sql`SELECT um.user_id, ${completedAt} AS at
          FROM user_media um JOIN media m ON m.id = um.media_id AND m.deleted_at IS NULL
          WHERE um.user_id = ANY(${ids}) AND um.status = 'completed'`,
      [25, 100, 500],
    ),
    nth(
      db,
      sql`SELECT user_id, created_at AS at FROM rating
          WHERE user_id = ANY(${ids}) AND target_type = 'media' AND score IS NOT NULL`,
      [10, 50],
    ),
    nth(
      db,
      sql`SELECT owner_id AS user_id, created_at AS at FROM list WHERE owner_id = ANY(${ids})`,
      [],
    ),
    nth(
      db,
      sql`SELECT user_a_id AS user_id, responded_at AS at FROM friendship
            WHERE status = 'accepted' AND user_a_id = ANY(${ids})
          UNION ALL
          SELECT user_b_id, responded_at FROM friendship
            WHERE status = 'accepted' AND user_b_id = ANY(${ids})`,
      [5],
    ),
    // `favorite` keeps no timestamp, so the moment of evaluation stands in.
    nth(db, sql`SELECT user_id, now() AS at FROM favorite WHERE user_id = ANY(${ids})`, [5]),
    nth(
      db,
      sql`SELECT user_id, min(finished_at) AS at FROM import_run
          WHERE user_id = ANY(${ids}) AND state = 'completed' AND finished_at IS NOT NULL
          GROUP BY user_id, source`,
      [2],
    ),
    nth(
      db,
      sql`SELECT user_id, watched_at AS at FROM progress WHERE user_id = ANY(${ids})`,
      [100, 1000],
    ),
    nth(
      db,
      sql`SELECT p.user_id, p.watched_at AS at
          FROM progress p JOIN media_part mp ON mp.id = p.part_id
          WHERE p.user_id = ANY(${ids}) AND mp.air_date IS NOT NULL
            AND (p.watched_at AT TIME ZONE 'UTC')::date = mp.air_date`,
      [10],
    ),
    // First completion per kind, oldest first.
    db.execute(sql`
      SELECT DISTINCT ON (um.user_id, m.kind)
             um.user_id, m.id, m.slug, m.kind, m.title, ${completedAt} AS at
      FROM user_media um JOIN media m ON m.id = um.media_id AND m.deleted_at IS NULL
      WHERE um.user_id = ANY(${ids}) AND um.status = 'completed'
      ORDER BY um.user_id, m.kind, ${completedAt}
    `),
    // A whole season of 10+ episodes inside 48 hours. The distinct-stamp floor
    // keeps "mark all watched" and imports — one timestamp for every episode — out.
    db.execute(sql`
      SELECT DISTINCT ON (um.user_id) um.user_id, m.id, m.slug, m.kind, m.title, b.done_at AS at
      FROM user_media um
      JOIN media m ON m.id = um.media_id AND m.deleted_at IS NULL AND m.kind IN ('series', 'anime')
      JOIN LATERAL (
        SELECT max(p.watched_at) AS done_at, min(p.watched_at) AS start_at,
               count(DISTINCT p.part_id) AS parts, count(DISTINCT p.watched_at) AS stamps
        FROM progress p JOIN media_part mp ON mp.id = p.part_id
        WHERE p.user_id = um.user_id AND mp.media_id = m.id AND mp.kind = 'episode'
          AND p.repeat_index = 0
      ) b ON true
      WHERE um.user_id = ANY(${ids}) AND um.status = 'completed'
        AND b.stamps >= 10
        AND b.parts >= GREATEST(10, (SELECT count(*) FROM media_part e WHERE e.media_id = m.id AND e.kind = 'episode'))
        AND b.done_at - b.start_at <= interval '48 hours'
      ORDER BY um.user_id, b.done_at
    `),
    // Chapters read per manga/webtoon, with the completion date when finished.
    db.execute(sql`
      SELECT um.user_id, m.id, m.slug, m.kind, m.title, COALESCE(c.chapters, 0)::int AS chapters,
             m.part_count, um.status, ${completedAt} AS at
      FROM user_media um
      JOIN media m ON m.id = um.media_id AND m.deleted_at IS NULL AND m.kind IN ('manga', 'webtoon')
      LEFT JOIN (
        SELECT p.user_id, mp.media_id, count(DISTINCT p.part_id) AS chapters
        FROM progress p JOIN media_part mp ON mp.id = p.part_id AND mp.kind = 'chapter'
        WHERE p.user_id = ANY(${ids})
        GROUP BY p.user_id, mp.media_id
      ) c ON c.user_id = um.user_id AND c.media_id = um.media_id
      WHERE um.user_id = ANY(${ids})
    `),
  ]);

  const evidence = (row: Record<string, unknown>): TrophyEvidenceRow => ({
    mediaId: row.id as string,
    slug: row.slug as string,
    kind: row.kind as MediaKind,
    title: row.title as string,
    at: toDate(row.at),
  });

  const kindsByUser = new Map<string, TrophyEvidenceRow[]>();
  for (const row of kindRows) {
    const list = kindsByUser.get(row.user_id as string) ?? [];
    list.push(evidence(row));
    kindsByUser.set(row.user_id as string, list);
  }
  for (const list of kindsByUser.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());

  const bingeByUser = new Map<string, TrophyEvidenceRow>();
  for (const row of bingeRows) bingeByUser.set(row.user_id as string, evidence(row));

  const haulByUser = new Map<string, { best: number; done: TrophyEvidenceRow | null }>();
  for (const row of haulRows) {
    const userId = row.user_id as string;
    const entry = haulByUser.get(userId) ?? { best: 0, done: null };
    entry.best = Math.max(entry.best, Number(row.chapters));
    // A completion can come without per-chapter check-ins (an import), so the catalogue's count also counts.
    const long = Math.max(Number(row.chapters), Number(row.part_count ?? 0)) >= 100;
    if (row.status === 'completed' && long) {
      const candidate = evidence(row);
      if (!entry.done || candidate.at < entry.done.at) entry.done = candidate;
    }
    haulByUser.set(userId, entry);
  }

  const fromNth = (
    source: Map<string, NthResult>,
    userId: string,
    target: number,
  ): Pick<TrophyState, 'value' | 'reachedAt'> => {
    const entry = source.get(userId);
    return { value: entry?.count ?? 0, reachedAt: entry?.at.get(target) ?? null };
  };

  const nthSources: Partial<Record<TrophyId, Map<string, NthResult>>> = {
    'first-log': logs,
    'curtain-call': completions,
    regular: completions,
    completionist: completions,
    'living-archive': completions,
    opinionated: ratings,
    critic: ratings,
    curator: lists,
    'plus-one': friends,
    'inner-circle': friends,
    'heart-on-sleeve': favorites,
    archivist: services,
    century: checkins,
    'thousand-nights': checkins,
    'day-one': dayOne,
  };

  for (const userId of userIds) {
    const kinds = kindsByUser.get(userId) ?? [];
    const binge = bingeByUser.get(userId) ?? null;
    const haul = haulByUser.get(userId) ?? { best: 0, done: null };
    const states = TROPHIES.map((trophy): TrophyState => {
      const source = nthSources[trophy.id];
      if (source) return { id: trophy.id, ...fromNth(source, userId, trophy.target), evidence: [] };
      switch (trophy.id) {
        case 'explorer':
        case 'polyglot':
          return {
            id: trophy.id,
            value: kinds.length,
            reachedAt: kinds[trophy.target - 1]?.at ?? null,
            evidence: trophy.id === 'polyglot' ? kinds : [],
          };
        case 'binge-engine':
          return {
            id: trophy.id,
            value: binge ? 1 : 0,
            reachedAt: binge?.at ?? null,
            evidence: binge ? [binge] : [],
          };
        case 'long-haul':
          return {
            id: trophy.id,
            value: haul.done ? Math.max(haul.best, trophy.target) : haul.best,
            reachedAt: haul.done?.at ?? null,
            evidence: haul.done ? [haul.done] : [],
          };
        default:
          return { id: trophy.id, value: 0, reachedAt: null, evidence: [] };
      }
    });
    result.set(userId, states);
  }
  return result;
}

/** Record every reached trophy. Existing rows win: an unlock date never moves. */
export async function recordTrophies(db: Db, states: Map<string, TrophyState[]>): Promise<void> {
  const rows: SQL[] = [];
  for (const [userId, list] of states) {
    for (const state of list) {
      if (state.reachedAt)
        rows.push(
          sql`(${userId}::uuid, ${state.id}, ${state.reachedAt.toISOString()}::timestamptz)`,
        );
    }
  }
  for (let i = 0; i < rows.length; i += 1000) {
    await db.execute(sql`
      INSERT INTO user_trophy (user_id, trophy_id, unlocked_at)
      VALUES ${sql.join(rows.slice(i, i + 1000), sql`, `)}
      ON CONFLICT (user_id, trophy_id) DO NOTHING
    `);
  }
}

export async function evaluateTrophies(
  db: Db,
  userIds: string[],
): Promise<Map<string, TrophyState[]>> {
  const states = await computeTrophies(db, userIds);
  await recordTrophies(db, states);
  return states;
}

/** Evaluate every account, a batch at a time — the worker's sweep. */
export async function evaluateAllTrophies(db: Db, batchSize = 500): Promise<number> {
  let after = '00000000-0000-0000-0000-000000000000';
  let total = 0;
  for (;;) {
    const rows = await db.execute(
      sql`SELECT id FROM "user" WHERE id > ${after}::uuid ORDER BY id LIMIT ${batchSize}`,
    );
    if (rows.length === 0) return total;
    const ids = rows.map((r) => r.id as string);
    await evaluateTrophies(db, ids);
    total += ids.length;
    after = ids[ids.length - 1] as string;
  }
}
