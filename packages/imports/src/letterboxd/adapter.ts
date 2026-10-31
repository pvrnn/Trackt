import { ImportError } from '../errors.js';
import { createImportFetcher } from '../http/fetch.js';
import { entryKey } from '../resolve.js';
import {
  warning,
  type FetchedEntries,
  type FetchEntriesOptions,
  type ImportEntry,
  type ImportWarning,
} from '../types.js';
import { createLetterboxdClient } from './client.js';
import { mapLetterboxdEntry, type LetterboxdRawEntry } from './map.js';
import type { DiaryItem, PosterItem } from './parse.js';

const DEFAULT_MAX_ENRICH = 200;

/**
 * Films + watchlist + diary → one row per slug. A film can be on both grids and
 * have several diary viewings; watched beats planned, and the diary supplies the
 * dates, the rewatch count and (failing a grid rating) the rating.
 */
function mergeLists(
  films: PosterItem[],
  watchlist: PosterItem[],
  diary: DiaryItem[],
): LetterboxdRawEntry[] {
  const viewingsBySlug = new Map<string, DiaryItem[]>();
  for (const item of diary) {
    const bucket = viewingsBySlug.get(item.slug) ?? [];
    bucket.push(item);
    viewingsBySlug.set(item.slug, bucket);
  }

  const bySlug = new Map<string, LetterboxdRawEntry>();
  for (const item of watchlist) {
    if (bySlug.has(item.slug)) continue;
    bySlug.set(item.slug, {
      slug: item.slug,
      title: item.title,
      year: item.year,
      list: 'watchlist',
      rating: item.rating,
      liked: item.liked,
    });
  }
  for (const item of films) {
    bySlug.set(item.slug, {
      slug: item.slug,
      title: item.title,
      year: item.year,
      list: 'films',
      rating: item.rating,
      liked: item.liked,
    });
  }

  for (const [slug, viewings] of viewingsBySlug) {
    const existing = bySlug.get(slug);
    const entry: LetterboxdRawEntry = existing ?? {
      slug,
      title: viewings[0]?.title ?? slug,
      year: viewings[0]?.year ?? null,
      list: 'films',
      rating: null,
      liked: false,
    };
    entry.viewings = viewings
      .map((viewing) => ({
        watchedOn: viewing.watchedOn,
        rating: viewing.rating,
        rewatch: viewing.rewatch,
      }))
      .sort((a, b) => a.watchedOn.localeCompare(b.watchedOn));
    bySlug.set(slug, entry);
  }

  return [...bySlug.values()];
}

/** Fetch the three lists, merge them and map them. Reads, never writes. */
export async function fetchLetterboxdEntries(
  options: FetchEntriesOptions,
): Promise<FetchedEntries> {
  const local = options.fetcher
    ? null
    : createImportFetcher({
        ...(options.requestSpacingMs !== undefined
          ? { requestSpacingMs: options.requestSpacingMs }
          : {}),
      });
  const fetcher = options.fetcher ?? local!;
  const warnings: ImportWarning[] = [];

  try {
    const client = createLetterboxdClient({
      fetcher,
      ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
      ...(options.requestSpacingMs !== undefined
        ? { requestSpacingMs: options.requestSpacingMs }
        : {}),
    });

    const films = await client.fetchFilms(options.profile);
    const watchlist = await client.fetchWatchlist(options.profile);

    // The diary is the only dated list, and Cloudflare is the most likely thing
    // to refuse it: the import continues without dates rather than failing.
    let diary: DiaryItem[] = [];
    try {
      diary = await client.fetchDiary(options.profile);
    } catch (error) {
      if (!(error instanceof ImportError)) throw error;
      warnings.push(
        warning(
          'partial-source',
          { externalId: null, title: null },
          `the diary could not be read (${error.message}) — no viewing dates or rewatches from it`,
        ),
      );
    }

    const rows = mergeLists(films, watchlist, diary);

    // Enrichment is one request per film — 30 k films is 30 k requests, which is
    // why it is opt-in and capped: without it the resolver guesses on title+year.
    if (options.enrichFilmPages) {
      const maxEnrich = options.maxEnrich ?? DEFAULT_MAX_ENRICH;
      const targets = rows.slice(0, Math.max(0, maxEnrich));
      let failed = 0;
      for (const row of targets) {
        try {
          const links = await client.fetchFilmLinks(row.slug);
          row.tmdb = links.tmdb;
          row.imdb = links.imdb;
          row.countries = links.countries;
        } catch {
          // A film page that refuses is not a failed import: the resolver's
          // title fallback still has a title and a year.
          failed += 1;
        }
      }
      if (failed > 0) {
        warnings.push(
          warning(
            'partial-source',
            { externalId: null, title: null },
            `${failed} of ${targets.length} film pages could not be read — those rows fall back to title and year`,
          ),
        );
      }
      if (rows.length > targets.length) {
        warnings.push(
          warning(
            'partial-source',
            { externalId: null, title: null },
            `did not read the last ${rows.length - targets.length} film pages (maxEnrich ${maxEnrich}) — those rows fall back to title and year`,
          ),
        );
      }
    }

    const entries: ImportEntry[] = [];
    const entryWarnings = new Map<string, ImportWarning[]>();
    for (const raw of rows) {
      const mapped = mapLetterboxdEntry(raw, options.now ? { now: options.now } : {});
      if (!mapped.entry) {
        warnings.push(...mapped.warnings);
        continue;
      }
      entryWarnings.set(entryKey(mapped.entry), mapped.warnings);
      entries.push(mapped.entry);
    }

    return { entries, entryWarnings, warnings };
  } finally {
    await local?.dispose();
  }
}
