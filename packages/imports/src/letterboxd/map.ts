import type { LogStatus } from '@trackt/shared';
import { applyDateRules } from '../dates.js';
import { warning, type ImportEntry, type ImportWarning } from '../types.js';

/**
 * Letterboxd has no status field: being on the films grid *is* having watched it
 * (a film is a whole work, so there is nothing left to watch), and being on the
 * watchlist is `planned`. The diary is the only place the site states a date.
 */

export type LetterboxdList = 'films' | 'watchlist';

export interface LetterboxdViewing {
  /** `YYYY-MM-DD`. */
  watchedOn: string;
  rating: number | null;
  rewatch: boolean;
}

export interface LetterboxdRawEntry {
  slug: string;
  title: string;
  year: number | null;
  list: LetterboxdList;
  /** `rated-N`: 1–10, which is already Trackt's 0–10 with half a star per point. */
  rating: number | null;
  liked: boolean;
  /** Diary viewings, oldest first. */
  viewings?: LetterboxdViewing[];
  /** Harvested from the film page when enrichment ran. */
  tmdb?: string | null;
  imdb?: string | null;
}

export interface MapOptions {
  /** Injected so the future-date rule is testable. */
  now?: Date;
}

function readScore(
  rating: number | null,
  row: { externalId: string | null; title: string | null },
  warnings: ImportWarning[],
): number | null {
  if (rating === null) return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    warnings.push(
      warning(
        'score-invalid',
        row,
        `rating ${rating} is outside Letterboxd's 1–10 scale — dropped`,
      ),
    );
    return null;
  }
  return rating;
}

/**
 * One merged film row → one import entry, or nothing when it names no work.
 * Dates come from the most recent viewing: a Trackt log holds one start/finish
 * pair, and `repeats` carries the viewings before it.
 */
export function mapLetterboxdEntry(
  raw: LetterboxdRawEntry,
  options: MapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const externalId = raw.slug;
  const title = raw.title.trim();
  const row = { externalId, title: title || null };

  if (!title) {
    warnings.push(
      warning('malformed-row', row, `Letterboxd row "${raw.slug}" names no film — row skipped`),
    );
    return { entry: null, warnings };
  }

  const viewings = [...(raw.viewings ?? [])].sort((a, b) => a.watchedOn.localeCompare(b.watchedOn));
  const latest = viewings.at(-1) ?? null;
  const status: LogStatus = raw.list === 'watchlist' ? 'planned' : 'completed';
  const { startedAt, finishedAt } = applyDateRules(
    latest?.watchedOn ?? null,
    // A film is seen in one sitting: start and finish are the same day.
    latest?.watchedOn ?? null,
    row,
    options.now ?? new Date(),
    warnings,
  );

  return {
    entry: {
      source: 'letterboxd',
      kind: 'movie',
      externalId,
      title,
      year: raw.year,
      seasonNumber: null,
      status,
      score: readScore(raw.rating ?? latest?.rating ?? null, row, warnings),
      // A movie is one part, so there is no progress to carry.
      progress: 0,
      repeats: Math.max(0, viewings.length - 1),
      startedAt,
      finishedAt,
      notes: null,
      favourite: raw.liked,
      externalIds: {
        ...(raw.tmdb ? { tmdb: raw.tmdb } : {}),
        ...(raw.imdb ? { imdb: raw.imdb } : {}),
      },
    },
    warnings,
  };
}
