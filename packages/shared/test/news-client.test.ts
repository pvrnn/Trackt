import { describe, expect, it } from 'vitest';
import { decodeNewsCursor, encodeNewsCursor } from '../src/news.js';
import { fetchNewsArticle, fetchNewsForMedia, fetchNewsList } from '../src/news-client.js';

/**
 * Wire-contract tests for the news clients (ADR-0005), mirroring
 * catalog-client.test.ts: hard failures throw so the API route can degrade to an
 * empty feed in one place, while a single article carrying an enum value this
 * build doesn't know is skipped rather than blanking the page.
 */

const validArticle = {
  id: '0f9c1b2a-3d4e-5f6a-8b9c-0d1e2f3a4b5c',
  slug: 'neon-harbor-renewed-for-season-3',
  title: 'Neon Harbor renewed for Season 3',
  dek: 'A 10-episode third season, with the showrunner returning.',
  topic: 'renewal',
  kinds: ['series'],
  coverUrl: null,
  publishedAt: '2026-08-01T09:00:00.000Z',
};

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const OPTIONS = { timeoutMs: 1000 };

describe('fetchNewsList', () => {
  it('throws on a non-2xx catalog response', async () => {
    await expect(
      fetchNewsList('http://catalog.test', { ...OPTIONS, fetchImpl: fetchReturning({}, 503) }),
    ).rejects.toThrow(/503/);
  });

  it('throws on a malformed envelope', async () => {
    await expect(
      fetchNewsList('http://catalog.test', {
        ...OPTIONS,
        fetchImpl: fetchReturning({ articles: [] }),
      }),
    ).rejects.toThrow();
  });

  it('parses a fully valid page and carries the cursor through', async () => {
    const result = await fetchNewsList('http://catalog.test', {
      ...OPTIONS,
      fetchImpl: fetchReturning({ articles: [validArticle], nextCursor: 'abc' }),
    });
    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.slug).toBe('neon-harbor-renewed-for-season-3');
    expect(result.nextCursor).toBe('abc');
    expect(result.skipped).toEqual([]);
  });

  it('skips an article with an unknown topic without dropping the page', async () => {
    const result = await fetchNewsList('http://catalog.test', {
      ...OPTIONS,
      fetchImpl: fetchReturning({
        articles: [
          validArticle,
          { ...validArticle, id: '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d', topic: 'merchandise' },
        ],
        nextCursor: null,
      }),
    });
    expect(result.articles.map((a) => a.id)).toEqual([validArticle.id]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe('1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d');
  });

  it('skips an article whose kinds include one this build does not know', async () => {
    const result = await fetchNewsList('http://catalog.test', {
      ...OPTIONS,
      fetchImpl: fetchReturning({
        articles: [{ ...validArticle, kinds: ['series', 'audiobook'] }],
        nextCursor: null,
      }),
    });
    expect(result.articles).toEqual([]);
    expect(result.skipped).toHaveLength(1);
  });

  it('sends every filter it was given', async () => {
    let seen: URL | undefined;
    await fetchNewsList('http://catalog.test', {
      ...OPTIONS,
      kinds: 'anime,manga',
      topic: 'adaptation',
      from: '2026-07-01',
      to: '2026-08-01',
      limit: 5,
      cursor: 'xyz',
      fetchImpl: async (input) => {
        seen = new URL(String(input));
        return new Response(JSON.stringify({ articles: [], nextCursor: null }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(Object.fromEntries(seen?.searchParams ?? [])).toEqual({
      kinds: 'anime,manga',
      topic: 'adaptation',
      from: '2026-07-01',
      to: '2026-08-01',
      limit: '5',
      cursor: 'xyz',
    });
  });

  it('gives up on a catalog that never answers', async () => {
    await expect(
      fetchNewsList('http://catalog.test', {
        timeoutMs: 10,
        fetchImpl: (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      }),
    ).rejects.toThrow();
  });
});

describe('fetchNewsArticle', () => {
  it('returns null on 404 rather than throwing', async () => {
    // A missing article must stay distinguishable from an unreachable catalog:
    // the route renders "not found" for one and a degraded page for the other.
    const article = await fetchNewsArticle('http://catalog.test', 'nope', {
      ...OPTIONS,
      fetchImpl: fetchReturning({ error: 'not found' }, 404),
    });
    expect(article).toBeNull();
  });

  it('throws on a 5xx', async () => {
    await expect(
      fetchNewsArticle('http://catalog.test', 'x', {
        ...OPTIONS,
        fetchImpl: fetchReturning({}, 502),
      }),
    ).rejects.toThrow(/502/);
  });

  it('parses a full article', async () => {
    const article = await fetchNewsArticle('http://catalog.test', 'x', {
      ...OPTIONS,
      fetchImpl: fetchReturning({
        ...validArticle,
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
      }),
    });
    expect(article?.sources[0]?.outlet).toBe('Example Wire');
  });

  it('percent-encodes the slug into the path', async () => {
    let seen: URL | undefined;
    await fetchNewsArticle('http://catalog.test', 'a/b', {
      ...OPTIONS,
      fetchImpl: async (input) => {
        seen = new URL(String(input));
        return new Response(null, { status: 404 });
      },
    });
    expect(seen?.pathname).toBe('/v1/news/a%2Fb');
  });
});

describe('fetchNewsForMedia', () => {
  const mediaId = '7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d';

  it('sends the id and the limit, and asks the by-media route', async () => {
    let seen: URL | undefined;
    await fetchNewsForMedia('http://catalog.test', mediaId, {
      ...OPTIONS,
      limit: 3,
      fetchImpl: async (input) => {
        seen = new URL(String(input));
        return new Response(JSON.stringify({ articles: [], nextCursor: null }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(seen?.pathname).toBe('/v1/news/by-media');
    expect(Object.fromEntries(seen?.searchParams ?? [])).toEqual({ id: mediaId, limit: '3' });
  });

  it('leaves the limit off when the caller did not set one', async () => {
    let seen: URL | undefined;
    await fetchNewsForMedia('http://catalog.test', mediaId, {
      ...OPTIONS,
      fetchImpl: async (input) => {
        seen = new URL(String(input));
        return new Response(JSON.stringify({ articles: [], nextCursor: null }), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    expect(seen?.searchParams.has('limit')).toBe(false);
  });

  it('throws on a non-2xx so the API route degrades in one place', async () => {
    await expect(
      fetchNewsForMedia('http://catalog.test', mediaId, {
        ...OPTIONS,
        fetchImpl: fetchReturning({}, 500),
      }),
    ).rejects.toThrow(/500/);
  });

  it('skips an article this build cannot parse and keeps the rest', async () => {
    const result = await fetchNewsForMedia('http://catalog.test', mediaId, {
      ...OPTIONS,
      fetchImpl: fetchReturning({
        articles: [validArticle, { ...validArticle, id: crypto.randomUUID(), topic: 'merch' }],
        nextCursor: null,
      }),
    });
    expect(result.articles).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });
});

describe('news cursor', () => {
  it('round-trips', () => {
    const cursor = { publishedAt: '2026-08-01T09:00:00.000Z', id: validArticle.id };
    expect(decodeNewsCursor(encodeNewsCursor(cursor))).toEqual(cursor);
  });

  it('is url-safe', () => {
    const encoded = encodeNewsCursor({
      publishedAt: '2026-08-01T09:00:00.000Z',
      id: validArticle.id,
    });
    expect(encoded).toBe(encodeURIComponent(encoded));
  });

  it.each([
    ['not base64 at all', '!!!!'],
    ['base64 without a separator', btoa('nope')],
    ['a non-uuid id', btoa('2026-08-01T09:00:00.000Z|nope')],
    ['a non-timestamp date', btoa('yesterday|' + validArticle.id)],
  ])('returns null for %s', (_label, raw) => {
    // A bad cursor restarts the feed; it must never reach SQL or throw a 500.
    expect(decodeNewsCursor(raw)).toBeNull();
  });
});
