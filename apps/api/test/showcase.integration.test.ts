import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDb, media, runMigrations, seedMedia, type Db } from '@trackt/db';
import { SHOWCASE_LIMIT, SHOWCASE_MAX_OFFSET, SearchResultSchema, loadEnv } from '@trackt/shared';
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

  async function showcase(query = ''): Promise<{
    statusCode: number;
    headers: unknown;
    rows: Row[];
  }> {
    const response = await app.inject({ method: 'GET', url: `/api/v1/media/showcase${query}` });
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

  it('narrows to one kind when asked, and lets that kind fill a whole page', async () => {
    // The seed carries three distinct series titles — too few to fill a page,
    // and too few to tell the round-robin apart from a single-kind shelf, so
    // pad it past the batch size.
    const padded = Array.from({ length: SHOWCASE_LIMIT + 2 }, (_, index) => ({
      kind: 'series' as const,
      title: `Bulk Series ${index}`,
      slug: `bulk-series-${index}`,
    }));
    await db.insert(media).values(padded);
    try {
      const { statusCode, rows } = await showcase('?kind=series');
      expect(statusCode).toBe(200);
      expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(['series']));
      // Interleaving across kinds would have left the grid a fifth full; the
      // caller asked for a screenful of one kind.
      expect(rows.length).toBe(SHOWCASE_LIMIT);
    } finally {
      await db.delete(media).where(
        inArray(
          media.slug,
          padded.map((row) => row.slug),
        ),
      );
    }
  });

  it('continues the same order when paged, and says when the shelf runs out', async () => {
    const padded = Array.from({ length: SHOWCASE_LIMIT + 4 }, (_, index) => ({
      kind: 'series' as const,
      title: `Paged Series ${index}`,
      slug: `paged-series-${index}`,
    }));
    await db.insert(media).values(padded);
    try {
      const first = await showcase('?kind=series');
      expect((first.headers as Record<string, string>)['x-has-more']).toBe('true');
      expect(first.rows.length).toBe(SHOWCASE_LIMIT);

      const second = await showcase(`?kind=series&offset=${SHOWCASE_LIMIT}`);
      expect(second.rows.length).toBeGreaterThan(0);
      // A total order means a page cannot repeat a row an earlier one carried.
      const firstIds = new Set(first.rows.map((row) => row.id));
      expect(second.rows.filter((row) => firstIds.has(row.id))).toEqual([]);

      const past = await showcase(`?kind=series&offset=${SHOWCASE_LIMIT + second.rows.length}`);
      expect(past.rows).toEqual([]);
      expect((past.headers as Record<string, string>)['x-has-more']).toBe('false');
    } finally {
      await db.delete(media).where(
        inArray(
          media.slug,
          padded.map((row) => row.slug),
        ),
      );
    }
  });

  it('narrows to one release year when asked', async () => {
    const ids = {
      hit: '9a4a2a5b-6f04-46b4-9a01-0000000000a1',
      miss: '9a4a2a5b-6f04-46b4-9a01-0000000000a2',
    };
    await db.insert(media).values([
      {
        id: ids.hit,
        kind: 'movie',
        title: 'Year Probe Seventies',
        slug: 'year-probe-seventies',
        year: 1977,
        source: 'provider',
        moderation: 'verified',
      },
      {
        id: ids.miss,
        kind: 'movie',
        title: 'Year Probe Eighties',
        slug: 'year-probe-eighties',
        year: 1985,
        source: 'provider',
        moderation: 'verified',
      },
    ]);
    try {
      const { statusCode, rows } = await showcase('?year=1977');
      expect(statusCode).toBe(200);
      expect(rows.map((row) => row.title)).toEqual(['Year Probe Seventies']);
    } finally {
      await db.delete(media).where(inArray(media.id, [ids.hit, ids.miss]));
    }
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

  it('leaves out ecchi and hentai titles, whatever the genre casing', async () => {
    const webtoonId = '7b0c6d3e-2f41-4a9d-9c1c-8f4d2a6b5e10';
    const [original] = await db
      .select({ genres: media.genres })
      .from(media)
      .where(eq(media.id, webtoonId));
    try {
      await db.update(media).set({ moderation: 'verified' }).where(eq(media.id, webtoonId));
      expect((await showcase()).rows.map((row) => row.id)).toContain(webtoonId);

      for (const genre of ['ecchi', 'Ecchi', 'Hentai']) {
        await db
          .update(media)
          .set({ genres: ['comedy', genre] })
          .where(eq(media.id, webtoonId));
        expect((await showcase()).rows.map((row) => row.id)).not.toContain(webtoonId);
        expect((await showcase('?kind=webtoon')).rows.map((row) => row.id)).not.toContain(
          webtoonId,
        );
      }
    } finally {
      await db
        .update(media)
        .set({ moderation: 'unverified', genres: original?.genres ?? [] })
        .where(eq(media.id, webtoonId));
    }
  });

  it('refuses an offset past the ceiling instead of walking the catalog', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/media/showcase?offset=${SHOWCASE_MAX_OFFSET + 1}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('is cacheable — it varies by nothing', async () => {
    const { headers } = await showcase();
    expect((headers as Record<string, string>)['cache-control']).toMatch(/public/);
  });
});

describe.runIf(!available)('showcase (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});

describe.runIf(available)(
  'GET /api/v1/media/showcase — from the central catalog (postgres)',
  () => {
    let app: App | undefined;
    let db: Db;
    let server: Server | undefined;
    let lastQuery: URLSearchParams | undefined;

    const ids = {
      first: '8e1f2a3b-4c5d-5e6f-8a7b-000000000101',
      second: '8e1f2a3b-4c5d-5e6f-8a7b-000000000102',
      pulled: '8e1f2a3b-4c5d-5e6f-8a7b-000000000103',
    };

    function work(id: string, title: string): Record<string, unknown> {
      return {
        id,
        kind: 'movie',
        title,
        synonyms: [],
        year: 2031,
        status: 'ended',
        genres: [],
        partCount: null,
        seasonNumber: null,
        externalIds: {},
        metadata: {},
        description: null,
        coverUrl: null,
        bannerUrl: null,
      };
    }

    function catalog(status: number, body: unknown): Promise<string> {
      server = createServer((req, res) => {
        lastQuery = new URL(req.url ?? '/', 'http://stub').searchParams;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      return new Promise((resolve) => {
        server!.listen(0, '127.0.0.1', () => {
          const address = server!.address() as AddressInfo;
          resolve(`http://127.0.0.1:${address.port}`);
        });
      });
    }

    async function shelfVia(catalogUrl: string, query = '') {
      app = await buildApp({
        env: loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: catalogUrl }),
        db,
      });
      const response = await app.inject({ method: 'GET', url: `/api/v1/media/showcase${query}` });
      expect(response.statusCode).toBe(200);
      return {
        rows: response.json() as { id: string; slug: string; title: string }[],
        hasMore: response.headers['x-has-more'],
      };
    }

    beforeAll(async () => {
      await runMigrations(TEST_DATABASE_URL);
      db = createDb(TEST_DATABASE_URL, { max: 1 });
      await seedMedia(db);
    });

    afterEach(async () => {
      await app?.close();
      server?.close();
      app = undefined;
      server = undefined;
    });

    afterAll(async () => {
      await db.delete(media).where(inArray(media.id, Object.values(ids)));
    });

    it("serves the catalog's shelf in its order, materialized under local slugs", async () => {
      const url = await catalog(200, {
        results: [work(ids.first, 'Shelf Probe One'), work(ids.second, 'Shelf Probe Two')],
      });
      const { rows, hasMore } = await shelfVia(url, '?kind=movie&year=2031&offset=24');
      expect(rows.map((row) => row.id)).toEqual([ids.first, ids.second]);
      expect(rows[0]?.slug).toBe('shelf-probe-one-2031');
      expect(hasMore).toBe('false');
      expect(Object.fromEntries(lastQuery ?? [])).toMatchObject({
        kind: 'movie',
        year: '2031',
        offset: '24',
        limit: String(SHOWCASE_LIMIT + 1),
      });
      const stored = await db.select().from(media).where(eq(media.id, ids.first));
      expect(stored[0]).toMatchObject({ source: 'provider', moderation: 'verified' });
    });

    it('says there is more when the catalog answers past the batch', async () => {
      const results = Array.from({ length: SHOWCASE_LIMIT + 1 }, (_, n) =>
        work(ids.first, `Shelf Probe ${n}`),
      );
      const { hasMore } = await shelfVia(await catalog(200, { results }));
      expect(hasMore).toBe('true');
    });

    it('keeps a work this instance pulled off the shelf', async () => {
      await db
        .insert(media)
        .values({
          id: ids.pulled,
          kind: 'movie',
          title: 'Shelf Probe Pulled',
          slug: 'shelf-probe-pulled-2031',
          source: 'provider',
          moderation: 'verified',
          deletedAt: new Date(),
        })
        .onConflictDoNothing();
      const url = await catalog(200, {
        results: [work(ids.pulled, 'Shelf Probe Pulled'), work(ids.second, 'Shelf Probe Two')],
      });
      const { rows } = await shelfVia(url);
      expect(rows.map((row) => row.id)).toEqual([ids.second]);
    });

    it('falls back to local rows when the catalog fails or predates the route', async () => {
      for (const status of [500, 404]) {
        const { rows } = await shelfVia(await catalog(status, { error: 'nope' }));
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.map((row) => row.id)).not.toContain(ids.pulled);
        await app?.close();
        server?.close();
        app = undefined;
        server = undefined;
      }
    });
  },
);
