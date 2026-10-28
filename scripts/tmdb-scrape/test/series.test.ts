import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parseSeriesArgs,
  parseSeriesCheckpoint,
  seasonRows,
  seriesQuery,
  showStatus,
  showSynonyms,
  type TmdbShow,
} from '../series.ts';

/** Breaking Bad, as `/tv/1396` answers it (abridged). */
const breakingBad: TmdbShow = {
  id: 1396,
  name: 'Breaking Bad',
  original_name: 'Breaking Bad',
  overview: 'Walter White, a New Mexico chemistry teacher…',
  first_air_date: '2008-01-20',
  last_air_date: '2013-09-29',
  poster_path: '/ztkUQFLlC19CCMYHW9o1zWhJRNq.jpg',
  backdrop_path: '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
  vote_average: 8.958,
  vote_count: 18_978,
  original_language: 'en',
  status: 'Ended',
  type: 'Scripted',
  genres: [
    { id: 18, name: 'Drama' },
    { id: 80, name: 'Crime' },
  ],
  origin_country: ['US'],
  spoken_languages: [{ english_name: 'English' }],
  number_of_seasons: 5,
  number_of_episodes: 62,
  episode_run_time: [49],
  created_by: [{ name: 'Vince Gilligan' }],
  networks: [{ name: 'AMC' }],
  tagline: 'All Hail the King.',
  seasons: [
    {
      season_number: 0,
      episode_count: 11,
      air_date: '2009-02-17',
      name: 'Specials',
      poster_path: '/x.jpg',
    },
    {
      season_number: 1,
      episode_count: 7,
      air_date: '2008-01-20',
      name: 'Season 1',
      overview: 'High school chemistry teacher Walter White…',
      poster_path: '/s1.jpg',
      vote_average: 8.4,
    },
    {
      season_number: 2,
      episode_count: 13,
      air_date: '2009-03-08',
      name: 'Season 2',
      poster_path: '/s2.jpg',
    },
    {
      season_number: 3,
      episode_count: 0,
      air_date: null,
      name: 'Season 3',
    },
  ],
  external_ids: { imdb_id: 'tt0903747', tvdb_id: 81189 },
  translations: {
    translations: [
      { iso_639_1: 'en', iso_3166_1: 'US', data: { name: '' } },
      { iso_639_1: 'fr', iso_3166_1: 'CA', data: { name: 'Breaking Bad : Le chimiste' } },
      { iso_639_1: 'fr', iso_3166_1: 'FR', data: { name: 'Breaking Bad' } },
      { iso_639_1: 'es', iso_3166_1: 'ES', data: { name: 'Breaking Bad' } },
      { iso_639_1: 'de', iso_3166_1: 'DE', data: { name: 'Breaking Bad' } },
    ],
  },
};

describe('the series arguments', () => {
  it('defaults to ten season rows above the TV-appropriate floor', () => {
    const args = parseSeriesArgs([]);
    assert.deepEqual(args, {
      limit: 10,
      minVoteCount: 10_000,
      language: 'en-US',
      out: 'apps/catalog/seed/top-series-tmdb.json',
      sort: 'rating',
      concurrency: 3,
      resume: false,
      excludeAnime: false,
    });
  });

  it('takes the run a long seed needs', () => {
    const args = parseSeriesArgs([
      '--limit',
      '30000',
      '--min-vote-count',
      '10',
      '--sort',
      'popularity',
      '--exclude-anime',
      '--concurrency',
      '4',
      '--resume',
      '--out',
      '/tmp/series.json',
    ]);
    assert.equal(args.limit, 30_000);
    assert.equal(args.minVoteCount, 10);
    assert.equal(args.sort, 'popularity');
    assert.equal(args.excludeAnime, true);
    assert.equal(args.concurrency, 4);
    assert.equal(args.resume, true);
    assert.equal(args.out, '/tmp/series.json');
  });

  it('refuses an argument it cannot use', () => {
    assert.throws(() => parseSeriesArgs(['--limit', '0']), /--limit/);
    assert.throws(() => parseSeriesArgs(['--sort', 'trending']), /--sort/);
    assert.throws(() => parseSeriesArgs(['--concurrency', '9']), /--concurrency/);
    assert.throws(() => parseSeriesArgs(['--min-vote-count', '-2']), /--min-vote-count/);
    assert.throws(() => parseSeriesArgs(['--language', 'en_US']), /--language/);
  });
});

describe('the series ranking query', () => {
  it('sorts by average behind a vote floor and partitions on the first air date', () => {
    assert.deepEqual(seriesQuery({ minVoteCount: 10, language: 'en-US', sort: 'rating' }, 2008), {
      sort_by: 'vote_average.desc',
      'vote_count.gte': 10,
      include_adult: 'false',
      language: 'en-US',
      first_air_date_year: 2008,
    });
  });

  it('sorts by vote count for a popularity run', () => {
    assert.equal(
      seriesQuery({ minVoteCount: 10, language: 'en-US', sort: 'popularity' }).sort_by,
      'vote_count.desc',
    );
  });
});

