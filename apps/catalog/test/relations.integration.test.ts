import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadCatalogEnv, type CatalogRelationEdge } from '@trackt/shared';
import {
  catalogMedia,
  catalogMediaRelation,
  createCatalogDb,
  runCatalogMigrations,
  type CatalogDb,
} from '../src/db/index.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for the relation lookup (ADR-0004) against the dev
 * compose catalog database. Self-skips when Postgres is down, so `pnpm test`
 * stays green without Docker.
 *
 * The load-bearing assertion here is that this service never flips a stored type:
 * a reverse traversal returns `{type: 'adaptation', direction: 'reverse'}`, and
 * rendering that as "source" is the consumer's job.
 */

// Distinct from the api-side suite's TEST_DATABASE_URL_RELATIONS: that one names
// the instance database on 5432, this one the catalog database on 5433.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_CATALOG_RELATIONS ??
  'postgres://trackt:trackt@localhost:5433/trackt_catalog_relations_test';

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

const mangaId = '11111111-1111-5111-8111-111111111111';
const animeId = '22222222-2222-5222-8222-222222222222';
const spinoffId = '33333333-3333-5333-8333-333333333333';
const tombstonedId = '44444444-4444-5444-8444-444444444444';

describe.runIf(available)('GET /v1/catalog/relations (postgres)', () => {
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
        id: mangaId,
        kind: 'manga',
        title: 'Fullmetal Alchemist',
        synonyms: [],
        year: 2001,
        status: 'ended',
        genres: ['action'],
        partCount: 116,
        externalIds: { anilist: 30025 },
      },
      {
        id: animeId,
        kind: 'anime',
        title: 'Fullmetal Alchemist: Brotherhood',
        synonyms: [],
        year: 2009,
        status: 'ended',
        genres: ['action'],
        partCount: 64,
        seasonNumber: 1,
        externalIds: { anilist: 5114 },
      },
      {
        id: spinoffId,
        kind: 'anime',
        title: 'FMA Side Story',
        synonyms: [],
        year: 2010,
        status: 'ended',
        genres: [],
        externalIds: {},
      },
      {
        id: tombstonedId,
        kind: 'anime',
        title: 'Tombstoned Adaptation',
        synonyms: [],
        year: 2011,
        status: 'ended',
        genres: [],
        externalIds: {},
        deletedAt: new Date(),
      },
    ]);
    await db.insert(catalogMediaRelation).values([
      { fromId: mangaId, toId: animeId, type: 'adaptation' },
      { fromId: animeId, toId: spinoffId, type: 'spinoff' },
      // Points at a tombstoned work — must never surface.
      { fromId: mangaId, toId: tombstonedId, type: 'adaptation' },
    ]);
  });

  afterEach(async () => {
    // Relations first would also work via cascade, but be explicit.
    await db.delete(catalogMediaRelation);
    await db.delete(catalogMedia);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function relations(
    query: string,
  ): Promise<{ statusCode: number; relations: CatalogRelationEdge[] }> {
    const response = await app.inject({ method: 'GET', url: `/v1/catalog/relations?${query}` });
    const body = response.json() as { relations: CatalogRelationEdge[] };
    return { statusCode: response.statusCode, relations: body.relations };
  }

  it('returns forward edges with the target work inlined', async () => {
    const { statusCode, relations: edges } = await relations(`id=${mangaId}`);
    expect(statusCode).toBe(200);
    const adaptation = edges.find((edge) => edge.id === animeId);
    expect(adaptation).toMatchObject({
      id: animeId,
      title: 'Fullmetal Alchemist: Brotherhood',
      kind: 'anime',
      type: 'adaptation',
      direction: 'forward',
      partCount: 64,
      seasonNumber: 1,
    });
  });

  it('returns reverse edges with the stored type unflipped', async () => {
    const { relations: edges } = await relations(`id=${animeId}`);
    const source = edges.find((edge) => edge.id === mangaId);
    // Not 'source' — the label is the consumer's to derive (ADR-0004 point 1).
    expect(source).toMatchObject({ type: 'adaptation', direction: 'reverse' });
  });

  it('serves both directions for a work that is a target and a source', async () => {
    const { relations: edges } = await relations(`id=${animeId}`);
    expect(
      edges
        .map((edge) => [edge.id, edge.type, edge.direction])
        .sort((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
    ).toEqual([
      [mangaId, 'adaptation', 'reverse'],
      [spinoffId, 'spinoff', 'forward'],
    ]);
  });

  it('excludes edges whose target is tombstoned', async () => {
    const { relations: edges } = await relations(`id=${mangaId}`);
    expect(edges.map((edge) => edge.id)).not.toContain(tombstonedId);
  });

  it('respects the limit', async () => {
    const { relations: edges } = await relations(`id=${animeId}&limit=1`);
    expect(edges).toHaveLength(1);
  });

  it('returns an empty list (not a 404) for a work with no edges', async () => {
    const { statusCode, relations: edges } = await relations(`id=${spinoffId}&limit=50`);
    expect(statusCode).toBe(200);
    // spinoffId is only ever a target, so it has exactly the one reverse edge.
    expect(edges.map((edge) => [edge.id, edge.direction])).toEqual([[animeId, 'reverse']]);
  });

  it('returns an empty list for an unknown id', async () => {
    const { statusCode, relations: edges } = await relations(
      'id=99999999-9999-5999-8999-999999999999',
    );
    expect(statusCode).toBe(200);
    expect(edges).toEqual([]);
  });

  it('rejects a non-uuid id', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/catalog/relations?id=nope' });
    expect(response.statusCode).toBe(400);
  });
});

describe.runIf(!available)('GET /v1/catalog/relations (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
