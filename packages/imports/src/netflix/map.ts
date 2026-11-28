import { applyDateRules } from '../dates.js';
import { normaliseTitle } from '../titles.js';
import type { ImportEntry, ImportWarning } from '../types.js';
import type { NetflixMovie, NetflixSeason } from './schemas.js';

/**
 * Netflix's history to our vocabulary. It records what was played, never what
 * was finished or planned, so a film is completed and a season is in progress
 * until the catalog's episode count says it is done. No ids and no years: the
 * title is the work, which is why the normalised title is the provider id.
 */

export interface NetflixMapOptions {
  now?: Date;
}

interface Mapped {
  entry: ImportEntry;
  warnings: ImportWarning[];
}

export function mapNetflixMovie(movie: NetflixMovie, options: NetflixMapOptions = {}): Mapped {
  const row = { externalId: normaliseTitle(movie.title), title: movie.title };
  const warnings: ImportWarning[] = [];
  const dates = applyDateRules(
    movie.firstWatchedAt,
    movie.lastWatchedAt,
    row,
    options.now ?? new Date(),
    warnings,
  );
  return {
    entry: {
      source: 'netflix',
      kind: 'movie',
      externalId: row.externalId,
      title: movie.title,
      year: null,
      seasonNumber: null,
      status: 'completed',
      score: null,
      progress: 0,
      repeats: 0,
      startedAt: dates.startedAt,
      finishedAt: dates.finishedAt,
      notes: null,
      favourite: false,
      externalIds: {},
      // Netflix lists anime films with the rest; the catalog files them as anime.
      fallbackKind: 'anime',
    },
    warnings,
  };
}

/**
 * Season 1 also offers itself as an anime, as TV Time's does: the catalog files
 * anime per AniList entry, and a later anime season has no sound mapping.
 */
export function mapNetflixSeason(season: NetflixSeason, options: NetflixMapOptions = {}): Mapped {
  const row = { externalId: normaliseTitle(season.show), title: season.show };
  const warnings: ImportWarning[] = [];
  const dates = applyDateRules(
    season.firstWatchedAt,
    season.lastWatchedAt,
    row,
    options.now ?? new Date(),
    warnings,
  );
  return {
    entry: {
      source: 'netflix',
      kind: 'series',
      externalId: row.externalId,
      title: season.show,
      year: null,
      seasonNumber: season.number,
      status: 'in_progress',
      score: null,
      progress: season.episodes,
      repeats: 0,
      startedAt: dates.startedAt,
      finishedAt: null,
      notes: null,
      favourite: false,
      externalIds: {},
      completesAtPartCount: { finishedAt: dates.finishedAt },
      ...(season.number === 1 ? { fallbackKind: 'anime' as const } : {}),
    },
    warnings,
  };
}
