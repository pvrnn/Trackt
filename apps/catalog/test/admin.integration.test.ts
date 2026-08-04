import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  canonicalMediaId,
  canonicalSeriesSeasonId,
  loadCatalogEnv,
  type SlimMedia,
} from '@trackt/shared';
import {
  catalogMedia,
  catalogMediaRelation,
  createCatalogDb,
  runCatalogMigrations,
  type CatalogDb,
} from '../src/db/index.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for the publish path (ADR-0001) against the dev compose
 * catalog database. Self-skips when Postgres is down, so `pnpm test` stays green
 * without Docker.
 *
 * The load-bearing assertions are the ones about identity: a canonical id is
 * frozen forever, so a publisher must never be able to store a row under an id
 * that doesn't derive from its own external id.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_CATALOG_ADMIN ??
  'postgres://trackt:trackt@localhost:5433/trackt_catalog_admin_test';

const ADMIN_TOKEN = 'test-admin-token-16chars';

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

/** The Matrix — the movie fixture the unit tests use, with a real derived id. */
function movie(overrides: Partial<SlimMedia> = {}): SlimMedia {
  return {
    id: canonicalMediaId({ kind: 'movie', title: 'The Matrix', year: 1999 }),
    kind: 'movie',
    title: 'The Matrix',
    synonyms: ['Matrix'],
    year: 1999,
    status: 'ended',
    genres: ['action'],
    partCount: null,
    seasonNumber: null,
    discriminator: null,
    externalIds: { tmdb: 603 },
    description: null,
    coverUrl: null,
    ...overrides,
  };
}

function manga(overrides: Partial<SlimMedia> = {}): SlimMedia {
  return {
    id: canonicalMediaId({ kind: 'manga', title: 'Fullmetal Alchemist', year: 2001 }),
    kind: 'manga',
    title: 'Fullmetal Alchemist',
    synonyms: [],
    year: 2001,
    status: 'ended',
    genres: ['action'],
    partCount: 116,
    seasonNumber: null,
    discriminator: null,
    externalIds: { anilist: 30025 },
    description: null,
    coverUrl: null,
    ...overrides,
  };
}

