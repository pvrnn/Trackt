import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  authorize,
  collectRanking,
  discoverQuery,
  genreTag,
  imageUrl,
  isJapaneseAnimation,
  mapLimit,
  parseArgs,
  parseCheckpoint,
  rankKey,
  statusFor,
  synonymsFor,
  toSeedRow,
  uuidV5,
  walkRanking,
  yearsToScan,
  type DiscoverPage,
  type TmdbCrew,
  type TmdbMovie,
} from '../scrape.ts';

const isNotAnime = (movie: {
  genre_ids?: number[];
  genres?: { id: number }[];
  original_language?: string;
}) => !isJapaneseAnimation(movie);

/**
 * The seed mints its own ids because a scraper has no `@trackt/shared` to
 * import: the namespace and the `provider:kind:id` key are copied here, so a
 * drift in either would publish rows no instance can derive (ADR-0001).
 */

describe('the TMDB seed id', () => {
  it('derives the canonical movie id every instance computes', () => {
    // Frozen forever, and shared with packages/shared/test/canonical-id.test.ts.
    assert.equal(uuidV5('tmdb:movie:278'), '6e5d9a00-1468-5ca9-bbda-74c79d7a66b6');
    assert.equal(uuidV5('tmdb:movie:238'), '739cf7a2-dbf6-59a0-ae8e-398bbc2a36d8');
  });

  it('is a v5 uuid', () => {
    const id = uuidV5('tmdb:movie:1');
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(id, uuidV5('tmdb:movie:2'));
  });
});

describe('the walk arguments', () => {
  it('defaults to the top ten movies above a meaningful vote floor', () => {
    const args = parseArgs([]);
    assert.equal(args.limit, 10);
    assert.equal(args.minVoteCount, 10_000);
    assert.equal(args.language, 'en-US');
    assert.equal(args.out, 'apps/catalog/seed/top-movies-tmdb.json');
    assert.equal(args.sort, 'rating');
    assert.equal(args.concurrency, 3);
    assert.equal(args.resume, false);
    assert.equal(args.excludeAnime, false);
  });

  it('takes an explicit size, floor, language, order and path', () => {
    const args = parseArgs([
      '--limit',
      '250',
      '--min-vote-count',
      '100',
      '--sort',
      'popularity',
      '--language',
      'fr-FR',
      '--out',
      '/tmp/x.json',
    ]);
    assert.deepEqual(args, {
      limit: 250,
      minVoteCount: 100,
      language: 'fr-FR',
      out: '/tmp/x.json',
      sort: 'popularity',
      concurrency: 3,
      resume: false,
      excludeAnime: false,
    });
  });

  it('takes a pace and a resume flag, the flag without a value of its own', () => {
    const args = parseArgs(['--concurrency', '6', '--resume', '--limit', '30']);
    assert.equal(args.concurrency, 6);
    assert.equal(args.resume, true);
    assert.equal(args.limit, 30);
  });

  it('leaves anime in unless the run asks it to go', () => {
    assert.equal(parseArgs(['--exclude-anime']).excludeAnime, true);
  });

  it('accepts a ranking larger than the ten thousand one query can return', () => {
    assert.equal(parseArgs(['--limit', '30000']).limit, 30_000);
  });

  it('refuses a size, floor, order, pace or language it cannot use', () => {
    assert.throws(() => parseArgs(['--limit', 'many']), /--limit/);
    assert.throws(() => parseArgs(['--limit', '50001']), /--limit/);
    assert.throws(() => parseArgs(['--min-vote-count', '-1']), /--min-vote-count/);
    assert.throws(() => parseArgs(['--sort', 'trending']), /--sort/);
    assert.throws(() => parseArgs(['--concurrency', '0']), /--concurrency/);
    assert.throws(() => parseArgs(['--concurrency', '9']), /--concurrency/);
    assert.throws(() => parseArgs(['--language', 'english']), /--language/);
    assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  });
});

