import { sql, type SQL } from 'drizzle-orm';
import { evaluateTrophies, type Db, type TrophyState } from '@trackt/db';
import {
  TROPHIES,
  TROPHY_TIER_POINTS,
  type Leaderboard,
  type LeaderboardPeriod,
  type LeaderboardRow,
  type LeaderboardScope,
  type TrophyCabinet,
  type TrophyEntry,
  type TrophyId,
  type TrophyTierCounts,
} from '@trackt/shared';

/** The global board's head; the viewer's own row is appended below it. */
const GLOBAL_TOP = 10;
const FRIEND_SAMPLE = 3;

interface Person {
  id: string;
  username: string;
  name: string;
  image: string | null;
}

const POINTS = new Map(TROPHIES.map((t) => [t.id as string, TROPHY_TIER_POINTS[t.tier]]));

/** `(trophy_id, pts, tier)` for every trophy in the catalogue, as a SQL VALUES list. */
const trophyValues = sql.join(
  TROPHIES.map((t) => sql`(${t.id}, ${TROPHY_TIER_POINTS[t.tier]}::int, ${t.tier})`),
  sql`, `,
);

function windowFor(period: LeaderboardPeriod): { start: SQL; prevStart: SQL } {
  if (period === 'all')
    return { start: sql`'-infinity'::timestamptz`, prevStart: sql`'-infinity'::timestamptz` };
  const unit = sql.raw(`'${period}'`);
  const step = sql.raw(`interval '1 ${period}'`);
  return {
    start: sql`date_trunc(${unit}, now())`,
    prevStart: sql`date_trunc(${unit}, now()) - ${step}`,
  };
}

