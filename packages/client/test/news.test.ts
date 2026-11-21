import { describe, expect, it } from 'vitest';
import type { NewsArticleSummary } from '@trackt/shared';
import { mergeNewsLists } from '../src/news.js';

const article = (id: string, publishedAt: string): NewsArticleSummary => ({
  id,
  slug: id,
  title: id,
  dek: null,
  topic: 'general',
  kinds: ['series'],
  coverUrl: null,
  publishedAt,
});

const a = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe('mergeNewsLists', () => {
  it('sorts newest first across every list', () => {
    const merged = mergeNewsLists(
      [
        [article(a(1), '2026-01-01T00:00:00.000Z')],
        [article(a(2), '2026-03-01T00:00:00.000Z'), article(a(3), '2026-02-01T00:00:00.000Z')],
      ],
      10,
    );
    expect(merged.map((item) => item.id)).toEqual([a(2), a(3), a(1)]);
  });

  it('keeps one copy of a story two tracked works share', () => {
    const shared = article(a(1), '2026-01-01T00:00:00.000Z');
    expect(mergeNewsLists([[shared], [shared]], 10)).toHaveLength(1);
  });

  it('stops at the limit', () => {
    const list = [1, 2, 3, 4].map((n) => article(a(n), `2026-0${n}-01T00:00:00.000Z`));
    expect(mergeNewsLists([list], 2).map((item) => item.id)).toEqual([a(4), a(3)]);
  });
});
