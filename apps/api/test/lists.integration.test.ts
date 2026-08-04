import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb, list, media, runMigrations, seedId, seedMedia, type Db } from '@trackt/db';
import { loadEnv, type ListDetail, type ListSummary } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed lists tests (own `trackt_lists_test` db, self-skips without
 * Docker). Two users throughout: lists are the first feature where one account's
 * data is deliberately reachable by another, so isolation and the two composed
 * visibility rules are the point of most of these cases.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_LISTS ??
  'postgres://trackt:trackt@localhost:5432/trackt_lists_test';

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

const matrixId = seedId('the-matrix-1999');
const bebopId = seedId('cowboy-bebop-1998');
const berserkId = seedId('berserk-1989');
const webtoonId = '7b0c6d3e-2f41-4a9d-9c1c-8f4d2a6b5e10';

describe.runIf(available)('lists (postgres)', () => {
  let app: App;
  let db: Db;
  let owner: string;
  let stranger: string;

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

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });
    owner = await signUp('owner');
    stranger = await signUp('strngr');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function createList(
    cookie: string,
    body: Record<string, unknown> = {},
  ): Promise<ListSummary> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/lists',
      headers: { cookie },
      payload: { title: 'A list', ...body },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  async function addItem(cookie: string, listId: string, mediaId: string) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/lists/${listId}/items`,
      headers: { cookie },
      payload: { mediaId },
    });
  }

  async function detail(cookie: string | undefined, listId: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/lists/${listId}`,
      ...(cookie ? { headers: { cookie } } : {}),
    });
  }

  it('creates a list and returns it in the index', async () => {
    const created = await createList(owner, { title: 'Rainy day noir', isRanked: true });
    expect(created).toMatchObject({ title: 'Rainy day noir', isRanked: true, itemCount: 0 });
    expect(created.covers).toEqual([]);

    const index = await app.inject({
      method: 'GET',
      url: '/api/v1/lists',
      headers: { cookie: owner },
    });
    expect(index.statusCode).toBe(200);
    expect((index.json() as ListSummary[]).map((l) => l.id)).toContain(created.id);
  });

  it('appends items with dense positions and fans the first covers', async () => {
    const created = await createList(owner, { title: 'Ordering' });
    for (const id of [matrixId, bebopId, berserkId]) {
      expect((await addItem(owner, created.id, id)).statusCode).toBe(200);
    }
    const body = (await detail(owner, created.id)).json() as ListDetail;
    expect(body.entries.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(body.entries.map((e) => e.id)).toEqual([matrixId, bebopId, berserkId]);
    expect(body.covers).toHaveLength(3);
    expect(body.itemCount).toBe(3);
  });

  it('treats re-adding a title as a no-op rather than a duplicate', async () => {
    const created = await createList(owner, { title: 'Idempotent adds' });
    await addItem(owner, created.id, matrixId);
    const second = await addItem(owner, created.id, matrixId);
    expect(second.statusCode).toBe(200);
    expect((second.json() as ListSummary).itemCount).toBe(1);
  });

  it('swaps neighbours on move and no-ops at the boundaries', async () => {
    const created = await createList(owner, { title: 'Reorder', isRanked: true });
    for (const id of [matrixId, bebopId, berserkId]) await addItem(owner, created.id, id);

    const move = (mediaId: string, direction: 'up' | 'down') =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/lists/${created.id}/items/${mediaId}`,
        headers: { cookie: owner },
        payload: { direction },
      });

    const up = await move(berserkId, 'up');
    expect(up.statusCode).toBe(200);
    expect((up.json() as ListDetail).entries.map((e) => e.id)).toEqual([
      matrixId,
      berserkId,
      bebopId,
    ]);

    // Already first — a no-op, not an error, so the client needn't bounds-check.
    await move(matrixId, 'up');
    const top = await move(matrixId, 'up');
    expect(top.statusCode).toBe(200);
    expect((top.json() as ListDetail).entries[0]!.id).toBe(matrixId);

    const last = await move(bebopId, 'down');
    expect(last.statusCode).toBe(200);
    expect((last.json() as ListDetail).entries.at(-1)!.id).toBe(bebopId);
  });

  it('leaves omitted fields alone on a partial update', async () => {
    // A `.partial()` of a schema carrying `.default()`s still fills omitted keys,
    // which turned a title-only rename into an un-ranking — and, worse, flipped a
    // private list to public.
    const created = await createList(owner, {
      title: 'Before',
      isRanked: true,
      visibility: 'private',
    });
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/lists/${created.id}`,
      headers: { cookie: owner },
      payload: { title: 'After' },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      title: 'After',
      isRanked: true,
      visibility: 'private',
    });
    // And it stays private to everyone else.
    expect((await detail(stranger, created.id)).statusCode).toBe(404);
  });

  it('404s a move for a title that is not in the list', async () => {
    const created = await createList(owner, { title: 'Absent' });
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/lists/${created.id}/items/${matrixId}`,
      headers: { cookie: owner },
      payload: { direction: 'up' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('removes an item without disturbing the order of the rest', async () => {
    const created = await createList(owner, { title: 'Removal' });
    for (const id of [matrixId, bebopId, berserkId]) await addItem(owner, created.id, id);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/v1/lists/${created.id}/items/${bebopId}`,
      headers: { cookie: owner },
    });
    expect(removed.statusCode).toBe(200);
    const body = (await detail(owner, created.id)).json() as ListDetail;
    expect(body.entries.map((e) => e.id)).toEqual([matrixId, berserkId]);
  });

  it('shows a public list to strangers and anonymous visitors, private to nobody else', async () => {
    const pub = await createList(owner, { title: 'Public', visibility: 'public' });
    expect((await detail(stranger, pub.id)).statusCode).toBe(200);
    expect((await detail(undefined, pub.id)).statusCode).toBe(200);
    // A visitor sees it but cannot act on it.
    expect((await detail(stranger, pub.id)).json().isOwner).toBe(false);

    const priv = await createList(owner, { title: 'Private', visibility: 'private' });
    expect((await detail(stranger, priv.id)).statusCode).toBe(404);
    expect((await detail(undefined, priv.id)).statusCode).toBe(404);
    expect((await detail(owner, priv.id)).statusCode).toBe(200);
  });

  it('fails closed on `followers` until the follow system exists', async () => {
    const followersOnly = await createList(owner, { title: 'Followers', visibility: 'followers' });
    expect((await detail(stranger, followersOnly.id)).statusCode).toBe(404);
    expect((await detail(owner, followersOnly.id)).statusCode).toBe(200);
  });

  it('keeps another user from editing, deleting, or adding to a list', async () => {
    const owned = await createList(owner, { title: 'Mine', visibility: 'public' });
    const rename = await app.inject({
      method: 'PATCH',
      url: `/api/v1/lists/${owned.id}`,
      headers: { cookie: stranger },
      payload: { title: 'Not yours' },
    });
    expect(rename.statusCode).toBe(404);
    expect((await addItem(stranger, owned.id, matrixId)).statusCode).toBe(404);
    const destroy = await app.inject({
      method: 'DELETE',
      url: `/api/v1/lists/${owned.id}`,
      headers: { cookie: stranger },
    });
    expect(destroy.statusCode).toBe(404);
    // Still intact and still named what the owner called it.
    expect((await detail(owner, owned.id)).json().title).toBe('Mine');
  });

  it("never leaks another user's lists through the index", async () => {
    await createList(owner, { title: 'Owner only' });
    const index = await app.inject({
      method: 'GET',
      url: '/api/v1/lists',
      headers: { cookie: stranger },
    });
    expect((index.json() as ListSummary[]).every((l) => l.title !== 'Owner only')).toBe(true);
  });

  it('hides an unverified title inside a public list from everyone but its creator', async () => {
    // The seed's community webtoon is unverified with no creator, so nobody but
    // a moderator can see it — a public list must not become a way around that.
    const created = await createList(owner, { title: 'With a hidden entry', visibility: 'public' });
    await db.update(media).set({ createdBy: null }).where(eq(media.id, webtoonId));
    const added = await addItem(owner, created.id, webtoonId);
    // The owner can't even add a title they cannot see.
    expect(added.statusCode).toBe(404);

    // Force the row in behind the API's back, then confirm reads still filter it.
    await db.execute(sql`
      INSERT INTO list_item (list_id, media_id, position)
      VALUES (${created.id}::uuid, ${webtoonId}::uuid, 1)
      ON CONFLICT DO NOTHING
    `);
    const asStranger = (await detail(stranger, created.id)).json() as ListDetail;
    expect(asStranger.entries.map((e) => e.id)).not.toContain(webtoonId);
    expect(asStranger.itemCount).toBe(0);
  });

  it('hides a soft-deleted title from list reads', async () => {
    const created = await createList(owner, { title: 'Soft delete' });
    await addItem(owner, created.id, matrixId);
    await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, matrixId));
    try {
      const body = (await detail(owner, created.id)).json() as ListDetail;
      expect(body.entries).toEqual([]);
      expect(body.itemCount).toBe(0);
    } finally {
      await db.update(media).set({ deletedAt: null }).where(eq(media.id, matrixId));
    }
  });

  it('marks which lists already hold a title', async () => {
    const holding = await createList(owner, { title: 'Holds matrix' });
    const empty = await createList(owner, { title: 'Holds nothing' });
    await addItem(owner, holding.id, matrixId);

    const index = await app.inject({
      method: 'GET',
      url: `/api/v1/lists?containsMedia=${matrixId}`,
      headers: { cookie: owner },
    });
    const byId = new Map((index.json() as ListSummary[]).map((l) => [l.id, l.containsMedia]));
    expect(byId.get(holding.id)).toBe(true);
    expect(byId.get(empty.id)).toBe(false);
  });

  it('deletes a list and its items together', async () => {
    const created = await createList(owner, { title: 'Doomed' });
    await addItem(owner, created.id, matrixId);
    const destroy = await app.inject({
      method: 'DELETE',
      url: `/api/v1/lists/${created.id}`,
      headers: { cookie: owner },
    });
    expect(destroy.statusCode).toBe(204);
    expect((await detail(owner, created.id)).statusCode).toBe(404);
    const rows = await db.select().from(list).where(eq(list.id, created.id));
    expect(rows).toHaveLength(0);
  });

  it('requires a session for every mutating route', async () => {
    const created = await createList(owner, { title: 'Auth' });
    for (const [method, url] of [
      ['POST', '/api/v1/lists'],
      ['PATCH', `/api/v1/lists/${created.id}`],
      ['DELETE', `/api/v1/lists/${created.id}`],
      ['POST', `/api/v1/lists/${created.id}/items`],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        payload: { title: 'x', mediaId: matrixId },
      });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});

describe.runIf(!available)('lists (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
