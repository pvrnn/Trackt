/** Build a TMDB-ranked movie seed in the same row shape as the catalog seeds. */

import { createHash } from 'node:crypto';
import { appendFile, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const NAMESPACE = 'f8d11238-d681-551c-875d-5ac53892f6e7';
const API = 'https://api.themoviedb.org/3';
const IMAGE_BASE = 'https://image.tmdb.org/t/p';
const DEFAULT_USER_AGENT = 'trackt-catalog-scraper/0.1 (+https://github.com/pvrnn/Trackt)';

/** TMDB rejects `page` above 500 on one discover query, so 20 rows a page is the ceiling. */
const MAX_PAGES = 500;
const PAGE_SIZE = 20;
/** One unpaged query can rank 10 000 rows; past that the ranking has to be split. */
const SINGLE_QUERY_LIMIT = MAX_PAGES * PAGE_SIZE;
/** No film predates this, so a year partition starts here rather than being discovered. */
const YEAR_FLOOR = 1870;
const MAX_LIMIT = 50_000;

/** `rating` is TMDB's `vote_average` order behind a vote floor; `popularity` is `vote_count`. */
export type Sort = 'rating' | 'popularity';

export type Args = {
  limit: number;
  minVoteCount: number;
  language: string;
  out: string;
  sort: Sort;
  concurrency: number;
  resume: boolean;
  /** Leave Japanese animation out: anime rows come from AniList (see `isJapaneseAnimation`). */
  excludeAnime: boolean;
};

export type TmdbCrew = { name?: string; job?: string };

/** One language's edition of a `translations` block. */
export type TmdbTranslation = {
  iso_639_1?: string;
  iso_3166_1?: string;
  data?: { title?: string };
};

/** The fields this seed reads from `/discover/movie` and `/movie/{id}`. */
export type TmdbMovie = {
  id: number;
  title: string;
  original_title?: string;
  overview?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  original_language?: string;
  /** `Released`, `Post Production`, `Canceled`… Only the detail endpoint returns it. */
  status?: string;
  /** Discover results carry genre *ids*, not names; the detail endpoint carries both. */
  genre_ids?: number[];
  runtime?: number | null;
  tagline?: string;
  imdb_id?: string | null;
  genres?: { id: number; name: string }[];
  origin_country?: string[];
  spoken_languages?: { english_name?: string }[];
  /** Appended: `/movie/{id}?append_to_response=credits,translations`. */
  credits?: { crew?: TmdbCrew[] };
  translations?: { translations?: TmdbTranslation[] };
};

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    // TMDB's own top-rated order is a vote average over as few as ten votes, so
    // a floor is what makes a ten-row run "the top movies" rather than "ten
    // films four people liked". At 5000 a film still in its first weeks of
    // voting outranks the canon; 10 000 is the floor that holds the classics.
    limit: 10,
    minVoteCount: 10_000,
    language: 'en-US',
    out: 'apps/catalog/seed/top-movies-tmdb.json',
    sort: 'rating',
    // 3 in flight against a ~75 ms response is ~40 requests a second, just under
    // the pace TMDB documents; more workers start collecting 429s.
    concurrency: 3,
    resume: false,
    excludeAnime: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === '--limit' && value) {
      args.limit = Number(value);
      i++;
    } else if (argv[i] === '--min-vote-count' && value) {
      args.minVoteCount = Number(value);
      i++;
    } else if (argv[i] === '--language' && value) {
      args.language = value;
      i++;
    } else if (argv[i] === '--out' && value) {
      args.out = value;
      i++;
    } else if (argv[i] === '--sort' && value) {
      if (value !== 'rating' && value !== 'popularity')
        throw new Error('--sort must be rating or popularity');
      args.sort = value;
      i++;
    } else if (argv[i] === '--concurrency' && value) {
      args.concurrency = Number(value);
      i++;
    } else if (argv[i] === '--resume') {
      args.resume = true;
    } else if (argv[i] === '--exclude-anime') {
      args.excludeAnime = true;
    } else if (argv[i] === '--help') {
      console.log(
        'Usage: pnpm scrape:tmdb [--limit 10] [--min-vote-count 10000] [--sort rating|popularity] [--exclude-anime] [--concurrency 3] [--resume] [--language en-US] [--out path]',
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  if (!Number.isInteger(args.minVoteCount) || args.minVoteCount < 0) {
    throw new Error('--min-vote-count must be a non-negative integer');
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 8) {
    throw new Error('--concurrency must be an integer from 1 to 8');
  }
  if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(args.language)) {
    throw new Error('--language must be an ISO 639-1 code, optionally with a region (en-US)');
  }
  return args;
}

