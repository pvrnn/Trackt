import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PageFetcher } from '../src/http/fetch.js';
import { fetchMalEntries } from '../src/mal/adapter.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/mal/${name}`, import.meta.url), 'utf8');
}

/** The anime and manga endpoints, empty second pages, and one favourites page. */
function stubFetcher(favorites: { status?: number; body?: string }): PageFetcher {
  return {
    async get(url: string) {
      if (url.includes('/favorites')) {
        return { status: favorites.status ?? 200, body: favorites.body ?? '' };
      }
      if (url.includes('offset=0')) {
        const body = url.includes('/animelist/')
          ? fixture('anime-list.json')
          : fixture('manga-list.json');
        return { status: 200, body };
      }
      return { status: 200, body: '[]' };
    },
  };
}

const fetch = (favorites: { status?: number; body?: string }) =>
  fetchMalEntries({
    profile: 'Kyoma__',
    credentials: {},
    fetcher: stubFetcher(favorites),
  });

describe('fetchMalEntries', () => {
  it('flags the favourites the lists carry, and reports the ones they do not', async () => {
    const { entries, warnings } = await fetch({ body: fixture('favorites.html') });

    expect(entries.map((entry) => `${entry.kind}:${entry.externalId}`)).toEqual([
      'anime:31646',
      'anime:33337',
      'manga:143991',
      // Yotsuba&! is the one favourite the lists also carry.
      'manga:104',
    ]);
    expect(entries.find((entry) => entry.externalId === '104')?.favourite).toBe(true);
    expect(entries.filter((entry) => entry.favourite)).toHaveLength(1);

    const unlisted = warnings.filter((w) => w.code === 'favourite-not-listed');
    expect(unlisted.map((w) => w.externalId)).toEqual(['1210', '5114']);
    expect(unlisted[0]?.message).toMatch(/pinned as a favourite/);
  });

  it('imports the lists even when the favourites page refuses', async () => {
    const { entries, warnings } = await fetch({ status: 403 });

    expect(entries).toHaveLength(4);
    expect(entries.some((entry) => entry.favourite)).toBe(false);
    expect(warnings.map((w) => w.code)).toEqual(['partial-source']);
    expect(warnings[0]?.message).toMatch(/favourites page could not be read/);
  });

  it('says so when the favourites page has no sections at all', async () => {
    const { entries, warnings } = await fetch({ body: '<html><body>new layout</body></html>' });

    expect(entries).toHaveLength(4);
    expect(warnings.map((w) => w.code)).toEqual(['partial-source']);
    expect(warnings[0]?.message).toMatch(/no Anime or Manga section/);
  });
});