describe('the ranking query', () => {
  it('sorts by average behind a vote floor, and never includes adult titles', () => {
    assert.deepEqual(discoverQuery({ minVoteCount: 5000, language: 'en-US', sort: 'rating' }), {
      sort_by: 'vote_average.desc',
      'vote_count.gte': 5000,
      include_adult: 'false',
      language: 'en-US',
    });
  });

  it('sorts by vote count when the run is a popularity ranking', () => {
    assert.equal(
      discoverQuery({ minVoteCount: 10, language: 'en-US', sort: 'popularity' }).sort_by,
      'vote_count.desc',
    );
  });

  it('narrows a partition to one release year, so it stays under the result cap', () => {
    assert.equal(
      discoverQuery({ minVoteCount: 10, language: 'en-US', sort: 'popularity' }, 1994)[
        'primary_release_year'
      ],
      1994,
    );
  });

  it('reads the key it sorted by off the row itself', () => {
    assert.equal(rankKey('popularity', { vote_count: 900 }), 900);
    assert.equal(rankKey('rating', { vote_average: 8.4 }), 8.4);
    assert.equal(rankKey('popularity', { vote_average: 8.4 }), 0);
  });

  it('scans every year from the first films to the last announced release', () => {
    const years = yearsToScan(1900);
    assert.equal(years[0], 1870);
    assert.equal(years.at(-1), 1900);
    assert.equal(years.length, 31);
  });
});

describe('the ranking walk', () => {
  const page = (results: TmdbMovie[], total = 500): DiscoverPage => ({
    page: 1,
    total_pages: total,
    results,
  });

  it('stops at the requested size', async () => {
    const pages = [
      page([
        { id: 1, title: 'One' },
        { id: 2, title: 'Two' },
      ]),
      page([
        { id: 3, title: 'Three' },
        { id: 4, title: 'Four' },
      ]),
    ];
    const movies = await walkRanking(async (n) => pages[n - 1]!, 3);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [1, 2, 3],
    );
  });

  it('dedupes a movie that shifts between pages instead of counting it twice', async () => {
    const pages = [
      page([
        { id: 1, title: 'One' },
        { id: 2, title: 'Two' },
      ]),
      page([
        { id: 2, title: 'Two' },
        { id: 3, title: 'Three' },
        { id: 4, title: 'Four' },
      ]),
    ];
    const movies = await walkRanking(async (n) => pages[n - 1]!, 3);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [1, 2, 3],
    );
  });

  it('stops at the last page rather than asking for one past it', async () => {
    const asked: number[] = [];
    const movies = await walkRanking(async (n) => {
      asked.push(n);
      return page([{ id: n, title: `Movie ${n}` }], 2);
    }, 10);
    assert.deepEqual(asked, [1, 2]);
    assert.equal(movies.length, 2);
  });

  it('asks for at most the 500 pages one discover query allows', async () => {
    let calls = 0;
    await walkRanking(async () => {
      calls++;
      return page([{ id: calls, title: `Movie ${calls}` }], 100_000);
    }, 10_000);
    assert.equal(calls, 500);
  });

  it('keeps walking past a movie the run was told to leave out', async () => {
    const pages = [
      page(
        [
          { id: 1, title: 'Anime', genre_ids: [16], original_language: 'ja' },
          { id: 2, title: 'Kept', genre_ids: [18], original_language: 'en' },
        ],
        2,
      ),
      page([{ id: 3, title: 'Also kept', genre_ids: [28], original_language: 'en' }], 2),
    ];
    const movies = await walkRanking(async (n) => pages[n - 1]!, 2, isNotAnime);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [2, 3],
    );
  });
});

describe('the ranking merge', () => {
  const batch = (results: TmdbMovie[], totalPages = 1): DiscoverPage => ({
    page: 1,
    total_pages: totalPages,
    results,
  });
  const film = (id: number, votes: number): TmdbMovie => ({
    id,
    title: `Movie ${id}`,
    vote_count: votes,
  });
  const feed = (pages: DiscoverPage[]) => {
    const asked: number[] = [];
    return {
      asked,
      source: {
        label: 'partition',
        fetchPage: async (requested: number) => {
          asked.push(requested);
          return pages[requested - 1] ?? batch([]);
        },
      },
    };
  };
  const byVotes = (movie: TmdbMovie) => movie.vote_count ?? 0;

  it('merges partitions into the one global order a single query would give', async () => {
    const older = feed([batch([film(1, 100), film(2, 80)])]);
    const newer = feed([batch([film(3, 90), film(4, 70)])]);
    const movies = await collectRanking([older.source, newer.source], 4, byVotes);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [1, 3, 2, 4],
    );
  });

  it('stops at the requested size instead of walking every partition to the end', async () => {
    const first = feed([batch([film(1, 100), film(2, 90)], 3), batch([film(5, 10)], 3)]);
    const second = feed([batch([film(3, 95), film(4, 85)], 3), batch([film(6, 5)], 3)]);
    const movies = await collectRanking([first.source, second.source], 2, byVotes);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [1, 3],
    );
    assert.deepEqual(first.asked, [1]);
    assert.deepEqual(second.asked, [1]);
  });

  it('counts a movie that shifts between pages once', async () => {
    const only = feed([batch([film(1, 50), film(1, 50)], 2), batch([film(2, 40)], 2)]);
    const movies = await collectRanking([only.source], 3, byVotes);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [1, 2],
    );
  });

  it('asks for at most the 500 pages one partition allows', async () => {
    const asked: number[] = [];
    const endless = {
      label: 'endless',
      fetchPage: async (requested: number) => {
        asked.push(requested);
        return batch([film(requested, 1000 - requested)], 100_000);
      },
    };
    await collectRanking([endless], 10_000, byVotes);
    assert.equal(asked.length, 500);
  });

  it('skips a filtered movie and takes the next one in rank order', async () => {
    const only = feed([
      batch([
        { id: 1, title: 'Anime', genre_ids: [16], original_language: 'ja', vote_count: 900 },
        { id: 2, title: 'Kept', genre_ids: [18], original_language: 'en', vote_count: 800 },
        { id: 3, title: 'Also kept', genre_ids: [28], original_language: 'en', vote_count: 700 },
      ]),
    ]);
    const movies = await collectRanking([only.source], 2, byVotes, isNotAnime);
    assert.deepEqual(
      movies.map((movie) => movie.id),
      [2, 3],
    );
  });

  it('ends when every partition runs dry', async () => {
    const empty = feed([batch([], 7)]);
    const movies = await collectRanking([empty.source], 10, byVotes);
    assert.deepEqual(movies, []);
    assert.deepEqual(empty.asked, [1]);
  });
});