function uuidArray(ids: string[]): SQL {
  return sql`ARRAY[${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

async function loadPerson(db: Db, userId: string): Promise<Person> {
  const [row] = await db.execute(
    sql`SELECT id, display_username AS username, name, image FROM "user" WHERE id = ${userId}::uuid`,
  );
  return {
    id: userId,
    username: (row?.username as string | null) ?? '',
    name: (row?.name as string | undefined) ?? '',
    image: (row?.image as string | null | undefined) ?? null,
  };
}

export async function loadFriends(db: Db, userId: string): Promise<Person[]> {
  const rows = await db.execute(sql`
    SELECT u.id, u.display_username AS username, u.name, u.image
    FROM friendship f
    JOIN "user" u ON u.id = CASE WHEN f.user_a_id = ${userId}::uuid THEN f.user_b_id ELSE f.user_a_id END
    WHERE f.status = 'accepted' AND (f.user_a_id = ${userId}::uuid OR f.user_b_id = ${userId}::uuid)
  `);
  return rows.map((r) => ({
    id: r.id as string,
    username: (r.username as string | null) ?? '',
    name: r.name as string,
    image: (r.image as string | null) ?? null,
  }));
}

async function tierCounts(db: Db, ids: string[]): Promise<Map<string, TrophyTierCounts>> {
  const out = new Map<string, TrophyTierCounts>();
  for (const id of ids) out.set(id, { bronze: 0, silver: 0, gold: 0, prism: 0 });
  if (ids.length === 0) return out;
  const rows = await db.execute(sql`
    SELECT ut.user_id, tp.tier, count(*)::int AS n
    FROM user_trophy ut JOIN (VALUES ${trophyValues}) AS tp(trophy_id, pts, tier) USING (trophy_id)
    WHERE ut.user_id = ANY(${uuidArray(ids)})
    GROUP BY ut.user_id, tp.tier
  `);
  for (const row of rows) {
    const counts = out.get(row.user_id as string);
    if (counts) counts[row.tier as keyof TrophyTierCounts] = Number(row.n);
  }
  return out;
}

/** Rank by points, ties broken by id so a board never reshuffles between reads. */
function rankBy(entries: { id: string; points: number }[]): Map<string, number> {
  const sorted = [...entries].sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : 1));
  return new Map(sorted.map((e, i) => [e.id, i + 1]));
}

function chaseTrophy(states: TrophyState[] | undefined, gap: number): TrophyId | null {
  if (!states) return null;
  const locked = TROPHIES.map((t) => ({ t, s: states.find((s) => s.id === t.id) })).filter(
    ({ s }) => s && !s.reachedAt,
  );
  const ratio = (x: (typeof locked)[number]) => Math.min(1, (x.s?.value ?? 0) / x.t.target);
  const enough = locked.filter(({ t }) => TROPHY_TIER_POINTS[t.tier] >= gap);
  const pool = enough.length > 0 ? enough : locked;
  pool.sort(
    (a, b) => ratio(b) - ratio(a) || TROPHY_TIER_POINTS[b.t.tier] - TROPHY_TIER_POINTS[a.t.tier],
  );
  return pool[0]?.t.id ?? null;
}

async function friendsBoard(
  db: Db,
  viewer: Person,
  friends: Person[],
  period: LeaderboardPeriod,
  states?: TrophyState[],
): Promise<Leaderboard> {
  const people = [viewer, ...friends];
  const ids = people.map((p) => p.id);
  const { start, prevStart } = windowFor(period);
  const rows = await db.execute(sql`
    SELECT ut.user_id,
           COALESCE(sum(tp.pts) FILTER (WHERE ut.unlocked_at >= ${start}), 0)::int AS cur,
           COALESCE(sum(tp.pts) FILTER (WHERE ut.unlocked_at >= ${prevStart} AND ut.unlocked_at < ${start}), 0)::int AS prev
    FROM user_trophy ut JOIN (VALUES ${trophyValues}) AS tp(trophy_id, pts, tier) USING (trophy_id)
    WHERE ut.user_id = ANY(${uuidArray(ids)})
    GROUP BY ut.user_id
  `);
  const cur = new Map(rows.map((r) => [r.user_id as string, Number(r.cur)]));
  const prev = new Map(rows.map((r) => [r.user_id as string, Number(r.prev)]));
  const rank = rankBy(ids.map((id) => ({ id, points: cur.get(id) ?? 0 })));
  // Only people who scored last period had a place in it; a newcomer has no delta.
  const prevRank = rankBy(
    ids.filter((id) => (prev.get(id) ?? 0) > 0).map((id) => ({ id, points: prev.get(id) ?? 0 })),
  );
  const tiers = await tierCounts(db, ids);

  const board: LeaderboardRow[] = people
    .map((p) => ({
      rank: rank.get(p.id) as number,
      username: p.username,
      name: p.name,
      image: p.image,
      isViewer: p.id === viewer.id,
      points: cur.get(p.id) ?? 0,
      tiers: tiers.get(p.id) as TrophyTierCounts,
      delta:
        period === 'all' || !prevRank.has(p.id)
          ? null
          : (prevRank.get(p.id) as number) - (rank.get(p.id) as number),
    }))
    .sort((a, b) => a.rank - b.rank);

  const me = board.find((r) => r.isViewer) as LeaderboardRow;
  const rival = board[me.rank - 2];
  const gap = rival ? rival.points - me.points + 1 : 0;
  return {
    scope: 'friends',
    period,
    population: people.length,
    rows: board,
    viewer: null,
    chase: rival
      ? { points: gap, rival: rival.name, rank: rival.rank, trophy: chaseTrophy(states, gap) }
      : null,
  };
}

async function globalBoard(
  db: Db,
  viewer: Person,
  period: LeaderboardPeriod,
): Promise<Leaderboard> {
  const { start, prevStart } = windowFor(period);
  const ranked = await db.execute(sql`
    WITH agg AS (
      SELECT ut.user_id,
             COALESCE(sum(tp.pts) FILTER (WHERE ut.unlocked_at >= ${start}), 0) AS cur,
             COALESCE(sum(tp.pts) FILTER (WHERE ut.unlocked_at >= ${prevStart} AND ut.unlocked_at < ${start}), 0) AS prev
      FROM user_trophy ut JOIN (VALUES ${trophyValues}) AS tp(trophy_id, pts, tier) USING (trophy_id)
      GROUP BY ut.user_id
    ),
    cur AS (SELECT user_id, cur::int AS points, row_number() OVER (ORDER BY cur DESC, user_id) AS rank FROM agg WHERE cur > 0),
    prev AS (SELECT user_id, row_number() OVER (ORDER BY prev DESC, user_id) AS rank FROM agg WHERE prev > 0)
    SELECT c.user_id, c.points, c.rank::int AS rank, p.rank::int AS prev_rank,
           u.display_username AS username, u.name, u.image,
           (SELECT count(*)::int FROM cur) AS ranked
    FROM cur c JOIN "user" u ON u.id = c.user_id LEFT JOIN prev p USING (user_id)
    WHERE c.rank <= ${GLOBAL_TOP} OR c.user_id = ${viewer.id}::uuid
    ORDER BY c.rank
  `);
  const [population] = await db.execute(sql`SELECT count(*)::int AS n FROM "user"`);
  const ids = [...new Set([...ranked.map((r) => r.user_id as string), viewer.id])];
  const tiers = await tierCounts(db, ids);

  const toRow = (r: Record<string, unknown>): LeaderboardRow => ({
    rank: Number(r.rank),
    username: (r.username as string | null) ?? '',
    name: r.name as string,
    image: (r.image as string | null) ?? null,
    isViewer: r.user_id === viewer.id,
    points: Number(r.points),
    tiers: tiers.get(r.user_id as string) as TrophyTierCounts,
    delta: period === 'all' || r.prev_rank == null ? null : Number(r.prev_rank) - Number(r.rank),
  });

  const head = ranked.filter((r) => Number(r.rank) <= GLOBAL_TOP).map(toRow);
  const mine = ranked.find((r) => r.user_id === viewer.id);
  const rankedCount = Number(ranked[0]?.ranked ?? 0);
  let viewerRow: LeaderboardRow | null = null;
  if (mine && Number(mine.rank) > GLOBAL_TOP) viewerRow = toRow(mine);
  else if (!mine)
    viewerRow = {
      rank: rankedCount + 1,
      username: viewer.username,
      name: viewer.name,
      image: viewer.image,
      isViewer: true,
      points: 0,
      tiers: tiers.get(viewer.id) as TrophyTierCounts,
      delta: null,
    };

  return {
    scope: 'global',
    period,
    population: Number(population?.n ?? 0),
    rows: head,
    viewer: viewerRow,
    chase: null,
  };
}

export async function loadLeaderboard(
  db: Db,
  viewerId: string,
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
): Promise<Leaderboard> {
  const [viewer, friends] = await Promise.all([
    loadPerson(db, viewerId),
    loadFriends(db, viewerId),
  ]);
  if (scope === 'global') {
    await evaluateTrophies(db, [viewerId]);
    return globalBoard(db, viewer, period);
  }
  const states = await evaluateTrophies(db, [viewerId, ...friends.map((f) => f.id)]);
  return friendsBoard(db, viewer, friends, period, states.get(viewerId));
}

export async function loadCabinet(db: Db, viewerId: string): Promise<TrophyCabinet> {
  const [viewer, friends] = await Promise.all([
    loadPerson(db, viewerId),
    loadFriends(db, viewerId),
  ]);
  const friendIds = friends.map((f) => f.id);
  const states = (await evaluateTrophies(db, [viewerId, ...friendIds])).get(viewerId) ?? [];

  const [stats, owned, friendHolds, [accounts], friendsAll, globalMonth] = await Promise.all([
    db.execute(sql`
      SELECT t.trophy_id, count(*)::int AS holders,
             (count(*) FILTER (
               WHERE t.unlocked_at < m.unlocked_at OR (t.unlocked_at = m.unlocked_at AND t.user_id < m.user_id)
             ) + 1)::int AS serial
      FROM user_trophy t
      LEFT JOIN user_trophy m ON m.trophy_id = t.trophy_id AND m.user_id = ${viewerId}::uuid
      GROUP BY t.trophy_id
    `),
    db.execute(
      sql`SELECT trophy_id, unlocked_at FROM user_trophy WHERE user_id = ${viewerId}::uuid`,
    ),
    friendIds.length > 0
      ? db.execute(
          sql`SELECT trophy_id, user_id FROM user_trophy WHERE user_id = ANY(${uuidArray(friendIds)}) ORDER BY unlocked_at`,
        )
      : Promise.resolve([]),
    db.execute(sql`SELECT count(*)::int AS n FROM "user"`),
    friendsBoard(db, viewer, friends, 'all'),
    globalBoard(db, viewer, 'month'),
  ]);

  const statById = new Map(stats.map((r) => [r.trophy_id as string, r]));
  const unlockedAt = new Map(
    owned.map((r) => [r.trophy_id as string, new Date(String(r.unlocked_at)).toISOString()]),
  );
  const friendById = new Map(friends.map((f) => [f.id, f]));
  const holdersById = new Map<string, Person[]>();
  for (const row of friendHolds) {
    const list = holdersById.get(row.trophy_id as string) ?? [];
    const friend = friendById.get(row.user_id as string);
    if (friend) list.push(friend);
    holdersById.set(row.trophy_id as string, list);
  }
  const population = Math.max(1, Number(accounts?.n ?? 1));

  const trophies: TrophyEntry[] = TROPHIES.map((t) => {
    const state = states.find((s) => s.id === t.id);
    const at = unlockedAt.get(t.id) ?? null;
    const stat = statById.get(t.id);
    const holders = Number(stat?.holders ?? 0);
    const friendList = holdersById.get(t.id) ?? [];
    return {
      id: t.id,
      tier: t.tier,
      points: TROPHY_TIER_POINTS[t.tier],
      unit: t.unit,
      target: t.target,
      progress: at ? t.target : Math.min(t.target, state?.value ?? 0),
      unlockedAt: at,
      holders,
      rarity: Math.round((holders / population) * 1000) / 10,
      serial: at ? Number(stat?.serial ?? 1) : null,
      friends: {
        count: friendList.length,
        sample: friendList
          .slice(0, FRIEND_SAMPLE)
          .map((f) => ({ username: f.username, name: f.name, image: f.image })),
      },
      evidence: (state?.evidence ?? []).map((e) => ({ ...e, at: e.at.toISOString() })),
    };
  });

  const tiers: TrophyTierCounts = { bronze: 0, silver: 0, gold: 0, prism: 0 };
  let points = 0;
  for (const t of trophies) {
    if (!t.unlockedAt) continue;
    tiers[t.tier] += 1;
    points += POINTS.get(t.id) ?? 0;
  }
  const meGlobal = globalMonth.viewer ?? globalMonth.rows.find((r) => r.isViewer) ?? null;

  return {
    owner: { username: viewer.username, name: viewer.name },
    points,
    unlocked: trophies.filter((t) => t.unlockedAt).length,
    total: TROPHIES.length,
    tiers,
    friendsRank: friendsAll.rows.find((r) => r.isViewer)?.rank ?? 1,
    globalMonthRank: meGlobal && meGlobal.points > 0 ? meGlobal.rank : null,
    trophies,
  };
}
