import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  createDb,
  media,
  mediaPart,
  progress,
  rating,
  runMigrations,
  seedMedia,
  userMedia,
  type Db,
} from '@trackt/db';
import { canonicalMediaId, encodeHistoryCursor, loadEnv, type HistoryPage } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed `/me/history` tests (ADR-0007). Same boilerplate as
 * `tracking.integration.test.ts`: its own database, self-skipping when Postgres
 * is down.
 *
 * The fixtures write `user_media` rows straight through `db` rather than driving
 * the API, because every interesting case is about *dates in the past* and
 * there is no other way to get a 2024 finish date without a clock shim.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_HISTORY ??
  'postgres://trackt:trackt@localhost:5432/trackt_history_test';

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

const bebopId = canonicalMediaId('anime', 1); // anime, 26 episodes in the seed
const frierenId = canonicalMediaId('anime', 154587); // anime
const matrixId = canonicalMediaId('movie', 603); // movie
const onePieceId = canonicalMediaId('manga', 30013); // manga

describe.runIf(available)('me/history (postgres)', () => {
  let app: App;
  let db: Db;
  let cookie: string;
  let userId: string;

  /** One log row, dated by hand. `null` dates mean "no evidence" — a watchlist row. */
  async function log(
    mediaId: string,
    status: 'planned' | 'in_progress' | 'completed' | 'dropped' | 'paused',
    startedAt: string | null,
    finishedAt: string | null,
  ): Promise<void> {
    await db
      .insert(userMedia)
      .values({ userId, mediaId, status, startedAt, finishedAt })
      .onConflictDoUpdate({
        target: [userMedia.userId, userMedia.mediaId],
        set: { status, startedAt, finishedAt },
      });
  }

  /** A check-in on a given day, for the totals that come from `progress`. */
  async function checkIn(mediaId: string, number: number, day: string): Promise<void> {
    await db
      .insert(mediaPart)
      .values({ mediaId, kind: 'episode', number: String(number) })
      .onConflictDoNothing();
    const [part] = await db
      .select({ id: mediaPart.id })
      .from(mediaPart)
      .where(sql`${mediaPart.mediaId} = ${mediaId} AND ${mediaPart.number} = ${String(number)}`);
    await db
      .insert(progress)
      .values({ userId, partId: part!.id, watchedAt: new Date(`${day}T12:00:00Z`) })
      .onConflictDoNothing();
  }

  async function history(query = '', authed = true): Promise<HistoryPage> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/me/history${query}`,
      headers: authed ? { cookie } : {},
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }

  const titles = (page: HistoryPage) => page.entries.map((entry) => entry.title);

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    // The test database persists between runs; stale rows would leak into the facets.
    await db.delete(progress);
    await db.delete(rating);
    await db.delete(userMedia);
    await db.update(media).set({ deletedAt: null });

    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });

    const stamp = Date.now();
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: 'History Tester',
        username: `histor${stamp}`.slice(0, 20),
        email: `history-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(signUp.statusCode).toBe(200);
    userId = signUp.json().user.id;
    cookie = (signUp.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;

    // Bebop spans New Year: started 2025, finished 2026.
    await log(bebopId, 'completed', '2025-12-20', '2026-01-11');
    // Frieren is open — it files under its start.
    await log(frierenId, 'in_progress', '2026-04-19', null);
    // A film, finished the day it started, in a different quarter.
    await log(matrixId, 'completed', '2026-07-04', '2026-07-04');
    // A watchlist entry: no dates, and it must never appear.
    await log(onePieceId, 'planned', null, null);

    await checkIn(bebopId, 1, '2025-12-20');
    await checkIn(bebopId, 2, '2026-01-11');
    await checkIn(frierenId, 1, '2026-04-19');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('files a work spanning New Year under its finish year only', async () => {
    expect(titles(await history('?year=2026'))).toContain('Cowboy Bebop');
    expect(titles(await history('?year=2025'))).not.toContain('Cowboy Bebop');
  });

  it('files an open work under its start date', async () => {
    const page = await history('?year=2026');
    const frieren = page.entries.find((entry) => entry.id === frierenId);
    expect(frieren).toMatchObject({ loggedOn: '2026-04-19', finishedAt: null });
  });

  it('never lists a planned row — a watchlist is not a history', async () => {
    const all = await history();
    expect(all.entries.map((entry) => entry.id)).not.toContain(onePieceId);
    expect(all.years.every((year) => year.year >= 2025)).toBe(true);
  });

  it('orders newest-filed first', async () => {
    const page = await history('?year=2026');
    const dates = page.entries.map((entry) => entry.loggedOn);
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates);
  });

  it('narrows to an anime quarter, and rejects a season without a year', async () => {
    // Summer 2026 holds the film (04 JUL) and nothing else.
    expect(titles(await history('?year=2026&season=summer'))).toEqual(['The Matrix']);
    // Winter 2026 holds Bebop's 11 JAN finish.
    expect(titles(await history('?year=2026&season=winter'))).toEqual(['Cowboy Bebop']);
    expect(titles(await history('?year=2026&season=autumn'))).toEqual([]);

    const orphan = await app.inject({
      method: 'GET',
      url: '/api/v1/me/history?season=spring',
      headers: { cookie },
    });
    expect(orphan.statusCode).toBe(400);
  });

  it('composes the kind and status filters', async () => {
    expect(titles(await history('?year=2026&kind=movie'))).toEqual(['The Matrix']);
    expect(
      (await history('?year=2026&kind=anime&status=in_progress')).entries.map((e) => e.id),
    ).toEqual([frierenId]);
    expect(titles(await history('?year=2026&kind=movie&status=in_progress'))).toEqual([]);
  });

  it('lists every year in `years`, ignoring the year filter but honouring kind', async () => {
    const page = await history('?year=2026');
    // Bebop files under 2026, but Frieren's 2026 start and the film are there too;
    // 2025 exists only if something files there — nothing does, by design.
    expect(page.years.map((year) => year.year)).toEqual([2026]);
    expect(page.years[0]!.count).toBe(3);

    const movies = await history('?year=2026&kind=movie');
    expect(movies.years).toEqual([{ year: 2026, count: 1 }]);
  });

  it('counts check-ins in the window, not parts of the titles listed', async () => {
    // Bebop is filed under 2026 but one of its two check-ins happened in 2025:
    // the strip's two halves are allowed to disagree, and this is why.
    const page2026 = await history('?year=2026');
    expect(page2026.totals).toMatchObject({ titles: 3, completed: 2, episodes: 2, chapters: 0 });

    const page2025 = await history('?year=2025');
    expect(page2025.totals).toMatchObject({ titles: 0, episodes: 1 });

    const allTime = await history();
    expect(allTime.totals.episodes).toBe(3);

    // …and the counts follow the kind tab: a strip reading "3 EPISODES" under a
    // MOVIES filter would just be wrong.
    expect((await history('?kind=movie')).totals.episodes).toBe(0);
  });

  it('pages with a cursor, without gaps or repeats', async () => {
    const first = await history('?limit=2');
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await history(`?limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.nextCursor).toBeNull();

    const paged = [...first.entries, ...second.entries].map((entry) => entry.id);
    const whole = (await history()).entries.map((entry) => entry.id);
    expect(paged).toEqual(whole);
    expect(new Set(paged).size).toBe(paged.length);
  });

  it('400s on a tampered cursor rather than restarting the list', async () => {
    for (const cursor of [
      'not-base64!!',
      encodeHistoryCursor({ loggedOn: 'nope', mediaId: '1' }),
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/me/history?cursor=${encodeURIComponent(cursor)}`,
        headers: { cookie },
      });
      expect(response.statusCode, cursor).toBe(400);
    }
  });

  it('drops a soft-deleted title while its log row survives', async () => {
    await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, matrixId));
    try {
      expect(titles(await history('?year=2026'))).not.toContain('The Matrix');
      const [row] = await db
        .select({ mediaId: userMedia.mediaId })
        .from(userMedia)
        .where(eq(userMedia.mediaId, matrixId));
      expect(row).toBeDefined();
    } finally {
      await db.update(media).set({ deletedAt: null }).where(eq(media.id, matrixId));
    }
  });

  it('401s without a cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/history' });
    expect(response.statusCode).toBe(401);
  });
});

describe.runIf(!available)('me/history (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
