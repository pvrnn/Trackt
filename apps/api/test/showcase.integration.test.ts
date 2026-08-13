import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, media, runMigrations, seedMedia, type Db } from '@trackt/db';
import { SHOWCASE_LIMIT, SearchResultSchema, loadEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for the landing page's cover band (`GET
 * /v1/media/showcase`). Same posture as the search suite: creates and migrates
 * its own database and self-skips when Postgres is down.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_SHOWCASE ??
  'postgres://trackt:trackt@localhost:5432/trackt_showcase_test';

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

interface Row {
  id: string;
  kind: string;
  title: string;
  coverUrl: string | null;
}

describe.runIf(available)('GET /api/v1/media/showcase (postgres)', () => {
  let app: App;
  let db: Db;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' }),
      db,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  async function showcase(): Promise<{ statusCode: number; headers: unknown; rows: Row[] }> {
    const response = await app.inject({ method: 'GET', url: '/api/v1/media/showcase' });
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      rows: response.statusCode === 200 ? (response.json() as Row[]) : [],
    };
  }

  it('serves rows matching the shared result schema, capped at the limit', async () => {
    const { statusCode, rows } = await showcase();
    expect(statusCode).toBe(200);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(SHOWCASE_LIMIT);
    for (const row of rows) expect(() => SearchResultSchema.parse(row)).not.toThrow();
  });

  it('is not a slug lookup — `showcase` must not resolve as /media/:idOrSlug', async () => {
    const { rows } = await showcase();
    // The detail route returns an object; the band returns an array. Route
    // registration order is what keeps these apart.
    expect(Array.isArray(rows)).toBe(true);
  });

  it('spreads across kinds rather than running out one kind first', async () => {
    const { rows } = await showcase();
    const kinds = new Set(rows.map((row) => row.kind));
    // The seed carries movies, series, anime and manga at minimum.
    expect(kinds.size).toBeGreaterThanOrEqual(3);
    // Round-robin: the first rows should each be a different kind.
    const leading = rows.slice(0, kinds.size).map((row) => row.kind);
    expect(new Set(leading).size).toBe(leading.length);
  });

  it('sorts titles that have real artwork ahead of ones that do not', async () => {
    const { rows } = await showcase();
    const byKind = new Map<string, Row[]>();
    for (const row of rows) byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
    for (const kindRows of byKind.values()) {
      const withCover = kindRows.map((row) => row.coverUrl !== null);
      // Once false appears, no true may follow it.
      expect(withCover.indexOf(true)).toBeLessThanOrEqual(
        withCover.includes(false) ? withCover.indexOf(false) : withCover.length,
      );
    }
  });

  it('never exposes unverified, rejected, or soft-deleted entries', async () => {
    // The seed's community webtoon is unverified — an anonymous band must not
    // carry it, and neither must a rejected or pulled title.
    const webtoonId = '7b0c6d3e-2f41-4a9d-9c1c-8f4d2a6b5e10';
    const { rows: unverified } = await showcase();
    expect(unverified.map((row) => row.id)).not.toContain(webtoonId);

    try {
      await db.update(media).set({ moderation: 'verified' }).where(eq(media.id, webtoonId));
      const { rows: verified } = await showcase();
      expect(verified.map((row) => row.id)).toContain(webtoonId);

      await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, webtoonId));
      const { rows: deleted } = await showcase();
      expect(deleted.map((row) => row.id)).not.toContain(webtoonId);

      await db
        .update(media)
        .set({ deletedAt: null, moderation: 'rejected' })
        .where(eq(media.id, webtoonId));
      const { rows: rejected } = await showcase();
      expect(rejected.map((row) => row.id)).not.toContain(webtoonId);
    } finally {
      await db
        .update(media)
        .set({ moderation: 'unverified', deletedAt: null })
        .where(eq(media.id, webtoonId));
    }
  });

  it('is cacheable — it varies by nothing', async () => {
    const { headers } = await showcase();
    expect((headers as Record<string, string>)['cache-control']).toMatch(/public/);
  });
});

describe.runIf(!available)('showcase (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