describe('the anime the run leaves out', () => {
  it('is animation the original language marks as Japanese', () => {
    assert.equal(isJapaneseAnimation({ genre_ids: [16], original_language: 'ja' }), true);
    assert.equal(isJapaneseAnimation({ genres: [{ id: 16 }], original_language: 'ja' }), true);
  });

  it('keeps Japanese live action and animation from anywhere else', () => {
    // A Japanese drama is animation-free; Pixar is Japanese-free. Neither is anime.
    assert.equal(isJapaneseAnimation({ genre_ids: [18], original_language: 'ja' }), false);
    assert.equal(isJapaneseAnimation({ genre_ids: [16], original_language: 'en' }), false);
    assert.equal(isJapaneseAnimation({ genre_ids: [16], original_language: 'fr' }), false);
  });
});

describe('the detail pool', () => {
  it('keeps the results in the order of the input', async () => {
    const results = await mapLimit([5, 1, 3, 2, 4], 2, async (n) => {
      await new Promise((wait) => setTimeout(wait, n % 3));
      return n * 10;
    });
    assert.deepEqual(results, [50, 10, 30, 20, 40]);
  });

  it('holds the requested number of requests in flight, not more', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, index) => index),
      3,
      async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((wait) => setTimeout(wait, 1));
        inFlight--;
      },
    );
    assert.equal(peak, 3);
  });
});

