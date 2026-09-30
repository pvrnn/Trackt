import type { NewsArticleSummary } from '@trackt/shared';
import { describe, expect, it } from 'vitest';
import {
  compareCursors,
  isAfter,
  matchesKinds,
  pickNewArticles,
  type FeedCursor,
} from '../../src/news/select.js';

function article(id: string, publishedAt: string, kinds: NewsArticleSummary['kinds'] = ['anime']) {
  return {
    id,
    slug: id,
    title: `Article ${id}`,
    dek: null,
    topic: 'general',
    kinds,
    coverUrl: null,
    publishedAt,
  } satisfies NewsArticleSummary;
}

const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';
const T0 = '2026-09-30T10:00:00.000Z';
const T1 = '2026-09-30T11:00:00.000Z';

describe('isAfter', () => {
  const cursor: FeedCursor = { publishedAt: new Date(T0), articleId: ID_A };

  it('compares by publication time first', () => {
    expect(isAfter(article(ID_A, T1), cursor)).toBe(true);
    expect(isAfter(article(ID_B, '2026-09-30T09:00:00.000Z'), cursor)).toBe(false);
  });

  it('breaks ties on the article id, like the feed', () => {
    expect(isAfter(article(ID_B, T0), cursor)).toBe(true);
    expect(isAfter(article(ID_A, T0), cursor)).toBe(false);
  });

  it('counts a tie as new against a seed with no article', () => {
    expect(isAfter(article(ID_A, T0), { publishedAt: new Date(T0), articleId: null })).toBe(true);
  });
});

describe('compareCursors', () => {
  it('sorts a seed before an article posted at the same instant', () => {
    const seed = { publishedAt: new Date(T0), articleId: null };
    const posted = { publishedAt: new Date(T0), articleId: ID_A };
    expect(compareCursors(seed, posted)).toBeLessThan(0);
    expect(compareCursors(posted, seed)).toBeGreaterThan(0);
    expect(compareCursors(posted, { ...posted })).toBe(0);
  });
});

describe('matchesKinds', () => {
  it('takes everything with an empty filter, including kindless articles', () => {
    expect(matchesKinds([], [])).toBe(true);
    expect(matchesKinds(['movie'], [])).toBe(true);
  });

  it('matches on any shared kind', () => {
    expect(matchesKinds(['anime', 'manga'], ['manga'])).toBe(true);
    expect(matchesKinds(['movie'], ['anime', 'manga'])).toBe(false);
    expect(matchesKinds([], ['movie'])).toBe(false);
  });
});

describe('pickNewArticles', () => {
  const seed: FeedCursor = { publishedAt: new Date(T0), articleId: null };

  it('returns unseen matching articles oldest first', () => {
    const feed = [
      article(ID_B, T1),
      article(ID_A, T1),
      article('00000000-0000-4000-8000-00000000000c', '2026-09-30T10:30:00.000Z', ['movie']),
      article('00000000-0000-4000-8000-00000000000d', '2026-09-30T09:00:00.000Z'),
    ];
    expect(pickNewArticles(feed, seed, ['anime'], 10).map((a) => a.id)).toEqual([ID_A, ID_B]);
  });

  it('caps the batch at the oldest articles so the rest wait for the next poll', () => {
    const feed = [article(ID_B, T1), article(ID_A, '2026-09-30T10:30:00.000Z')];
    expect(pickNewArticles(feed, seed, [], 1).map((a) => a.id)).toEqual([ID_A]);
  });
});
