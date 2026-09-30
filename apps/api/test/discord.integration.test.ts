import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createDb,
  discordLinkCode,
  hashLinkCode,
  issueLinkCode,
  runMigrations,
  type Db,
} from '@trackt/db';
import { loadEnv, type DiscordLinkStatus } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed Discord linking tests (own `trackt_discord_link_test` db,
 * self-skips without Docker). The bot's side of the handshake — issuing a
 * code — is called directly, as the bot would.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_DISCORD_LINK ??
  'postgres://trackt:trackt@localhost:5432/trackt_discord_link_test';

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

function discordId(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
}

describe.runIf(available)('discord linking (postgres)', () => {
  let app: App;
  let db: Db;

  async function signUp(prefix: string): Promise<string> {
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: `${prefix} Tester`,
        username: `${prefix}${stamp}`.slice(0, 20),
        email: `${prefix}-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(response.statusCode).toBe(200);
    return (response.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
  }

  function status(cookie: string) {
    return app.inject({ method: 'GET', url: '/api/v1/me/discord', headers: { cookie } });
  }

  function preview(cookie: string | undefined, code: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/me/discord/link-code?code=${code}`,
      headers: cookie ? { cookie } : undefined,
    });
  }

  function link(cookie: string, code: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/me/discord/link',
      headers: { cookie },
      payload: { code },
    });
  }

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('previews, redeems once, and reports the link', async () => {
    const cookie = await signUp('linker');
    const id = discordId();
    const { code } = await issueLinkCode(db, { discordUserId: id, discordUsername: 'linker#1' });

    expect((await status(cookie)).json()).toEqual({ linked: null });
    const peek = await preview(cookie, code);
    expect(peek.statusCode).toBe(200);
    expect(peek.json()).toMatchObject({ discordUsername: 'linker#1' });

    const linked = await link(cookie, code);
    expect(linked.statusCode).toBe(200);
    expect(linked.json<DiscordLinkStatus>().linked).toMatchObject({
      discordUserId: id,
      discordUsername: 'linker#1',
    });
    expect((await status(cookie)).json<DiscordLinkStatus>().linked?.discordUserId).toBe(id);

    expect((await link(cookie, code)).statusCode).toBe(404);
    expect((await preview(cookie, code)).statusCode).toBe(404);
  });

  it('requires a session', async () => {
    const { code } = await issueLinkCode(db, { discordUserId: discordId(), discordUsername: 'x' });
    expect((await preview(undefined, code)).statusCode).toBe(401);
  });

  it('rejects an expired code', async () => {
    const cookie = await signUp('late');
    const { code } = await issueLinkCode(db, { discordUserId: discordId(), discordUsername: 'x' });
    await db
      .update(discordLinkCode)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(discordLinkCode.codeHash, hashLinkCode(code)));
    expect((await link(cookie, code)).statusCode).toBe(404);
  });

  it('only honours the newest code a Discord user asked for', async () => {
    const cookie = await signUp('twice');
    const identity = { discordUserId: discordId(), discordUsername: 'twice' };
    const first = await issueLinkCode(db, identity);
    const second = await issueLinkCode(db, identity);
    expect((await link(cookie, first.code)).statusCode).toBe(404);
    expect((await link(cookie, second.code)).statusCode).toBe(200);
  });

  it('moves a Discord account to whichever Trackt account redeemed last', async () => {
    const first = await signUp('first');
    const second = await signUp('second');
    const identity = { discordUserId: discordId(), discordUsername: 'shared' };

    await link(first, (await issueLinkCode(db, identity)).code);
    await link(second, (await issueLinkCode(db, identity)).code);

    expect((await status(first)).json()).toEqual({ linked: null });
    expect((await status(second)).json<DiscordLinkStatus>().linked?.discordUserId).toBe(
      identity.discordUserId,
    );
  });

  it('replaces the Discord account a Trackt account was linked to', async () => {
    const cookie = await signUp('relink');
    await link(
      cookie,
      (await issueLinkCode(db, { discordUserId: discordId(), discordUsername: 'old' })).code,
    );
    const fresh = discordId();
    await link(
      cookie,
      (await issueLinkCode(db, { discordUserId: fresh, discordUsername: 'new' })).code,
    );
    expect((await status(cookie)).json<DiscordLinkStatus>().linked).toMatchObject({
      discordUserId: fresh,
      discordUsername: 'new',
    });
  });

  it('unlinks', async () => {
    const cookie = await signUp('unlink');
    await link(
      cookie,
      (await issueLinkCode(db, { discordUserId: discordId(), discordUsername: 'u' })).code,
    );
    const removed = await app.inject({
      method: 'DELETE',
      url: '/api/v1/me/discord',
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(204);
    expect((await status(cookie)).json()).toEqual({ linked: null });
  });

  it('rejects a malformed code before touching the database', async () => {
    const cookie = await signUp('bad');
    expect((await link(cookie, 'not-a-code')).statusCode).toBe(400);
  });
});