export interface Credentials {
  accessToken?: string;
  apiKey?: string;
}

/**
 * v3 accepts either credential: the read-access token as a bearer header, or the
 * API key as a query parameter. The token is preferred because it stays out of
 * URLs and logs. The repo's own config file lives outside the checkout for the
 * same reason — a token in a GPL repository is a leaked token.
 */
export async function credentials(): Promise<Credentials> {
  const values: Record<string, string> = {};
  const envFile = resolve(homedir(), '.config/opencode/tmdb.env');
  try {
    for (const line of (await readFile(envFile, 'utf8')).split(/\r?\n/)) {
      const match = line.match(
        /^\s*(TMDB_READ_ACCESS_TOKEN|TMDB_API_KEY)\s*=\s*['"]?([^'"#]*)['"]?\s*$/,
      );
      if (match) values[match[1]!] = match[2]!.trim();
    }
  } catch {
    // Environment variables are also supported for CI and other machines.
  }
  const accessToken =
    process.env.TMDB_READ_ACCESS_TOKEN ?? process.env.TMDB_TOKEN ?? values.TMDB_READ_ACCESS_TOKEN;
  const apiKey = process.env.TMDB_API_KEY ?? process.env.TMDB_KEY ?? values.TMDB_API_KEY;
  if (!accessToken && !apiKey) {
    throw new Error(
      `Set TMDB_READ_ACCESS_TOKEN or TMDB_API_KEY, or configure ${envFile} with either name`,
    );
  }
  return { accessToken, apiKey };
}

/** Point a request at the API: the bearer token if there is one, else `?api_key=`. */
export function authorize(url: string, creds: Credentials): { url: string; headers: HeadersInit } {
  if (creds.accessToken) {
    return { url, headers: { Authorization: `Bearer ${creds.accessToken}` } };
  }
  if (!creds.apiKey) throw new Error('TMDB credentials missing');
  const withKey = new URL(url);
  withKey.searchParams.set('api_key', creds.apiKey);
  return { url: withKey.href, headers: {} };
}

export interface FetchOptions {
  credentials: Credentials;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  retries?: number;
}

/** One API call, politely: a delay between calls and a retry on 429/5xx. */
export async function tmdbGet<T>(
  path: string,
  query: Record<string, string | number>,
  options: FetchOptions,
): Promise<T> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const retries = options.retries ?? 2;
  const delayMs = options.delayMs ?? 100;
  const target = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(query)) target.searchParams.set(key, String(value));
  const { url, headers } = authorize(target.href, options.credentials);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0 && delayMs > 0)
      await new Promise((wait) => setTimeout(wait, delayMs * 2 ** attempt));
    if (delayMs > 0) await new Promise((wait) => setTimeout(wait, delayMs));
    const response = await fetchImpl(url, {
      headers: { ...headers, Accept: 'application/json', 'User-Agent': DEFAULT_USER_AGENT },
    });
    if (response.ok) return (await response.json()) as T;
    lastError = new Error(`TMDB ${response.status} for ${path}`);
    // 429 carries the pace TMDB will accept; anything below 500 is our request.
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        await new Promise((wait) => setTimeout(wait, retryAfter * 1000));
      }
      continue;
    }
    if (response.status < 500) break;
  }
  throw lastError ?? new Error(`failed to fetch ${path}`);
}

