import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, runMigrations, seedMedia, type Db } from '@trackt/db';
import { SearchResultSchema, canonicalMediaId, loadEnv } from '@trackt/shared';
import { buildApp, type App } from './app.js';

/**
 * Postgres-backed search tests against the dev compose database
 * (`docker compose -f docker-compose.dev.yml up -d`). The suite creates and
 * migrates its own `trackt_test` database and self-skips when Postgres is down,
 * so `pnpm test` stays green without Docker.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://trackt:trackt@localhost:5432/trackt_test';

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

describe.runIf(available)('GET /api/v1/search (postgres)', () => {
  let app: App;
  let db: Db;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    app = await buildApp({ env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' }), db });
  });

  afterAll(async () => {
    await app?.close();
  });

  async function search(query: string): Promise<{ statusCode: number; results: unknown[] }> {
    const response = await app.inject({ method: 'GET', url: `/api/v1/search?${query}` });
    return { statusCode: response.statusCode, results: response.json() };
  }

  it('finds an exact title', async () => {
    const { statusCode, results } = await search('q=Breaking%20Bad');
    expect(statusCode).toBe(200);
    expect(results[0]).toMatchObject({
      id: canonicalMediaId('series', 1396),
      title: 'Breaking Bad',
      kind: 'series',
      year: 2008,
    });
  });

  it('tolerates typos via trigram matching', async () => {
    const { results } = await search('q=cowbay%20bebop');
    expect(results[0]).toMatchObject({
      id: canonicalMediaId('anime', 1),
      title: 'Cowboy Bebop',
    });
  });

  it('matches synonyms (original-language titles)', async () => {
    const { results } = await search(`q=${encodeURIComponent('葬送のフリーレン')}`);
    expect(results.map((r) => (r as { title: string }).title)).toContain(
      'Frieren: Beyond Journey’s End',
    );
  });

  it('filters by kind', async () => {
    const { results } = await search('q=the&kind=movie');
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect((result as { kind: string }).kind).toBe('movie');
  });

  it('respects the limit', async () => {
    const { results } = await search('q=a&limit=2');
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('excludes rejected entries', async () => {
    const { results: before } = await search('q=Cosmic%20Delivery%20Club');
    expect(before.length).toBe(1);
    const webtoonId = (before[0] as { id: string }).id;
    const { media } = await import('@trackt/db');
    const { eq } = await import('drizzle-orm');
    await db.update(media).set({ moderation: 'rejected' }).where(eq(media.id, webtoonId));
    try {
      const { results } = await search('q=Cosmic%20Delivery%20Club');
      expect(results).toEqual([]);
    } finally {
      await db.update(media).set({ moderation: 'unverified' }).where(eq(media.id, webtoonId));
    }
  });

  it('returns rows matching the shared result schema', async () => {
    const { results } = await search('q=matrix');
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(() => SearchResultSchema.parse(result)).not.toThrow();
  });
});

describe.runIf(!available)('search (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
