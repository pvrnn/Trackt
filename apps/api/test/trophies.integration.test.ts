import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  evaluateTrophies,
  media,
  mediaPart,
  progress,
  runMigrations,
  userMedia,
  type Db,
} from '@trackt/db';
import { loadEnv, MEDIA_KINDS, type Leaderboard, type TrophyCabinet } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed trophy tests (own `trackt_trophies_test` db, self-skips
 * without Docker). The database outlives the suite, so nothing here assumes
 * this run's users are the only ones holding a trophy or on the global board.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_TROPHIES ??
  'postgres://trackt:trackt@localhost:5432/trackt_trophies_test';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt';
  const admin = postgres(adminUrl.href, { max: 1, connect_timeout: 3 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
    return true;
  } catch (error) {
    if (process.env.CI_REQUIRE_DB) {
      throw new Error(`Postgres is unavailable but CI_REQUIRE_DB is set: ${String(error)}`, {
        cause: error,
      });
    }
    return false;
  } finally {
    await admin.end();
  }
}

const available = await ensureTestDatabase();

interface SignedUpUser {
  cookie: string;
  id: string;
  username: string;
}

describe.runIf(available)('trophies (postgres)', () => {
  let app: App;
  let db: Db;

  async function signUp(prefix: string): Promise<SignedUpUser> {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const username = `${prefix}${stamp}`.slice(0, 20);
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: `${prefix} Tester`,
        username,
        email: `${prefix}-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(response.statusCode).toBe(200);
    const cookie = (response.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
    return { cookie, id: response.json().user.id as string, username };
  }

  async function addMedia(kind: (typeof MEDIA_KINDS)[number], title: string): Promise<string> {
    const id = randomUUID();
    await db.insert(media).values({
      id,
      kind,
      title,
      slug: `${title.toLowerCase().replace(/\W+/g, '-')}-${id.slice(0, 8)}`,
    });
    return id;
  }

  /** One completed title per kind, each finished on its own day in 2020. */
  async function completeEveryKind(userId: string): Promise<void> {
    for (const [i, kind] of MEDIA_KINDS.entries()) {
      const mediaId = await addMedia(kind, `Polyglot ${kind}`);
      await db.insert(userMedia).values({
        userId,
        mediaId,
        status: 'completed',
        finishedAt: `2020-01-0${i + 1}`,
      });
    }
  }

  /** A ten-episode season checked in one episode a minute, just now. */
  async function bingeSeason(userId: string): Promise<void> {
    const mediaId = await addMedia('series', 'Binge Season');
    const parts = await db
      .insert(mediaPart)
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          mediaId,
          kind: 'episode' as const,
          number: String(i + 1),
        })),
      )
      .returning({ id: mediaPart.id });
    const now = Date.now();
    await db.insert(progress).values(
      parts.map((p, i) => ({
        userId,
        partId: p.id,
        watchedAt: new Date(now - (10 - i) * 60_000),
      })),
    );
    await db.insert(userMedia).values({ userId, mediaId, status: 'completed' });
  }

  async function befriend(a: SignedUpUser, b: SignedUpUser): Promise<void> {
    const sent = await app.inject({
      method: 'POST',
      url: '/api/v1/me/friends/requests',
      headers: { cookie: a.cookie },
      payload: { username: b.username },
    });
    expect(sent.statusCode).toBeLessThan(300);
    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/me/friends/requests/${a.id}/accept`,
      headers: { cookie: b.cookie },
    });
    expect(accepted.statusCode).toBeLessThan(300);
  }

  async function cabinet(user: SignedUpUser): Promise<TrophyCabinet> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me/trophies',
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function board(user: SignedUpUser, scope: string, period: string): Promise<Leaderboard> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/me/trophies/leaderboard?scope=${scope}&period=${period}`,
      headers: { cookie: user.cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      AUTH_EMAIL_VERIFICATION: 'off',
      CATALOG_URL: '',
    });
    app = await buildApp({ env, db, auth: createAuth(db, env) });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/trophies' });
    expect(response.statusCode).toBe(401);
  });

  it('a fresh account holds nothing and every trophy reads as locked', async () => {
    const fresh = await signUp('fresh');
    const result = await cabinet(fresh);
    expect(result.points).toBe(0);
    expect(result.unlocked).toBe(0);
    expect(result.globalMonthRank).toBeNull();
    expect(result.trophies).toHaveLength(result.total);
    expect(result.trophies.every((t) => t.unlockedAt === null && t.serial === null)).toBe(true);
  });

  it('dates each unlock from the data, not from when it was noticed', async () => {
    const alice = await signUp('alice');
    await completeEveryKind(alice.id);
    await bingeSeason(alice.id);

    const result = await cabinet(alice);
    const byId = new Map(result.trophies.map((t) => [t.id, t]));

    const polyglot = byId.get('polyglot');
    expect(polyglot?.unlockedAt?.slice(0, 10)).toBe('2020-01-06');
    expect(polyglot?.evidence.map((e) => e.kind)).toEqual([...MEDIA_KINDS]);
    expect(byId.get('explorer')?.unlockedAt?.slice(0, 10)).toBe('2020-01-03');
    expect(byId.get('curtain-call')?.unlockedAt?.slice(0, 10)).toBe('2020-01-01');
    expect(byId.get('binge-engine')?.unlockedAt).not.toBeNull();
    expect(byId.get('binge-engine')?.evidence[0]?.title).toBe('Binge Season');

    const regular = byId.get('regular');
    expect(regular?.unlockedAt).toBeNull();
    expect(regular?.progress).toBe(7);
    expect(byId.get('century')?.progress).toBe(10);

    // first-log 15 + curtain-call 15 + explorer 30 + binge 90 + polyglot 180
    expect(result.points).toBe(330);
    expect(result.tiers).toEqual({ bronze: 2, silver: 1, gold: 1, prism: 1 });
    expect(polyglot?.serial).toBeGreaterThanOrEqual(1);
    expect(polyglot?.holders).toBeGreaterThanOrEqual(1);

    // A second read keeps the same unlock dates.
    const again = await cabinet(alice);
    expect(again.trophies.find((t) => t.id === 'polyglot')?.unlockedAt).toBe(polyglot?.unlockedAt);
  });

  it('an import that stamps every episode at once is not a binge', async () => {
    const carol = await signUp('carol');
    const mediaId = await addMedia('anime', 'Bulk Marked');
    const parts = await db
      .insert(mediaPart)
      .values(
        Array.from({ length: 12 }, (_, i) => ({
          mediaId,
          kind: 'episode' as const,
          number: String(i + 1),
        })),
      )
      .returning({ id: mediaPart.id });
    const at = new Date();
    await db
      .insert(progress)
      .values(parts.map((p) => ({ userId: carol.id, partId: p.id, watchedAt: at })));
    await db.insert(userMedia).values({ userId: carol.id, mediaId, status: 'completed' });

    const states = await evaluateTrophies(db, [carol.id]);
    expect(states.get(carol.id)?.find((s) => s.id === 'binge-engine')?.reachedAt).toBeNull();
  });

  it('ranks friends, counts only the period, and names the one to pass', async () => {
    const dana = await signUp('dana');
    const erin = await signUp('erin');
    await completeEveryKind(dana.id);
    await bingeSeason(dana.id);
    await befriend(dana, erin);

    const all = await board(erin, 'friends', 'all');
    expect(all.population).toBe(2);
    expect(all.rows.map((r) => r.username)).toEqual([dana.username, erin.username]);
    // Plus One joins the 330 once the friendship is accepted.
    expect(all.rows[0]?.points).toBe(345);
    expect(all.rows[0]?.tiers.prism).toBe(1);
    expect(all.rows.every((r) => r.delta === null)).toBe(true);
    expect(all.chase).toMatchObject({ rival: 'dana Tester', rank: 1, points: 331 });

    // This week holds the binge and the friendship; First Entry dates from the 2020 logs.
    const week = await board(erin, 'friends', 'week');
    expect(week.rows[0]?.points).toBe(105);
    expect(week.rows[0]?.delta).toBeNull();

    const danaCabinet = await cabinet(dana);
    expect(danaCabinet.friendsRank).toBe(1);
    const erinCabinet = await cabinet(erin);
    expect(erinCabinet.friendsRank).toBe(2);
    expect(erinCabinet.globalMonthRank).toBeGreaterThanOrEqual(1);
    const polyglot = erinCabinet.trophies.find((t) => t.id === 'polyglot');
    expect(polyglot?.friends).toEqual({
      count: 1,
      sample: [{ username: dana.username, name: 'dana Tester', image: null }],
    });
  });

  it('the global board always places the viewer', async () => {
    const frank = await signUp('frank');
    await completeEveryKind(frank.id);
    const result = await board(frank, 'global', 'all');
    expect(result.population).toBeGreaterThanOrEqual(1);
    const mine = result.rows.find((r) => r.isViewer) ?? result.viewer;
    expect(mine?.points).toBe(240);
    expect(mine?.rank).toBeGreaterThanOrEqual(1);

    const nobody = await signUp('nobody');
    const empty = await board(nobody, 'global', 'week');
    expect(empty.viewer).toMatchObject({ points: 0, isViewer: true });
    expect(empty.rows.some((r) => r.isViewer)).toBe(false);
  });
});
