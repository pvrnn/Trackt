/**
 * Build a TMDB-ranked series seed: one row per season, the layout the catalog
 * seeder loads (ADR-0003 — a series row is a single season, keyed by
 * `tmdb:series:<showId>:<seasonNumber>`).
 */

import { appendFile, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  collectRanking,
  credentials,
  genreTag,
  imageUrl,
  isJapaneseAnimation,
  mapLimit,
  rankKey,
  tmdbGet,
  uuidV5,
  yearsToScan,
  type DiscoverPage,
  type FetchOptions,
  type Sort,
} from './scrape.ts';

const API_TV = '/discover/tv';
const MAX_LIMIT = 50_000;
/** Shows per detail batch: enough to overlap the requests, small enough to stop near `--limit`. */
const SHOWS_PER_BATCH = 200;
/**
 * A season row per 1–3 shows, so this many shows is always enough to fill
 * `--limit` rows; the walk stops early anyway when it has them.
 */
const SHOW_OVERSCAN = 4;
/** TMDB has ~19.8k shows above ten votes, and discover refuses more than 20 001. */
const MAX_SHOWS = 20_000;

export type SeriesArgs = {
  /** Season rows to write, not shows: a five-season show is five rows. */
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

/** One language's edition of a show's `translations` block. TV carries `name`, not `title`. */
export type ShowTranslation = {
  iso_639_1?: string;
  iso_3166_1?: string;
  data?: { name?: string };
};

type TmdbSeason = {
  season_number?: number;
  episode_count?: number;
  air_date?: string | null;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  vote_average?: number;
};

/** The fields this seed reads from `/discover/tv` and `/tv/{id}`. */
export type TmdbShow = {
  id: number;
  name: string;
  original_name?: string;
  overview?: string;
  first_air_date?: string;
  last_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  original_language?: string;
  /** `Returning Series`, `Ended`, `Canceled`… Only the detail endpoint returns it. */
  status?: string;
  /** TMDB's own format word: `Scripted`, `Documentary`, `Mini-Series`… */
  type?: string;
  genres?: { id: number; name: string }[];
  /** Discover results carry genre *ids*, not names. */
  genre_ids?: number[];
  origin_country?: string[];
  spoken_languages?: { english_name?: string }[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  /** Every season with its episode count and air date — the season rows' whole content. */
  seasons?: TmdbSeason[];
  created_by?: { name?: string }[];
  episode_run_time?: number[];
  networks?: { name?: string }[];
  tagline?: string;
  /** Appended: `/tv/{id}?append_to_response=translations,external_ids`. */
  translations?: { translations?: ShowTranslation[] };
  external_ids?: { imdb_id?: string | null; tvdb_id?: number | null };
};

export type SeasonRow = {
  id: string;
  kind: 'series';
  title: string;
  synonyms: string[];
  year: number | null;
  status: 'announced' | 'airing' | 'publishing' | 'ended' | 'cancelled' | null;
  genres: string[];
  partCount: number | null;
  seasonNumber: number;
  externalIds: Record<string, string | number>;
  metadata: Record<string, unknown>;
  description: string | null;
  coverUrl: string | null;
  bannerUrl: string | null;
};

export function parseSeriesArgs(argv: string[]): SeriesArgs {
  const args: SeriesArgs = {
    limit: 10,
    // TV is a much smaller pool than films: only 22 shows clear 10 000 votes, so
    // this floor holds a default run but a long one needs a lower one.
    minVoteCount: 10_000,
    language: 'en-US',
    out: 'apps/catalog/seed/top-series-tmdb.json',
    sort: 'rating',
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
      if (value !== 'rating' && value !== 'popularity') {
        throw new Error('--sort must be rating or popularity');
      }
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
        'Usage: pnpm scrape:tmdb:series [--limit 10] [--min-vote-count 10000] [--sort rating|popularity] [--exclude-anime] [--concurrency 3] [--resume] [--language en-US] [--out path]',
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

/** The ranking query. A show's partition key is its first air date, not a release date. */
export function seriesQuery(
  args: Pick<SeriesArgs, 'minVoteCount' | 'language' | 'sort'>,
  year?: number,
): Record<string, string | number> {
  return {
    sort_by: args.sort === 'popularity' ? 'vote_count.desc' : 'vote_average.desc',
    'vote_count.gte': args.minVoteCount,
    include_adult: 'false',
    language: args.language,
    ...(year === undefined ? {} : { first_air_date_year: year }),
  };
}

/**
 * TMDB's show statuses folded onto the catalog's: a returning show is still
 * airing, an ended one has finished, and a cancelled one stays cancelled.
 */
export function showStatus(
  status: string | undefined,
): 'ended' | 'airing' | 'cancelled' | 'announced' | null {
  switch (status) {
    case undefined:
    case '':
      return null;
    case 'Returning Series':
      return 'airing';
    case 'Ended':
      return 'ended';
    case 'Canceled':
    case 'Cancelled':
      return 'cancelled';
    default:
      // Planned, Pilot, In Production, Rumored.
      return 'announced';
  }
}

/**
 * A show's titles as readers search for them: the native one, plus French and
 * Spanish, preferring the region that matches the language over the first
 * variant TMDB lists (same rule the movie seed applies).
 */
export function showSynonyms(show: TmdbShow): string[] {
  const title = show.name?.trim() ?? '';
  const translations = show.translations?.translations ?? [];
  const pick = (language: string): string | undefined => {
    const candidates = translations.filter(
      (entry) => entry.iso_639_1 === language && entry.data?.name?.trim(),
    );
    const preferred =
      candidates.find((entry) => entry.iso_3166_1 === language.toUpperCase()) ?? candidates[0];
    return preferred?.data?.name?.trim();
  };
  const candidates = [show.original_name?.trim(), pick('fr'), pick('es')];
  return [...new Set(candidates.filter((value): value is string => !!value && value !== title))];
}

function releasedYear(date: string | undefined | null): number | null {
  const match = /^(\d{4})/.exec(date?.trim() ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * The rows one show contributes: one per season, specials (season 0) and empty
 * seasons excluded — a season with no episode is not a trackable unit.
 */
export function seasonRows(show: TmdbShow): SeasonRow[] {
  const title = show.name?.trim() ?? '';
  const genres = [
    ...new Set((show.genres ?? []).flatMap((genre) => [genreTag(genre.name)]).filter(Boolean)),
  ];
  const synonyms = showSynonyms(show);
  const status = showStatus(show.status);
  const creators = [
    ...new Set(
      (show.created_by ?? []).flatMap((creator) =>
        creator.name?.trim() ? [creator.name.trim()] : [],
      ),
    ),
  ];
  const networks = [
    ...new Set(
      (show.networks ?? []).flatMap((network) =>
        network.name?.trim() ? [network.name.trim()] : [],
      ),
    ),
  ];
  const runtime = show.episode_run_time?.[0];

  return (show.seasons ?? [])
    .filter((season) => (season.season_number ?? 0) >= 1 && (season.episode_count ?? 0) > 0)
    .sort((left, right) => (left.season_number ?? 0) - (right.season_number ?? 0))
    .map((season) => {
      const seasonNumber = season.season_number!;
      const airDate = season.air_date?.trim() || show.first_air_date?.trim() || null;
      return {
        id: uuidV5(`tmdb:series:${show.id}:${seasonNumber}`),
        kind: 'series' as const,
        title,
        synonyms,
        year: releasedYear(airDate),
        status,
        genres,
        partCount: season.episode_count ?? null,
        seasonNumber,
        externalIds: {
          tmdb: show.id,
          ...(show.external_ids?.imdb_id ? { imdb: show.external_ids.imdb_id } : {}),
          ...(show.external_ids?.tvdb_id ? { tvdb: show.external_ids.tvdb_id } : {}),
        },
        metadata: {
          format: 'tv',
          // The same 0–100 scale the other importers use, from TMDB's 0–10 average.
          providerScore:
            show.vote_average === undefined ? null : Math.round(show.vote_average * 100) / 10,
          ratingCount: show.vote_count ?? 0,
          ...(season.name?.trim() ? { seasonName: season.name.trim() } : {}),
          ...(airDate ? { airDate } : {}),
          ...(show.last_air_date?.trim() ? { lastAirDate: show.last_air_date.trim() } : {}),
          ...(show.type?.trim() ? { seriesType: show.type.trim() } : {}),
          ...(runtime ? { episodeRuntime: runtime } : {}),
          ...(show.original_language ? { originalLanguage: show.original_language } : {}),
          creators,
          networks,
          originCountry: show.origin_country ?? [],
          spokenLanguages: (show.spoken_languages ?? []).flatMap((language) =>
            language.english_name ? [language.english_name] : [],
          ),
          totalSeasons: show.number_of_seasons ?? null,
          totalEpisodes: show.number_of_episodes ?? null,
          ...(show.tagline?.trim() ? { tagline: show.tagline.trim() } : {}),
        },
        description: season.overview?.trim() || show.overview?.trim() || null,
        // The season's own poster is the honest cover for a season row; the show's is the fallback.
        coverUrl: imageUrl(season.poster_path || show.poster_path, 'w500'),
        bannerUrl: imageUrl(show.backdrop_path, 'w1280'),
      };
    });
}

/** The seasons a previous run already converted, keyed by show id. */
export function parseSeriesCheckpoint(text: string): Map<number, SeasonRow[]> {
  const shows = new Map<number, SeasonRow[]>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { showId?: number; rows?: SeasonRow[] };
      if (typeof entry.showId === 'number' && Array.isArray(entry.rows)) {
        shows.set(entry.showId, entry.rows);
      }
    } catch {
      // Torn tail of an interrupted append.
    }
  }
  return shows;
}

export async function scrapeSeries(args: SeriesArgs): Promise<number> {
  const creds = await credentials();
  const scan: FetchOptions = { credentials: creds };
  // Detail fetches are paced by --concurrency, so the per-request sleep is off.
  const detail: FetchOptions = { credentials: creds, delayMs: 0 };
  const lastYear = new Date().getUTCFullYear() + 2;
  const keep = args.excludeAnime ? (show: TmdbShow) => !isJapaneseAnimation(show) : undefined;

  // Every show is one or more season rows, so the show walk is sized to overrun
  // the row limit rather than to match it; it stops as soon as the rows exist.
  const shows = await collectRanking<TmdbShow>(
    yearsToScan(lastYear).map((year) => ({
      label: String(year),
      fetchPage: (page: number) =>
        tmdbGet<DiscoverPage<TmdbShow>>(API_TV, { ...seriesQuery(args, year), page }, scan),
    })),
    Math.min(MAX_SHOWS, Math.max(100, args.limit * SHOW_OVERSCAN)),
    (show) => rankKey(args.sort, show),
    keep,
  );

  const output = resolve(args.out);
  const checkpoint = `${output}.checkpoint.jsonl`;
  await mkdir(dirname(output), { recursive: true });
  const known = args.resume
    ? parseSeriesCheckpoint(await readFile(checkpoint, 'utf8').catch(() => ''))
    : new Map<number, SeasonRow[]>();
  if (!args.resume) await writeFile(checkpoint, '', 'utf8');
  await chmod(checkpoint, 0o600);

  const failed: { id: number; name: string; reason: string }[] = [];
  const rows: SeasonRow[] = [];
  let processed = 0;

  for (
    let offset = 0;
    offset < shows.length && rows.length < args.limit;
    offset += SHOWS_PER_BATCH
  ) {
    const batch = shows.slice(offset, offset + SHOWS_PER_BATCH);
    const missing = batch.filter((show) => !known.has(show.id));
    await mapLimit(missing, args.concurrency, async (show) => {
      try {
        const response = await tmdbGet<TmdbShow>(
          `/tv/${show.id}`,
          { language: args.language, append_to_response: 'translations,external_ids' },
          detail,
        );
        const seasons = seasonRows({ ...show, ...response });
        known.set(show.id, seasons);
        await appendFile(
          checkpoint,
          `${JSON.stringify({ showId: show.id, rows: seasons })}\n`,
          'utf8',
        );
      } catch (error) {
        failed.push({
          id: show.id,
          name: show.name,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    });

    for (const show of batch) {
      for (const row of known.get(show.id) ?? []) {
        if (rows.length >= args.limit) break;
        rows.push(row);
      }
    }
    processed += batch.length;
    console.log(`${processed} shows expanded; ${rows.length}/${args.limit} season rows`);
  }

  if (rows.length < args.limit) {
    throw new Error(
      `TMDB's ${shows.length} ranked shows above ${args.minVoteCount} votes only yield ${rows.length} seasons; refusing to write a partial ${args.limit}-row seed.`,
    );
  }

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
      partitionedBy: 'first_air_date_year',
      excludesJapaneseAnimation: args.excludeAnime,
      rowsPerShow: 'season',
    },
    catalog_media: rows,
    catalog_media_relation: [],
  };
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await chmod(temporary, 0o600);
  await rename(temporary, output);
  console.log(`Wrote ${rows.length} season rows to ${output}`);

  if (failed.length) {
    throw new Error(
      `${failed.length} shows TMDB did not return (${failed
        .slice(0, 5)
        .map((show) => `${show.id} ${show.name}: ${show.reason}`)
        .join(
          '; ',
        )}); the seed holds the other ${rows.length} rows. Re-run with --resume to fill the gaps.`,
    );
  }
  return rows.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  scrapeSeries(parseSeriesArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
