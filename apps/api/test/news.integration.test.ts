import { createServer, type Server } from 'node:http';
import { eq, inArray } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, media, runMigrations, type Db } from '@trackt/db';
import { loadEnv, type NewsArticleDetail, type NewsListResponse } from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';
import { clearNewsCache } from '../src/lib/news.js';

/**
 * Postgres-backed tests for the instance's news proxy (ADR-0005): the
 * degradation posture when the catalog is unreachable, the TTL memo, and the
 * lazy materialization that gives a linked work a local slug to route to.
 * Self-skips when Postgres is down, so `pnpm test` stays green without Docker.
 *
 * The load-bearing assertion is that a dead catalog yields **200 with an empty
 * feed**, never a 500 — a self-hoster's News page goes quiet, not broken.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_NEWS ?? 'postgres://trackt:trackt@localhost:5432/trackt_news_test';

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

const linkedWorkId = '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';
const collidingWorkId = '8b2c3d4e-5f6a-4b7c-8d9e-1f2a3b4c5d6e';

const summary = {
  id: '0f9c1b2a-3d4e-4f6a-8b9c-0d1e2f3a4b5c',
  slug: 'neon-harbor-renewed',
  title: 'Neon Harbor renewed for a third season',
  dek: 'Ten episodes, same showrunner.',
  topic: 'renewal',
  kinds: ['series'],
  coverUrl: null,
  publishedAt: '2026-08-01T09:00:00.000Z',
};

/** A full SlimMedia + role, as the catalog inlines linked works. */
function work(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    kind: 'series',
    synonyms: [],
    year: 2024,
    status: 'airing',
    genres: ['drama'],
    partCount: 10,
    seasonNumber: 2,
    externalIds: { tmdb: 4242 },
    description: null,
    coverUrl: null,
    role: 'subject',
    ...overrides,
  };
}

type StubOutcome = { status?: number; body?: unknown } | 'hang';

/** Minimal central-catalog stub serving the /v1/news contracts. */
function catalogStub(
  handler: (pathname: string, query: URLSearchParams) => StubOutcome,
  onRequest?: (pathname: string) => void,
): Server {
  return createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    onRequest?.(url.pathname);
    const outcome = handler(url.pathname, url.searchParams);
    if (outcome === 'hang') return; // never answers — exercises the timeout
    res.writeHead(outcome.status ?? 200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(outcome.body ?? {}));
  });
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

