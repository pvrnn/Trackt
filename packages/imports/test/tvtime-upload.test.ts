import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import { readTvTimeUpload, tvTimeUploadLabel } from '../src/tvtime/upload.js';
import { readImportUpload } from '../src/upload.js';

/** Shapes as the TV Time Out tool writes them, trimmed to what the reader keeps. */
const episode = (
  number: number,
  watchedAt: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: { tvdb: 1000 + number, imdb: null },
  number,
  name: `Episode ${number}`,
  special: false,
  is_watched: watchedAt !== null,
  watched_at: watchedAt,
  rewatch_count: 0,
  watched_count: watchedAt ? 1 : 0,
  ...extra,
});

const SERIES = [
  {
    uuid: 'a',
    id: { tvdb: 81189, imdb: null },
    created_at: '2020-01-01T00:00:00Z',
    title: 'Breaking Bad',
    status: 'stopped',
    is_favorite: true,
    _noEpisodeData: false,
    seasons: [
      {
        number: 0,
        is_specials: true,
        episodes: [episode(1, '2020-01-01T10:00:00Z')],
      },
      {
        number: 1,
        is_specials: false,
        episodes: [
          episode(1, '2020-01-05T22:00:00Z', { rewatch_count: 1 }),
          episode(2, '2020-01-06T23:59:00Z', { rewatch_count: 2 }),
          // A special filed inside a regular season does not count towards it.
          episode(3, null, { special: true }),
        ],
      },
      {
        number: 2,
        is_specials: false,
        episodes: [episode(1, '2020-02-01T10:00:00Z'), episode(2, null), episode(3, null)],
      },
    ],
  },
];

const MOVIES = [
  {
    id: { tvdb: 153, imdb: 'tt0330373' },
    uuid: 'fba77bbb-092b-4d99-a68a-af6a70f284e8',
    created_at: '2020-06-08T23:13:18Z',
    title: '  Harry Potter and the Goblet of Fire ',
    year: 2005,
    watched_at: '2020-06-08T23:13:18Z',
    is_watched: true,
    is_favorite: false,
    rewatch_count: 0,
  },
];

const summary = (shows: unknown[], movies: unknown[]) => `<!DOCTYPE html>
<html><head><title>TV Time Out — Export Summary</title></head><body>
  <script>
    var SHOWS  = ${JSON.stringify(shows)};
    var MOVIES = ${JSON.stringify(movies)};

    var _col = 8;
  </script>
</body></html>`;

const htmlShow = (overrides: Record<string, unknown>) => ({
  title: 'Elite',
  tvdbId: 346328,
  imdbId: null,
  status: 'stopped',
  isFavorite: false,
  watched: 16,
  total: 40,
  unwatchedRegularEps: [],
  ...overrides,
});

