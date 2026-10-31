import type { ExternalIds, LogStatus } from '@trackt/shared';
import { applyDateRules, readFullDate } from '../dates.js';
import { warning, type ImportEntry, type ImportWarning } from '../types.js';
import type {
  TraktIds,
  TraktMovie,
  TraktProgressEpisode,
  TraktProgressSeason,
  TraktWatchedEpisode,
  TraktWatchedMovie,
  TraktWatchedSeason,
  TraktWatchedShow,
  TraktWatchlistItem,
} from './schemas.js';

/**
 * Trakt's vocabulary to ours. Unlike MAL or AniList there is no status field to
 * translate: being in `watched` *is* the log, and a season's completion is the
 * only thing Trakt states separately (`progress/watched`).
 */

/** The provider identity a warning is filed under. */
export interface TraktRow {
  externalId: string | null;
  title: string | null;
}

export interface MapOptions {
  /** Injected so the future-date rule is testable. */
  now?: Date;
}

/** Only the ids Trakt actually returned: a missing one is a missing join. */
function externalIdsFor(ids: TraktIds | null | undefined): ExternalIds {
  const externalIds: ExternalIds = {};
  if (typeof ids?.trakt === 'number') externalIds.trakt = ids.trakt;
  if (typeof ids?.tmdb === 'number') externalIds.tmdb = ids.tmdb;
  if (typeof ids?.tvdb === 'number') externalIds.tvdb = ids.tvdb;
  if (ids?.imdb) externalIds.imdb = ids.imdb;
  return externalIds;
}

function workOf(raw: { title?: string | null }): string | null {
  const title = raw.title?.trim();
  return title ? title : null;
}

/** Trakt's timestamps are UTC instants; a log date is their UTC day (ADR-0007). */
function dayOf(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

function repeatCount(plays: number | null | undefined): number {
  return Math.max(0, Math.floor(plays ?? 0) - 1);
}

/** Trakt rates on Trackt's own 1–10 scale; anything else is a provider bug, not a score. */
export function readTraktScore(
  rating: number | null | undefined,
  row: TraktRow,
  warnings: ImportWarning[],
): number | null {
  if (rating === null || rating === undefined) return null;
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) {
    warnings.push(
      warning('score-invalid', row, `rating ${rating} is outside Trakt's 1–10 scale — dropped`),
    );
    return null;
  }
  return rating;
}

function malformed(row: TraktRow, message: string): { entry: null; warnings: ImportWarning[] } {
  return { entry: null, warnings: [warning('malformed-row', row, message)] };
}

/**
 * One watched movie → one entry. A film is a whole work seen in one sitting, so
 * start and finish are the day Trakt last recorded it, and plays beyond the
 * first are rewatches.
 */
export function mapTraktMovie(
  raw: TraktWatchedMovie,
  options: MapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const movie: TraktMovie | null | undefined = raw.movie;
  const title = movie ? workOf(movie) : null;
  const traktId = movie?.ids?.trakt;
  const externalId = typeof traktId === 'number' ? String(traktId) : null;
  const row: TraktRow = { externalId, title };

  if (!title || !externalId) {
    return malformed(
      row,
      `a watched movie row names no work (movie ${externalId ?? '—'}) — skipped`,
    );
  }

  const day = dayOf(raw.last_watched_at);
  const startedAt = readFullDate(day, row, 'start', warnings);
  // A film is seen in one sitting: start and finish are the same day, so the
  // rules run once rather than reporting the same future date twice.
  const dates = applyDateRules(startedAt, null, row, options.now ?? new Date(), warnings);

  return {
    entry: {
      source: 'trakt',
      kind: 'movie',
      externalId,
      title,
      year: movie?.year ?? null,
      seasonNumber: null,
      status: 'completed',
      score: null,
      // A movie is one part; nothing to position.
      progress: 0,
      repeats: repeatCount(raw.plays),
      startedAt: dates.startedAt,
      finishedAt: dates.startedAt,
      notes: null,
      // No provider on this source states a favourite.
      favourite: false,
      externalIds: externalIdsFor(movie?.ids),
    },
    warnings,
  };
}

/**
 * One watched season of a show → one entry (ADR-0003: the catalog files one row
 * per season, so a show is as many entries as it has seasons).
 *
 * `progressSeason` is the matching season of `progress/watched`; it is null when
 * that call failed, and the watched list alone still says which episodes were
 * seen — just not how many are out, so the season cannot be called completed.
 */
