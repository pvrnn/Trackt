import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  createDb,
  ensureWatchMetadata,
  media,
  mediaPart,
  runMigrations,
  seedMedia,
  type Db,
} from '@trackt/db';
import {
  canonicalMediaId,
  canonicalSeriesSeasonId,
  loadEnv,
  type CatalogPart,
  type MediaDetail,
} from '@trackt/shared';
import { buildApp, type App } from '../src/app.js';

/**
 * `ensureWatchMetadata` (ADR-0009) against Postgres, with the catalog faked at
 * the fetch layer: a snapshot row gains the runtime and part facts the catalog
 * published after it was materialized, and the detail route serves them.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_WATCH_METADATA ??
  'postgres://trackt:trackt@localhost:5432/trackt_watch_metadata_test';

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

const CATALOG = 'http://catalog.test';
const matrixId = canonicalMediaId('movie', 603);
const breakingBadS1 = canonicalSeriesSeasonId(1396, 1);

const pilot: CatalogPart = { number: 1, title: 'Pilot', runtimeMinutes: 58, airDate: '2008-01-20' };
const episode2: CatalogPart = {
  number: 2,
  title: "Cat's in the Bag...",
  runtimeMinutes: 48,
  airDate: '2008-01-27',
};

/** A catalog that knows `runtimes` per work and `parts` per work; 404 for anything else. */
function fakeCatalog(runtimes: Record<string, number>, parts: Record<string, CatalogPart[]>) {
  return vi.fn<typeof fetch>(async (input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    const partsMatch = /^\/v1\/catalog\/media\/([^/]+)\/parts$/.exec(path);
    if (partsMatch) {
      const list = parts[partsMatch[1]!];
      return list
        ? Response.json({ mediaId: partsMatch[1], parts: list })
        : new Response(null, { status: 404 });
    }
    const mediaMatch = /^\/v1\/catalog\/media\/([^/]+)$/.exec(path);
    const runtime = mediaMatch ? runtimes[mediaMatch[1]!] : undefined;
    if (runtime === undefined) return new Response(null, { status: 404 });
    return Response.json({
      id: mediaMatch![1],
      kind: 'movie',
      title: 'Whatever',
      synonyms: [],
      year: null,
      status: null,
      genres: [],
      partCount: null,
      seasonNumber: null,
      externalIds: { tmdb: 1 },
      description: null,
      coverUrl: null,
      runtimeMinutes: runtime,
    });
  });
}

describe.runIf(available)('ensureWatchMetadata (postgres)', () => {
  let db: Db;
  let app: App;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db });
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    await db.update(media).set({ runtimeMinutes: null });
    await db.delete(mediaPart);
  });

  it("backfills a movie's runtime and serves it on the detail route", async () => {
    const fetchImpl = fakeCatalog({ [matrixId]: 136 }, { [matrixId]: [] });
    await ensureWatchMetadata(db, CATALOG, matrixId, { timeoutMs: 1000, fetchImpl });

    const detail = await app.inject({ method: 'GET', url: `/api/v1/media/${matrixId}` });
    expect(detail.json<MediaDetail>().runtimeMinutes).toBe(136);
    // A movie has no parts to ask for.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fills a season's parts, onto any a check-in already created", async () => {
    await db.insert(mediaPart).values({ mediaId: breakingBadS1, kind: 'episode', number: '1' });
    const fetchImpl = fakeCatalog({}, { [breakingBadS1]: [pilot, episode2] });

    await ensureWatchMetadata(db, CATALOG, breakingBadS1, { timeoutMs: 1000, fetchImpl });

    const parts = await db
      .select({
        number: mediaPart.number,
        title: mediaPart.title,
        runtimeMinutes: mediaPart.runtimeMinutes,
        airDate: mediaPart.airDate,
      })
      .from(mediaPart)
      .where(and(eq(mediaPart.mediaId, breakingBadS1), eq(mediaPart.kind, 'episode')))
      .orderBy(mediaPart.number);
    expect(parts).toEqual([
      { number: '1.00', title: 'Pilot', runtimeMinutes: 58, airDate: '2008-01-20' },
      { number: '2.00', title: "Cat's in the Bag...", runtimeMinutes: 48, airDate: '2008-01-27' },
    ]);
  });

  it('asks the catalog only for what is still missing', async () => {
    const first = fakeCatalog({ [breakingBadS1]: 47 }, { [breakingBadS1]: [pilot] });
    await ensureWatchMetadata(db, CATALOG, breakingBadS1, { timeoutMs: 1000, fetchImpl: first });
    expect(first).toHaveBeenCalledTimes(2);

    const second = fakeCatalog({}, {});
    await ensureWatchMetadata(db, CATALOG, breakingBadS1, { timeoutMs: 1000, fetchImpl: second });
    expect(second).not.toHaveBeenCalled();
  });

  it('leaves the row alone when the catalog knows nothing more', async () => {
    const fetchImpl = fakeCatalog({}, {});
    await ensureWatchMetadata(db, CATALOG, breakingBadS1, { timeoutMs: 1000, fetchImpl });
    const [row] = await db.select().from(media).where(eq(media.id, breakingBadS1));
    expect(row?.runtimeMinutes).toBeNull();
    expect(await db.select().from(mediaPart)).toHaveLength(0);
  });

  it('surfaces a catalog failure to the caller', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 502 }));
    await expect(
      ensureWatchMetadata(db, CATALOG, matrixId, { timeoutMs: 1000, fetchImpl }),
    ).rejects.toThrow(/502/);
  });
});
