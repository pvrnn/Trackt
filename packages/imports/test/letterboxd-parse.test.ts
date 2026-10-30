import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  hasNextPage,
  parseDiary,
  parseFilmLinks,
  parsePosterGrid,
} from '../src/letterboxd/parse.js';

/** Pages captured from letterboxd.com on 2026-10-30, trimmed to a few items. */
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/letterboxd/${name}`, import.meta.url), 'utf8');
}

describe('parsePosterGrid', () => {
  it('reads the watched grid: slugs, titles, years, ratings and likes', () => {
    const items = parsePosterGrid(fixture('films-page-1.html'));
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({
      slug: 'club-kid',
      title: 'Club Kid',
      year: 2026,
      rating: 8,
      liked: true,
    });
    expect(items[0]?.uid).toMatch(/^film:\d+$/);
    // 5/10 is 2½ stars; the parser keeps Letterboxd's own 0–10 scale.
    expect(items.find((item) => item.slug === 'the-mandalorian-and-grogu')?.rating).toBe(5);
    expect(items.filter((item) => item.liked)).toHaveLength(3);
  });

  it('leaves an unrated film null rather than guessing a score', () => {
    const items = parsePosterGrid(fixture('films-page-1.html'));
    const unrated = items.find((item) => item.slug === 'the-punisher-one-last-kill');
    expect(unrated?.rating).toBeNull();
    expect(unrated?.title).toBe('The Punisher: One Last Kill');
  });

  it('reads the watchlist grid, where nothing carries a rating', () => {
    const items = parsePosterGrid(fixture('watchlist-page-1.html'));
    expect(items).toHaveLength(8);
    expect(items.map((item) => item.rating)).toEqual(Array(8).fill(null));
    expect(items[0]).toMatchObject({ slug: 'big-world-2024', title: 'Big World', year: 2024 });
    expect(items.map((item) => item.title)).toContain('Who Killed Captain Alex?');
  });

  it('takes the last parenthesised year, so a subtitle is not mistaken for one', () => {
    const html = fixture('films-page-1.html').replace(
      'data-item-full-display-name="Club Kid (2026)"',
      'data-item-full-display-name="Movie (Director&#39;s Cut) (2001)"',
    );
    expect(parsePosterGrid(html)[0]).toMatchObject({
      title: "Movie (Director's Cut)",
      year: 2001,
    });
  });

  it('returns nothing for a page with no grid', () => {
    expect(parsePosterGrid('<html><body><p>Nothing here</p></body></html>')).toEqual([]);
  });
});

describe('parseDiary', () => {
  it('reads a dated viewing per row, carrying month and year forward', () => {
    const items = parseDiary(fixture('diary.html'));
    expect(items).toHaveLength(8);
    expect(items[0]).toMatchObject({
      slug: 'obsession-2025',
      title: 'Obsession',
      year: 2025,
      watchedOn: '2026-07-09',
      rating: 7,
      rewatch: false,
    });
    // Only the first row of a month prints its month and year; the ones under it
    // leave those cells empty, which is why the parser carries them.
    expect(items.map((item) => item.watchedOn)).toEqual([
      '2026-07-09',
      '2026-07-08',
      '2026-06-25',
      '2026-06-19',
      '2026-06-19',
      '2026-06-18',
      '2026-06-16',
      '2026-05-31',
    ]);
  });

  it('distinguishes a rewatch from a first viewing', () => {
    const items = parseDiary(fixture('diary.html'));
    expect(items.filter((item) => item.rewatch).map((item) => item.slug)).toEqual([
      'toy-story-4',
      'toy-story-3',
      'toy-story-2',
      'toy-story',
      'rush-hour',
    ]);
    expect(items.filter((item) => !item.rewatch).map((item) => item.slug)).toEqual([
      'obsession-2025',
      'the-sheep-detectives',
      'disclosure-day',
    ]);
  });

  it('reads the viewing’s rating, which is not the film’s released year', () => {
    const items = parseDiary(fixture('diary.html'));
    expect(items.find((item) => item.slug === 'toy-story-3')?.rating).toBe(9);
    expect(items.find((item) => item.slug === 'toy-story-3')?.year).toBe(2010);
  });

  it('returns nothing for a page with no diary table', () => {
    expect(parseDiary('<html><body></body></html>')).toEqual([]);
  });
});

describe('parseFilmLinks', () => {
  it('takes the TMDB and IMDb ids off the film page', () => {
    expect(parseFilmLinks(fixture('film-page.html'))).toEqual({
      tmdb: '791523',
      imdb: 'tt2056785',
    });
  });

  it('reports a missing link as null', () => {
    expect(parseFilmLinks('<html><body></body></html>')).toEqual({ tmdb: null, imdb: null });
  });
});

describe('hasNextPage', () => {
  it('is true when the pagination has an "Older" link', () => {
    expect(hasNextPage(fixture('films-page-1.html'))).toBe(true);
    expect(hasNextPage(fixture('watchlist-page-1.html'))).toBe(true);
  });

  it('is false on a last page, where "Older" is a span', () => {
    const html = fixture('films-page-1.html').replace(
      /<a class="next" href="[^"]*">/,
      '<span class="next">',
    );
    expect(hasNextPage(html)).toBe(false);
  });
});
