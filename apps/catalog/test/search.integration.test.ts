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
});

describe.runIf(!available)('GET /v1/catalog/search (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