describe.runIf(available)('news proxy (postgres)', () => {
  let db: Db;
  let server: Server | undefined;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
  });

  beforeEach(() => {
    // The memo is module-level and would otherwise leak between cases.
    clearNewsCache();
  });

  afterEach(async () => {
    server?.close();
    server = undefined;
    await db.delete(media).where(inArray(media.id, [linkedWorkId, collidingWorkId]));
  });

  afterAll(() => {
    server?.close();
  });

  /** Build an app pointed at `catalogUrl` (empty string disables the feature). */
  async function appWith(catalogUrl: string): Promise<App> {
    const env = loadEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      CATALOG_URL: catalogUrl,
      CATALOG_NEWS_TIMEOUT_MS: '300',
    });
    return buildApp({ env, db, auth: createAuth(db, env) });
  }

  async function feedVia(
    app: App,
    query = '',
  ): Promise<{ status: number; body: NewsListResponse }> {
    const response = await app.inject({ method: 'GET', url: `/api/v1/news?${query}` });
    return { status: response.statusCode, body: response.json() };
  }

  describe('the feed', () => {
    it('proxies a catalog page through unchanged', async () => {
      server = catalogStub(() => ({ body: { articles: [summary], nextCursor: 'next-page' } }));
      const app = await appWith(await listen(server));
      try {
        const { status, body } = await feedVia(app);
        expect(status).toBe(200);
        expect(body.articles.map((article) => article.slug)).toEqual(['neon-harbor-renewed']);
        expect(body.nextCursor).toBe('next-page');
      } finally {
        await app.close();
      }
    });

    it('forwards every filter to the catalog', async () => {
      let seen: URLSearchParams | undefined;
      server = catalogStub((_path, query) => {
        seen = query;
        return { body: { articles: [], nextCursor: null } };
      });
      const app = await appWith(await listen(server));
      try {
        await feedVia(
          app,
          'kinds=anime,manga&topic=adaptation&from=2026-07-01&to=2026-08-01&limit=5',
        );
        expect(Object.fromEntries(seen ?? [])).toEqual({
          kinds: 'anime,manga',
          topic: 'adaptation',
          from: '2026-07-01',
          to: '2026-08-01',
          limit: '5',
        });
      } finally {
        await app.close();
      }
    });

    it('normalises the legacy single-kind filter to the list spelling', async () => {
      let seen: URLSearchParams | undefined;
      server = catalogStub((_path, query) => {
        seen = query;
        return { body: { articles: [], nextCursor: null } };
      });
      const app = await appWith(await listen(server));
      try {
        await feedVia(app, 'kind=anime');
        expect(seen?.get('kinds')).toBe('anime');
        expect(seen?.get('kind')).toBeNull();
      } finally {
        await app.close();
      }
    });

    it('answers 200 with an empty feed when the catalog 500s', async () => {
      server = catalogStub(() => ({ status: 500, body: { error: 'boom' } }));
      const app = await appWith(await listen(server));
      try {
        const { status, body } = await feedVia(app);
        expect(status).toBe(200);
        expect(body).toEqual({ articles: [], nextCursor: null });
      } finally {
        await app.close();
      }
    });

    it('answers 200 with an empty feed when the catalog never responds', async () => {
      server = catalogStub(() => 'hang');
      const app = await appWith(await listen(server));
      try {
        const { status, body } = await feedVia(app);
        expect(status).toBe(200);
        expect(body.articles).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it('answers 200 with an empty feed when no catalog is configured', async () => {
      const app = await appWith('');
      try {
        const { status, body } = await feedVia(app);
        expect(status).toBe(200);
        expect(body).toEqual({ articles: [], nextCursor: null });
      } finally {
        await app.close();
      }
    });

    it('drops an article this build cannot parse but keeps the rest', async () => {
      server = catalogStub(() => ({
        body: {
          articles: [summary, { ...summary, id: crypto.randomUUID(), topic: 'merchandise' }],
          nextCursor: null,
        },
      }));
      const app = await appWith(await listen(server));
      try {
        const { body } = await feedVia(app);
        expect(body.articles).toHaveLength(1);
      } finally {
        await app.close();
      }
    });

    it('serves a repeat query from the memo instead of re-asking the catalog', async () => {
      let calls = 0;
      server = catalogStub(
        () => ({ body: { articles: [summary], nextCursor: null } }),
        () => {
          calls += 1;
        },
      );
      const app = await appWith(await listen(server));
      try {
        await feedVia(app);
        await feedVia(app);
        expect(calls).toBe(1);
        // A different filter is a different key, so it goes upstream.
        await feedVia(app, 'kind=anime');
        expect(calls).toBe(2);
      } finally {
        await app.close();
      }
    });

    it('rejects a filter value the contract does not allow', async () => {
      const app = await appWith('');
      try {
        const response = await app.inject({ method: 'GET', url: '/api/v1/news?topic=nope' });
        expect(response.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  describe('the by-media strip', () => {
    async function stripVia(
      app: App,
      query = `id=${linkedWorkId}`,
    ): Promise<{ status: number; body: NewsListResponse }> {
      const response = await app.inject({ method: 'GET', url: `/api/v1/news/by-media?${query}` });
      return { status: response.statusCode, body: response.json() };
    }

    it('reaches the by-media route, not the slug route', async () => {
      // 'by-media' is a static segment sharing a prefix with '/news/:slug'; if
      // the router ever preferred the parametric branch this would fetch an
      // article named "by-media" instead.
      let path: string | undefined;
      server = catalogStub(
        () => ({ body: { articles: [summary], nextCursor: null } }),
        (pathname) => {
          path = pathname;
        },
      );
      const app = await appWith(await listen(server));
      try {
        const { status, body } = await stripVia(app);
        expect(status).toBe(200);
        expect(path).toBe('/v1/news/by-media');
        expect(body.articles.map((article) => article.slug)).toEqual(['neon-harbor-renewed']);
      } finally {
        await app.close();
      }
    });

    it('forwards the id and the limit to the catalog', async () => {
      let seen: URLSearchParams | undefined;
      server = catalogStub((_path, query) => {
        seen = query;
        return { body: { articles: [], nextCursor: null } };
      });
      const app = await appWith(await listen(server));
      try {
        await stripVia(app, `id=${linkedWorkId}&limit=3`);
        expect(Object.fromEntries(seen ?? [])).toEqual({ id: linkedWorkId, limit: '3' });
      } finally {
        await app.close();
      }
    });

    it('nulls the cursor even if the catalog sends one — the strip never pages', async () => {
      server = catalogStub(() => ({ body: { articles: [summary], nextCursor: 'next-page' } }));
      const app = await appWith(await listen(server));
      try {
        const { body } = await stripVia(app);
        expect(body.nextCursor).toBeNull();
      } finally {
        await app.close();
      }
    });

    it('answers 200 with an empty strip when the catalog is down', async () => {
      // The media page must still render; it loses one sidebar section.
      server = catalogStub(() => ({ status: 500, body: { error: 'boom' } }));
      const app = await appWith(await listen(server));
      try {
        const { status, body } = await stripVia(app);
        expect(status).toBe(200);
        expect(body).toEqual({ articles: [], nextCursor: null });
      } finally {
        await app.close();
      }
    });

    it('answers 200 with an empty strip when no catalog is configured', async () => {
      const app = await appWith('');
      try {
        const { status, body } = await stripVia(app);
        expect(status).toBe(200);
        expect(body).toEqual({ articles: [], nextCursor: null });
      } finally {
        await app.close();
      }
    });

    it('serves a repeat lookup from the memo, keyed per work', async () => {
      let calls = 0;
      server = catalogStub(
        () => ({ body: { articles: [summary], nextCursor: null } }),
        () => {
          calls += 1;
        },
      );
      const app = await appWith(await listen(server));
      try {
        await stripVia(app);
        await stripVia(app);
        expect(calls).toBe(1);
        await stripVia(app, `id=${collidingWorkId}`);
        expect(calls).toBe(2);
      } finally {
        await app.close();
      }
    });

    it('rejects an id that is not a uuid', async () => {
      const app = await appWith('');
      try {
        const { status } = await stripVia(app, 'id=nope');
        expect(status).toBe(400);
      } finally {
        await app.close();
      }
    });
  });

  describe('the article route', () => {
    function articleBody(overrides: Record<string, unknown> = {}) {
      return {
        ...summary,
        body: 'Harbor Studios confirmed the renewal on Monday.',
        sources: [
          {
            url: 'https://example.test/story',
            outlet: 'Example Wire',
            title: 'Neon Harbor gets a third run',
            publishedAt: '2026-08-01T08:00:00.000Z',
          },
        ],
        media: [],
        ...overrides,
      };
    }

    async function articleVia(
      app: App,
      slug = summary.slug,
    ): Promise<{ status: number; body: NewsArticleDetail & { error?: string } }> {
      const response = await app.inject({ method: 'GET', url: `/api/v1/news/${slug}` });
      return { status: response.statusCode, body: response.json() };
    }

    it('materializes a linked work it has never seen and returns the persisted slug', async () => {
      server = catalogStub(() => ({
        body: articleBody({ media: [work({ id: linkedWorkId, title: 'Neon Harbor' })] }),
      }));
      const app = await appWith(await listen(server));
      try {
        const { status, body } = await articleVia(app);
        expect(status).toBe(200);
        expect(body.media).toHaveLength(1);

        const [row] = await db.select().from(media).where(eq(media.id, linkedWorkId)).limit(1);
        expect(row).toMatchObject({ source: 'provider', moderation: 'verified' });
        // The chip must route to the slug as persisted, never the requested one.
        expect(body.media[0]!.slug).toBe(row!.slug);
      } finally {
        await app.close();
      }
    });

    it('answers with the suffixed slug when the natural slug is taken', async () => {
      await db.insert(media).values({
        id: collidingWorkId,
        kind: 'movie',
        title: 'Neon Harbor',
        slug: 'neon-harbor-2024',
        synonyms: [],
        genres: [],
        year: 2024,
        source: 'provider',
        moderation: 'verified',
      });
      server = catalogStub(() => ({
        body: articleBody({ media: [work({ id: linkedWorkId, title: 'Neon Harbor' })] }),
      }));
      const app = await appWith(await listen(server));
      try {
        const { body } = await articleVia(app);
        expect(body.media[0]!.slug).toBe(`neon-harbor-2024-${linkedWorkId.slice(0, 8)}`);
      } finally {
        await app.close();
      }
    });

    it('reuses an existing local row rather than re-inserting it', async () => {
      await db.insert(media).values({
        id: linkedWorkId,
        kind: 'series',
        title: 'Neon Harbor (local title)',
        slug: 'neon-harbor-local',
        synonyms: [],
        genres: [],
        year: 2024,
        source: 'provider',
        moderation: 'verified',
      });
      server = catalogStub(() => ({
        body: articleBody({ media: [work({ id: linkedWorkId, title: 'Neon Harbor' })] }),
      }));
      const app = await appWith(await listen(server));
      try {
        const { body } = await articleVia(app);
        expect(body.media[0]).toMatchObject({
          slug: 'neon-harbor-local',
          title: 'Neon Harbor (local title)',
        });
      } finally {
        await app.close();
      }
    });

    it('drops a linked work that is soft-deleted locally', async () => {
      await db.insert(media).values({
        id: linkedWorkId,
        kind: 'series',
        title: 'Withdrawn',
        slug: 'withdrawn-locally',
        synonyms: [],
        genres: [],
        year: 2024,
        source: 'provider',
        moderation: 'verified',
        deletedAt: new Date(),
      });
      server = catalogStub(() => ({
        body: articleBody({ media: [work({ id: linkedWorkId, title: 'Neon Harbor' })] }),
      }));
      const app = await appWith(await listen(server));
      try {
        // Federation must never resurrect a title pulled from circulation.
        const { body } = await articleVia(app);
        expect(body.media).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it('drops an unverified user entry from an anonymous reader', async () => {
      await db.insert(media).values({
        id: linkedWorkId,
        kind: 'series',
        title: 'Someone Else Entry',
        slug: 'someone-else-entry',
        synonyms: [],
        genres: [],
        year: 2024,
        source: 'user',
        moderation: 'unverified',
      });
      server = catalogStub(() => ({
        body: articleBody({ media: [work({ id: linkedWorkId, title: 'Neon Harbor' })] }),
      }));
      const app = await appWith(await listen(server));
      try {
        const { body } = await articleVia(app);
        expect(body.media).toEqual([]);
      } finally {
        await app.close();
      }
    });

    it('404s when the catalog says the article does not exist', async () => {
      server = catalogStub(() => ({ status: 404, body: { error: 'article not found' } }));
      const app = await appWith(await listen(server));
      try {
        const { status } = await articleVia(app, 'no-such-article');
        expect(status).toBe(404);
      } finally {
        await app.close();
      }
    });

    it('503s — not 404 — when the catalog is unreachable', async () => {
      server = catalogStub(() => ({ status: 500 }));
      const app = await appWith(await listen(server));
      try {
        // An outage must stay distinguishable from a dead link, or every
        // article looks retired whenever the catalog hiccups.
        const { status } = await articleVia(app);
        expect(status).toBe(503);
      } finally {
        await app.close();
      }
    });

    it('503s when no catalog is configured', async () => {
      const app = await appWith('');
      try {
        const { status } = await articleVia(app);
        expect(status).toBe(503);
      } finally {
        await app.close();
      }
    });

    it('memoizes a 404 so a crawler does not re-ask the catalog each time', async () => {
      let calls = 0;
      server = catalogStub(
        () => ({ status: 404, body: { error: 'article not found' } }),
        () => {
          calls += 1;
        },
      );
      const app = await appWith(await listen(server));
      try {
        await articleVia(app, 'ghost');
        await articleVia(app, 'ghost');
        expect(calls).toBe(1);
      } finally {
        await app.close();
      }
    });
  });
});

describe.runIf(!available)('news proxy (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