/** One page of any discover ranking; the row shape depends on the endpoint. */
export type DiscoverPage<T = TmdbMovie> = { page: number; total_pages: number; results: T[] };

/** The ranking query: TMDB's own ordering with the vote floor that makes it mean something. */
export function discoverQuery(
  args: Pick<Args, 'minVoteCount' | 'language' | 'sort'>,
  year?: number,
): Record<string, string | number> {
  return {
    sort_by: args.sort === 'popularity' ? 'vote_count.desc' : 'vote_average.desc',
    'vote_count.gte': args.minVoteCount,
    include_adult: 'false',
    language: args.language,
    ...(year === undefined ? {} : { primary_release_year: year }),
  };
}

export type Rankable = { vote_count?: number; vote_average?: number };

/** The value a work is ranked by, read off the row TMDB already sorted the page by. */
export function rankKey(sort: Sort, work: Rankable): number {
  return sort === 'popularity' ? (work.vote_count ?? 0) : (work.vote_average ?? 0);
}

/** TMDB's Animation genre id, the only signal discover results carry as a number. */
export const ANIMATION_GENRE = 16;

/**
 * Japanese animation is anime, and anime is AniList's job: it mints the
 * per-season row an instance can derive (ADR-0003), so a TMDB row for the same
 * work would duplicate it under a provider id the catalog does not use for the
 * kind. Discover *ignores* `without_original_language`, so the test runs on the
 * rows instead of the query.
 */
export function isJapaneseAnimation(work: {
  genre_ids?: number[];
  genres?: { id: number }[];
  original_language?: string;
}): boolean {
  const animated =
    (work.genre_ids ?? []).includes(ANIMATION_GENRE) ||
    (work.genres ?? []).some((genre) => genre.id === ANIMATION_GENRE);
  return animated && work.original_language === 'ja';
}

/** Every year a film could have opened in, so each partition is far under TMDB's 10 000-row cap. */
export function yearsToScan(lastYear: number): number[] {
  const years: number[] = [];
  for (let year = YEAR_FLOOR; year <= lastYear; year++) years.push(year);
  return years;
}

/**
 * Walk `page`s until `limit` unique movies are collected or the source runs out.
 * Discover repeats a movie across pages when its ordering is unstable, so ids
 * are deduped rather than trusted to be disjoint; TMDB also refuses pages past
 * 500 on any one query.
 */
export async function walkRanking(
  fetchPage: (page: number) => Promise<DiscoverPage>,
  limit: number,
  keep: (movie: TmdbMovie) => boolean = () => true,
): Promise<TmdbMovie[]> {
  const movies: TmdbMovie[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= MAX_PAGES && movies.length < limit; page++) {
    const response = await fetchPage(page);
    for (const movie of response.results ?? []) {
      if (seen.has(movie.id) || !keep(movie)) continue;
      seen.add(movie.id);
      movies.push(movie);
    }
    console.log(
      `Scanned page ${page}; collected ${Math.min(movies.length, limit)}/${limit} unique movies`,
    );
    if (!response.results?.length || page >= (response.total_pages ?? MAX_PAGES)) break;
  }
  return movies.slice(0, limit);
}

export type RankingSource<T = TmdbMovie> = {
  label: string;
  fetchPage: (page: number) => Promise<DiscoverPage<T>>;
};

type Cursor<T> = {
  source: RankingSource<T>;
  page: number;
  totalPages: number;
  rows: T[];
  next: number;
  done: boolean;
};

/**
 * A ranking larger than one discover query allows, assembled from partitions.
 *
 * Each source is already sorted by the ranking key, so a k-way merge of their
 * pages reproduces the one global order a single query would have given — pages
 * are pulled only when a source's buffer empties, which is what keeps a 30 000-row
 * run at ~1 500 page requests instead of walking every partition to the end.
 * A movie is in exactly one release year, so ids can only repeat within a source
 * (unstable ordering between pages); `head` drops those rather than counting them.
 */
