import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDb,
  progress,
  rating,
  runMigrations,
  seedMedia,
  userMedia,
  type Db,
} from '@trackt/db';
import { canonicalMediaId, loadEnv, type MediaDetail } from '@trackt/shared';
import { createAuth } from './auth.js';
import { buildApp, type App } from './app.js';

/**
 * Postgres-backed media-detail + tracking tests against the dev compose database
 * (`docker compose -f docker-compose.dev.yml up -d`). Creates and migrates its own
 * `trackt_tracking_test` database and self-skips when Postgres is down, so
 * `pnpm test` stays green without Docker. Auth flows go through the real
 * better-auth endpoints (sign-up → session cookie).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_TRACKING ??
  'postgres://trackt:trackt@localhost:5432/trackt_tracking_test';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt';
  const admin = postgres(adminUrl.href, { max: 1, connect_timeout: 3 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

const available = await ensureTestDatabase();

const bebopId = canonicalMediaId('anime', 1); // Cowboy Bebop, 26 episodes in the seed
const matrixId = canonicalMediaId('movie', 603);
const frierenId = canonicalMediaId('anime', 154587);

describe.runIf(available)('media detail + tracking (postgres)', () => {
  let app: App;
  let db: Db;
  let cookie: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    // Tracking rows from previous runs would skew community stats.
    await db.delete(progress);
    await db.delete(rating);
    await db.delete(userMedia);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });

    // Unique per run — the test database persists between runs.
    const stamp = Date.now();
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: 'Track Tester',
        username: `tracker${stamp}`.slice(0, 20),
        email: `tracker-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(signUp.statusCode).toBe(200);
    cookie = (signUp.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
    expect(cookie).toContain('better-auth');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function getDetail(idOrSlug: string, authed = true): Promise<MediaDetail> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/media/${idOrSlug}`,
      headers: authed ? { cookie } : {},
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('serves the detail by slug and by id, anonymous viewer null', async () => {
    const bySlug = await getDetail('cowboy-bebop-1998', false);
    expect(bySlug).toMatchObject({ id: bebopId, kind: 'anime', episodeCount: 26, viewer: null });
    expect(bySlug.community).toEqual({ averageScore: null, ratingCount: 0 });
    const byId = await getDetail(bebopId, false);
    expect(byId.slug).toBe('cowboy-bebop-1998');
  });

  it('suggests same-kind related titles by genre overlap', async () => {
    const detail = await getDetail('cowboy-bebop-1998', false);
    expect(detail.related.length).toBeGreaterThan(0);
    for (const item of detail.related) {
      expect(item.kind).toBe('anime');
      expect(item.id).not.toBe(bebopId);
    }
  });

  it('404s on unknown slugs', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/media/not-a-thing' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects tracking mutations without a session', async () => {
    for (const [method, url, payload] of [
      ['PUT', `/api/v1/media/${bebopId}/log`, { status: 'planned' }],
      ['PUT', `/api/v1/media/${bebopId}/rating`, { score: 8 }],
      ['PUT', `/api/v1/media/${bebopId}/progress/1`, undefined],
      ['DELETE', `/api/v1/media/${bebopId}/progress/1`, undefined],
    ] as const) {
      const response = await app.inject({ method, url, payload });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('upserts and clears the log status', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'planned' },
    });
    expect(put.statusCode).toBe(200);
    expect((await getDetail(bebopId)).viewer?.status).toBe('planned');

    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'completed' },
    });
    expect((await getDetail(bebopId)).viewer?.status).toBe('completed');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect((await getDetail(bebopId)).viewer?.status).toBeNull();
  });

  it('upserts ratings, reflects them in community stats, validates the scale', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/rating`,
      headers: { cookie },
      payload: { score: 8.5 },
    });
    expect(put.statusCode).toBe(200);
    const detail = await getDetail(bebopId);
    expect(detail.viewer?.score).toBe(8.5);
    expect(detail.community).toEqual({ averageScore: 8.5, ratingCount: 1 });

    for (const score of [10.5, -1, 7.3]) {
      const bad = await app.inject({
        method: 'PUT',
        url: `/api/v1/media/${bebopId}/rating`,
        headers: { cookie },
        payload: { score },
      });
      expect(bad.statusCode, `score ${score}`).toBe(400);
    }

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${bebopId}/rating`,
      headers: { cookie },
    });
    const cleared = await getDetail(bebopId);
    expect(cleared.viewer?.score).toBeNull();
    expect(cleared.community.ratingCount).toBe(0);
  });

  it('checks in episodes idempotently with lazy part creation and auto-log', async () => {
    for (const number of [1, 2, 1]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/media/${frierenId}/progress/${number}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
    }
    const detail = await getDetail(frierenId);
    expect(detail.viewer?.watched).toEqual([1, 2]);
    // First check-in on an unlogged work starts the log.
    expect(detail.viewer?.status).toBe('in_progress');

    const uncheck = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${frierenId}/progress/1`,
      headers: { cookie },
    });
    expect(uncheck.statusCode).toBe(200);
    expect((await getDetail(frierenId)).viewer?.watched).toEqual([2]);
  });

  it('keeps an existing status when checking in', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'paused' },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/progress/5`,
      headers: { cookie },
    });
    expect((await getDetail(bebopId)).viewer?.status).toBe('paused');
  });

  it('rejects out-of-range numbers and movie check-ins', async () => {
    const tooHigh = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/progress/27`,
      headers: { cookie },
    });
    expect(tooHigh.statusCode).toBe(400);

    const movie = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${matrixId}/progress/1`,
      headers: { cookie },
    });
    expect(movie.statusCode).toBe(400);
  });
});

describe.runIf(!available)('media detail + tracking (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