export function mapTraktSeason(
  show: TraktWatchedShow,
  season: TraktWatchedSeason,
  progressSeason: TraktProgressSeason | null,
  options: MapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const work = show.show;
  const title = work ? workOf(work) : null;
  const traktId = work?.ids?.trakt;
  const externalId = typeof traktId === 'number' ? String(traktId) : null;
  const row: TraktRow = { externalId, title };

  if (!title || !externalId) {
    return malformed(
      row,
      `a watched season (number ${season.number}) names no show — season skipped`,
    );
  }

  // An announced season has no aired episode: a 0-episode "in progress" log is
  // noise, and Trakt states the zero explicitly, so it is not a guess to drop it.
  if (progressSeason?.aired === 0) {
    return {
      entry: null,
      warnings: [
        warning(
          'partial-source',
          row,
          `season ${season.number} of "${title}" has no aired episode yet — season skipped`,
        ),
      ],
    };
  }

  const progressEpisodes: TraktProgressEpisode[] = progressSeason?.episodes ?? [];
  const watchedEpisodes: TraktWatchedEpisode[] = season.episodes ?? [];
  const completedNumbers = progressEpisodes
    .filter((episode) => episode.completed === true)
    .map((episode) => episode.number);
  const watchedNumbers = watchedEpisodes
    .filter((episode) => (episode.plays ?? 0) > 0)
    .map((episode) => episode.number);

  // Position is the highest episode seen, not a count: watching 1, 2 and 5 is
  // "on episode 5" in the app's own position semantics.
  const position = Math.max(0, ...completedNumbers, ...watchedNumbers);
  if (position === 0) {
    return {
      entry: null,
      warnings: [
        warning(
          'partial-source',
          row,
          `season ${season.number} of "${title}" has no watched episode — season skipped`,
        ),
      ],
    };
  }

  const aired = progressSeason?.aired ?? null;
  const status: LogStatus =
    aired !== null && aired > 0 && completedNumbers.length >= aired ? 'completed' : 'in_progress';

  const days = [...progressEpisodes, ...watchedEpisodes]
    .map((episode) => dayOf(episode.last_watched_at))
    .filter((day): day is string => day !== null)
    .sort();
  const dates = applyDateRules(
    readFullDate(days[0], row, 'start', warnings),
    status === 'completed' ? readFullDate(days.at(-1), row, 'finish', warnings) : null,
    row,
    options.now ?? new Date(),
    warnings,
  );

  return {
    entry: {
      source: 'trakt',
      kind: 'series',
      externalId,
      title,
      // A season row's own year is the catalog's; a season number is not an
      // offset into the show's premiere year, so only season 1 knows one.
      year: season.number === 1 ? (work?.year ?? null) : null,
      seasonNumber: season.number,
      status,
      score: null,
      progress: position,
      // Trakt counts a rewatch at show level, not per season.
      repeats: repeatCount(show.plays),
      startedAt: dates.startedAt,
      finishedAt: dates.finishedAt,
      notes: null,
      // No provider on this source states a favourite.
      favourite: false,
      externalIds: externalIdsFor(work?.ids),
    },
    warnings,
  };
}

/** A watchlisted movie is `planned`: nothing has happened to it yet. */
export function mapTraktWatchlistMovie(raw: TraktWatchlistItem): {
  entry: ImportEntry | null;
  warnings: ImportWarning[];
} {
  const movie = raw.movie;
  const title = movie ? workOf(movie) : null;
  const traktId = movie?.ids?.trakt;
  const externalId = typeof traktId === 'number' ? String(traktId) : null;
  const row: TraktRow = { externalId, title };

  if (!title || !externalId) {
    return malformed(row, `a watchlist row names no movie (movie ${externalId ?? '—'}) — skipped`);
  }

  return {
    entry: {
      source: 'trakt',
      kind: 'movie',
      externalId,
      title,
      year: movie?.year ?? null,
      seasonNumber: null,
      status: 'planned',
      score: null,
      progress: 0,
      repeats: 0,
      startedAt: null,
      finishedAt: null,
      notes: raw.notes?.trim() ? raw.notes.trim() : null,
      // No provider on this source states a favourite.
      favourite: false,
      externalIds: externalIdsFor(movie?.ids),
    },
    warnings: [],
  };
}