export async function collectRanking<T extends { id: number }>(
  sources: RankingSource<T>[],
  limit: number,
  rank: (row: T) => number,
  keep: (row: T) => boolean = () => true,
): Promise<T[]> {
  const seen = new Set<number>();
  const cursors: Cursor<T>[] = sources.map((source) => ({
    source,
    page: 0,
    totalPages: Number.POSITIVE_INFINITY,
    rows: [],
    next: 0,
    done: false,
  }));

  const fill = async (cursor: Cursor<T>): Promise<void> => {
    if (cursor.done) return;
    if (cursor.page >= Math.min(cursor.totalPages, MAX_PAGES)) {
      cursor.done = true;
      return;
    }
    cursor.page++;
    const response = await cursor.source.fetchPage(cursor.page);
    cursor.rows = response.results ?? [];
    cursor.next = 0;
    cursor.totalPages = response.total_pages ?? Number.POSITIVE_INFINITY;
    if (!cursor.rows.length) cursor.done = true;
  };

  /** The row this source has not yielded yet, past the ones already collected. */
  const head = async (cursor: Cursor<T>): Promise<T | null> => {
    while (true) {
      while (cursor.next < cursor.rows.length && seen.has(cursor.rows[cursor.next]!.id)) {
        cursor.next++;
      }
      if (cursor.next < cursor.rows.length) return cursor.rows[cursor.next]!;
      if (cursor.done) return null;
      await fill(cursor);
    }
  };

  const heads = (await Promise.all(cursors.map(head))) as (T | null)[];
  const picked: T[] = [];
  while (picked.length < limit) {
    let best = -1;
    for (let index = 0; index < heads.length; index++) {
      const movie = heads[index];
      if (!movie) continue;
      if (best < 0 || rank(movie) > rank(heads[best]!)) best = index;
    }
    if (best < 0) break;
    const movie = heads[best]!;
    cursors[best]!.next++;
    if (keep(movie)) {
      picked.push(movie);
      seen.add(movie.id);
    }
    heads[best] = await head(cursors[best]!);
  }
  return picked;
}

/** Run `fn` over `items` with at most `concurrency` in flight, keeping the results in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * The canonical id every instance derives for a work, for a seed row that has
 * no `@trackt/shared` to import: same namespace, same `provider:kind:id` key.
 */
export function uuidV5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1')
    .update(Buffer.concat([ns, Buffer.from(name)]))
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * TMDB's movie statuses folded onto the catalog's: a released film has finished
 * its run, an unreleased one is announced, and a cancelled film stays cancelled.
 */
export function statusFor(status: string | undefined): 'ended' | 'announced' | 'cancelled' | null {
  switch (status) {
    case undefined:
    case '':
      return null;
    case 'Released':
      return 'ended';
    case 'Canceled':
    case 'Cancelled':
      return 'cancelled';
    default:
      // Planned, Rumored, In Production, Post Production.
      return 'announced';
  }
}

