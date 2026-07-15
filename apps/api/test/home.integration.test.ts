import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, seedMedia, type Db } from '@trackt/db';
import { canonicalMediaId, loadEnv, type HomeSummary } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed home-dashboard tests against the dev compose database
 * (`docker compose -f docker-compose.dev.yml up -d`). Creates and migrates its
 * own `trackt_home_test` database and self-skips when Postgres is down. Every
 * run signs up a fresh user, so summaries start empty without table cleanup.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_HOME ?? 'postgres://trackt:trackt@localhost:5432/trackt_home_test';

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

const bebopId = canonicalMediaId('anime', 1); // 26 episodes
const berserkId = canonicalMediaId('manga', 30002); // 380 chapters
const matrixId = canonicalMediaId('movie', 603);

describe.runIf(available)('GET /api/v1/me/home (postgres)', () => {
  let app: App;
  let db: Db;
  let cookie: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });

    const stamp = Date.now();
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: 'Home Tester',
        username: `homer${stamp}`.slice(0, 20),
        email: `home-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(signUp.statusCode).toBe(200);
    cookie = (signUp.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function getSummary(): Promise<HomeSummary> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me/home',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function track(method: 'PUT', url: string, payload?: object): Promise<void> {
    const response = await app.inject({ method, url, headers: { cookie }, payload });
    expect(response.statusCode, url).toBe(200);
  }

  it('requires a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/home' });
    expect(response.statusCode).toBe(401);
  });

  it('starts empty for a fresh account', async () => {
    const summary = await getSummary();
    expect(summary).toEqual({
      upNext: [],
      inProgress: [],
      activity: [],
      stats: { episodesThisYear: 0, chaptersThisYear: 0, dayStreak: 0, completedThisYear: 0 },
    });
  });

  it('reflects check-ins, ratings, and statuses across all sections', async () => {
    // Bebop: check in E1+E2 (auto in_progress); Berserk: log + CH1; Matrix: completed + rating.
    await track('PUT', `/api/v1/media/${bebopId}/progress/1`);
    await track('PUT', `/api/v1/media/${bebopId}/progress/2`);
    await track('PUT', `/api/v1/media/${berserkId}/log`, { status: 'in_progress' });
    await track('PUT', `/api/v1/media/${berserkId}/progress/1`);
    await track('PUT', `/api/v1/media/${matrixId}/log`, { status: 'completed' });
    await track('PUT', `/api/v1/media/${matrixId}/rating`, { score: 9 });

    const summary = await getSummary();

    expect(summary.upNext).toHaveLength(2);
    const bebopNext = summary.upNext.find((entry) => entry.id === bebopId);
    expect(bebopNext).toMatchObject({ next: 3, total: 26, partKind: 'episode' });
    const berserkNext = summary.upNext.find((entry) => entry.id === berserkId);
    expect(berserkNext).toMatchObject({ next: 2, total: 380, partKind: 'chapter' });

    // Completed Matrix is not "in progress"; the two active titles are.
    expect(summary.inProgress.map((entry) => entry.id).sort()).toEqual([bebopId, berserkId].sort());
    const bebopShelf = summary.inProgress.find((entry) => entry.id === bebopId);
    expect(bebopShelf).toMatchObject({ watched: 2, total: 26 });

    expect(summary.stats).toEqual({
      episodesThisYear: 2,
      chaptersThisYear: 1,
      dayStreak: 1,
      completedThisYear: 1,
    });

    // Newest-first, capped at 6, and containing each verb.
    const ats = summary.activity.map((entry) => entry.at);
    expect([...ats].sort().reverse()).toEqual(ats);
    expect(summary.activity.length).toBeLessThanOrEqual(6);
    const verbs = new Set(summary.activity.map((entry) => entry.verb));
    expect(verbs).toContain('rated');
    expect(verbs).toContain('checked_in');
  });

  it('drops fully-watched titles from up next but keeps them in progress', async () => {
    const frierenId = canonicalMediaId('anime', 154587); // 28 episodes
    for (let episode = 1; episode <= 28; episode++) {
      await track('PUT', `/api/v1/media/${frierenId}/progress/${episode}`);
    }
    const summary = await getSummary();
    expect(summary.upNext.map((entry) => entry.id)).not.toContain(frierenId);
    expect(summary.inProgress.find((entry) => entry.id === frierenId)).toMatchObject({
      watched: 28,
      total: 28,
    });
  });
});

describe.runIf(!available)('GET /api/v1/me/home (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
