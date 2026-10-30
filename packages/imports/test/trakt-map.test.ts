import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mergeTraktRatings } from '../src/trakt/adapter.js';
import { mapTraktMovie, mapTraktSeason, mapTraktWatchlistMovie } from '../src/trakt/map.js';
import type {
  TraktRating,
  TraktShowProgress,
  TraktWatchedMovie,
  TraktWatchedShow,
  TraktWatchlistItem,
} from '../src/trakt/schemas.js';

/**
 * The Trakt fixtures are hand-written from the documented endpoint shapes, not
 * captures: no TRAKT_CLIENT_ID was available, so nothing here came off the live
 * API. They exist to pin the mapper's decisions, not to prove the shapes.
 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/trakt/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const NOW = new Date('2026-10-30T12:00:00Z');
const movies = fixture<TraktWatchedMovie[]>('watched-movies.json');
const shows = fixture<TraktWatchedShow[]>('watched-shows.json');
const progress = fixture<TraktShowProgress>('show-progress.json');

const breakingBad = shows[0]!;
const announced = shows[1]!;

function season(number: number) {
  const found = breakingBad.seasons?.find((candidate) => candidate.number === number);
  if (!found) throw new Error(`no season ${number} in the fixture`);
  return found;
}

function progressSeason(number: number) {
  const found = progress.seasons?.find((candidate) => candidate.number === number);
  if (!found) throw new Error(`no progress season ${number} in the fixture`);
  return found;
}

describe('mapTraktMovie', () => {
  it('maps a watched film onto a completed log row', () => {
    const { entry, warnings } = mapTraktMovie(movies[0]!, { now: NOW });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'trakt',
      kind: 'movie',
      externalId: '481',
      title: 'The Matrix',
      year: 1999,
      seasonNumber: null,
      status: 'completed',
      score: null,
      progress: 0,
      repeats: 1,
      startedAt: '2024-03-10',
      finishedAt: '2024-03-10',
      notes: null,
      externalIds: { trakt: 481, tmdb: 603, imdb: 'tt0133093' },
    });
  });

  it('carries only the ids Trakt actually returned', () => {
    // The third fixture row has a Trakt id and nothing else.
    const { entry, warnings } = mapTraktMovie(movies[2]!, { now: NOW });
    expect(warnings).toEqual([]);
    expect(entry?.externalIds).toEqual({ trakt: 900001 });
  });

  it('counts plays beyond the first as rewatches', () => {
    expect(mapTraktMovie(movies[0]!, { now: NOW }).entry?.repeats).toBe(1);
    expect(mapTraktMovie(movies[1]!, { now: NOW }).entry?.repeats).toBe(0);
  });

  it('drops a future day, as ADR-0007 says', () => {
    const raw = { ...movies[1]!, last_watched_at: '2030-01-02T22:00:00.000Z' };
    const { entry, warnings } = mapTraktMovie(raw, { now: NOW });
    expect(warnings.map((w) => w.code)).toEqual(['future-date']);
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
  });

  it('drops a timestamp that is not a day', () => {
    const raw = { ...movies[1]!, last_watched_at: 'last tuesday' };
    const { entry, warnings } = mapTraktMovie(raw, { now: NOW });
    expect(warnings.map((w) => w.code)).toEqual(['partial-date']);
    expect(entry?.finishedAt).toBeNull();
  });

  it('skips a row that names no work', () => {
    const { entry, warnings } = mapTraktMovie({ plays: 1, movie: null }, { now: NOW });
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('malformed-row');
  });
});

describe('mapTraktSeason', () => {
  it('positions a season on the highest episode seen, gaps included', () => {
    const { entry, warnings } = mapTraktSeason(breakingBad, season(1), progressSeason(1), {
      now: NOW,
    });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'trakt',
      kind: 'series',
      externalId: '1388',
      title: 'Breaking Bad',
      seasonNumber: 1,
      // Season 1 is the only season whose year the show's premiere year states.
      year: 2008,
      status: 'in_progress',
      // Episodes 1, 2 and 5 watched is "on episode 5", not "3 episodes seen".
      progress: 5,
      // Trakt counts the rewatch at show level; the fixture says two plays.
      repeats: 1,
      startedAt: '2020-01-05',
      finishedAt: null,
      externalIds: { trakt: 1388, tmdb: 1396, tvdb: 81189, imdb: 'tt0903747' },
    });
  });

  it('calls a season completed when every aired episode is done, and dates it', () => {
    const { entry } = mapTraktSeason(breakingBad, season(2), progressSeason(2), {
      now: NOW,
    });
    expect(entry).toMatchObject({
      seasonNumber: 2,
      // A season number is not an offset into the show's premiere year.
      year: null,
      status: 'completed',
      progress: 3,
      startedAt: '2020-02-01',
      finishedAt: '2020-02-03',
    });
  });

  it('skips a season that has nothing out rather than writing a 0-episode log', () => {
    const { entry, warnings } = mapTraktSeason(
      announced,
      announced.seasons![0]!,
      { number: 1, aired: 0, completed: 0, episodes: [] },
      { now: NOW },
    );
    expect(entry).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['partial-source']);
    expect(warnings[0]?.message).toContain('no aired episode');
  });

  it('imports an uncompleted season when the progress call failed', () => {
    // `watched/shows` states which episodes played, just not how many are out.
    const { entry } = mapTraktSeason(breakingBad, season(2), null, { now: NOW });
    expect(entry).toMatchObject({
      status: 'in_progress',
      progress: 3,
      startedAt: '2020-02-01',
      finishedAt: null,
    });
  });

  it('skips a season with no watched episode', () => {
    const { entry, warnings } = mapTraktSeason(
      breakingBad,
      { number: 3, episodes: [{ number: 1, plays: 0, last_watched_at: null }] },
      { number: 3, aired: 13, completed: 0, episodes: [] },
      { now: NOW },
    );
    expect(entry).toBeNull();
    expect(warnings[0]?.message).toContain('no watched episode');
  });

  it('skips a season whose show carries no id', () => {
    const { entry, warnings } = mapTraktSeason(
      { plays: 1, show: { title: 'Breaking Bad', year: 2008, ids: {} } },
      season(1),
      progressSeason(1),
      { now: NOW },
    );
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('malformed-row');
  });
});

describe('mapTraktWatchlistMovie', () => {
  it('maps a watchlisted film as planned, carrying its note', () => {
    const items = fixture<TraktWatchlistItem[]>('watchlist-movies.json');
    const { entry, warnings } = mapTraktWatchlistMovie(items[0]!);
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      kind: 'movie',
      externalId: '441',
      title: 'Spirited Away',
      status: 'planned',
      progress: 0,
      repeats: 0,
      startedAt: null,
      finishedAt: null,
      notes: 'watch with Ana',
    });
  });
});

describe('mergeTraktRatings', () => {
  const ratings = fixture<TraktRating[]>('ratings-movies.json');

  it('drops a rating for a work the watched list did not carry, and says why', () => {
    const moviesMapped = movies.map((raw) => mapTraktMovie(raw, { now: NOW }).entry!);
    const warnings = mergeTraktRatings(moviesMapped, ratings);

    expect(moviesMapped[0]?.score).toBe(8);
    // The orphan (trakt 900002) has no entry to land on.
    expect(warnings.map((w) => w.code)).toEqual(['partial-source']);
    expect(warnings[0]?.message).toContain('not in the watched lists');
    expect(warnings[0]?.title).toBe('A Rated Film With No Watch');
  });

  it('lands a show rating on every season of that show', () => {
    const seasons = [1, 2].map(
      (number) => mapTraktSeason(breakingBad, season(number), progressSeason(number)).entry!,
    );
    const showRating: TraktRating = {
      rated_at: '2020-03-01T10:00:00.000Z',
      rating: 9,
      type: 'show',
      show: breakingBad.show,
    };

    expect(mergeTraktRatings(seasons, [showRating])).toEqual([]);
    expect(seasons.map((entry) => entry.score)).toEqual([9, 9]);
  });

  it('refuses a rating outside Trakt’s 1–10 scale', () => {
    const moviesMapped = [mapTraktMovie(movies[0]!, { now: NOW }).entry!];
    const warnings = mergeTraktRatings(moviesMapped, [{ ...ratings[0]!, rating: 12 }]);
    expect(warnings.map((w) => w.code)).toEqual(['score-invalid']);
    expect(moviesMapped[0]?.score).toBeNull();
  });
});