/** A genre tag a page can print beside the others, in the importers' lowercase words. */
export function genreTag(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** TMDB answers with a bare path (`/9cqNxx….jpg`) that is only meaningful under a size. */
export function imageUrl(path: string | null | undefined, size: string): string | null {
  return path ? `${IMAGE_BASE}/${size}${path}` : null;
}

/**
 * A work's titles as readers search for them: the native one, plus French and
 * Spanish. TMDB states the original title on the movie itself but leaves the
 * original language's `translation.data.title` empty, while the French and
 * Spanish ones carry region variants (`Les Évadés` for FR, `À l'ombre de
 * Shawshank` for CA) — so the region matching the language wins over the first
 * entry, and the catalogue gets one title per language rather than a list of
 * every country's marketing.
 */
export function synonymsFor(movie: TmdbMovie): string[] {
  const title = movie.title.trim();
  const translations = movie.translations?.translations ?? [];
  const pick = (language: string): string | undefined => {
    const candidates = translations.filter(
      (entry) => entry.iso_639_1 === language && entry.data?.title?.trim(),
    );
    const preferred =
      candidates.find((entry) => entry.iso_3166_1 === language.toUpperCase()) ?? candidates[0];
    return preferred?.data?.title?.trim();
  };
  const candidates = [movie.original_title?.trim(), pick('fr'), pick('es')];
  return [...new Set(candidates.filter((value): value is string => !!value && value !== title))];
}

/** Screenwriting credits, in the order TMDB ranks them; a novelist credit is a source, not one. */
const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story']);

function crewNames(movie: TmdbMovie, jobs: Set<string>): string[] {
  return [
    ...new Set(
      (movie.credits?.crew ?? []).flatMap((member) =>
        member.name?.trim() && member.job && jobs.has(member.job) ? [member.name.trim()] : [],
      ),
    ),
  ];
}

export function toSeedRow(movie: TmdbMovie) {
  const releaseYear = /^(\d{4})/.exec(movie.release_date ?? '');
  return {
    id: uuidV5(`tmdb:movie:${movie.id}`),
    kind: 'movie' as const,
    title: movie.title.trim(),
    synonyms: synonymsFor(movie),
    year: releaseYear ? Number(releaseYear[1]) : null,
    status: statusFor(movie.status),
    genres: [
      ...new Set((movie.genres ?? []).flatMap((genre) => [genreTag(genre.name)]).filter(Boolean)),
    ],
    partCount: null,
    seasonNumber: null,
    externalIds: {
      tmdb: movie.id,
      ...(movie.imdb_id ? { imdb: movie.imdb_id } : {}),
    },
    metadata: {
      format: 'movie',
      // The same 0–100 scale the other importers use, from TMDB's 0–10 average.
      providerScore:
        movie.vote_average === undefined ? null : Math.round(movie.vote_average * 100) / 10,
      ratingCount: movie.vote_count ?? 0,
      // The slim contract has no release-date column, so the exact date a page
      // would print only survives inside metadata.
      ...(releaseYear && movie.release_date?.trim()
        ? { releaseDate: movie.release_date.trim() }
        : {}),
      ...(movie.runtime ? { runtime: movie.runtime } : {}),
      ...(movie.original_language ? { originalLanguage: movie.original_language } : {}),
      directors: crewNames(movie, new Set(['Director'])),
      writers: crewNames(movie, WRITER_JOBS),
      originCountry: movie.origin_country ?? [],
      spokenLanguages: (movie.spoken_languages ?? []).flatMap((language) =>
        language.english_name ? [language.english_name] : [],
      ),
      ...(movie.tagline ? { tagline: movie.tagline } : {}),
    },
    description: movie.overview?.trim() || null,
    coverUrl: imageUrl(movie.poster_path, 'w500'),
    bannerUrl: imageUrl(movie.backdrop_path, 'w1280'),
  };
}

type SeedRow = ReturnType<typeof toSeedRow>;

/**
 * The rows a previous run already converted, keyed by TMDB id. A 30 000-row run
 * is half an hour of detail calls, so an interrupted run resumes from here
 * instead of starting over; a torn last line from a killed process is dropped.
 */
export function parseCheckpoint(text: string): Map<number, SeedRow> {
  const rows = new Map<number, SeedRow>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as SeedRow;
      if (typeof row.externalIds?.tmdb === 'number') rows.set(row.externalIds.tmdb, row);
    } catch {
      // Torn tail of an interrupted append.
    }
  }
  return rows;
}

