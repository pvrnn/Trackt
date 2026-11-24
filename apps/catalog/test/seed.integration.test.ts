import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalMediaId, canonicalSeriesSeasonId, type SlimMedia } from '@trackt/shared';
import {
  catalogMedia,
  createCatalogDb,
  runCatalogMigrations,
  type CatalogDb,
} from '../src/db/index.js';
import { retireFoldedDuplicates, seedCatalog } from '../src/seed.js';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_CATALOG_SEED ??
  'postgres://trackt:trackt@localhost:5433/trackt_catalog_seed_test';

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

function media(overrides: Partial<SlimMedia> & Pick<SlimMedia, 'id' | 'kind'>): SlimMedia {
  return {
    title: 'Work',
    synonyms: [],
    year: 2022,
    status: 'ended',
    genres: ['animation'],
    partCount: null,
    seasonNumber: null,
    externalIds: {},
    description: null,
    coverUrl: null,
    metadata: {},
    bannerUrl: null,
    ...overrides,
  };
}

const anime = media({
  id: canonicalMediaId('anime', 120377),
  kind: 'anime',
  externalIds: { anilist: 120377, tmdb: 105248 },
  metadata: { tmdb: { id: 105248, kind: 'series', seasonNumber: 1 } },
});
const foldedSeason = media({
  id: canonicalSeriesSeasonId(105248, 1),
  kind: 'series',
  seasonNumber: 1,
  externalIds: { tmdb: 105248 },
});
const otherSeason = media({
  id: canonicalSeriesSeasonId(105248, 2),
  kind: 'series',
  seasonNumber: 2,
  externalIds: { tmdb: 105248 },
});
const animeFilm = media({
  id: canonicalMediaId('anime', 21519),
  kind: 'anime',
  externalIds: { anilist: 21519, tmdb: 372058 },
  metadata: { tmdb: { id: 372058, kind: 'movie' } },
});
const foldedFilm = media({
  id: canonicalMediaId('movie', 372058),
  kind: 'movie',
  externalIds: { tmdb: 372058 },
});
const unrelatedFilm = media({
  id: canonicalMediaId('movie', 603),
  kind: 'movie',
  externalIds: { tmdb: 603 },
});

describe.runIf(available)('retireFoldedDuplicates (postgres)', () => {
  let db: CatalogDb;

  beforeAll(async () => {
    await runCatalogMigrations(TEST_DATABASE_URL);
    db = createCatalogDb(TEST_DATABASE_URL, { max: 1 });
  });

  beforeEach(async () => {
    await db.delete(catalogMedia);
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  async function liveIds(): Promise<string[]> {
    const rows = await db
      .select({ id: catalogMedia.id, deletedAt: catalogMedia.deletedAt })
      .from(catalogMedia);
    return rows
      .filter((row) => row.deletedAt === null)
      .map((row) => row.id)
      .sort();
  }

  it('soft-deletes exactly the TMDB rows an anime row has absorbed, and is idempotent', async () => {
    await seedCatalog(db, {
      catalog_media: [anime, foldedSeason, otherSeason, animeFilm, foldedFilm, unrelatedFilm],
      catalog_media_relation: [],
    });

    expect(await retireFoldedDuplicates(db)).toBe(2);
    expect(await liveIds()).toEqual(
      [anime.id, otherSeason.id, animeFilm.id, unrelatedFilm.id].sort(),
    );
    expect(await retireFoldedDuplicates(db)).toBe(0);
  });
});
