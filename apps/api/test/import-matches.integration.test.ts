import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { createDb, importMatch, media, runMigrations, userMedia, users, type Db } from '@trackt/db';
import { loadEnv } from '@trackt/shared';
import type { Auth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed `import_match` tests (own `trackt_import_matches_test` db,
 * self-skips without Docker): the list a picker reads, and the answer that
 * writes the log from the entry the import kept. No catalog: every candidate
 * is a local row.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_IMPORT_MATCHES ??
  'postgres://trackt:trackt@localhost:5432/trackt_import_matches_test';

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

function fakeAuth(userId: string): Auth {
  return {
    api: {
      getSession: async () => ({ user: { id: userId, name: 'tester', role: 'user' } }),
    },
  } as unknown as Auth;
}

interface ListedMatch {
  id: string;
  title: string;
  progress: number;
  startedAt: string | null;
  finishedAt: string | null;
  candidates: { id: string; kind: string | null; slug: string | null; inLog: boolean }[];
}

describe.runIf(available)('import matches (postgres)', () => {
  let db: Db;
  let app: App;
  let userId: string;
  const shaft2000 = randomUUID();
  const shaft2019 = randomUUID();
  const witcher = randomUUID();

  /** A Netflix film the import could not tell apart, as `recordUncertainMatches` stores it. */
  async function tie(title: string, candidates: { id: string; title: string; year: number }[]) {
    const entry = {
      source: 'netflix',
      kind: 'movie',
      externalId: title.toLowerCase(),
      title,
      year: null,
      seasonNumber: null,
      status: 'completed',
      score: null,
      progress: 0,
      repeats: 0,
      startedAt: '2019-07-25',
      finishedAt: '2019-07-25',
      notes: null,
      favourite: false,
      externalIds: {},
    };
    const [row] = await db
      .insert(importMatch)
      .values({
        userId,
        source: 'netflix',
        externalId: entry.externalId,
        entryKey: `netflix:movie:${entry.externalId}`,
        kind: 'movie',
        title,
        year: null,
        seasonNumber: null,
        status: 'completed',
        outcome: 'tie',
        bestScore: 1,
        candidates: candidates.map((candidate) => ({
          ...candidate,
          score: 1,
          origin: 'local' as const,
        })),
        entry,
      })
      .returning({ id: importMatch.id });
    return row!.id;
  }

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const [user] = await db
      .insert(users)
      .values({ name: 'Picker', email: `picker-${stamp}@example.com` })
      .returning({ id: users.id });
    userId = user!.id;
    await db.insert(media).values([
      { id: shaft2000, kind: 'movie', title: 'Shaft', slug: `shaft-2000-${stamp}`, year: 2000 },
      { id: shaft2019, kind: 'movie', title: 'Shaft', slug: `shaft-2019-${stamp}`, year: 2019 },
      { id: witcher, kind: 'series', title: 'The Witcher', slug: `witcher-${stamp}`, year: 2019 },
    ]);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db, auth: fakeAuth(userId) });
  });

  afterAll(async () => {
    await app?.close();
  });

  const list = async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/import/uncertain' });
    expect(response.statusCode).toBe(200);
    return (response.json() as { matches: ListedMatch[] }).matches;
  };
  const answer = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: `/api/v1/me/import/uncertain/${id}`, payload });

  it('lists a match with what it would log and each candidate’s row', async () => {
    const id = await tie('Shaft', [
      { id: shaft2019, title: 'Shaft', year: 2019 },
      { id: shaft2000, title: 'Shaft', year: 2000 },
    ]);
    await db.insert(userMedia).values({ userId, mediaId: shaft2000, status: 'planned' });

    const match = (await list()).find((row) => row.id === id)!;
    expect(match).toMatchObject({ title: 'Shaft', startedAt: '2019-07-25' });
    expect(match.candidates).toEqual([
      expect.objectContaining({ id: shaft2019, kind: 'movie', inLog: false }),
      expect.objectContaining({ id: shaft2000, kind: 'movie', inLog: true }),
    ]);
  });

  it('logs the picked work from the kept entry, and closes the question', async () => {
    const [open] = await list();
    const response = await answer(open!.id, { action: 'pick', mediaId: shaft2019 });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ outcome: 'created', mediaId: shaft2019 });
    const [log] = await db
      .select()
      .from(userMedia)
      .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, shaft2019)));
    expect(log).toMatchObject({
      status: 'completed',
      startedAt: '2019-07-25',
      finishedAt: '2019-07-25',
    });
    expect(await list()).toEqual([]);
  });

  it('refuses a second answer to the same question', async () => {
    const [answered] = await db.select().from(importMatch).where(eq(importMatch.userId, userId));
    const response = await answer(answered!.id, { action: 'pick', mediaId: shaft2000 });
    expect(response.statusCode).toBe(409);
  });

  it('merges a pick into a work the viewer already logs', async () => {
    const id = await tie('Shaft (again)', [{ id: shaft2000, title: 'Shaft', year: 2000 }]);
    const response = await answer(id, { action: 'pick', mediaId: shaft2000 });

    expect(response.json()).toMatchObject({ outcome: 'merged' });
    const [log] = await db
      .select()
      .from(userMedia)
      .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, shaft2000)));
    // Status only climbs: planned becomes completed, and the dates fill in.
    expect(log).toMatchObject({ status: 'completed', startedAt: '2019-07-25' });
  });

  it('skips without logging anything', async () => {
    const id = await tie('The Witcher', [{ id: witcher, title: 'The Witcher', year: 2019 }]);
    const response = await answer(id, { action: 'skip' });

    expect(response.json()).toEqual({ outcome: 'skipped', mediaId: null });
    const logged = await db
      .select()
      .from(userMedia)
      .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, witcher)));
    expect(logged).toEqual([]);
    const [row] = await db.select().from(importMatch).where(eq(importMatch.id, id));
    expect(row?.resolvedAt).not.toBeNull();
  });

  it('answers 404 for a work that does not exist, and leaves the question open', async () => {
    const id = await tie('Drive', [{ id: shaft2000, title: 'Drive', year: 2011 }]);
    const response = await answer(id, { action: 'pick', mediaId: randomUUID() });

    expect(response.statusCode).toBe(404);
    expect((await list()).map((row) => row.id)).toContain(id);
  });
});