export async function scrapeTmdb(args: Args): Promise<number> {
  const creds = await credentials();
  const scan: FetchOptions = { credentials: creds };
  // Detail fetches are paced by --concurrency, so the per-request sleep is off.
  const detail: FetchOptions = { credentials: creds, delayMs: 0 };
  const lastYear = new Date().getUTCFullYear() + 2;
  const keep = args.excludeAnime ? (movie: TmdbMovie) => !isJapaneseAnimation(movie) : undefined;

  // One discover query ranks at most 10 000 rows; a longer run is merged from
  // release-year partitions, each far under TMDB's 20 001-result ceiling.
  const movies =
    args.limit <= SINGLE_QUERY_LIMIT
      ? await walkRanking(
          (page) =>
            tmdbGet<DiscoverPage>('/discover/movie', { ...discoverQuery(args), page }, scan),
          args.limit,
          keep,
        )
      : await collectRanking(
          yearsToScan(lastYear).map((year) => ({
            label: String(year),
            fetchPage: (page: number) =>
              tmdbGet<DiscoverPage>(
                '/discover/movie',
                { ...discoverQuery(args, year), page },
                scan,
              ),
          })),
          args.limit,
          (movie) => rankKey(args.sort, movie),
          keep,
        );

  if (movies.length < args.limit) {
    throw new Error(
      `TMDB returned only ${movies.length} movies above ${args.minVoteCount} votes; refusing to write a partial ${args.limit}-row seed.`,
    );
  }

  const output = resolve(args.out);
  const checkpoint = `${output}.checkpoint.jsonl`;
  await mkdir(dirname(output), { recursive: true });
  const known = args.resume
    ? parseCheckpoint(await readFile(checkpoint, 'utf8').catch(() => ''))
    : new Map<number, SeedRow>();
  if (!args.resume) await writeFile(checkpoint, '', 'utf8');
  await chmod(checkpoint, 0o600);

  const missing = movies.filter((movie) => !known.has(movie.id));
  console.log(
    `${movies.length} ranked movies; fetching ${missing.length} details (${movies.length - missing.length} from the checkpoint)`,
  );

  // The ranking payload carries no genre names, runtime, credits or translations,
  // so each selected movie costs one more request — and that request is ~100 KB,
  // nearly all of it the cast and crew list this seed only mines for two jobs.
  const failed: { id: number; title: string; reason: string }[] = [];
  let finished = 0;
  await mapLimit(missing, args.concurrency, async (movie) => {
    try {
      const response = await tmdbGet<TmdbMovie>(
        `/movie/${movie.id}`,
        { language: args.language, append_to_response: 'credits,translations' },
        detail,
      );
      const row = toSeedRow({ ...movie, ...response });
      known.set(movie.id, row);
      await appendFile(checkpoint, `${JSON.stringify(row)}\n`, 'utf8');
    } catch (error) {
      failed.push({
        id: movie.id,
        title: movie.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    finished++;
    if (finished % 100 === 0 || finished === missing.length) {
      console.log(`Fetched ${finished}/${missing.length} details`);
    }
  });

  const rows = movies.flatMap((movie) => {
    const row = known.get(movie.id);
    return row ? [row] : [];
  });

  const temporary = `${output}.tmp`;
  const data = {
    generatedAt: new Date().toISOString(),
    source: 'TMDB',
    attribution: 'This product uses the TMDB API but is not endorsed or certified by TMDB.',
    ranking: {
      order: args.sort === 'popularity' ? 'vote_count desc' : 'vote_average desc',
      minimumVoteCount: args.minVoteCount,
      limit: args.limit,
      language: args.language,
      partitionedBy: args.limit > SINGLE_QUERY_LIMIT ? 'primary_release_year' : null,
      excludesJapaneseAnimation: args.excludeAnime,
    },
    catalog_media: rows,
    catalog_media_relation: [],
  };
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await chmod(temporary, 0o600);
  await rename(temporary, output);
  console.log(`Wrote ${rows.length} movies to ${output}`);

  if (failed.length) {
    throw new Error(
      `${failed.length} films TMDB did not return (${failed
        .slice(0, 5)
        .map((film) => `${film.id} ${film.title}: ${film.reason}`)
        .join(
          '; ',
        )}); the seed holds the other ${rows.length}. Re-run with --resume to fill the gaps.`,
    );
  }
  return rows.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  scrapeTmdb(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