describe('the checkpoint a run resumes from', () => {
  it('reads the rows back by TMDB id and drops a torn last line', () => {
    const row = toSeedRow({ id: 278, title: 'The Shawshank Redemption' });
    const text = `${JSON.stringify(row)}\n{"id":"6e5d9a00-1468-5ca9-bbda-74c7`;
    const rows = parseCheckpoint(text);
    assert.equal(rows.size, 1);
    assert.deepEqual(rows.get(278), row);
  });

  it('keeps the row written last for a film the run fetched twice', () => {
    const first = toSeedRow({ id: 1, title: 'Draft' });
    const second = toSeedRow({ id: 1, title: 'Final' });
    const rows = parseCheckpoint(`${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
    assert.equal(rows.get(1)?.title, 'Final');
  });
});

describe('the credentials a request carries', () => {
  it('sends the read-access token as a bearer header and keeps it out of the url', () => {
    const request = authorize('https://api.themoviedb.org/3/discover/movie', {
      accessToken: 'token',
      apiKey: 'key',
    });
    assert.equal(request.url, 'https://api.themoviedb.org/3/discover/movie');
    assert.deepEqual(request.headers, { Authorization: 'Bearer token' });
  });

  it('falls back to the api key as a query parameter', () => {
    const request = authorize('https://api.themoviedb.org/3/movie/278?language=en-US', {
      apiKey: 'key',
    });
    const url = new URL(request.url);
    assert.equal(url.searchParams.get('api_key'), 'key');
    assert.equal(url.searchParams.get('language'), 'en-US');
    assert.deepEqual(request.headers, {});
  });
});

describe('the artwork urls', () => {
  it('builds them from the bare path TMDB returns', () => {
    assert.equal(
      imageUrl('/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg', 'w500'),
      'https://image.tmdb.org/t/p/w500/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
    );
  });

  it('keeps a movie without artwork null rather than minting a url to nothing', () => {
    assert.equal(imageUrl(null, 'w500'), null);
    assert.equal(imageUrl(undefined, 'w1280'), null);
    assert.equal(imageUrl('', 'w1280'), null);
  });
});

describe('the status the seed writes', () => {
  it('folds TMDB movie statuses onto the catalog enums', () => {
    assert.equal(statusFor('Released'), 'ended');
    assert.equal(statusFor('Post Production'), 'announced');
    assert.equal(statusFor('Rumored'), 'announced');
    assert.equal(statusFor('Canceled'), 'cancelled');
    assert.equal(statusFor(undefined), null);
  });
});

describe('the genre tags the seed writes', () => {
  it('turns TMDB names into the lowercase phrases the other importers write', () => {
    assert.equal(genreTag('Science Fiction'), 'science fiction');
    assert.equal(genreTag('TV Movie'), 'tv movie');
    assert.equal(genreTag('Action & Adventure'), 'action and adventure');
  });
});

describe('the titles the seed keeps as synonyms', () => {
  const dubbed: TmdbMovie = {
    id: 278,
    title: 'The Shawshank Redemption',
    original_title: 'The Shawshank Redemption',
    original_language: 'en',
    translations: {
      translations: [
        { iso_639_1: 'en', iso_3166_1: 'US', data: { title: '' } },
        { iso_639_1: 'fr', iso_3166_1: 'FR', data: { title: 'Les Évadés' } },
        { iso_639_1: 'fr', iso_3166_1: 'CA', data: { title: "À l'ombre de Shawshank" } },
        { iso_639_1: 'es', iso_3166_1: 'ES', data: { title: 'Cadena perpetua' } },
        { iso_639_1: 'es', iso_3166_1: 'MX', data: { title: 'Sueño de fuga' } },
        { iso_639_1: 'de', iso_3166_1: 'DE', data: { title: 'Die Verurteilten' } },
      ],
    },
  };

  it('keeps the native, French and Spanish titles, one per language', () => {
    assert.deepEqual(synonymsFor(dubbed), ['Les Évadés', 'Cadena perpetua']);
    // The native title is the one TMDB states on the movie, in the original language.
    assert.deepEqual(synonymsFor({ ...dubbed, title: 'Les Évadés' }), [
      'The Shawshank Redemption',
      'Cadena perpetua',
    ]);
  });

  it('prefers the region that matches the language over the first variant listed', () => {
    // TMDB lists fr-CA before fr-FR on some records; the French edition is the one to keep.
    const reordered = {
      ...dubbed,
      translations: {
        translations: [
          { iso_639_1: 'fr', iso_3166_1: 'CA', data: { title: "À l'ombre de Shawshank" } },
          { iso_639_1: 'fr', iso_3166_1: 'FR', data: { title: 'Les Évadés' } },
        ],
      },
    };
    assert.deepEqual(synonymsFor(reordered), ['Les Évadés']);
  });

  it('keeps the native title of a film whose page title is translated', () => {
    assert.deepEqual(
      synonymsFor({ id: 129, title: 'Spirited Away', original_title: '千と千尋の神隠し' }),
      ['千と千尋の神隠し'],
    );
  });

  it('drops a synonym that repeats the page title, and a translation TMDB left blank', () => {
    assert.deepEqual(
      synonymsFor({
        id: 1,
        title: 'Les Évadés',
        original_title: 'Les Évadés',
        translations: { translations: [{ iso_639_1: 'fr', data: { title: 'Les Évadés' } }] },
      }),
      [],
    );
  });
});

describe('the credits the seed keeps', () => {
  const crew: TmdbCrew[] = [
    { name: 'Frank Darabont', job: 'Director' },
    { name: 'Frank Darabont', job: 'Screenplay' },
    { name: 'Stephen King', job: 'Novel' },
    { name: 'Thomas Newman', job: 'Original Music Composer' },
    { name: 'Niki Marvin', job: 'Producer' },
  ];

  it('takes the directors and the screenwriters, deduped, and leaves a novelist out', () => {
    const row = toSeedRow({ id: 278, title: 'The Shawshank Redemption', credits: { crew } });
    assert.deepEqual(row.metadata.directors, ['Frank Darabont']);
    assert.deepEqual(row.metadata.writers, ['Frank Darabont']);
  });

  it('keeps a story or writer credit beside the screenplay', () => {
    const row = toSeedRow({
      id: 1,
      title: 'X',
      credits: {
        crew: [
          { name: 'Hayao Miyazaki', job: 'Screenplay' },
          { name: 'Cindy Davis Hewitt', job: 'Writer' },
          { name: 'Donald H. Hewitt', job: 'Writer' },
          { name: 'Someone', job: 'Story' },
        ],
      },
    });
    assert.deepEqual(row.metadata.writers, [
      'Hayao Miyazaki',
      'Cindy Davis Hewitt',
      'Donald H. Hewitt',
      'Someone',
    ]);
  });

  it('writes empty lists when TMDB has no credits rather than omitting the keys', () => {
    const row = toSeedRow({ id: 1, title: 'Untitled' });
    assert.deepEqual(row.metadata.directors, []);
    assert.deepEqual(row.metadata.writers, []);
  });
});

describe('the seed row', () => {
  const detail: TmdbMovie = {
    id: 278,
    title: 'The Shawshank Redemption',
    original_title: 'The Shawshank Redemption',
    overview: 'Imprisoned in the 1940s for the double murder of his wife and her lover…',
    release_date: '1994-09-23',
    poster_path: '/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
    backdrop_path: '/pNjh59JSxChQktamG3LMp9ZoQzp.jpg',
    vote_average: 8.734,
    vote_count: 31_691,
    original_language: 'en',
    status: 'Released',
    runtime: 142,
    tagline: 'Fear can hold you prisoner. Hope can set you free.',
    imdb_id: 'tt0111161',
    origin_country: ['US'],
    spoken_languages: [{ english_name: 'English' }, { english_name: undefined }],
    genres: [
      { id: 18, name: 'Drama' },
      { id: 80, name: 'Crime' },
    ],
    credits: {
      crew: [
        { name: 'Frank Darabont', job: 'Director' },
        { name: 'Frank Darabont', job: 'Screenplay' },
        { name: 'Stephen King', job: 'Novel' },
      ],
    },
    translations: {
      translations: [
        { iso_639_1: 'fr', iso_3166_1: 'FR', data: { title: 'Les Évadés' } },
        { iso_639_1: 'es', iso_3166_1: 'ES', data: { title: 'Cadena perpetua' } },
      ],
    },
  };

  it('maps a TMDB movie onto a catalog row', () => {
    assert.deepEqual(toSeedRow(detail), {
      id: '6e5d9a00-1468-5ca9-bbda-74c79d7a66b6',
      kind: 'movie',
      title: 'The Shawshank Redemption',
      synonyms: ['Les Évadés', 'Cadena perpetua'],
      year: 1994,
      status: 'ended',
      genres: ['drama', 'crime'],
      partCount: null,
      seasonNumber: null,
      externalIds: { tmdb: 278, imdb: 'tt0111161' },
      metadata: {
        format: 'movie',
        providerScore: 87.3,
        ratingCount: 31_691,
        releaseDate: '1994-09-23',
        runtime: 142,
        originalLanguage: 'en',
        directors: ['Frank Darabont'],
        writers: ['Frank Darabont'],
        originCountry: ['US'],
        spokenLanguages: ['English'],
        tagline: 'Fear can hold you prisoner. Hope can set you free.',
      },
      description: 'Imprisoned in the 1940s for the double murder of his wife and her lover…',
      coverUrl: 'https://image.tmdb.org/t/p/w500/9cqNxx0GxF0bflZmeSMuL5tnGzr.jpg',
      bannerUrl: 'https://image.tmdb.org/t/p/w1280/pNjh59JSxChQktamG3LMp9ZoQzp.jpg',
    });
  });

  it('keeps the full release date in metadata, since the slim contract has no column for it', () => {
    const dated = toSeedRow(detail);
    assert.equal(dated.year, 1994);
    assert.equal(dated.metadata.releaseDate, '1994-09-23');
  });

  it('survives a movie TMDB has almost nothing on', () => {
    const sparse = toSeedRow({ id: 1, title: 'Untitled' });
    assert.equal(sparse.year, null);
    assert.equal(sparse.status, null);
    assert.deepEqual(sparse.genres, []);
    assert.deepEqual(sparse.externalIds, { tmdb: 1 });
    assert.equal(sparse.description, null);
    assert.equal(sparse.coverUrl, null);
    assert.equal(sparse.bannerUrl, null);
    assert.equal(sparse.metadata.providerScore, null);
    assert.equal('releaseDate' in sparse.metadata, false);
    assert.deepEqual(sparse.synonyms, []);
    assert.deepEqual(sparse.metadata, {
      format: 'movie',
      providerScore: null,
      ratingCount: 0,
      directors: [],
      writers: [],
      originCountry: [],
      spokenLanguages: [],
    });
  });
});
