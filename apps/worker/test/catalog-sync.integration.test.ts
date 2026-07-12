import { createServer, type Server } from 'node:http';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import postgres from 'postgres';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, media, runMigrations, syncState, type Db } from '@trackt/db';
import { canonicalMediaId, type CatalogChange } from '@trackt/shared';
import { CATALOG_SYNC_CURSOR_KEY, runCatalogSync } from '../src/catalog-sync.js';

/**
 * Postgres-backed sync tests against the dev compose database
 * (`docker compose -f docker-compose.dev.yml up -d`). The suite creates and
 * migrates its own `trackt_worker_test` database and self-skips when Postgres
 * is down, so `pnpm test` stays green without Docker. The central catalog is
 * a local stub server speaking the /v1/catalog/changes contract.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://trackt:trackt@localhost:5432/trackt_worker_test';

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

/** Minimal catalog stub: serves `stream` through the changes contract, capping pages at `pageSize`. */
function catalogStub(stream: CatalogChange[], pageSize = 2): Server {
  return createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname !== '/v1/catalog/changes') {
      res.writeHead(404).end();
      return;
    }
    const since = Number(url.searchParams.get('since') ?? 0);
    const pending = stream.filter((change) => change.seq > since);
    const page = pending.slice(0, pageSize);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        latestVersion: stream.at(-1)?.seq ?? 0,
        nextSince: pending.length > pageSize ? page.at(-1)!.seq : null,
        changes: page,
      }),
    );
  });
}

function change(
  partial: Partial<CatalogChange> & Pick<CatalogChange, 'id' | 'seq'>,
): CatalogChange {
  return {
    kind: 'movie',
    title: 'Untitled',
    synonyms: [],
    year: null,
    status: null,
    genres: [],
    episodeCount: null,
    seasonCount: null,
    chapterCount: null,
    volumeCount: null,
    externalIds: {},
    description: null,
    coverUrl: null,
    deletedAt: null,
    ...partial,
  };
}

const logger = pino({ level: 'silent' });

