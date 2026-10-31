import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PageFetcher } from '../src/http/fetch.js';
import { fetchLetterboxdEntries } from '../src/letterboxd/adapter.js';
import type { FetchEntriesOptions } from '../src/types.js';

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/letterboxd/${name}`, import.meta.url), 'utf8');
}

const EMPTY = '<html><body><div class="poster-grid"></div></body></html>';

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

function options(fetcher: PageFetcher): FetchEntriesOptions {
  return {
    profile: 'dave',
    credentials: {},
    fetcher,
    now: new Date('2026-10-30T12:00:00Z'),
    requestSpacingMs: 0,
  };
}

const FILMS = 'https://letterboxd.com/dave/films/page/1/';
const FILMS_2 = 'https://letterboxd.com/dave/films/page/2/';
const WATCHLIST = 'https://letterboxd.com/dave/watchlist/page/1/';
const WATCHLIST_2 = 'https://letterboxd.com/dave/watchlist/page/2/';
const DIARY = 'https://letterboxd.com/dave/films/diary/';
const DIARY_2 = 'https://letterboxd.com/dave/diary/films/page/2/';

describe('fetchLetterboxdEntries', () => {
  it('reads the three lists and maps each onto the log vocabulary', async () => {
    const fetcher = stubFetcher({
      [FILMS]: { body: fixture('films-page-1.html') },
      [FILMS_2]: { body: EMPTY },
      [WATCHLIST]: { body: fixture('watchlist-page-1.html') },
      [WATCHLIST_2]: { body: EMPTY },
      [DIARY]: { body: fixture('diary.html') },
      [DIARY_2]: { body: EMPTY },
    });
    const { entries, warnings } = await fetchLetterboxdEntries(options(fetcher));

    // 8 watched + 8 planned + 7 only the diary knows (The Sheep Detectives is
    // on both a grid and the diary, and stays one row).
    expect(entries).toHaveLength(23);
    expect(warnings).toEqual([]);

    const clubKid = entries.find((entry) => entry.externalId === 'club-kid');
    expect(clubKid).toMatchObject({ status: 'completed', score: 8, progress: 0, kind: 'movie' });
    expect(clubKid?.finishedAt).toBeNull();

    const planned = entries.filter((entry) => entry.status === 'planned');
    expect(planned).toHaveLength(8);
    expect(planned.every((entry) => entry.score === null)).toBe(true);

    // A diary-only row still imports as watched, because the diary *is* a watch.
    // A grid row the diary also logged keeps the grid's status and gains the date.
    const both = entries.find((entry) => entry.externalId === 'the-sheep-detectives');
    expect(both).toMatchObject({
      status: 'completed',
      score: 7,
      startedAt: '2026-07-08',
      finishedAt: '2026-07-08',
    });

    const diaryOnly = entries.find((entry) => entry.externalId === 'toy-story-4');
    expect(diaryOnly).toMatchObject({
      status: 'completed',
      startedAt: '2026-06-25',
      finishedAt: '2026-06-25',
      score: 7,
    });
  });

  it('keeps one row per slug, and the watched grid beats the watchlist', async () => {
    const fetcher = stubFetcher({
      [FILMS]: { body: fixture('watchlist-page-1.html') },
      [FILMS_2]: { body: EMPTY },
      [WATCHLIST]: { body: fixture('watchlist-page-1.html') },
      [WATCHLIST_2]: { body: EMPTY },
      [DIARY]: { body: EMPTY },
    });
    const { entries } = await fetchLetterboxdEntries(options(fetcher));

    expect(entries).toHaveLength(8);
    expect(entries.map((entry) => entry.externalId).sort()).toEqual(
      [
        'big-world-2024',
        'meiyazhagan',
        'kumbalangi-nights',
        'who-killed-captain-alex',
        'the-ox-bow-incident',
        'a-bronx-tale',
        'turtles-can-fly',
        'to-wong-foo-thanks-for-everything-julie-newmar',
      ].sort(),
    );
    expect(entries.every((entry) => entry.status === 'completed')).toBe(true);
  });

  it('imports the grids when the diary is walled off, with a warning instead of a failure', async () => {
    const fetcher = stubFetcher({
      [FILMS]: { body: fixture('films-page-1.html') },
      [FILMS_2]: { body: EMPTY },
      [WATCHLIST]: { body: fixture('watchlist-page-1.html') },
      [WATCHLIST_2]: { body: EMPTY },
      [DIARY]: { status: 403, body: fixture('challenge.html') },
    });
    const { entries, warnings } = await fetchLetterboxdEntries(options(fetcher));

    expect(entries).toHaveLength(16);
    expect(entries.every((entry) => entry.finishedAt === null)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('partial-source');
    expect(warnings[0]?.message).toContain('diary');
  });

  it('enriches film pages when asked, up to maxEnrich, and says what it skipped', async () => {
    const fetcher = stubFetcher({
      [FILMS]: { body: fixture('films-page-1.html') },
      [FILMS_2]: { body: EMPTY },
      [WATCHLIST]: { body: EMPTY },
      [DIARY]: { body: EMPTY },
      'https://letterboxd.com/film/club-kid/': { body: fixture('film-page.html') },
      'https://letterboxd.com/film/fatherland-2026/': { status: 404 },
    });
    const { entries, warnings } = await fetchLetterboxdEntries({
      ...options(fetcher),
      enrichFilmPages: true,
      maxEnrich: 2,
    });

    expect(entries[0]?.externalIds).toEqual({ tmdb: '791523', imdb: 'tt2056785' });
    // The second film page refused: the row keeps no ids and falls back to title.
    expect(entries[1]?.externalIds).toEqual({});
    expect(entries.slice(2).every((entry) => Object.keys(entry.externalIds).length === 0)).toBe(
      true,
    );

    expect(fetcher.calls.filter((url) => url.startsWith('https://letterboxd.com/film/'))).toEqual([
      'https://letterboxd.com/film/club-kid/',
      'https://letterboxd.com/film/fatherland-2026/',
    ]);
    expect(warnings.map((warning) => warning.code)).toEqual(['partial-source', 'partial-source']);
    expect(warnings.map((warning) => warning.message).join(' ')).toMatch(/could not be read/);
    expect(warnings.map((warning) => warning.message).join(' ')).toMatch(/maxEnrich 2/);
  });
});
