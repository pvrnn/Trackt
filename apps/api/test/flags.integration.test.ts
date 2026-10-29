import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createDb,
  featureFlagOverrides,
  featureFlags,
  runMigrations,
  users,
  type Db,
} from '@trackt/db';
import { FlagsSnapshotSchema, loadEnv } from '@trackt/shared';
import { createAuth, type Auth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';
import { clearFlagCache } from '../src/lib/flags.js';

/**
 * Postgres-backed feature-flag tests (ADR-0011). Creates and migrates its own
 * `trackt_flags_test` database and self-skips when Postgres is down. The
 * database persists between runs, so every test starts by deleting this
 * suite's rule (its overrides cascade).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_FLAGS ??
  'postgres://trackt:trackt@localhost:5432/trackt_flags_test';

const KEY = 'lists.custom';

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

describe.runIf(available)('feature flags (postgres)', () => {
  let app: App;
  let envApp: App;
  let countryApp: App;
  let db: Db;
  let adminCookie: string;
  let adminId: string;
  let memberCookie: string;
  let memberId: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
    const auth: Auth = createAuth(db, env);

    app = await buildApp({ env, db, auth });
    envApp = await buildApp({
      env: { ...env, FEATURE_FLAGS: `${KEY}=off` },
      db,
      auth,
    });
    countryApp = await buildApp({
      env: { ...env, FLAG_COUNTRY_HEADER: 'cf-ipcountry' },
      db,
      auth,
    });

    const admin = await signUp(app, db, 'flag-admin');
    const member = await signUp(app, db, 'flag-member');
    adminId = admin.id;
    adminCookie = admin.cookie;
    memberId = member.id;
    memberCookie = member.cookie;

    await db.update(users).set({ role: 'admin' }).where(eq(users.id, adminId));
  });

  beforeEach(async () => {
    await db.delete(featureFlags).where(eq(featureFlags.key, KEY));
    clearFlagCache();
  });

  afterAll(async () => {
    await app?.close();
    await envApp?.close();
    await countryApp?.close();
  });

  it('answers every registry key, anonymously, with a revalidating cache header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/flags' });
    expect(response.statusCode).toBe(200);
    const body = FlagsSnapshotSchema.parse(response.json());
    expect(body.flags).toEqual({ [KEY]: true });
    expect(response.headers['cache-control']).toBe('private, max-age=0, must-revalidate');

    const etag = response.headers.etag as string;
    expect(etag).toMatch(/^W\/".+"$/);
    const repeat = await app.inject({
      method: 'GET',
      url: '/api/v1/flags',
      headers: { 'if-none-match': etag },
    });
    expect(repeat.statusCode).toBe(304);
  });

  it('guards the admin surface by session role', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/flags' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/admin/flags',
          headers: { cookie: memberCookie },
        })
      ).statusCode,
    ).toBe(403);

    const adminRead = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/flags',
      headers: { cookie: adminCookie },
    });
    expect(adminRead.statusCode).toBe(200);
    const body = adminRead.json();
    expect(body.flags[0]).toMatchObject({ key: KEY, source: 'default', rule: null });
  });

  it('rejects an unknown key and a bad body', async () => {
    const patch = (url: string, payload: unknown) =>
      app.inject({
        method: 'PATCH',
        url,
        payload: payload as object,
        headers: { cookie: adminCookie },
      });

    expect((await patch('/api/v1/admin/flags/nope.old', { rollout: 0 })).statusCode).toBe(400);
    expect((await patch(`/api/v1/admin/flags/${KEY}`, { rollout: 101 })).statusCode).toBe(400);
    expect((await patch(`/api/v1/admin/flags/${KEY}`, { countries: ['fr'] })).statusCode).toBe(400);
  });

  it('reads a written rule back on the next request, and kills it with the switch', async () => {
    const patch = (payload: unknown) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/flags/${KEY}`,
        payload: payload as object,
        headers: { cookie: adminCookie },
      });

    const dark = await patch({ rollout: 0 });
    expect(dark.statusCode).toBe(200);
    expect(dark.json()).toMatchObject({ source: 'db', anonymous: false, rule: { rollout: 0 } });

    const asMember = FlagsSnapshotSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/flags',
          headers: { cookie: memberCookie },
        })
      ).json(),
    );
    expect(asMember.flags[KEY]).toBe(false);

    await patch({ rollout: 100 });
    const wide = FlagsSnapshotSchema.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/flags' })).json(),
    );
    expect(wide.flags[KEY]).toBe(true);

    await patch({ enabled: false });
    const killed = FlagsSnapshotSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/flags',
          headers: { cookie: memberCookie },
        })
      ).json(),
    );
    expect(killed.flags[KEY]).toBe(false);
  });

  it('flips exactly one user with an override, and lets the kill switch beat it', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/flags/${KEY}/overrides/${memberId}`,
      payload: { enabled: false },
      headers: { cookie: adminCookie },
    });

    const read = async (cookie: string) =>
      FlagsSnapshotSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/flags', headers: { cookie } })).json(),
      ).flags[KEY];

    expect(await read(memberCookie)).toBe(false);
    expect(await read(adminCookie)).toBe(true);

    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/flags/${KEY}`,
      payload: { enabled: false },
      headers: { cookie: adminCookie },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/flags/${KEY}/overrides/${memberId}`,
      payload: { enabled: true },
      headers: { cookie: adminCookie },
    });
    expect(await read(memberCookie)).toBe(false);

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/flags/${KEY}/overrides/${memberId}`,
      headers: { cookie: adminCookie },
    });
    const [override] = await db
      .select()
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.userId, memberId));
    expect(override).toBeUndefined();
  });

  it('deletes a rule back to the compiled default, dropping its overrides', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/flags/${KEY}/overrides/${memberId}`,
      payload: { enabled: false },
      headers: { cookie: adminCookie },
    });
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/flags/${KEY}`,
      headers: { cookie: adminCookie },
    });
    expect(removed.statusCode).toBe(204);

    const body = FlagsSnapshotSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/flags',
          headers: { cookie: memberCookie },
        })
      ).json(),
    );
    expect(body.flags[KEY]).toBe(true);
  });

  it('locks a key owned by FEATURE_FLAGS and reports the source', async () => {
    const write = await envApp.inject({
      method: 'PATCH',
      url: `/api/v1/admin/flags/${KEY}`,
      payload: { rollout: 100 },
      headers: { cookie: adminCookie },
    });
    expect(write.statusCode).toBe(409);
    expect(write.json()).toEqual({ error: 'env-locked' });

    const body = FlagsSnapshotSchema.parse(
      (
        await envApp.inject({
          method: 'GET',
          url: '/api/v1/flags',
          headers: { cookie: memberCookie },
        })
      ).json(),
    );
    expect(body.flags[KEY]).toBe(false);

    const read = await envApp.inject({
      method: 'GET',
      url: '/api/v1/admin/flags',
      headers: { cookie: adminCookie },
    });
    expect(read.json().flags[0]).toMatchObject({ source: 'env', anonymous: false });
  });

  it('admits an allowlisted country and excludes others and the unknown', async () => {
    await countryApp.inject({
      method: 'PATCH',
      url: `/api/v1/admin/flags/${KEY}`,
      payload: { countries: ['FR'], rollout: 100 },
      headers: { cookie: adminCookie },
    });

    const read = async (headers: Record<string, string>) =>
      FlagsSnapshotSchema.parse(
        (
          await countryApp.inject({
            method: 'GET',
            url: '/api/v1/flags',
            headers: { cookie: memberCookie, ...headers },
          })
        ).json(),
      ).flags[KEY];

    expect(await read({ 'cf-ipcountry': 'FR' })).toBe(true);
    expect(await read({ 'cf-ipcountry': 'DE' })).toBe(false);
    expect(await read({ 'cf-ipcountry': 'XX' })).toBe(false);
    expect(await read({})).toBe(false);
  });

  it('gates the lists surface behind the same flag', async () => {
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/flags/${KEY}`,
      payload: { enabled: false },
      headers: { cookie: adminCookie },
    });

    const authed = await app.inject({
      method: 'GET',
      url: '/api/v1/lists',
      headers: { cookie: adminCookie },
    });
    expect(authed.statusCode).toBe(404);

    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/lists' });
    expect(anonymous.statusCode).toBe(404);
  });
});

async function signUp(app: App, db: Db, prefix: string): Promise<{ id: string; cookie: string }> {
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const email = `${prefix}-${stamp}@example.com`;
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: {
      name: prefix,
      username: `${prefix}${stamp}`.replace(/[^a-z0-9]/gi, '').slice(0, 20),
      email,
      password: 'a-strong-password-1',
    },
  });
  if (response.statusCode !== 200) throw new Error(`sign-up failed: ${response.statusCode}`);

  const cookie = (response.headers['set-cookie'] as string[] | string | undefined)
    ?.toString()
    .split(';')[0] as string;
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  return { id: row!.id, cookie };
}
