import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalogEnv } from '@trackt/shared';
import {
  catalogMedia,
  createCatalogDb,
  runCatalogMigrations,
  type CatalogDb,
} from '../src/db/index.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for the live federated-search endpoint (ADR-0002)
 * against the dev compose catalog database. Self-skips when Postgres is
 * down, so `pnpm test` stays green without Docker.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://trackt:trackt@localhost:5433/trackt_catalog_test';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt_catalog';
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

const matrixId = '2e1c929b-ab13-5b76-9706-c68e438b6a03';
const bebopId = '3f2d838c-bc24-6c87-a817-d79f549c7b14';

describe.runIf(available)('GET /v1/catalog/search (postgres)', () => {
  let app: App;
  let db: CatalogDb;

  beforeAll(async () => {
    await runCatalogMigrations(TEST_DATABASE_URL);
    db = createCatalogDb(TEST_DATABASE_URL, { max: 1 });
    app = await buildApp({ env: loadCatalogEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' }), db });
  });

  beforeEach(async () => {
    await db.insert(catalogMedia).values([
      {
        id: matrixId,
        kind: 'movie',
        title: 'The Matrix',
        synonyms: [],
        year: 1999,
        status: 'ended',
        genres: ['action'],
        externalIds: { tmdb: 603 },
      },
      {
        id: bebopId,
        kind: 'anime',
        title: 'Cowboy Bebop',
        synonyms: ['カウボーイビバップ'],
        year: 1998,
        status: 'ended',
        genres: ['action', 'sci-fi'],
        externalIds: { anilist: 1 },
      },
      {
        id: '4a3e949d-cd35-7d98-b928-e8af65a8d235',
        kind: 'movie',
        title: 'Tombstoned Movie',
        synonyms: [],
        year: 2000,
        status: 'ended',
        genres: [],
        externalIds: {},
        deletedAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(catalogMedia);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function search(query: string): Promise<{ statusCode: number; results: unknown[] }> {
    const response = await app.inject({ method: 'GET', url: `/v1/catalog/search?${query}` });
    const body = response.json() as { results: unknown[] };
    return { statusCode: response.statusCode, results: body.results };
  }

  it('finds an exact title', async () => {
    const { statusCode, results } = await search('q=matrix');
    expect(statusCode).toBe(200);
    expect(results[0]).toMatchObject({ id: matrixId, title: 'The Matrix', kind: 'movie' });
  });

  it('tolerates typos via trigram matching', async () => {
    const { results } = await search('q=cowbay%20bebop');
    expect(results[0]).toMatchObject({ id: bebopId, title: 'Cowboy Bebop' });
  });

  it('matches synonyms', async () => {
    const { results } = await search(`q=${encodeURIComponent('カウボーイビバップ')}`);
    expect(results.map((r) => (r as { id: string }).id)).toContain(bebopId);
  });

  it('filters by kind', async () => {
    const { results } = await search('q=matrix&kind=anime');
    expect(results).toEqual([]);
  });

  it('filters by release year', async () => {
    const { results } = await search('q=matrix&year=1998');
    expect(results).toEqual([]);
    const { results: exact } = await search('q=matrix&year=1999');
    expect(exact.map((r) => (r as { id: string }).id)).toEqual([matrixId]);
  });

  it('respects the limit', async () => {
    const { results } = await search('q=a&limit=1');
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('excludes tombstoned rows', async () => {
    const { results } = await search('q=Tombstoned');
    expect(results).toEqual([]);
  });

  it('every hit carries a rank for merge-sorting against local results', async () => {
    const { results } = await search('q=matrix');
    for (const result of results) expect(typeof (result as { rank: number }).rank).toBe('number');
  });

  it('orders equally relevant titles by provider score, then anime format', async () => {
    const ids = [
      '9a4a2a5b-6f04-46b4-9a01-000000000001',
      '9a4a2a5b-6f04-46b4-9a01-000000000002',
      '9a4a2a5b-6f04-46b4-9a01-000000000003',
    ];
    await db.insert(catalogMedia).values([
      {
        id: ids[0]!,
        kind: 'anime',
        title: 'Ranking Probe',
        synonyms: [],
        year: 2020,
        status: 'ended',
        genres: [],
        externalIds: {},
        metadata: { providerScore: 75, format: 'special' },
      },
      {
        id: ids[1]!,
        kind: 'anime',
        title: 'Ranking Probe',
        synonyms: [],
        year: 2020,
        status: 'ended',
        genres: [],
        externalIds: {},
        metadata: { providerScore: 90, format: 'special' },
      },
      {
        id: ids[2]!,
        kind: 'anime',
        title: 'Ranking Probe',
        synonyms: [],
        year: 2020,
        status: 'ended',
        genres: [],
        externalIds: {},
        metadata: { providerScore: 90, format: 'tv' },
      },
    ]);

    const { results } = await search('q=Ranking%20Probe');
    expect(results.slice(0, 3).map((result) => (result as { id: string }).id)).toEqual([
      ids[2],
      ids[1],
      ids[0],
    ]);
  });

  it('prefers the main work over its spin-off when the query names the franchise', async () => {
    // ADR-0010: the spin-off's shorter title trigrams better against the query,
    // which is what put it first before the format class existed.
    const ids = {
      short: '9a4a2a5b-6f04-46b4-9a01-000000000015',
      main: '9a4a2a5b-6f04-46b4-9a01-000000000016',
      season: '9a4a2a5b-6f04-46b4-9a01-000000000017',
    };
    await db.insert(catalogMedia).values([
      {
        id: ids.short,
        kind: 'anime',
        title: 'Zero Probe ~Break Time~',
        synonyms: [],
        year: 2020,
        status: 'ended',
        genres: [],
        externalIds: {},
        metadata: { providerScore: 65, format: 'tv short' },
      },
      {
        id: ids.main,
        kind: 'anime',
        title: 'Zero Probe -Main Line-',
        synonyms: [],
        year: 2020,
        status: 'ended',
        genres: [],
        externalIds: {},
        metadata: { providerScore: 81, format: 'tv' },
      },
      {
        id: ids.season,
        kind: 'anime',
        title: 'Zero Probe -Main Line- Season 2',
        synonyms: [],
        year: 2021,
        status: 'ended',
        genres: [],
        externalIds: {},
        metadata: { providerScore: 83, format: 'tv' },
      },
    ]);

    const { results } = await search('q=Zero%20Probe');
    expect(results.slice(0, 3).map((result) => (result as { id: string }).id)).toEqual([
      ids.main,
      ids.season,
      ids.short,
    ]);
  });

  it('matches accented titles with or without accents', async () => {
    const id = '9a4a2a5b-6f04-46b4-9a01-000000000004';
    await db.insert(catalogMedia).values({
      id,
      kind: 'anime',
      title: 'Pokémon Horizons',
      synonyms: [],
      year: 2023,
      status: 'airing',
      genres: [],
      externalIds: {},
    });

    for (const query of ['pokemon horizons', 'pokémon horizons']) {
      const { results } = await search(`q=${encodeURIComponent(query)}`);
      expect(results.map((result) => (result as { id: string }).id)).toContain(id);
    }
  });

  it('sorts by newest and by title when asked, keeping only real matches', async () => {
    await db.insert(catalogMedia).values([
      {
        id: '5b4f0a0e-de46-5e09-8a39-f9b076b9e346',
        kind: 'movie',
        title: 'The Matrix Resurrections',
        synonyms: [],
        year: 2021,
        status: 'ended',
        genres: [],
        externalIds: {},
      },
      {
        id: '6c5a1b1f-ef57-5f1a-9b4a-0ac187cae457',
        kind: 'movie',
        title: 'Matrix Reloaded',
        synonyms: [],
        year: 2003,
        status: 'ended',
        genres: [],
        externalIds: {},
      },
    ]);
    const ids = (results: unknown[]) => results.map((r) => (r as { title: string }).title);

    const { results: newest } = await search('q=matrix&sort=newest');
    expect(ids(newest)).toEqual(['The Matrix Resurrections', 'Matrix Reloaded', 'The Matrix']);
    const { results: az } = await search('q=matrix&sort=az');
    expect(ids(az)).toEqual(['Matrix Reloaded', 'The Matrix', 'The Matrix Resurrections']);

    // A typo is relevance's job: under a reordering sort only hits that
    // contain the query (or nearly spell it) survive.
    const { results: fuzzy } = await search('q=cowbay%20bebop');
    expect(ids(fuzzy)).toContain('Cowboy Bebop');
    const { results: fuzzyNewest } = await search('q=bebxp&sort=newest');
    expect(ids(fuzzyNewest)).not.toContain('Cowboy Bebop');
  });

  it('counts hits per kind, ignoring tombstones', async () => {
    // Besides Cowboy Bebop, only the tombstoned movie contains an "o".
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/search/kinds?q=o' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ kinds: { anime: 1 } });

    const matrix = await app.inject({ method: 'GET', url: '/v1/catalog/search/kinds?q=matrix' });
    expect(matrix.json()).toEqual({ kinds: { movie: 1 } });
    const none = await app.inject({
      method: 'GET',
      url: '/v1/catalog/search/kinds?q=matrix&year=1998',
    });
    expect(none.json()).toEqual({ kinds: {} });
  });

  it('narrows by every listed genre and by status, in hits and counts', async () => {
    const titles = async (query: string) =>
      (await search(query)).results.map((r) => (r as { title: string }).title);
    expect(await titles('q=bebop&genres=action,sci-fi')).toEqual(['Cowboy Bebop']);
    expect(await titles('q=bebop&genres=action,comedy')).toEqual([]);
    expect(await titles('q=bebop&status=ended')).toEqual(['Cowboy Bebop']);
    expect(await titles('q=bebop&status=ongoing')).toEqual([]);

    const counts = await app.inject({
      method: 'GET',
      url: '/v1/catalog/search/kinds?q=o&genres=comedy',
    });
    expect(counts.json()).toEqual({ kinds: {} });
  });

  it('lists genres with counts, commonest first, ignoring tombstones', async () => {
    const all = await app.inject({ method: 'GET', url: '/v1/catalog/genres' });
    expect(all.statusCode).toBe(200);
    expect(all.json()).toEqual({
      genres: [
        { genre: 'action', count: 2 },
        { genre: 'sci-fi', count: 1 },
      ],
    });
    const typed = await app.inject({ method: 'GET', url: '/v1/catalog/genres?q=%20FI' });
    expect(typed.json()).toEqual({ genres: [{ genre: 'sci-fi', count: 1 }] });
    const movies = await app.inject({ method: 'GET', url: '/v1/catalog/genres?kind=movie' });
    expect(movies.json()).toEqual({ genres: [{ genre: 'action', count: 1 }] });
  });
});

describe.runIf(available)('GET /v1/catalog/showcase (postgres)', () => {
  let app: App;
  let db: CatalogDb;

  const id = (n: number) => `5c0a1e2b-3d4f-5a6b-8c7d-${String(n).padStart(12, '0')}`;
  const cover = 'https://example.test/cover.jpg';

  beforeAll(async () => {
    await runCatalogMigrations(TEST_DATABASE_URL);
    db = createCatalogDb(TEST_DATABASE_URL, { max: 1 });
    app = await buildApp({ env: loadCatalogEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' }), db });
  });

  beforeEach(async () => {
    const base = { synonyms: [], status: 'ended' as const, externalIds: {}, coverUrl: cover };
    await db.insert(catalogMedia).values([
      // Anime and manga rank by AniList list users; the rest by rating count.
      {
        ...base,
        id: id(1),
        kind: 'anime',
        title: 'Niche Anime',
        year: 2020,
        genres: ['drama'],
        metadata: { providerPopularity: 900, format: 'tv' },
      },
      {
        ...base,
        id: id(2),
        kind: 'anime',
        title: 'Hit Anime',
        year: 2010,
        genres: ['action'],
        metadata: { providerPopularity: 900_000, format: 'tv' },
      },
      {
        ...base,
        id: id(3),
        kind: 'anime',
        title: 'Hit Anime Music',
        year: 2011,
        genres: [],
        metadata: { providerPopularity: 5_000_000, format: 'music' },
      },
      {
        ...base,
        id: id(4),
        kind: 'anime',
        title: 'Coverless Anime',
        year: 2012,
        genres: [],
        coverUrl: null,
        metadata: { providerPopularity: 9_000_000, format: 'tv' },
      },
      {
        ...base,
        id: id(5),
        kind: 'anime',
        title: 'Spicy Anime',
        year: 2013,
        genres: ['Ecchi'],
        metadata: { providerPopularity: 8_000_000, format: 'tv' },
      },
      {
        ...base,
        id: id(6),
        kind: 'movie',
        title: 'Hit Movie',
        year: 2014,
        genres: ['action'],
        metadata: { ratingCount: 40_000 },
      },
      {
        ...base,
        id: id(7),
        kind: 'movie',
        title: 'Small Movie',
        year: 2014,
        genres: [],
        metadata: { ratingCount: 10_001 },
      },
      {
        ...base,
        id: id(8),
        kind: 'movie',
        title: 'Pulled Movie',
        year: 2014,
        genres: [],
        metadata: { ratingCount: 99_999 },
        deletedAt: new Date(),
      },
      {
        ...base,
        id: id(9),
        kind: 'series',
        title: 'Hit Show',
        year: 2008,
        genres: [],
        seasonNumber: 2,
        metadata: { ratingCount: 20_000 },
      },
      {
        ...base,
        id: id(10),
        kind: 'series',
        title: 'Hit Show',
        year: 2008,
        genres: [],
        seasonNumber: 1,
        metadata: { ratingCount: 20_000 },
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(catalogMedia);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function shelf(query = ''): Promise<{ id: string; kind: string; title: string }[]> {
    const response = await app.inject({ method: 'GET', url: `/v1/catalog/showcase${query}` });
    expect(response.statusCode).toBe(200);
    return (response.json() as { results: { id: string; kind: string; title: string }[] }).results;
  }

  it('round-robins kinds, each led by its most-followed work', async () => {
    const rows = await shelf();
    expect(rows.slice(0, 3).map((row) => row.title)).toEqual([
      'Hit Anime',
      'Hit Movie',
      'Hit Show',
    ]);
  });

  it('ranks within a kind by audience, derived formats and coverless works after', async () => {
    const titles = (await shelf('?kind=anime')).map((row) => row.title);
    expect(titles).toEqual(['Hit Anime', 'Niche Anime', 'Hit Anime Music', 'Coverless Anime']);
  });

  it('keeps tombstoned and ecchi works off, and a series to its first season', async () => {
    const rows = await shelf();
    const ids = rows.map((row) => row.id);
    expect(ids).not.toContain(id(8));
    expect(ids).not.toContain(id(5));
    expect(rows.filter((row) => row.title === 'Hit Show').map((row) => row.id)).toEqual([id(10)]);
  });

  it('applies the year and genre filters, and pages by offset', async () => {
    expect((await shelf('?year=2014')).map((row) => row.title)).toEqual([
      'Hit Movie',
      'Small Movie',
    ]);
    expect((await shelf('?genres=action')).map((row) => row.title)).toEqual([
      'Hit Anime',
      'Hit Movie',
    ]);
    const all = await shelf();
    expect(await shelf('?limit=2&offset=2')).toEqual(all.slice(2, 4));
  });

  it('is cacheable', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/showcase' });
    expect(response.headers['cache-control']).toMatch(/public/);
  });
});

describe.runIf(!available)('GET /v1/catalog/search (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