describe.runIf(available)('runCatalogSync (postgres)', () => {
  let db: Db;
  let server: Server;
  let catalogUrl: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
  });

  afterEach(async () => {
    server?.close();
    await db.delete(media);
    await db.delete(syncState);
  });

  async function serve(stream: CatalogChange[], pageSize?: number): Promise<void> {
    server = catalogStub(stream, pageSize);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    catalogUrl = `http://127.0.0.1:${address.port}`;
  }

  async function cursor(): Promise<number | undefined> {
    const [row] = await db
      .select({ cursor: syncState.cursor })
      .from(syncState)
      .where(eq(syncState.key, CATALOG_SYNC_CURSOR_KEY));
    return row?.cursor;
  }

  const matrixId = canonicalMediaId('movie', 603);
  const bebopId = canonicalMediaId('anime', 1);

  it('performs an initial full sync across pages and persists the cursor', async () => {
    await serve(
      [
        change({ id: matrixId, seq: 1, title: 'The Matrix', year: 1999, genres: ['action'] }),
        change({ id: bebopId, seq: 2, kind: 'anime', title: 'Cowboy Bebop', year: 1998 }),
        change({ id: canonicalMediaId('movie', 129), seq: 3, title: 'Spirited Away', year: 2001 }),
      ],
      2,
    );

    const result = await runCatalogSync({ db, catalogUrl, logger });

    expect(result).toMatchObject({ pages: 2, upserted: 3, deleted: 0, cursor: 3 });
    expect(await cursor()).toBe(3);
    const rows = await db.select().from(media);
    expect(rows).toHaveLength(3);
    const matrix = rows.find((row) => row.id === matrixId);
    expect(matrix).toMatchObject({
      title: 'The Matrix',
      slug: 'the-matrix-1999',
      source: 'provider',
      moderation: 'verified',
    });
  });

  it('applies incremental updates without churning slugs or clobbering enrichment', async () => {
    await serve([change({ id: matrixId, seq: 1, title: 'The Matrix', year: 1999 })]);
    await runCatalogSync({ db, catalogUrl, logger });
    server.close();

    // Instance-local enrichment (ADR-0001) that a slim (null) update must not erase.
    await db
      .update(media)
      .set({ description: 'local enrichment', coverUrl: 'https://covers.local/matrix.jpg' })
      .where(eq(media.id, matrixId));

    await serve([
      change({ id: matrixId, seq: 1, title: 'The Matrix', year: 1999 }),
      change({ id: matrixId, seq: 5, title: 'The Matrix (1999)', year: 1999, genres: ['sci-fi'] }),
    ]);
    const result = await runCatalogSync({ db, catalogUrl, logger });

    expect(result).toMatchObject({ upserted: 1, cursor: 5 });
    const [row] = await db.select().from(media).where(eq(media.id, matrixId));
    expect(row).toMatchObject({
      title: 'The Matrix (1999)',
      slug: 'the-matrix-1999', // unchanged: slugs are assigned on insert only
      genres: ['sci-fi'],
      description: 'local enrichment',
      coverUrl: 'https://covers.local/matrix.jpg',
    });
  });

  it('honors tombstones for provider rows and leaves user-created entries alone', async () => {
    const userRowId = '7b0f4c3a-1111-4222-8333-944445555666';
    await db.insert(media).values({
      id: userRowId,
      kind: 'webtoon',
      title: 'Cosmic Delivery Club',
      slug: 'cosmic-delivery-club',
      source: 'user',
      moderation: 'unverified',
    });
    await serve([change({ id: matrixId, seq: 1, title: 'The Matrix', year: 1999 })]);
    await runCatalogSync({ db, catalogUrl, logger });
    server.close();

    await serve([
      change({ id: matrixId, seq: 1, title: 'The Matrix', year: 1999 }),
      change({ id: matrixId, seq: 7, title: 'The Matrix', deletedAt: new Date().toISOString() }),
      change({
        id: userRowId,
        seq: 8,
        title: 'Cosmic Delivery Club',
        deletedAt: new Date().toISOString(),
      }),
    ]);
    const result = await runCatalogSync({ db, catalogUrl, logger });

    expect(result).toMatchObject({ deleted: 2, cursor: 8 });
    const rows = await db.select().from(media);
    expect(rows.map((row) => row.id)).toEqual([userRowId]);
  });

  it('resolves slug collisions between different works deterministically', async () => {
    const otherId = canonicalMediaId('movie', 999999);
    await serve([
      change({ id: matrixId, seq: 1, title: 'The Matrix', year: 1999 }),
      change({ id: otherId, seq: 2, title: 'The Matrix', year: 1999 }),
    ]);
    const result = await runCatalogSync({ db, catalogUrl, logger });

    expect(result).toMatchObject({ upserted: 2 });
    const rows = await db.select().from(media);
    const slugs = rows.map((row) => row.slug).sort();
    expect(slugs).toContain('the-matrix-1999');
    expect(slugs).toContain(`the-matrix-1999-${otherId.slice(0, 8)}`);
  });

  it('resumes from the persisted cursor instead of refetching history', async () => {
    await db.insert(syncState).values({ key: CATALOG_SYNC_CURSOR_KEY, cursor: 10 });
    await serve([
      change({ id: matrixId, seq: 9, title: 'Stale Change That Must Not Apply', year: 1999 }),
      change({ id: bebopId, seq: 11, kind: 'anime', title: 'Cowboy Bebop', year: 1998 }),
    ]);
    const result = await runCatalogSync({ db, catalogUrl, logger });

    expect(result).toMatchObject({ upserted: 1, cursor: 11 });
    const rows = await db.select().from(media);
    expect(rows.map((row) => row.title)).toEqual(['Cowboy Bebop']);
  });
});

describe.runIf(!available)('runCatalogSync (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
