import { describe, expect, it } from 'vitest';
import { fetchTvTimeEntries } from '../src/tvtime/adapter.js';
import { mapTvTimeMovie, mapTvTimeShow } from '../src/tvtime/map.js';
import type { TvTimeExport, TvTimeMovie, TvTimeSeason, TvTimeShow } from '../src/tvtime/schemas.js';

const NOW = new Date('2026-11-01T12:00:00Z');

const movie = (overrides: Partial<TvTimeMovie> = {}): TvTimeMovie => ({
  tvdb: 153,
  imdb: 'tt0330373',
  uuid: 'uuid-1',
  title: 'Harry Potter and the Goblet of Fire',
  year: 2005,
  watched: true,
  watchedAt: '2020-06-08',
  favourite: false,
  rewatches: 0,
  ...overrides,
});

const season = (overrides: Partial<TvTimeSeason> = {}): TvTimeSeason => ({
  number: 1,
  episodes: 8,
  position: 8,
  complete: true,
  firstWatchedAt: '2019-04-21',
  lastWatchedAt: '2019-04-22',
  rewatches: 0,
  ...overrides,
});

const show = (overrides: Partial<TvTimeShow> = {}): TvTimeShow => ({
  tvdb: 346328,
  imdb: null,
  title: 'Elite',
  status: 'continuing',
  favourite: false,
  watchedEpisodes: 12,
  seasons: [season(), season({ number: 2, position: 4, complete: false, lastWatchedAt: null })],
  ...overrides,
});

describe('mapTvTimeMovie', () => {
  it('maps a watched film to one completed day, joined on IMDb only', () => {
    const { entry, warnings } = mapTvTimeMovie(movie({ favourite: true, rewatches: 2 }), {
      now: NOW,
    });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'tvtime',
      kind: 'movie',
      externalId: '153',
      status: 'completed',
      startedAt: '2020-06-08',
      finishedAt: '2020-06-08',
      repeats: 2,
      favourite: true,
      // A TVDB movie id is not the TVDB series namespace the catalog stores.
      externalIds: { imdb: 'tt0330373' },
      fallbackKind: 'anime',
    });
  });

  it('plans an unwatched film', () => {
    const { entry } = mapTvTimeMovie(movie({ watched: false, watchedAt: null, rewatches: 3 }));
    expect(entry).toMatchObject({ status: 'planned', startedAt: null, repeats: 0 });
  });

  it('drops a future watch date with a warning', () => {
    const { entry, warnings } = mapTvTimeMovie(movie({ watchedAt: '2027-01-01' }), { now: NOW });
    expect(entry?.startedAt).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['future-date']);
  });

  it('refuses a row with no title', () => {
    const { entry, warnings } = mapTvTimeMovie(movie({ title: null }));
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('malformed-row');
  });
});

describe('mapTvTimeShow', () => {
  it('logs one entry per season seen, keyed on the TVDB show', () => {
    const { entries, warnings } = mapTvTimeShow(show({ favourite: true }), { now: NOW });
    expect(warnings).toEqual([]);
    expect(entries.map(({ entry }) => entry)).toMatchObject([
      {
        kind: 'series',
        externalId: '346328',
        seasonNumber: 1,
        status: 'completed',
        progress: 8,
        startedAt: '2019-04-21',
        finishedAt: '2019-04-22',
        favourite: true,
        externalIds: { tvdb: 346328 },
        fallbackKind: 'anime',
      },
      {
        seasonNumber: 2,
        status: 'in_progress',
        progress: 4,
        finishedAt: null,
        // One heart for the show, not one per season.
        favourite: false,
      },
    ]);
    // Only season 1 offers itself as an anime: later seasons have no sound mapping.
    expect(entries[1]?.entry.fallbackKind).toBeUndefined();
  });

  it('calls an unfinished season of a stopped show dropped', () => {
    const { entries } = mapTvTimeShow(show({ status: 'stopped' }));
    expect(entries.map(({ entry }) => entry.status)).toEqual(['completed', 'dropped']);
  });

  it('plans season 1 of a show on the list with nothing seen', () => {
    const { entries } = mapTvTimeShow(
      show({
        status: 'not_started_yet',
        watchedEpisodes: 0,
        seasons: [
          season({ position: 0, complete: false, firstWatchedAt: null, lastWatchedAt: null }),
        ],
      }),
    );
    expect(entries.map(({ entry }) => entry)).toMatchObject([
      { seasonNumber: 1, status: 'planned', progress: 0, fallbackKind: 'anime' },
    ]);
  });

  it('skips a stopped show with nothing seen', () => {
    const { entries, warnings } = mapTvTimeShow(
      show({ status: 'stopped', watchedEpisodes: 0, seasons: [] }),
    );
    expect(entries).toEqual([]);
    expect(warnings[0]?.code).toBe('partial-source');
  });

  it('reports seen episodes no season could hold rather than planning the show', () => {
    const { entries, warnings } = mapTvTimeShow(show({ watchedEpisodes: 5, seasons: [] }));
    expect(entries).toEqual([]);
    expect(warnings[0]?.message).toMatch(/5 episodes are marked seen/);
  });
});

describe('fetchTvTimeEntries', () => {
  const upload: TvTimeExport = {
    showsFrom: 'html',
    movies: [movie(), movie({ title: null })],
    shows: [show()],
  };

  it('maps the attached export and says what the summary cannot carry', async () => {
    const fetched = await fetchTvTimeEntries({
      profile: 'export',
      credentials: {},
      upload,
      now: NOW,
    });
    expect(fetched.entries.map((entry) => `${entry.kind}:${entry.seasonNumber ?? '-'}`)).toEqual([
      'movie:-',
      'series:1',
      'series:2',
    ]);
    expect(fetched.entryWarnings.get('tvtime:series:346328:1')).toEqual([]);
    expect(fetched.warnings.map((w) => w.code)).toEqual(['malformed-row', 'partial-source']);
    expect(fetched.warnings[1]?.message).toMatch(/HTML summary/);
  });

  it('says when the upload carried only one half', async () => {
    const fetched = await fetchTvTimeEntries({
      profile: 'export',
      credentials: {},
      upload: { showsFrom: null, movies: [], shows: null },
    });
    expect(fetched.warnings.map((w) => w.message)).toEqual([
      'the upload carries no show list — shows not imported',
    ]);
  });

  it('fails as malformed when nothing is attached', async () => {
    await expect(fetchTvTimeEntries({ profile: 'export', credentials: {} })).rejects.toMatchObject({
      kind: 'malformed',
    });
  });
});
