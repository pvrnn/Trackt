import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, media, runMigrations, seedMedia, type Db } from '@trackt/db';
import { canonicalMediaId, loadEnv, type MediaDetail, type ProfileSummary } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed profile + favourites tests (own `trackt_profile_test` db,
 * self-skips without Docker, fresh user per run — same pattern as the other
 * integration suites).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_PROFILE ??
  'postgres://trackt:trackt@localhost:5432/trackt_profile_test';

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

const bebopId = canonicalMediaId('anime', 1);
const frierenId = canonicalMediaId('anime', 154587);
const berserkId = canonicalMediaId('manga', 30002);

describe.runIf(available)('profile + favourites (postgres)', () => {
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
        name: 'Profile Tester',
        username: `prof${stamp}`.slice(0, 20),
        email: `profile-${stamp}@example.com`,
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

  async function getProfile(): Promise<ProfileSummary> {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me/profile',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('requires a session for the profile and favourite mutations', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/me/profile' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'PUT', url: `/api/v1/media/${bebopId}/favorite` })).statusCode,
    ).toBe(401);
  });

  it('serves identity and zeroed stats for a fresh account', async () => {
    const profile = await getProfile();
    expect(profile.user.name).toBe('Profile Tester');
    expect(profile.user.username).toMatch(/^prof/);
    expect(profile.stats).toMatchObject({ completed: 0, titlesTracked: 0, meanRating: null });
    expect(profile.favorites).toEqual([]);
  });

  it('ranks favourites per kind in insertion order, idempotently', async () => {
    for (const id of [bebopId, berserkId, frierenId, bebopId]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/media/${id}/favorite`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
    }
    const profile = await getProfile();
    expect(
      profile.favorites.map((entry) => ({ id: entry.id, kind: entry.kind, rank: entry.rank })),
    ).toEqual([
      { id: bebopId, kind: 'anime', rank: 1 },
      { id: frierenId, kind: 'anime', rank: 2 },
      { id: berserkId, kind: 'manga', rank: 1 },
    ]);
  });

  it('exposes favourited state on the media detail and removes cleanly', async () => {
    const detail = async (): Promise<MediaDetail> => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/media/${bebopId}`,
        headers: { cookie },
      });
      return response.json();
    };
    expect((await detail()).viewer?.favorited).toBe(true);

    const remove = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${bebopId}/favorite`,
      headers: { cookie },
    });
    expect(remove.statusCode).toBe(200);
    expect((await detail()).viewer?.favorited).toBe(false);
    // Frieren moves up to rank 1 in the anime shelf? No — ranks are recomputed
    // from position order on read, so it becomes the sole anime favourite.
    const profile = await getProfile();
    expect(profile.favorites.filter((entry) => entry.kind === 'anime')).toEqual([
      expect.objectContaining({ id: frierenId, rank: 1 }),
    ]);
  });

  it('hides soft-deleted media from the favourites shelves (the row stays)', async () => {
    const before = await getProfile();
    expect(before.favorites.map((entry) => entry.id)).toContain(frierenId);
    try {
      await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, frierenId));
      const profile = await getProfile();
      expect(profile.favorites.map((entry) => entry.id)).not.toContain(frierenId);
    } finally {
      await db.update(media).set({ deletedAt: null }).where(eq(media.id, frierenId));
    }
    // Back in circulation, the favourite row was never touched.
    const restored = await getProfile();
    expect(restored.favorites.map((entry) => entry.id)).toContain(frierenId);
  });

  it('updates display name and bio via PATCH, rejects empty updates', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { cookie },
      payload: { name: 'Renamed Tester', bio: 'Tracks everything.' },
    });
    expect(patch.statusCode).toBe(200);
    const profile = await getProfile();
    expect(profile.user).toMatchObject({ name: 'Renamed Tester', bio: 'Tracks everything.' });

    const clearBio = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { cookie },
      payload: { bio: null },
    });
    expect(clearBio.statusCode).toBe(200);
    expect((await getProfile()).user.bio).toBeNull();

    const empty = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { cookie },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
    const blankName = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { cookie },
      payload: { name: '   ' },
    });
    expect(blankName.statusCode).toBe(400);
  });

  it('stores, replaces, and validates social links', async () => {
    const set = await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { cookie },
      payload: {
        socialLinks: {
          x: 'https://x.com/tracktester',
          anilist: 'https://anilist.co/user/tracktester',
        },
      },
    });
    expect(set.statusCode).toBe(200);
    expect((await getProfile()).user.socialLinks).toEqual({
      x: 'https://x.com/tracktester',
      anilist: 'https://anilist.co/user/tracktester',
    });

    // Full replacement: omitting a platform unlinks it.
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/me/profile',
      headers: { cookie },
      payload: { socialLinks: { website: 'https://paulv.dev' } },
    });
    expect((await getProfile()).user.socialLinks).toEqual({ website: 'https://paulv.dev' });

    for (const socialLinks of [
      { x: 'http://x.com/insecure' }, // https only
      { x: 'not a url' },
      { myspace: 'https://myspace.com/tom' }, // unknown platform
    ]) {
      const bad = await app.inject({
        method: 'PATCH',
        url: '/api/v1/me/profile',
        headers: { cookie },
        payload: { socialLinks },
      });
      expect(bad.statusCode, JSON.stringify(socialLinks)).toBe(400);
    }
  });

  it('uploads, serves, and removes an avatar', async () => {
    // 1×1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const boundary = '----trackt-test-boundary';
    const multipart = (filename: string, mime: string, body: Buffer) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${mime}\r\n\r\n`,
        ),
        body,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

    const upload = await app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart('avatar.png', 'image/png', png),
    });
    expect(upload.statusCode).toBe(200);
    const { image } = upload.json();
    expect(image).toMatch(/^\/uploads\/avatars\/.+\.png$/);
    expect((await getProfile()).user.image).toBe(image);

    const served = await app.inject({ method: 'GET', url: image });
    expect(served.statusCode).toBe(200);
    expect(served.rawPayload.equals(png)).toBe(true);

    const badType = await app.inject({
      method: 'POST',
      url: '/api/v1/me/avatar',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: multipart('avatar.gif', 'image/gif', png),
    });
    expect(badType.statusCode).toBe(400);

    const remove = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/avatar',
      headers: { cookie },
    });
    expect(remove.statusCode).toBe(200);
    expect((await getProfile()).user.image).toBeNull();
    // The stored file is gone too.
    expect((await app.inject({ method: 'GET', url: image })).statusCode).toBe(404);
  });

  it('aggregates tracking stats and mean rating', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'completed' },
    });
    for (const [id, score] of [
      [bebopId, 8],
      [berserkId, 9],
    ] as const) {
      await app.inject({
        method: 'PUT',
        url: `/api/v1/media/${id}/rating`,
        headers: { cookie },
        payload: { score },
      });
    }
    const profile = await getProfile();
    expect(profile.stats).toMatchObject({ completed: 1, titlesTracked: 1, meanRating: 8.5 });
    expect(profile.activity.length).toBeGreaterThan(0);
  });
});

describe.runIf(!available)('profile + favourites (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
