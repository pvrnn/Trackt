import type { NewsArticleSummary } from '@trackt/shared';
import { describe, expect, it } from 'vitest';
import { newsEmbed } from '../../src/news/embed.js';

const article: NewsArticleSummary = {
  id: '00000000-0000-4000-8000-00000000000a',
  slug: 'frieren-season-2',
  title: 'Frieren season 2 gets a date',
  dek: 'January, on the usual slot.',
  topic: 'release_date',
  kinds: ['anime', 'manga'],
  coverUrl: 'https://image.example/frieren.jpg',
  publishedAt: '2026-09-30T10:00:00.000Z',
};

describe('newsEmbed', () => {
  it('links to the article on this instance', () => {
    const json = newsEmbed(article, 'https://trackt.example').toJSON();
    expect(json).toMatchObject({
      title: article.title,
      url: 'https://trackt.example/news/frieren-season-2',
      description: article.dek,
      image: { url: article.coverUrl },
      footer: { text: 'Release date · Anime · Manga' },
      timestamp: article.publishedAt,
    });
  });

  it('leaves out what the article does not have', () => {
    const json = newsEmbed({ ...article, dek: null, coverUrl: null }, 'https://t.example').toJSON();
    expect(json.description).toBeUndefined();
    expect(json.image).toBeUndefined();
  });
});
