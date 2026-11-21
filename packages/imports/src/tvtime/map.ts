import type { ExternalIds, LogStatus } from '@trackt/shared';
import { applyDateRules, readFullDate } from '../dates.js';
import { warning, type ImportEntry, type ImportWarning } from '../types.js';
import type { TvTimeMovie, TvTimeShow } from './schemas.js';

/**
 * TV Time's vocabulary to ours. A movie is watched or not; a show is a TV Time
 * status plus per-season episode marks, and the catalog files one row per
 * season (ADR-0003), so a show is as many entries as it has seasons seen.
 */

export interface TvTimeMapOptions {
  now?: Date;
}

interface Mapped {
  entry: ImportEntry | null;
  warnings: ImportWarning[];
}

/** TV Time's statuses that mean "on my list, not started" — the show is planned. */
const PLANNING_STATUSES = new Set(['not_started_yet', 'watch_later', 'continuing', 'up_to_date']);

function movieExternalIds(movie: TvTimeMovie): ExternalIds {
  // A TVDB *movie* id is its own namespace; the catalog keys movies on IMDb/TMDB.
  return movie.imdb ? { imdb: movie.imdb } : {};
}

function showExternalIds(show: TvTimeShow): ExternalIds {
  const ids: ExternalIds = {};
  if (show.tvdb !== null) ids.tvdb = show.tvdb;
  if (show.imdb) ids.imdb = show.imdb;
  return ids;
}

export function mapTvTimeMovie(movie: TvTimeMovie, options: TvTimeMapOptions = {}): Mapped {
  const externalId =
    movie.tvdb !== null ? String(movie.tvdb) : movie.uuid ? movie.uuid : (movie.imdb ?? null);
  const row = { externalId, title: movie.title };
  if (!movie.title || !externalId) {
    return {
      entry: null,
      warnings: [warning('malformed-row', row, 'a movie row names no film — skipped')],
    };
  }

  const warnings: ImportWarning[] = [];
  const watched = movie.watched;
  // A film is seen in one sitting: one day, checked once.
  const day = watched ? readFullDate(movie.watchedAt, row, 'start', warnings) : null;
  const dates = applyDateRules(day, null, row, options.now ?? new Date(), warnings);

  return {
    entry: {
      source: 'tvtime',
      kind: 'movie',
      externalId,
      title: movie.title,
      year: movie.year,
      seasonNumber: null,
      status: watched ? 'completed' : 'planned',
      score: null,
      progress: 0,
      repeats: watched ? movie.rewatches : 0,
      startedAt: dates.startedAt,
      finishedAt: dates.startedAt,
      notes: null,
      favourite: movie.favourite,
      externalIds: movieExternalIds(movie),
      // TV Time lists anime films with the rest; the catalog files them as anime.
      fallbackKind: 'anime',
    },
    warnings,
  };
}

/**
 * One show → its season entries.
 *
 * A season with an episode seen is logged: completed when every listed episode
 * is, dropped when TV Time says the show was stopped, in progress otherwise. A
 * show with nothing seen is planned as season 1 — TV Time lists its seasons, so
 * that is where watching it starts rather than a guess.
 *
 * TV Time files anime as TVDB shows, while the catalog files anime per AniList
 * entry with no TVDB id; season 1 therefore also offers itself as an anime, and
 * the resolver tries that when no series row answers. Later anime seasons have
 * no sound mapping (AniList splits by cour, TVDB by season) and stay unmatched.
 */
export function mapTvTimeShow(
  show: TvTimeShow,
  options: TvTimeMapOptions = {},
): { entries: { entry: ImportEntry; warnings: ImportWarning[] }[]; warnings: ImportWarning[] } {
  const externalId = show.tvdb !== null ? String(show.tvdb) : null;
  const row = { externalId, title: show.title };
  if (!show.title || !externalId) {
    return {
      entries: [],
      warnings: [warning('malformed-row', row, 'a show row names no TVDB show — skipped')],
    };
  }

  const now = options.now ?? new Date();
  const base = {
    source: 'tvtime' as const,
    kind: 'series' as const,
    externalId,
    title: show.title,
    // TV Time states no premiere year, and a season's year is the catalog's.
    year: null,
    score: null,
    notes: null,
    externalIds: showExternalIds(show),
  };
  const entries: { entry: ImportEntry; warnings: ImportWarning[] }[] = [];
  const seen = show.seasons.filter((season) => season.complete || season.position > 0);

  for (const season of seen) {
    const warnings: ImportWarning[] = [];
    const status: LogStatus = season.complete
      ? 'completed'
      : show.status === 'stopped'
        ? 'dropped'
        : 'in_progress';
    const dates = applyDateRules(
      readFullDate(season.firstWatchedAt, row, 'start', warnings),
      status === 'completed' ? readFullDate(season.lastWatchedAt, row, 'finish', warnings) : null,
      row,
      now,
      warnings,
    );
    entries.push({
      entry: {
        ...base,
        seasonNumber: season.number,
        status,
        progress: season.complete ? (season.episodes ?? season.position) : season.position,
        repeats: season.rewatches,
        startedAt: dates.startedAt,
        finishedAt: dates.finishedAt,
        // One show-level heart, pinned on the show's first logged season.
        favourite: show.favourite && entries.length === 0,
        ...(season.number === 1 ? { fallbackKind: 'anime' as const } : {}),
      },
      warnings,
    });
  }

  if (entries.length > 0) return { entries, warnings: [] };

  if (show.watchedEpisodes > 0) {
    return {
      entries: [],
      warnings: [
        warning(
          'partial-source',
          row,
          `${show.watchedEpisodes} episodes are marked seen but the export places none of them in a season — skipped`,
        ),
      ],
    };
  }

  const listsSeasonOne =
    show.seasons.length === 0 || show.seasons.some((season) => season.number === 1);
  if (!PLANNING_STATUSES.has(show.status ?? '') || !listsSeasonOne) {
    return {
      entries: [],
      warnings: [
        warning(
          'partial-source',
          row,
          `"${show.title}" has no episode seen and is ${show.status ?? 'without a status'} on TV Time — skipped`,
        ),
      ],
    };
  }

  entries.push({
    entry: {
      ...base,
      seasonNumber: 1,
      status: 'planned',
      progress: 0,
      repeats: 0,
      startedAt: null,
      finishedAt: null,
      favourite: show.favourite,
      fallbackKind: 'anime',
    },
    warnings: [],
  });
  return { entries, warnings: [] };
}
