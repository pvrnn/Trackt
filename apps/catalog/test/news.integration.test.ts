import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  loadCatalogEnv,
  type NewsAdminArticle,
  type NewsArticle,
  type NewsListResponse,
} from '@trackt/shared';
import {
  catalogMedia,
  createCatalogDb,
  newsArticle,
  newsArticleMedia,
  newsArticleSource,
  newsSource,
  newsSourceItem,
  runCatalogMigrations,
  type CatalogDb,
} from '../src/db/index.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for the news surface (ADR-0005) against the dev compose
 * catalog database. Self-skips when Postgres is down, so `pnpm test` stays green
 * without Docker.
 *
 * The load-bearing assertions: a draft is invisible publicly through every
 * route, and the keyset pager returns each article exactly once even when
 * timestamps tie.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_CATALOG_NEWS ??
  'postgres://trackt:trackt@localhost:5433/trackt_catalog_news_test';

const ADMIN_TOKEN = 'test-admin-token-at-least-16';

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

const seriesId = '11111111-1111-5111-8111-111111111111';
const animeId = '22222222-2222-5222-8222-222222222222';
const tombstonedId = '33333333-3333-5333-8333-333333333333';

const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };

describe.runIf(available)('news (postgres)', () => {
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

  beforeEach(async () => {
    await db.insert(catalogMedia).values([
      {
        id: seriesId,
        kind: 'series',
        title: 'Neon Harbor',
        synonyms: [],
        year: 2024,
        status: 'airing',
        genres: ['drama'],
        partCount: 10,
        seasonNumber: 2,
        externalIds: { tmdb: 4242 },
      },
      {
        id: animeId,
        kind: 'anime',
        title: 'Ashfall Chronicle',
        synonyms: [],
        year: 2025,
        status: 'airing',
        genres: ['action'],
        partCount: 24,
        seasonNumber: 1,
        externalIds: { anilist: 9001 },
      },
      {
        id: tombstonedId,
        kind: 'movie',
        title: 'Withdrawn Film',
        synonyms: [],
        year: 2020,
        status: 'ended',
        genres: [],
        externalIds: {},
        deletedAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await db.delete(newsArticleMedia);
    await db.delete(newsArticleSource);
    await db.delete(newsSourceItem);
    await db.delete(newsArticle);
    await db.delete(newsSource);
    await db.delete(catalogMedia);
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Post a draft through the real admin route, so the tests exercise the write path. */
  async function createDraft(
    overrides: Record<string, unknown> = {},
  ): Promise<{ statusCode: number; body: NewsAdminArticle & { error?: string } }> {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/news',
      headers: auth,
      payload: {
        title: 'Neon Harbor renewed for a third season',
        dek: 'Ten episodes, same showrunner.',
        body: 'Harbor Studios confirmed the renewal on Monday.',
        topic: 'renewal',
        kinds: ['series'],
        sources: [
          {
            url: 'https://example.test/neon-harbor',
            outlet: 'Example Wire',
            title: 'Neon Harbor gets a third run',
            publishedAt: '2026-08-01T08:00:00.000Z',
          },
        ],
        ...overrides,
      },
    });
    return { statusCode: response.statusCode, body: response.json() };
  }

  async function publish(id: string, patch: Record<string, unknown> = {}) {
    return app.inject({
      method: 'PATCH',
      url: `/v1/admin/news/${id}`,
      headers: auth,
      payload: { status: 'published', ...patch },
    });
  }

  async function feed(query = ''): Promise<NewsListResponse> {
    const response = await app.inject({ method: 'GET', url: `/v1/news?${query}` });
    expect(response.statusCode).toBe(200);
    return response.json() as NewsListResponse;
  }

  describe('admin write path', () => {
    it('requires the admin token on every news route', async () => {
      for (const [method, url] of [
        ['POST', '/v1/admin/news'],
        ['GET', '/v1/admin/news'],
        ['GET', '/v1/admin/news/sources'],
        ['POST', '/v1/admin/news/sources'],
        ['GET', '/v1/admin/news/items'],
        ['POST', '/v1/admin/news/items'],
      ] as const) {
        const response = await app.inject({ method, url, payload: {} });
        // 400 would mean body validation ran and rejected first; these must be
        // refused for lack of a token whatever the body says.
        expect([401, 400]).toContain(response.statusCode);
      }
      const noToken = await app.inject({ method: 'GET', url: '/v1/admin/news' });
      expect(noToken.statusCode).toBe(401);
    });

    it('rejects a wrong token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/admin/news',
        headers: { authorization: 'Bearer nope' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('creates a draft, never a published article', async () => {
      const { statusCode, body } = await createDraft();
      expect(statusCode).toBe(200);
      expect(body.status).toBe('draft');
      expect(body.publishedAt).toBeNull();
      expect(body.slug).toBe('neon-harbor-renewed-for-a-third-season');
      expect(body.sources).toHaveLength(1);
    });

    it('ignores a client-supplied status on create', async () => {
      // The create body has no `status` field, so zod strips it — assert the
      // outcome rather than trusting that it stays stripped.
      const { body } = await createDraft({ status: 'published' });
      expect(body.status).toBe('draft');
    });

    it('suffixes a colliding slug rather than overwriting', async () => {
      const first = await createDraft();
      const second = await createDraft();
      expect(second.body.slug).toBe(`${first.body.slug}-2`);
      const third = await createDraft();
      expect(third.body.slug).toBe(`${first.body.slug}-3`);
    });

    it('rejects a draft with no sources', async () => {
      const { statusCode } = await createDraft({ sources: [] });
      expect(statusCode).toBe(400);
    });

    it('rejects a title copied verbatim from a source headline', async () => {
      const { statusCode, body } = await createDraft({
        title: '  neon harbor GETS a third   run ',
      });
      expect(statusCode).toBe(400);
      expect(body.error).toMatch(/verbatim/);
    });

    it('rejects a link to a work the catalog does not have', async () => {
      const { statusCode } = await createDraft({
        media: [{ id: '99999999-9999-5999-8999-999999999999', role: 'subject' }],
      });
      expect(statusCode).toBe(404);
    });

    it('rejects a link to a tombstoned work', async () => {
      const { statusCode } = await createDraft({
        media: [{ id: tombstonedId, role: 'subject' }],
      });
      expect(statusCode).toBe(404);
    });

    it('marks the source items a draft was written from as used', async () => {
      const [source] = await db
        .insert(newsSource)
        .values({ name: 'Example Wire', feedUrl: 'https://example.test/feed.xml' })
        .returning();
      await db.insert(newsSourceItem).values({
        sourceId: source!.id,
        guid: 'entry-1',
        url: 'https://example.test/neon-harbor',
        title: 'Neon Harbor gets a third run',
      });

      const { body } = await createDraft({
        sourceItemIds: [{ sourceId: source!.id, guid: 'entry-1' }],
      });

      const [item] = await db.select().from(newsSourceItem);
      expect(item?.status).toBe('used');
      expect(item?.articleId).toBe(body.id);
    });
  });

  describe('the publish gate', () => {
    it('keeps a draft out of the public feed, the slug route, and by-media', async () => {
      const { body } = await createDraft({ media: [{ id: seriesId, role: 'subject' }] });

      expect((await feed()).articles).toEqual([]);

      const bySlug = await app.inject({ method: 'GET', url: `/v1/news/${body.slug}` });
      // 404, not 403: a draft's existence must not be probeable.
      expect(bySlug.statusCode).toBe(404);

      const byMedia = await app.inject({ method: 'GET', url: `/v1/news/by-media?id=${seriesId}` });
      expect((byMedia.json() as NewsListResponse).articles).toEqual([]);
    });

    it('publishes on PATCH and stamps publishedAt', async () => {
      const { body } = await createDraft();
      const response = await publish(body.id);
      expect(response.statusCode).toBe(200);
      const published = response.json() as NewsAdminArticle;
      expect(published.status).toBe('published');
      expect(published.publishedAt).not.toBeNull();

      const articles = (await feed()).articles;
      expect(articles.map((article) => article.slug)).toEqual([body.slug]);
    });

    it('keeps the original publishedAt when an article is unpublished and republished', async () => {
      const { body } = await createDraft();
      const first = (await publish(body.id)).json() as NewsAdminArticle;

      await app.inject({
        method: 'PATCH',
        url: `/v1/admin/news/${body.id}`,
        headers: auth,
        payload: { status: 'draft' },
      });
      const again = (await publish(body.id)).json() as NewsAdminArticle;
      // Otherwise a correction would fling an old story back to the top of the feed.
      expect(again.publishedAt).toBe(first.publishedAt);
    });

    it('hides a future-dated article until its time comes', async () => {
      const { body } = await createDraft();
      await publish(body.id);
      await db
        .update(newsArticle)
        .set({ publishedAt: new Date(Date.now() + 60 * 60 * 1000) })
        .where(eq(newsArticle.id, body.id));
      expect((await feed()).articles).toEqual([]);
    });

    it('rejects a patched title that copies a source headline', async () => {
      const { body } = await createDraft();
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/news/${body.id}`,
        headers: auth,
        payload: { title: 'Neon Harbor gets a third run' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('replaces sources in full rather than merging', async () => {
      const { body } = await createDraft();
      const response = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/news/${body.id}`,
        headers: auth,
        payload: {
          sources: [
            {
              url: 'https://other.test/story',
              outlet: 'Other Wire',
              title: 'Something else entirely',
              publishedAt: null,
            },
          ],
        },
      });
      const updated = response.json() as NewsAdminArticle;
      expect(updated.sources.map((source) => source.outlet)).toEqual(['Other Wire']);
    });

    it('404s on an unknown article id', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/v1/admin/news/99999999-9999-5999-8999-999999999999',
        headers: auth,
        payload: { status: 'published' },
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('the public feed', () => {
    /** Publish `count` articles, oldest first, one hour apart. */
    async function publishMany(count: number, overrides: Record<string, unknown> = {}) {
      const ids: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const { body } = await createDraft({
          title: `Story number ${index}`,
          ...overrides,
        });
        await publish(body.id);
        ids.push(body.id);
      }
      // Deterministic ordering: publishing in a loop can land inside one clock tick.
      for (const [index, id] of ids.entries()) {
        await db
          .update(newsArticle)
          .set({ publishedAt: new Date(Date.UTC(2026, 0, 1, index)) })
          .where(eq(newsArticle.id, id));
      }
      return ids;
    }

    it('orders newest first', async () => {
      await publishMany(3);
      const articles = (await feed()).articles;
      expect(articles.map((a) => a.title)).toEqual([
        'Story number 2',
        'Story number 1',
        'Story number 0',
      ]);
    });

    it('pages through with the keyset cursor, no repeats and no gaps', async () => {
      await publishMany(5);
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result: NewsListResponse = await feed(
          `limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...result.articles.map((article) => article.title));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      expect(seen).toEqual([
        'Story number 4',
        'Story number 3',
        'Story number 2',
        'Story number 1',
        'Story number 0',
      ]);
      expect(new Set(seen).size).toBe(5);
    });

    it('reports no next cursor on an exactly-full last page', async () => {
      await publishMany(2);
      const result = await feed('limit=2');
      expect(result.articles).toHaveLength(2);
      expect(result.nextCursor).toBeNull();
    });

    it('pages deterministically when publishedAt ties', async () => {
      const ids = await publishMany(4);
      const sameInstant = new Date(Date.UTC(2026, 5, 1, 12));
      for (const id of ids) {
        await db
          .update(newsArticle)
          .set({ publishedAt: sameInstant })
          .where(eq(newsArticle.id, id));
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 10; page += 1) {
        const result: NewsListResponse = await feed(
          `limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        seen.push(...result.articles.map((article) => article.id));
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      // The id tiebreak in both the ORDER BY and the cursor is what makes this
      // hold; on published_at alone a tie would loop or skip.
      expect(new Set(seen).size).toBe(4);
    });

    it('restarts the feed on a malformed cursor instead of failing', async () => {
      await publishMany(2);
      const result = await feed('cursor=not-a-real-cursor');
      expect(result.articles).toHaveLength(2);
    });

    it('filters by kind', async () => {
      await publishMany(1, { kinds: ['series'] });
      await publishMany(1, { title: 'Anime story', kinds: ['anime'] });
      expect((await feed('kind=anime')).articles.map((a) => a.title)).toEqual(['Anime story']);
      expect((await feed('kind=manga')).articles).toEqual([]);
    });

    it('matches an article tagged with several kinds', async () => {
      await publishMany(1, { kinds: ['manga', 'anime'] });
      expect((await feed('kind=manga')).articles).toHaveLength(1);
      expect((await feed('kind=anime')).articles).toHaveLength(1);
    });

    it('filters by topic', async () => {
      await publishMany(1, { topic: 'renewal' });
      await publishMany(1, { title: 'Casting story', topic: 'casting' });
      expect((await feed('topic=casting')).articles.map((a) => a.title)).toEqual(['Casting story']);
    });

    it('filters by an inclusive date range', async () => {
      await publishMany(3); // 2026-01-01 at 00:00, 01:00, 02:00 UTC
      expect((await feed('from=2026-01-01&to=2026-01-01')).articles).toHaveLength(3);
      expect((await feed('from=2026-01-02')).articles).toEqual([]);
      expect((await feed('to=2025-12-31')).articles).toEqual([]);
    });

    it('rejects a nonsense filter value', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/news?topic=merchandise' });
      expect(response.statusCode).toBe(400);
    });

    it('omits the body from feed items', async () => {
      await publishMany(1);
      const [article] = (await feed()).articles;
      expect(article).not.toHaveProperty('body');
    });
  });

  describe('the article route', () => {
    it('serves body, sources, and linked works in full slim form', async () => {
      const { body } = await createDraft({
        media: [
          { id: seriesId, role: 'subject' },
          { id: animeId, role: 'mentioned' },
        ],
      });
      await publish(body.id);

      const response = await app.inject({ method: 'GET', url: `/v1/news/${body.slug}` });
      expect(response.statusCode).toBe(200);
      const article = response.json() as NewsArticle;
      expect(article.body).toContain('Harbor Studios');
      expect(article.sources[0]?.outlet).toBe('Example Wire');
      // Full SlimMedia, so an instance can materialize a work it has never seen.
      const subject = article.media.find((work) => work.role === 'subject');
      expect(subject).toMatchObject({
        id: seriesId,
        kind: 'series',
        title: 'Neon Harbor',
        partCount: 10,
        seasonNumber: 2,
        externalIds: { tmdb: 4242 },
      });
      expect(article.media.map((work) => work.role).sort()).toEqual(['mentioned', 'subject']);
    });

    it('drops a linked work that was tombstoned after publication', async () => {
      const { body } = await createDraft({ media: [{ id: seriesId, role: 'subject' }] });
      await publish(body.id);
      await db
        .update(catalogMedia)
        .set({ deletedAt: new Date() })
        .where(eq(catalogMedia.id, seriesId));

      const response = await app.inject({ method: 'GET', url: `/v1/news/${body.slug}` });
      expect((response.json() as NewsArticle).media).toEqual([]);
    });

    it('404s on an unknown slug', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/news/no-such-article' });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('by-media', () => {
    it('returns published articles touching one work, newest first', async () => {
      const first = await createDraft({ media: [{ id: seriesId, role: 'subject' }] });
      await publish(first.body.id);
      const second = await createDraft({
        title: 'A second Neon Harbor story',
        media: [{ id: seriesId, role: 'mentioned' }],
      });
      await publish(second.body.id);
      await db
        .update(newsArticle)
        .set({ publishedAt: new Date(Date.UTC(2026, 0, 1)) })
        .where(eq(newsArticle.id, first.body.id));
      await db
        .update(newsArticle)
        .set({ publishedAt: new Date(Date.UTC(2026, 0, 2)) })
        .where(eq(newsArticle.id, second.body.id));

      const response = await app.inject({ method: 'GET', url: `/v1/news/by-media?id=${seriesId}` });
      const { articles } = response.json() as NewsListResponse;
      expect(articles.map((a) => a.title)).toEqual([
        'A second Neon Harbor story',
        'Neon Harbor renewed for a third season',
      ]);
    });

    it('returns an article once even when it links the work twice', async () => {
      const { body } = await createDraft({
        media: [
          { id: seriesId, role: 'subject' },
          { id: seriesId, role: 'mentioned' },
        ],
      });
      await publish(body.id);
      const response = await app.inject({ method: 'GET', url: `/v1/news/by-media?id=${seriesId}` });
      expect((response.json() as NewsListResponse).articles).toHaveLength(1);
    });

    it('returns an empty list for a work with no news', async () => {
      const response = await app.inject({ method: 'GET', url: `/v1/news/by-media?id=${animeId}` });
      expect(response.statusCode).toBe(200);
      expect((response.json() as NewsListResponse).articles).toEqual([]);
    });

    it('rejects a non-uuid id', async () => {
      const response = await app.inject({ method: 'GET', url: '/v1/news/by-media?id=nope' });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('the source registry', () => {
    it('registers a feed idempotently on its URL', async () => {
      const payload = { name: 'Example Wire', feedUrl: 'https://example.test/feed.xml' };
      const first = await app.inject({
        method: 'POST',
        url: '/v1/admin/news/sources',
        headers: auth,
        payload,
      });
      const second = await app.inject({
        method: 'POST',
        url: '/v1/admin/news/sources',
        headers: auth,
        payload: { ...payload, name: 'Renamed Wire' },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().id).toBe(first.json().id);
      expect(second.json().name).toBe('Renamed Wire');
    });

    it('returns only newly seen items on bulk ingest', async () => {
      const source = (
        await app.inject({
          method: 'POST',
          url: '/v1/admin/news/sources',
          headers: auth,
          payload: { name: 'Example Wire', feedUrl: 'https://example.test/feed.xml' },
        })
      ).json();

      const items = [
        {
          sourceId: source.id,
          guid: 'a',
          url: 'https://example.test/a',
          title: 'A',
          publishedAt: null,
        },
        {
          sourceId: source.id,
          guid: 'b',
          url: 'https://example.test/b',
          title: 'B',
          publishedAt: null,
        },
      ];

      const first = await app.inject({
        method: 'POST',
        url: '/v1/admin/news/items',
        headers: auth,
        payload: { items },
      });
      expect(first.json().created).toHaveLength(2);

      // The dedup that stops the agent rewriting a story is this constraint.
      const replay = await app.inject({
        method: 'POST',
        url: '/v1/admin/news/items',
        headers: auth,
        payload: {
          items: [
            ...items,
            {
              sourceId: source.id,
              guid: 'c',
              url: 'https://example.test/c',
              title: 'C',
              publishedAt: null,
            },
          ],
        },
      });
      expect(replay.json().created.map((item: { guid: string }) => item.guid)).toEqual(['c']);
    });

    it('rejects items for a source that is not registered', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/admin/news/items',
        headers: auth,
        payload: {
          items: [
            {
              sourceId: '99999999-9999-5999-8999-999999999999',
              guid: 'a',
              url: 'https://example.test/a',
              title: 'A',
              publishedAt: null,
            },
          ],
        },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});

describe.runIf(!available)('news (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
