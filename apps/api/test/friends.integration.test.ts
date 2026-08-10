import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createDb, runMigrations, seedMedia, type Db } from '@trackt/db';
import {
  loadEnv,
  type FriendsOverview,
  type PublicProfile,
  type UserSearchResult,
} from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed friends tests (own `trackt_friends_test` db, self-skips
 * without Docker). Three users throughout — alice, bob, carol — because half
 * the assertions are "the third party sees nothing".
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_FRIENDS ??
  'postgres://trackt:trackt@localhost:5432/trackt_friends_test';

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
  /** Raw-cased handle, as returned by sign-up — what a client would send back. */
  username: string;
}

describe.runIf(available)('friends (postgres)', () => {
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

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });
  });

  afterAll(async () => {
    await app?.close();
  });

  function sendRequest(cookie: string, username: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/me/friends/requests',
      headers: { cookie },
      payload: { username },
    });
  }

  function accept(cookie: string, userId: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/me/friends/requests/${userId}/accept`,
      headers: { cookie },
    });
  }

  function remove(cookie: string, userId: string) {
    return app.inject({
      method: 'DELETE',
      url: `/api/v1/me/friends/${userId}`,
      headers: { cookie },
    });
  }

  function overview(cookie: string) {
    return app.inject({ method: 'GET', url: '/api/v1/me/friends', headers: { cookie } });
  }

  function searchUsers(cookie: string, q: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/users/search?q=${encodeURIComponent(q)}`,
      headers: { cookie },
    });
  }

  function publicProfile(cookie: string | undefined, username: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/users/${username}/profile`,
      headers: cookie ? { cookie } : undefined,
    });
  }

  it('request creates outgoing/incoming and a third party sees neither', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const carol = await signUp('carol');

    const request = await sendRequest(alice.cookie, bob.username);
    expect(request.statusCode).toBe(200);
    expect(request.json()).toMatchObject({ friendState: 'outgoing' });

    const aliceOverview = (await overview(alice.cookie)).json() as FriendsOverview;
    expect(aliceOverview.outgoing.map((u) => u.id)).toContain(bob.id);
    expect(aliceOverview.friends).toEqual([]);

    const bobOverview = (await overview(bob.cookie)).json() as FriendsOverview;
    expect(bobOverview.incoming.map((u) => u.id)).toContain(alice.id);

    const carolOverview = (await overview(carol.cookie)).json() as FriendsOverview;
    expect(carolOverview.incoming).toEqual([]);
    expect(carolOverview.outgoing).toEqual([]);
  });

  it('accept makes both sides friends', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    await sendRequest(alice.cookie, bob.username);
    const accepted = await accept(bob.cookie, alice.id);
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ id: alice.id });

    expect(
      ((await overview(alice.cookie)).json() as FriendsOverview).friends.map((u) => u.id),
    ).toContain(bob.id);
    expect(
      ((await overview(bob.cookie)).json() as FriendsOverview).friends.map((u) => u.id),
    ).toContain(alice.id);
  });

  it('a reverse request auto-accepts instead of creating a second row', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    await sendRequest(alice.cookie, bob.username);
    const reverse = await sendRequest(bob.cookie, alice.username);
    expect(reverse.statusCode).toBe(200);
    expect(reverse.json()).toMatchObject({ friendState: 'friends' });

    const [row] = await db.execute(sql`
      SELECT count(*)::int AS count FROM friendship
      WHERE user_a_id = LEAST(${alice.id}::uuid, ${bob.id}::uuid)
        AND user_b_id = GREATEST(${alice.id}::uuid, ${bob.id}::uuid)
    `);
    expect(Number(row!.count)).toBe(1);
  });

  it('a duplicate request is idempotent', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    const first = await sendRequest(alice.cookie, bob.username);
    expect(first.statusCode).toBe(200);
    const second = await sendRequest(alice.cookie, bob.username);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ friendState: 'outgoing' });
  });

  it('decline deletes the row and a re-request works', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    await sendRequest(alice.cookie, bob.username);
    expect((await remove(bob.cookie, alice.id)).statusCode).toBe(204);
    expect(((await overview(alice.cookie)).json() as FriendsOverview).outgoing).toEqual([]);

    const again = await sendRequest(alice.cookie, bob.username);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ friendState: 'outgoing' });
  });

  it('deleting after accept unfriends both directions', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    await sendRequest(alice.cookie, bob.username);
    await accept(bob.cookie, alice.id);
    expect((await remove(alice.cookie, bob.id)).statusCode).toBe(204);

    expect(((await overview(alice.cookie)).json() as FriendsOverview).friends).toEqual([]);
    expect(((await overview(bob.cookie)).json() as FriendsOverview).friends).toEqual([]);
  });

  it('rejects an unknown handle and an unauthenticated call', async () => {
    const alice = await signUp('alice');

    const unknown = await sendRequest(alice.cookie, 'no-such-user-handle');
    expect(unknown.statusCode).toBe(404);

    const noCookie = await app.inject({
      method: 'POST',
      url: '/api/v1/me/friends/requests',
      payload: { username: 'no-such-user-handle' },
    });
    expect(noCookie.statusCode).toBe(401);
  });

  it('rejects requesting yourself', async () => {
    const alice = await signUp('alice');
    const selfRequest = await sendRequest(alice.cookie, alice.username);
    expect(selfRequest.statusCode).toBe(400);
  });

  it('caps outgoing requests at FRIEND_REQUEST_PENDING_MAX', async () => {
    const alice = await signUp('alice');
    // 50 is the cap; seed 50 outgoing requests via a raw insert (an HTTP round
    // trip per target would sign up 50 accounts for one assertion).
    const targets = await Promise.all(Array.from({ length: 50 }, (_, i) => signUp(`cap${i}`)));
    for (const target of targets) {
      await db.execute(sql`
        INSERT INTO friendship (user_a_id, user_b_id, requested_by, status)
        VALUES (LEAST(${alice.id}::uuid, ${target.id}::uuid),
                GREATEST(${alice.id}::uuid, ${target.id}::uuid),
                ${alice.id}::uuid, 'pending')
      `);
    }

    const oneMore = await signUp('capOverflow');
    const capped = await sendRequest(alice.cookie, oneMore.username);
    expect(capped.statusCode).toBe(429);
  });

  it('users/search matches a handle prefix, excludes self, and reports friendState', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');

    const results = (await searchUsers(alice.cookie, bob.username)).json() as UserSearchResult[];
    expect(results.map((r) => r.id)).toContain(bob.id);
    expect(results.some((r) => r.id === alice.id)).toBe(false);
    expect(results.find((r) => r.id === bob.id)!.friendState).toBe('none');

    await sendRequest(alice.cookie, bob.username);
    const afterRequest = (
      await searchUsers(alice.cookie, bob.username)
    ).json() as UserSearchResult[];
    expect(afterRequest.find((r) => r.id === bob.id)!.friendState).toBe('outgoing');
  });

  it('serves a public profile anonymously and reports the viewer-relative friendState', async () => {
    const alice = await signUp('alice');
    const bob = await signUp('bob');
    const carol = await signUp('carol');
    await sendRequest(alice.cookie, bob.username);
    await accept(bob.cookie, alice.id);

    const anon = await publicProfile(undefined, alice.username);
    expect(anon.statusCode).toBe(200);
    const anonBody = anon.json() as PublicProfile;
    expect(anonBody.user.username).toBe(alice.username);
    expect(anonBody.friendState).toBe('none');
    expect(anonBody.friendCount).toBe(1);
    // The friend buttons on /users/$username post to /me/friends/:userId, so
    // this has to be the *subject's* id, not the viewer's.
    expect(anonBody.userId).toBe(alice.id);

    const asFriend = (await publicProfile(bob.cookie, alice.username)).json() as PublicProfile;
    expect(asFriend.friendState).toBe('friends');

    const asStranger = (await publicProfile(carol.cookie, alice.username)).json() as PublicProfile;
    expect(asStranger.friendState).toBe('none');

    const asSelf = (await publicProfile(alice.cookie, alice.username)).json() as PublicProfile;
    expect(asSelf.friendState).toBe('self');

    expect((await publicProfile(undefined, 'no-such-user-handle')).statusCode).toBe(404);
  });
});