describe.runIf(available)('POST /v1/admin (postgres)', () => {
  let app: App;
  let db: CatalogDb;

  beforeAll(async () => {
    await runCatalogMigrations(TEST_DATABASE_URL);
    db = createCatalogDb(TEST_DATABASE_URL, { max: 1 });
    app = await buildApp({
      env: loadCatalogEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        CATALOG_ADMIN_TOKEN: ADMIN_TOKEN,
      }),
      db,
    });
  });

  afterEach(async () => {
    // Per-suite databases are never dropped, so rows leak into later runs unless
    // each test cleans up after itself.
    await db.delete(catalogMediaRelation);
    await db.delete(catalogMedia);
  });

  afterAll(async () => {
    await app?.close();
  });

  function publishMedia(payload: unknown, token: string | null = ADMIN_TOKEN) {
    return app.inject({
      method: 'POST',
      url: '/v1/admin/media',
      payload: payload as Record<string, unknown>,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  function publishRelation(payload: unknown, token: string | null = ADMIN_TOKEN) {
    return app.inject({
      method: 'POST',
      url: '/v1/admin/relations',
      payload: payload as Record<string, unknown>,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  }

  describe('POST /v1/admin/media', () => {
    it('rejects a missing or wrong token before touching the database', async () => {
      expect((await publishMedia(movie(), null)).statusCode).toBe(401);
      expect((await publishMedia(movie(), 'wrong')).statusCode).toBe(401);
      expect(await db.select().from(catalogMedia)).toHaveLength(0);
    });

    it('publishes a new work and reports created', async () => {
      const response = await publishMedia(movie());
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: canonicalMediaId({ kind: 'movie', title: 'The Matrix', year: 1999 }),
        created: true,
      });
      expect(response.json().seq).toBeGreaterThan(0);

      const [row] = await db.select().from(catalogMedia);
      expect(row).toMatchObject({ title: 'The Matrix', kind: 'movie', year: 1999 });
    });

    it('is idempotent: a re-send updates in place and reports created: false', async () => {
      const first = await publishMedia(movie());
      // A rename keeps the original id: identity is frozen at first publish, so
      // the guard does not re-derive it (ADR-0005).
      const second = await publishMedia(movie({ title: 'The Matrix (Remastered)' }));

      expect(second.statusCode).toBe(200);
      expect(second.json().created).toBe(false);
      expect(await db.select().from(catalogMedia)).toHaveLength(1);

      const [row] = await db.select().from(catalogMedia);
      expect(row?.title).toBe('The Matrix (Remastered)');
      // The seq trigger fires on UPDATE too, so a real change advances the cursor.
      expect(second.json().seq).toBeGreaterThan(first.json().seq);
    });

    it('advances seq monotonically across sequential publishes', async () => {
      const seqs = [
        (await publishMedia(movie())).json().seq,
        (await publishMedia(manga())).json().seq,
        (await publishMedia(movie({ title: 'Changed' }))).json().seq,
      ];
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(new Set(seqs).size).toBe(3);
    });

    it('rejects an id that does not derive from its own external id', async () => {
      const response = await publishMedia(
        movie({ id: canonicalMediaId({ kind: 'movie', title: 'A Different Film', year: 1999 }) }),
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/canonical id mismatch/);
      expect(await db.select().from(catalogMedia)).toHaveLength(0);
    });

    it('accepts a work with no external ids — identity is not provider-derived', async () => {
      // The inverse of the old rule (ADR-0005): externalIds are cross-references,
      // so a work nobody has catalogued upstream still publishes under a real id.
      const response = await publishMedia(movie({ externalIds: {} }));
      expect(response.statusCode).toBe(200);
      expect(response.json().created).toBe(true);
    });

    it('derives a series id from the show id AND the season number (ADR-0003)', async () => {
      const season2 = {
        id: canonicalSeriesSeasonId('Breaking Bad', 2009, 2),
        kind: 'series' as const,
        title: 'Breaking Bad',
        synonyms: [],
        year: 2009,
        status: 'ended' as const,
        genres: ['drama'],
        partCount: 13,
        seasonNumber: 2,
        discriminator: null,
        externalIds: { tmdb: 1396 },
        description: null,
        coverUrl: null,
      };
      // The season number is part of identity, so an id derived for S2 does not
      // match a body describing S1. Checked BEFORE S2 exists: the guard runs on
      // create only, so once the id is taken this same post is a legal update.
      const collision = await publishMedia({ ...season2, seasonNumber: 1 });
      expect(collision.statusCode).toBe(400);
      expect(collision.json().error).toMatch(/canonical id mismatch/);

      expect((await publishMedia(season2)).statusCode).toBe(200);
    });

    it('rejects a series with no season number', async () => {
      const response = await publishMedia({
        ...movie(),
        id: canonicalMediaId({ kind: 'series', title: 'The Matrix', year: 1999 }),
        kind: 'series',
        externalIds: { tmdb: 1396 },
        seasonNumber: null,
        discriminator: null,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/seasonNumber/);
    });

    it('derives a webtoon id like any other kind — no provider needed', async () => {
      const response = await publishMedia({
        ...movie(),
        id: canonicalMediaId({ kind: 'webtoon', title: 'Tower of God', year: 1999 }),
        kind: 'webtoon',
        title: 'Tower of God',
        partCount: 600,
        externalIds: {},
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().created).toBe(true);
    });

    it('resurrects a tombstoned work on republish', async () => {
      await publishMedia(movie());
      await db.update(catalogMedia).set({ deletedAt: new Date() });

      const response = await publishMedia(movie());
      expect(response.statusCode).toBe(200);
      expect(response.json().created).toBe(false);
      const [row] = await db.select().from(catalogMedia);
      expect(row?.deletedAt).toBeNull();
    });
  });

  describe('POST /v1/admin/relations', () => {
    const mangaId = canonicalMediaId({ kind: 'manga', title: 'Fullmetal Alchemist', year: 2001 });
    const animeId = canonicalMediaId({
      kind: 'anime',
      title: 'Fullmetal Alchemist: Brotherhood',
      year: 2009,
      // The fixture below is a season row, and the season number is part of the key.
      seasonNumber: 1,
    });

    async function seedPair() {
      await publishMedia(manga());
      await publishMedia({
        ...manga(),
        id: animeId,
        kind: 'anime',
        title: 'Fullmetal Alchemist: Brotherhood',
        // Spread from manga(), which is a 2001 work — the anime is 2009, and the
        // year is part of the id, so it has to be overridden alongside the title.
        year: 2009,
        partCount: 64,
        seasonNumber: 1,
        discriminator: null,
        externalIds: { anilist: 5114 },
      });
    }

    it('publishes a forward edge and reports created', async () => {
      await seedPair();
      const response = await publishRelation({
        fromId: mangaId,
        toId: animeId,
        type: 'adaptation',
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ created: true });

      const [edge] = await db.select().from(catalogMediaRelation);
      expect(edge).toMatchObject({ fromId: mangaId, toId: animeId, type: 'adaptation' });
    });

    it('is idempotent on the three-column key', async () => {
      await seedPair();
      const body = { fromId: mangaId, toId: animeId, type: 'adaptation' };
      expect((await publishRelation(body)).json().created).toBe(true);
      expect((await publishRelation(body)).json().created).toBe(false);
      expect(await db.select().from(catalogMediaRelation)).toHaveLength(1);
    });

    it('lets one pair carry two edges of different types', async () => {
      await seedPair();
      await publishRelation({ fromId: mangaId, toId: animeId, type: 'adaptation' });
      const second = await publishRelation({ fromId: mangaId, toId: animeId, type: 'related' });
      expect(second.json().created).toBe(true);
      expect(await db.select().from(catalogMediaRelation)).toHaveLength(2);
    });

    it('rejects a self-edge with 400, not a constraint 500', async () => {
      await seedPair();
      const response = await publishRelation({
        fromId: mangaId,
        toId: mangaId,
        type: 'related',
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/itself/);
    });

    it('404s when an endpoint does not exist', async () => {
      await seedPair();
      const unknown = '99999999-9999-5999-8999-999999999999';
      const response = await publishRelation({ fromId: mangaId, toId: unknown, type: 'sequel' });
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain(unknown);
      expect(await db.select().from(catalogMediaRelation)).toHaveLength(0);
    });

    it('404s when an endpoint is tombstoned — the read route would drop the edge anyway', async () => {
      await seedPair();
      await db.update(catalogMedia).set({ deletedAt: new Date() });
      const response = await publishRelation({
        fromId: mangaId,
        toId: animeId,
        type: 'adaptation',
      });
      expect(response.statusCode).toBe(404);
    });

    it('serves a published edge back through the public read route', async () => {
      await seedPair();
      await publishRelation({ fromId: mangaId, toId: animeId, type: 'adaptation' });

      const read = await app.inject({
        method: 'GET',
        url: `/v1/catalog/relations?id=${animeId}`,
      });
      expect(read.statusCode).toBe(200);
      // Stored forward, read backwards: the type is unflipped and the direction
      // says how it was reached (ADR-0004).
      expect(read.json().relations).toMatchObject([
        { id: mangaId, type: 'adaptation', direction: 'reverse' },
      ]);
    });
  });
});

describe.runIf(!available)('POST /v1/admin (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
