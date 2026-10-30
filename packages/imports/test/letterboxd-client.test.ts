import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import type { PageFetcher } from '../src/http/fetch.js';
import { createLetterboxdClient } from '../src/letterboxd/client.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/letterboxd/${name}`, import.meta.url), 'utf8');
}

const EMPTY_GRID = '<html><body><div class="poster-grid"><ul></ul></div></body></html>';

function stubFetcher(routes: Record<string, { status?: number; body?: string }>): PageFetcher & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    async get(url: string) {
      calls.push(url);
      const route = routes[url];
      if (!route) throw new Error(`unexpected request: ${url}`);
      return { status: route.status ?? 200, body: route.body ?? '' };
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((caught: unknown) => caught);
}

describe('createLetterboxdClient', () => {
  it('walks /films/ pages until one is empty', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/page/1/': { body: fixture('films-page-1.html') },
      'https://letterboxd.com/dave/films/page/2/': { body: EMPTY_GRID },
    });
    const items = await createLetterboxdClient({ fetcher }).fetchFilms('dave');

    expect(items).toHaveLength(8);
    expect(fetcher.calls).toEqual([
      'https://letterboxd.com/dave/films/page/1/',
      'https://letterboxd.com/dave/films/page/2/',
    ]);
  });

  it('stops on the last page instead of asking for one more', async () => {
    const lastPage = fixture('films-page-1.html').replace(
      /<a class="next" href="[^"]*">/,
      '<span class="next">',
    );
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/page/1/': { body: lastPage },
    });
    expect(await createLetterboxdClient({ fetcher }).fetchFilms('dave')).toHaveLength(8);
    expect(fetcher.calls).toHaveLength(1);
  });

  it('refuses to loop past maxPages rather than importing half a list', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/page/1/': { body: fixture('films-page-1.html') },
      'https://letterboxd.com/dave/films/page/2/': { body: fixture('films-page-1.html') },
    });
    const error = await failure(
      createLetterboxdClient({ fetcher, maxPages: 2 }).fetchFilms('dave'),
    );
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'http' });
    expect((error as Error).message).toMatch(/refusing to loop/);
  });

  it('reads the watchlist from its own path', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/watchlist/page/1/': { body: fixture('watchlist-page-1.html') },
      'https://letterboxd.com/dave/watchlist/page/2/': { body: EMPTY_GRID },
    });
    const items = await createLetterboxdClient({ fetcher }).fetchWatchlist('dave');
    expect(items).toHaveLength(8);
    expect(items[0]?.slug).toBe('big-world-2024');
  });

  it('reads page 1 of the diary at /films/diary/ and later pages at /diary/films/', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/diary/': { body: fixture('diary.html') },
      'https://letterboxd.com/dave/diary/films/page/2/': { body: '<html><body></body></html>' },
    });
    const items = await createLetterboxdClient({ fetcher }).fetchDiary('dave');
    expect(items).toHaveLength(8);
    expect(fetcher.calls).toEqual([
      'https://letterboxd.com/dave/films/diary/',
      'https://letterboxd.com/dave/diary/films/page/2/',
    ]);
  });

  it('reports an unknown user on page 1 as not-found', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/nobody/films/page/1/': { status: 404 },
    });
    const error = await failure(createLetterboxdClient({ fetcher }).fetchFilms('nobody'));
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'not-found', status: 404 });
  });

  it('treats a 404 past page 1 as the end of the list, not a missing user', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/page/1/': { body: fixture('films-page-1.html') },
      'https://letterboxd.com/dave/films/page/2/': { status: 404 },
    });
    expect(await createLetterboxdClient({ fetcher }).fetchFilms('dave')).toHaveLength(8);
  });

  it('says how to get past a Cloudflare challenge it could not', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/page/1/': {
        status: 403,
        body: fixture('challenge.html'),
      },
    });
    const error = await failure(createLetterboxdClient({ fetcher }).fetchFilms('dave'));
    expect(error).toBeInstanceOf(ImportError);
    expect(error).toMatchObject({ kind: 'http', status: 403 });
    expect((error as Error).message).toContain('IMPORT_FETCH_MODE=fallback');
    expect((error as Error).message).toContain('pnpm add -w playwright');
  });

  it('reports any other error status as http', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/dave/films/page/1/': { status: 500, body: 'oops' },
    });
    const error = await failure(createLetterboxdClient({ fetcher }).fetchFilms('dave'));
    expect(error).toMatchObject({ kind: 'http', status: 500 });
  });

  it('reads the TMDB and IMDb ids off a film page', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/film/wildwood-2026/': { body: fixture('film-page.html') },
    });
    expect(await createLetterboxdClient({ fetcher }).fetchFilmLinks('wildwood-2026')).toEqual({
      tmdb: '791523',
      imdb: 'tt2056785',
    });
  });

  it('reports a film page that does not exist as not-found', async () => {
    const fetcher = stubFetcher({
      'https://letterboxd.com/film/nope/': { status: 404 },
    });
    const error = await failure(createLetterboxdClient({ fetcher }).fetchFilmLinks('nope'));
    expect(error).toMatchObject({ kind: 'not-found' });
  });
});
