import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createDb, media, mediaRelation, runMigrations, seedMedia, type Db } from '@trackt/db';
import { canonicalMediaId, loadEnv, type MediaDetail } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for the federated half of typed relations (ADR-0004):
 * edges served live by the central catalog, the lazy materialization of targets
 * this instance has never seen, and the degradation posture when the catalog is
 * unreachable. Self-skips when Postgres is down, so `pnpm test` stays green
 * without Docker.
 *
 * The purely local paths (stored edges, derived season siblings) are covered by
 * tracking.integration.test.ts, which runs with CATALOG_URL unset.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_RELATIONS ??
  'postgres://trackt:trackt@localhost:5432/trackt_relations_test';

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

/** The seeded work whose detail page we load throughout. */
const bebopId = canonicalMediaId('anime', 1);
const bebopSlug = 'cowboy-bebop-1998';

const absentTargetId = '5b6e0f1a-2c3d-4e5f-8a9b-0c1d2e3f4a5b';
const slugCollisionTargetId = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const softDeletedTargetId = '6c7f1a2b-3d4e-4f5a-9b8c-1d2e3f4a5b6c';

/** Minimal central-catalog stub serving the /v1/catalog/relations contract. */
function catalogStub(
  handler: (query: URLSearchParams) => { relations: unknown[] } | 'error',
  onRequest?: () => void,
): Server {
  return createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    if (url.pathname !== '/v1/catalog/relations') {
      res.writeHead(404).end();
      return;
    }
    onRequest?.();
    const outcome = handler(url.searchParams);
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

/** A full relation edge with only the fields under test varying. */
function edge(overrides: {
  id: string;
  title: string;
  type?: string;
  direction?: string;
  kind?: string;
  year?: number;
}): Record<string, unknown> {
  return {
    kind: 'anime',
    synonyms: [],
    year: 2024,
    status: 'ended',
    genres: [],
    partCount: 12,
    seasonNumber: null,
    externalIds: {},
    description: null,
    coverUrl: null,
    type: 'sequel',
    direction: 'forward',
    ...overrides,
  };
}

describe.runIf(available)('media detail relations — federated (postgres)', () => {
  let db: Db;
  let server: Server | undefined;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
  });

  afterEach(async () => {
    server?.close();
    server = undefined;
    await db.delete(mediaRelation);
    await db
      .delete(media)
      .where(inArray(media.id, [absentTargetId, slugCollisionTargetId, softDeletedTargetId]));
  });

  afterAll(async () => {
    server?.close();
  });

  /** Build an app pointed at `catalogUrl` (empty string disables federation). */
  async function appWith(catalogUrl: string): Promise<App> {
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      CATALOG_URL: catalogUrl,
      CATALOG_RELATIONS_TIMEOUT_MS: '400',
    });
    return buildApp({ env, db, auth: createAuth(db, env) });
  }

  async function detailVia(app: App, idOrSlug = bebopSlug): Promise<MediaDetail> {
    const response = await app.inject({ method: 'GET', url: `/api/v1/media/${idOrSlug}` });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('materializes a target it has never seen and answers with the persisted slug', async () => {
    server = catalogStub(() => ({
      relations: [edge({ id: absentTargetId, title: 'Bebop Continues', year: 2001 })],
    }));
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      expect(detail.relations).toEqual([
        expect.objectContaining({ id: absentTargetId, relation: 'sequel', kind: 'anime' }),
      ]);

      const [row] = await db.select().from(media).where(eq(media.id, absentTargetId)).limit(1);
      expect(row).toMatchObject({ source: 'provider', moderation: 'verified' });
      // The response must carry the slug as persisted, never the requested one.
      expect(detail.relations[0]!.slug).toBe(row!.slug);
    } finally {
      await app.close();
    }
  });

  it('answers with the suffixed slug when the natural slug is taken', async () => {
    // A different work already owns the slug this title would generate.
    await db.insert(media).values({
      id: slugCollisionTargetId,
      kind: 'anime',
      title: 'Slug Owner',
      slug: 'bebop-continues-2001',
      externalIds: {},
    });
    server = catalogStub(() => ({
      relations: [edge({ id: absentTargetId, title: 'Bebop Continues', year: 2001 })],
    }));
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      const [row] = await db.select().from(media).where(eq(media.id, absentTargetId)).limit(1);
      expect(row!.slug).toBe(`bebop-continues-2001-${absentTargetId.slice(0, 8)}`);
      expect(detail.relations[0]!.slug).toBe(row!.slug);
    } finally {
      await app.close();
    }
  });

  it('reverses a catalog edge into its display label', async () => {
    server = catalogStub(() => ({
      relations: [
        edge({
          id: absentTargetId,
          title: 'Bebop Source Manga',
          kind: 'manga',
          type: 'adaptation',
          direction: 'reverse',
        }),
      ],
    }));
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      expect(detail.relations[0]).toMatchObject({ relation: 'source', kind: 'manga' });
    } finally {
      await app.close();
    }
  });

  it('keeps good edges when one carries an unknown relation type', async () => {
    server = catalogStub(() => ({
      relations: [
        edge({ id: slugCollisionTargetId, title: 'Unknown Type', type: 'remake' }),
        edge({ id: absentTargetId, title: 'Known Type' }),
      ],
    }));
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      expect(detail.relations.map((item) => item.id)).toEqual([absentTargetId]);
    } finally {
      await app.close();
    }
  });

  it('never resurrects a soft-deleted target, and never re-inserts it', async () => {
    await db.insert(media).values({
      id: softDeletedTargetId,
      kind: 'anime',
      title: 'Pulled From Circulation',
      slug: 'pulled-from-circulation',
      externalIds: {},
      deletedAt: new Date(),
    });
    server = catalogStub(() => ({
      relations: [edge({ id: softDeletedTargetId, title: 'Pulled From Circulation' })],
    }));
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      expect(detail.relations).toEqual([]);
      const [row] = await db.select().from(media).where(eq(media.id, softDeletedTargetId)).limit(1);
      expect(row!.deletedAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('degrades to local-only when the catalog errors', async () => {
    server = catalogStub(() => 'error');
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      expect(detail.relations).toEqual([]);
      // The page still renders everything else, including the fallback list.
      expect(detail.id).toBe(bebopId);
      expect(detail.related.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('degrades to local-only when the catalog is unreachable', async () => {
    // A port nobody is listening on — connection refused, not a timeout.
    const app = await appWith('http://127.0.0.1:1');
    try {
      const detail = await detailVia(app);
      expect(detail.relations).toEqual([]);
      expect(detail.id).toBe(bebopId);
    } finally {
      await app.close();
    }
  });

  it('does not call the catalog at all when CATALOG_URL is unset', async () => {
    let calls = 0;
    server = catalogStub(
      () => ({ relations: [] }),
      () => (calls += 1),
    );
    await listen(server);
    const app = await appWith('');
    try {
      await detailVia(app);
      expect(calls).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('skips the fan-out for a work that already has stored edges', async () => {
    let calls = 0;
    const frierenId = canonicalMediaId('anime', 154587);
    await db.insert(mediaRelation).values({ fromId: bebopId, toId: frierenId, type: 'related' });
    server = catalogStub(
      () => ({ relations: [edge({ id: absentTargetId, title: 'Should Not Be Fetched' })] }),
      () => (calls += 1),
    );
    const app = await appWith(await listen(server));
    try {
      const detail = await detailVia(app);
      expect(calls).toBe(0);
      expect(detail.relations.map((item) => item.id)).toEqual([frierenId]);
    } finally {
      await app.close();
    }
  });

  it('still calls the catalog when only derived siblings exist', async () => {
    // A series season with a sibling derives locally but has no stored edge, so
    // the fan-out must still happen — that's how it finds its adaptation.
    let calls = 0;
    server = catalogStub(
      () => ({ relations: [] }),
      () => (calls += 1),
    );
    const app = await appWith(await listen(server));
    try {
      await detailVia(app, 'breaking-bad-2008-s1');
      expect(calls).toBe(1);
    } finally {
      await app.close();
    }
  });
});

describe.runIf(!available)('media detail relations — federated (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