describe('the status the series seed writes', () => {
  it('folds TMDB show statuses onto the catalog enums', () => {
    assert.equal(showStatus('Returning Series'), 'airing');
    assert.equal(showStatus('Ended'), 'ended');
    assert.equal(showStatus('Canceled'), 'cancelled');
    assert.equal(showStatus('In Production'), 'announced');
    assert.equal(showStatus(undefined), null);
  });
});

describe('the titles the seed keeps as synonyms', () => {
  it('keeps the native title and one French and Spanish title', () => {
    // The French translation repeats the title, so only the original survives.
    assert.deepEqual(showSynonyms(breakingBad), []);
  });

  it('takes the region matching the language over the first variant listed', () => {
    const show: TmdbShow = {
      id: 1,
      name: 'Dr. House',
      original_name: 'House',
      translations: {
        translations: [
          { iso_639_1: 'fr', iso_3166_1: 'CA', data: { name: 'Dr House (CA)' } },
          { iso_639_1: 'fr', iso_3166_1: 'FR', data: { name: 'Dr House' } },
          { iso_639_1: 'es', iso_3166_1: 'ES', data: { name: 'House' } },
        ],
      },
    };
    assert.deepEqual(showSynonyms(show), ['House', 'Dr House']);
  });
});

describe('the season rows one show contributes', () => {
  const rows = seasonRows(breakingBad);

  it('writes one row per real season, skipping the specials and the empty season', () => {
    assert.deepEqual(
      rows.map((row) => row.seasonNumber),
      [1, 2],
    );
  });

  it('pins the canonical id a series season derives on every instance', () => {
    // Frozen forever, shared with packages/shared/src/canonical-id.ts (ADR-0003).
    assert.equal(rows[0]!.id, 'e6a230c6-268c-5445-8b5d-d339ee9d51c6');
    assert.equal(rows[1]!.id, 'a298c671-8044-5bf5-96f0-6f3f8f64af27');
  });

  it('maps a season onto a catalog row', () => {
    assert.deepEqual(rows[0], {
      id: 'e6a230c6-268c-5445-8b5d-d339ee9d51c6',
      kind: 'series',
      title: 'Breaking Bad',
      synonyms: [],
      year: 2008,
      status: 'ended',
      genres: ['drama', 'crime'],
      partCount: 7,
      seasonNumber: 1,
      externalIds: { tmdb: 1396, imdb: 'tt0903747', tvdb: 81189 },
      metadata: {
        format: 'tv',
        providerScore: 89.6,
        ratingCount: 18_978,
        seasonName: 'Season 1',
        airDate: '2008-01-20',
        lastAirDate: '2013-09-29',
        seriesType: 'Scripted',
        episodeRuntime: 49,
        originalLanguage: 'en',
        creators: ['Vince Gilligan'],
        networks: ['AMC'],
        originCountry: ['US'],
        spokenLanguages: ['English'],
        totalSeasons: 5,
        totalEpisodes: 62,
        tagline: 'All Hail the King.',
      },
      description: 'High school chemistry teacher Walter White…',
      coverUrl: 'https://image.tmdb.org/t/p/w500/s1.jpg',
      bannerUrl: 'https://image.tmdb.org/t/p/w1280/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    });
  });

  it('falls back to the show poster and the show overview when a season has none', () => {
    const [, second] = rows;
    assert.equal(second!.coverUrl, 'https://image.tmdb.org/t/p/w500/s2.jpg');
    assert.equal(second!.description, 'Walter White, a New Mexico chemistry teacher…');
    assert.equal(second!.metadata.seasonName, 'Season 2');
  });

  it('keeps the air date in metadata, since the slim contract has no column for it', () => {
    assert.equal(rows[1]!.metadata.airDate, '2009-03-08');
    assert.equal(rows[1]!.year, 2009);
  });

  it('survives a show TMDB has almost nothing on', () => {
    const sparse = seasonRows({ id: 5, name: 'Untitled', seasons: [{ season_number: 2 }] });
    assert.deepEqual(sparse, []);
    const noEpisodes = seasonRows({
      id: 6,
      name: 'Untitled',
      seasons: [{ season_number: 1, episode_count: 4 }],
    });
    assert.equal(noEpisodes[0]!.partCount, 4);
    assert.equal(noEpisodes[0]!.year, null);
    assert.equal(noEpisodes[0]!.status, null);
    assert.deepEqual(noEpisodes[0]!.genres, []);
    assert.deepEqual(noEpisodes[0]!.externalIds, { tmdb: 6 });
    assert.equal(noEpisodes[0]!.coverUrl, null);
    assert.equal(noEpisodes[0]!.bannerUrl, null);
    assert.equal(noEpisodes[0]!.description, null);
  });
});

describe('the series checkpoint a run resumes from', () => {
  it('reads a show back with all of its season rows', () => {
    const rows = seasonRows(breakingBad);
    const text = `${JSON.stringify({ showId: 1396, rows })}\n{"showId":7,"rows":[{"id":"a`;
    const shows = parseSeriesCheckpoint(text);
    assert.equal(shows.size, 1);
    assert.deepEqual(shows.get(1396), rows);
  });

  it('keeps a show that has no eligible season, so a resume does not ask again', () => {
    const shows = parseSeriesCheckpoint(`${JSON.stringify({ showId: 9, rows: [] })}\n`);
    assert.deepEqual(shows.get(9), []);
  });
});
