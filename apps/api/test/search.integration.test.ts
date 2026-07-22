import { createServer, type Server } from 'node:http';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, media, runMigrations, seedMedia, type Db } from '@trackt/db';
import { SearchResultSchema, canonicalMediaId, loadEnv } from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';

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

describe.runIf(available)('GET /api/v1/search (postgres)', () => {
  let app: App;
  let db: Db;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    // No central catalog for these tests — CATALOG_URL unset keeps search local-only.
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' }),
      db,
    });
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

  it('hides non-verified entries from anonymous viewers, shows them once verified', async () => {
    // The seed's community webtoon is unverified with no creator, so anonymous
    // searches can't see it (creator+moderator visibility, lib/visibility.ts).
    const webtoonId = '7b0c6d3e-2f41-4a9d-9c1c-8f4d2a6b5e10';
    const { results: hidden } = await search('q=Cosmic%20Delivery%20Club');
    expect(hidden).toEqual([]);
    try {
      await db.update(media).set({ moderation: 'verified' }).where(eq(media.id, webtoonId));
      const { results } = await search('q=Cosmic%20Delivery%20Club');
      expect(results.length).toBe(1);

      await db.update(media).set({ moderation: 'rejected' }).where(eq(media.id, webtoonId));
      const { results: rejected } = await search('q=Cosmic%20Delivery%20Club');
      expect(rejected).toEqual([]);
    } finally {
      await db.update(media).set({ moderation: 'unverified' }).where(eq(media.id, webtoonId));
    }
  });

  it('returns rows matching the shared result schema', async () => {
    const { results } = await search('q=matrix');
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(() => SearchResultSchema.parse(result)).not.toThrow();
  });

  it('hides soft-deleted media from search and the detail page', async () => {
    const bebopId = canonicalMediaId('anime', 1);
    const { results: before } = await search('q=Cowboy%20Bebop');
    expect((before[0] as { id: string }).id).toBe(bebopId);
    const [bebopRow] = await db
      .select({ slug: media.slug })
      .from(media)
      .where(eq(media.id, bebopId));
    const slug = bebopRow!.slug;
    try {
      await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, bebopId));

      const { results } = await search('q=Cowboy%20Bebop');
      expect(results.map((r) => (r as { id: string }).id)).not.toContain(bebopId);

      const detail = await app.inject({ method: 'GET', url: `/api/v1/media/${slug}` });
      expect(detail.statusCode).toBe(404);
      const byId = await app.inject({ method: 'GET', url: `/api/v1/media/${bebopId}` });
      expect(byId.statusCode).toBe(404);
    } finally {
      await db.update(media).set({ deletedAt: null }).where(eq(media.id, bebopId));
    }
  });
});