describe('readTvTimeUpload', () => {
  it('reads the two JSON files into per-season facts', () => {
    const upload = readTvTimeUpload([
      { name: 'tvtime-movies-2026-07-07.json', content: JSON.stringify(MOVIES) },
      { name: 'tvtime-series-2026-07-07.json', content: JSON.stringify(SERIES) },
    ]);

    expect(upload.showsFrom).toBe('json');
    expect(upload.movies).toEqual([
      {
        tvdb: 153,
        imdb: 'tt0330373',
        uuid: 'fba77bbb-092b-4d99-a68a-af6a70f284e8',
        title: 'Harry Potter and the Goblet of Fire',
        year: 2005,
        watched: true,
        watchedAt: '2020-06-08',
        favourite: false,
        rewatches: 0,
      },
    ]);
    const [show] = upload.shows ?? [];
    expect(show).toMatchObject({ tvdb: 81189, status: 'stopped', favourite: true });
    // Season 0 is dropped; season 1's in-season special is not one of its episodes.
    expect(show?.seasons).toEqual([
      {
        number: 1,
        episodes: 2,
        position: 2,
        complete: true,
        firstWatchedAt: '2020-01-05',
        lastWatchedAt: '2020-01-06',
        rewatches: 1,
      },
      {
        number: 2,
        episodes: 3,
        position: 1,
        complete: false,
        firstWatchedAt: '2020-02-01',
        lastWatchedAt: '2020-02-01',
        rewatches: 0,
      },
    ]);
    expect(show?.watchedEpisodes).toBe(3);
  });

  it('infers from the HTML summary only the seasons its unseen list pins down', () => {
    const upload = readTvTimeUpload([
      {
        name: 'tvtime-summary-2026-07-07.html',
        content: summary(
          [
            htmlShow({
              unwatchedRegularEps: [
                { season: 3, episode: 5 },
                { season: 3, episode: 6 },
                { season: 4, episode: 1 },
              ],
            }),
            htmlShow({ title: 'Done', tvdbId: 1, watched: 10, total: 10 }),
            htmlShow({
              title: 'Not started',
              tvdbId: 2,
              status: 'not_started_yet',
              watched: 0,
              total: 2,
              unwatchedRegularEps: [
                { season: 1, episode: 1 },
                { season: 1, episode: 2 },
              ],
            }),
          ],
          [
            {
              title: 'Ready Player One',
              tvdbId: 73,
              imdbId: 'tt1677720',
              year: 2018,
              isWatched: true,
              watchedAt: '2019-10-15T22:24:20Z',
            },
          ],
        ),
      },
    ]);

    expect(upload.showsFrom).toBe('html');
    const [elite, done, notStarted] = upload.shows ?? [];
    // Seasons 1–2 have nothing unseen below season 3, so they are complete;
    // season 3 is seen up to episode 4; season 4 not at all.
    expect(elite?.seasons.map((s) => [s.number, s.complete, s.position])).toEqual([
      [1, true, 0],
      [2, true, 0],
      [3, false, 4],
      [4, false, 0],
    ]);
    // Nothing unseen: only season 1 is claimed, the summary does not say how many there are.
    expect(done?.seasons.map((s) => [s.number, s.complete])).toEqual([[1, true]]);
    expect(notStarted?.seasons.map((s) => [s.number, s.complete, s.position])).toEqual([
      [1, false, 0],
    ]);
    expect(upload.movies?.[0]).toMatchObject({ imdb: 'tt1677720', watchedAt: '2019-10-15' });
  });

  it('prefers a JSON file over the summary for the half it carries', () => {
    const upload = readTvTimeUpload([
      { name: 'summary.html', content: summary([htmlShow({})], []) },
      { name: 'series.json', content: JSON.stringify(SERIES) },
    ]);
    expect(upload.showsFrom).toBe('json');
    expect(upload.shows?.[0]?.title).toBe('Breaking Bad');
    expect(upload.movies).toEqual([]);
  });

  it('leaves the half no file carried as null, not empty', () => {
    const upload = readTvTimeUpload([{ name: 'movies.json', content: JSON.stringify(MOVIES) }]);
    expect(upload.shows).toBeNull();
    expect(upload.showsFrom).toBeNull();
  });

  it('tells an empty movie list from an empty series list by its name', () => {
    const upload = readTvTimeUpload([{ name: 'tvtime-series-2026-07-07.json', content: '[]' }]);
    expect(upload.shows).toEqual([]);
    expect(upload.movies).toBeNull();
  });

  it('refuses files that are not the export, by name', () => {
    const read = (content: string) => () => readTvTimeUpload([{ name: 'export.json', content }]);
    expect(read('not json')).toThrow(ImportError);
    expect(read('{"a":1}')).toThrow(/export\.json is not a TV Time export/);
    expect(read('[{"foo":1}]')).toThrow(/neither the movies nor the series/);
    expect(read('<html><body>hello</body></html>')).toThrow(/SHOWS\/MOVIES/);
    expect(read('[{"seasons":"nope"}]')).toThrow(/show row does not read/);
    expect(() => readTvTimeUpload([])).toThrow(/attach the TV Time export/);
  });

  it('names the run after the export date', () => {
    expect(tvTimeUploadLabel([{ name: 'tvtime-series-2026-07-07.json', content: '' }])).toBe(
      'export 2026-07-07',
    );
    expect(tvTimeUploadLabel([{ name: 'mine.json', content: '' }])).toBe('export');
  });
});

describe('readImportUpload', () => {
  it('refuses a file for a source that reads a profile', () => {
    expect(() => readImportUpload('mal', [{ name: 'x.json', content: '[]' }])).toThrow(
      /read a profile, not a file/,
    );
  });

  it('keeps the compact form small enough to queue', () => {
    const { upload, profile } = readImportUpload('tvtime', [
      { name: 'tvtime-series-2026-07-07.json', content: JSON.stringify(SERIES) },
    ]);
    expect(profile).toBe('export 2026-07-07');
    expect(JSON.stringify(upload)).not.toContain('Episode 1');
  });
});
