import { ImportError } from '../errors.js';
import { entryKey } from '../resolve.js';
import {
  warning,
  type FetchedEntries,
  type FetchEntriesOptions,
  type ImportEntry,
  type ImportWarning,
} from '../types.js';
import { createTraktClient } from './client.js';
import { mapTraktMovie, mapTraktSeason, mapTraktWatchlistMovie, readTraktScore } from './map.js';
import type { TraktRating, TraktShowProgress } from './schemas.js';

const PROGRESS_CONCURRENCY = 2;

/** The work a season belongs to: `trakt:series:<showId>`, without the season. */
function workKey(entry: ImportEntry): string {
  return `${entry.source}:${entry.kind}:${entry.externalId}`;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * A show rating is one number for the whole show, but the catalog files one row
 * per season — so it lands on every season of that show. A rating for a work the
 * watched lists did not carry is dropped: Trakt only lets you rate what you have
 * seen, so an orphan means the watch itself did not survive.
 */
export function mergeTraktRatings(entries: ImportEntry[], ratings: TraktRating[]): ImportWarning[] {
  const warnings: ImportWarning[] = [];
  const byWork = new Map<string, ImportEntry[]>();
  for (const entry of entries) {
    const key = workKey(entry);
    const bucket = byWork.get(key) ?? [];
    bucket.push(entry);
    byWork.set(key, bucket);
  }

  for (const rating of ratings) {
    const kind = rating.movie ? 'movie' : rating.show ? 'series' : null;
    const work = rating.movie ?? rating.show;
    const traktId = work?.ids?.trakt;
    const title = work?.title?.trim() ? work.title.trim() : null;
    const row = { externalId: typeof traktId === 'number' ? String(traktId) : null, title };

    if (!kind || !title || typeof traktId !== 'number') {
      warnings.push(warning('malformed-row', row, 'a rating row names no work — rating skipped'));
      continue;
    }

    const bucket = byWork.get(`trakt:${kind}:${traktId}`) ?? [];
    if (bucket.length === 0) {
      warnings.push(
        warning(
          'partial-source',
          row,
          `rated "${title}" but it is not in the watched lists — Trakt only rates what it has seen, ` +
            'so the watch did not survive; the rating was dropped',
        ),
      );
      continue;
    }

    const score = readTraktScore(rating.rating, row, warnings);
    if (score === null) continue;
    for (const entry of bucket) entry.score = score;
  }

  return warnings;
}

/**
 * Trakt → entries. The watched lists come first because everything else is
 * decoration on them: ratings are merged onto those rows, and a watchlist movie
 * that is also watched keeps its watched row (a film you planned, then saw, is
 * one log entry, not two).
 */
export async function fetchTraktEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const client = createTraktClient({
    clientId: options.credentials.traktClientId ?? '',
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.requestSpacingMs !== undefined
      ? { requestSpacingMs: options.requestSpacingMs }
      : {}),
  });

  const mapOptions = options.now ? { now: options.now } : {};
  const spacing = options.requestSpacingMs ?? 0;
  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const warnings: ImportWarning[] = [];

  function push(mapped: { entry: ImportEntry | null; warnings: ImportWarning[] }): void {
    if (!mapped.entry) {
      warnings.push(...mapped.warnings);
      return;
    }
    entryWarnings.set(entryKey(mapped.entry), mapped.warnings);
    entries.push(mapped.entry);
  }

  /** A list that could not be read costs its rows, not the import. */
  async function optionalList<T>(what: string, run: () => Promise<T[]>): Promise<T[]> {
    try {
      return await run();
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      if (error.kind === 'auth' || error.kind === 'credential' || error.kind === 'not-found') {
        throw error;
      }
      warnings.push(
        warning(
          'partial-source',
          { externalId: null, title: null },
          `the ${what} could not be read (${error.message}) — the import continues without it`,
        ),
      );
      return [];
    }
  }

  for (const raw of await client.fetchWatchedMovies(options.profile)) {
    push(mapTraktMovie(raw, mapOptions));
  }

  const shows = await client.fetchWatchedShows(options.profile);
  const progresses = await mapWithConcurrency(
    shows,
    PROGRESS_CONCURRENCY,
    async (show): Promise<TraktShowProgress | null> => {
      const traktId = show.show?.ids?.trakt;
      if (typeof traktId !== 'number') return null;
      if (spacing > 0) await sleep(spacing);
      try {
        return await client.fetchShowProgress(options.profile, traktId);
      } catch (error) {
        if (!(error instanceof ImportError)) throw error;
        if (error.kind === 'auth' || error.kind === 'credential') throw error;
        warnings.push(
          warning(
            'partial-source',
            { externalId: String(traktId), title: show.show?.title ?? null },
            `the per-season progress of this show could not be read (${error.message}) — ` +
              'its seasons are imported uncompleted',
          ),
        );
        return null;
      }
    },
  );

  shows.forEach((show, index) => {
    if (!show.show) {
      warnings.push(
        warning(
          'malformed-row',
          { externalId: null, title: null },
          'a watched show row names no show — skipped',
        ),
      );
      return;
    }
    const progress = progresses[index] ?? null;
    for (const season of show.seasons ?? []) {
      const progressSeason =
        progress?.seasons?.find((candidate) => candidate.number === season.number) ?? null;
      push(mapTraktSeason(show, season, progressSeason, mapOptions));
    }
  });

  const ratings = [
    ...(await optionalList('movie ratings', () => client.fetchRatedMovies(options.profile))),
    ...(await optionalList('show ratings', () => client.fetchRatedShows(options.profile))),
  ];
  warnings.push(...mergeTraktRatings(entries, ratings));

  const seenWorks = new Set(entries.map(workKey));
  const watchlistMovies = await optionalList('movie watchlist', () =>
    client.fetchWatchlistMovies(options.profile),
  );
  for (const item of watchlistMovies) {
    const mapped = mapTraktWatchlistMovie(item);
    if (!mapped.entry) {
      warnings.push(...mapped.warnings);
      continue;
    }
    // Its watched row is the whole truth; a planned row beside it would be the
    // same film twice.
    if (seenWorks.has(workKey(mapped.entry))) continue;
    push(mapped);
  }

  const watchlistShows = await optionalList('show watchlist', () =>
    client.fetchWatchlistShows(options.profile),
  );
  for (const item of watchlistShows) {
    warnings.push(
      warning(
        'partial-source',
        {
          externalId: item.show?.ids?.trakt ? String(item.show.ids.trakt) : null,
          title: item.show?.title ?? null,
        },
        'a planned show names no season, and the catalog files one row per season — skipped ' +
          'rather than guessed as season 1',
      ),
    );
  }

  return { entries, entryWarnings, warnings };
}