describe.runIf(!available)('search (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});

/** Minimal central-catalog stub serving the /v1/catalog/search contract (ADR-0002). */
function catalogStub(
  handler: (query: URLSearchParams) => { results: unknown[] } | 'timeout' | 'error',
): Server {
  return createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname !== '/v1/catalog/search') {
      res.writeHead(404).end();
      return;
    }
    const outcome = handler(url.searchParams);
    if (outcome === 'timeout') return; // never respond — exercises the client timeout
    if (outcome === 'error') {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(outcome));
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

const centralOnlyId = '5b6e0f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const slugCollisionHitId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const slugOwnerLocalId = '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
const existingUnderOtherSlugId = '2f3e4d5c-6b7a-4980-8b1c-2d3e4f5a6b7c';
const softDeletedId = '6c7f1a2b-3d4e-4f5a-9b8c-1d2e3f4a5b6c';

/** Full central-catalog hit with only the fields under test varying. */
function slimHit(overrides: {
  id: string;
  kind?: string;
  title: string;
  year?: number;
  rank?: number;
}): Record<string, unknown> {
  return {
    kind: 'movie',
    synonyms: [],
    year: 2024,
    status: 'ended',
    genres: [],
    partCount: null,
    seasonNumber: null,
    externalIds: {},
    description: null,
    coverUrl: null,
    rank: 0.9,
    ...overrides,
  };
}

describe.runIf(available)('GET /api/v1/search — federated with central catalog (postgres)', () => {
  let app: App;
  let db: Db;
  let server: Server | undefined;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
  });

  afterEach(async () => {
    await app?.close();
    server?.close();
  });

  afterAll(async () => {
    for (const id of [
      centralOnlyId,
      slugCollisionHitId,
      slugOwnerLocalId,
      existingUnderOtherSlugId,
      softDeletedId,
    ]) {
      await db.delete(media).where(eq(media.id, id));
    }
  });

  async function buildAppWithCatalog(catalogUrl: string): Promise<App> {
    return buildApp({
      env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: catalogUrl }),
      db,
    });
  }

  it('materializes a central-only hit with a real slug and local row', async () => {
    server = catalogStub(() => ({
      results: [
        {
          id: centralOnlyId,
          kind: 'movie',
          title: 'Central Only Film',
          synonyms: [],
          year: 2024,
          status: 'ended',
          genres: ['drama'],
          partCount: null,
          seasonNumber: null,
          externalIds: { tmdb: 999999 },
          description: null,
          coverUrl: null,
          rank: 0.9,
        },
      ],
    }));
    app = await buildAppWithCatalog(await listen(server));

    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=Central%20Only' });
    expect(response.statusCode).toBe(200);
    const results = response.json() as { id: string; slug: string }[];
    const hit = results.find((r) => r.id === centralOnlyId);
    expect(hit).toMatchObject({ id: centralOnlyId, slug: 'central-only-film-2024' });

    const [row] = await db.select().from(media).where(eq(media.id, centralOnlyId));
    expect(row).toMatchObject({ source: 'provider', moderation: 'verified' });
  });

  it('returns the suffixed slug when the natural slug is already taken by another work', async () => {
    // A different local work already owns the slug the central hit would get.
    await db.insert(media).values({
      id: slugOwnerLocalId,
      kind: 'movie',
      title: 'Zzz Unrelated Slug Owner',
      slug: 'slug-collision-film-2024',
      source: 'user',
      moderation: 'verified',
    });
    server = catalogStub(() => ({
      results: [slimHit({ id: slugCollisionHitId, title: 'Slug Collision Film', year: 2024 })],
    }));
    app = await buildAppWithCatalog(await listen(server));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=Slug%20Collision%20Film',
    });
    expect(response.statusCode).toBe(200);
    const results = response.json() as { id: string; slug: string }[];
    const hit = results.find((r) => r.id === slugCollisionHitId);
    const expectedSlug = `slug-collision-film-2024-${slugCollisionHitId.slice(0, 8)}`;
    // The response must carry the slug that was actually persisted, not the colliding one.
    expect(hit).toMatchObject({ id: slugCollisionHitId, slug: expectedSlug });

    const [row] = await db.select().from(media).where(eq(media.id, slugCollisionHitId));
    expect(row?.slug).toBe(expectedSlug);
  });

  it('returns the existing slug when the id is already materialized under another slug', async () => {
    // The canonical id already exists locally with a slug that differs from
    // what the central hit's title would produce; the insert is skipped and
    // the response must point at the existing row's slug.
    await db.insert(media).values({
      id: existingUnderOtherSlugId,
      kind: 'movie',
      title: 'Zzz Existing Under Other Slug',
      slug: 'zzz-existing-under-other-slug',
      source: 'provider',
      moderation: 'verified',
    });
    server = catalogStub(() => ({
      results: [
        slimHit({ id: existingUnderOtherSlugId, title: 'Central Duplicate Story', year: 2020 }),
      ],
    }));
    app = await buildAppWithCatalog(await listen(server));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=Central%20Duplicate%20Story',
    });
    expect(response.statusCode).toBe(200);
    const results = response.json() as { id: string; slug: string; title: string }[];
    const hit = results.find((r) => r.id === existingUnderOtherSlugId);
    expect(hit).toMatchObject({
      id: existingUnderOtherSlugId,
      slug: 'zzz-existing-under-other-slug',
      title: 'Zzz Existing Under Other Slug',
    });

    // The skipped insert must not have overwritten the existing row.
    const [row] = await db.select().from(media).where(eq(media.id, existingUnderOtherSlugId));
    expect(row?.slug).toBe('zzz-existing-under-other-slug');
    expect(row?.title).toBe('Zzz Existing Under Other Slug');
  });

  it('shows a row already local once, not duplicated, when central also returns it', async () => {
    const breakingBadId = canonicalMediaId('series', 1396);
    server = catalogStub(() => ({
      results: [
        {
          id: breakingBadId,
          kind: 'series',
          title: 'Breaking Bad',
          synonyms: [],
          year: 2008,
          status: 'ended',
          genres: [],
          partCount: null,
          seasonNumber: null,
          externalIds: {},
          description: null,
          coverUrl: null,
          rank: 1,
        },
      ],
    }));
    app = await buildAppWithCatalog(await listen(server));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=Breaking%20Bad',
    });
    const results = response.json() as { id: string }[];
    expect(results.filter((r) => r.id === breakingBadId)).toHaveLength(1);
  });

  it('never resurrects a soft-deleted local row from a central hit', async () => {
    // A title pulled from circulation locally, still served by the central catalog.
    await db.insert(media).values({
      id: softDeletedId,
      kind: 'movie',
      title: 'Withdrawn Film',
      slug: 'withdrawn-film-2020',
      year: 2020,
      source: 'provider',
      moderation: 'verified',
      deletedAt: new Date(),
    });
    server = catalogStub(() => ({
      results: [
        {
          id: softDeletedId,
          kind: 'movie',
          title: 'Withdrawn Film',
          synonyms: [],
          year: 2020,
          status: 'ended',
          genres: [],
          partCount: null,
          seasonNumber: null,
          externalIds: { tmdb: 424242 },
          description: null,
          coverUrl: null,
          rank: 1,
        },
      ],
    }));
    app = await buildAppWithCatalog(await listen(server));

    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=Withdrawn' });
    expect(response.statusCode).toBe(200);
    const results = response.json() as { id: string }[];
    expect(results.map((r) => r.id)).not.toContain(softDeletedId);

    // The local row stays exactly as it was: soft-deleted, not overwritten.
    const [row] = await db.select().from(media).where(eq(media.id, softDeletedId));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('degrades to local-only results when the central catalog errors', async () => {
    server = catalogStub(() => 'error');
    app = await buildAppWithCatalog(await listen(server));

    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=Breaking%20Bad' });
    expect(response.statusCode).toBe(200);
    const results = response.json() as { title: string }[];
    expect(results.some((r) => r.title === 'Breaking Bad')).toBe(true);
  });

  it('degrades to local-only results when the central catalog times out', async () => {
    server = catalogStub(() => 'timeout');
    app = await buildApp({
      env: loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        CATALOG_URL: await listen(server),
        CATALOG_SEARCH_TIMEOUT_MS: '50',
      }),
      db,
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/search?q=Breaking%20Bad' });
    expect(response.statusCode).toBe(200);
    const results = response.json() as { title: string }[];
    expect(results.some((r) => r.title === 'Breaking Bad')).toBe(true);
  });
});
