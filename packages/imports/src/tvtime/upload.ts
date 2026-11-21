import { z } from 'zod';
import { ImportError } from '../errors.js';
import {
  TvTimeHtmlMovieSchema,
  TvTimeHtmlShowSchema,
  TvTimeJsonMovieSchema,
  TvTimeJsonShowSchema,
  type TvTimeExport,
  type TvTimeHtmlMovie,
  type TvTimeHtmlShow,
  type TvTimeJsonMovie,
  type TvTimeJsonShow,
  type TvTimeMovie,
  type TvTimeSeason,
  type TvTimeShow,
} from './schemas.js';

/** One uploaded file, as text. */
export interface TvTimeFile {
  name: string;
  content: string;
}

/** TV Time stamps a watch as a UTC instant; a log date is its UTC day (ADR-0007). */
function dayOf(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function cleanTitle(value: string | null | undefined): string | null {
  const title = value?.trim();
  return title ? title : null;
}

function malformed(name: string, why: string): ImportError {
  return new ImportError(`${name} is not a TV Time export: ${why}`, 'malformed');
}

/** `var SHOWS = [...]` sits on one line of the summary's script; JSON has no raw newline. */
function htmlLiteral(content: string, name: string): unknown[] | null {
  const match = new RegExp(`\\bvar\\s+${name}\\s*=\\s*(\\[.*\\])\\s*;?\\s*$`, 'm').exec(content);
  if (!match) return null;
  try {
    const value: unknown = JSON.parse(match[1]!);
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function parseRows<T>(rows: unknown[], schema: z.ZodType<T>, file: string, what: string): T[] {
  const parsed = z.array(schema).safeParse(rows);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw malformed(
      file,
      `a ${what} row does not read (${issue?.path.join('.')}: ${issue?.message})`,
    );
  }
  return parsed.data;
}

export function compactJsonMovie(raw: TvTimeJsonMovie): TvTimeMovie {
  return {
    tvdb: raw.id?.tvdb ?? null,
    imdb: raw.id?.imdb ?? null,
    uuid: raw.uuid ?? null,
    title: cleanTitle(raw.title),
    year: raw.year ?? null,
    watched: raw.is_watched === true,
    watchedAt: dayOf(raw.watched_at),
    favourite: raw.is_favorite === true,
    rewatches: Math.max(0, raw.rewatch_count ?? 0),
  };
}

export function compactHtmlMovie(raw: TvTimeHtmlMovie): TvTimeMovie {
  return {
    tvdb: raw.tvdbId ?? null,
    imdb: raw.imdbId ?? null,
    uuid: raw.uuid ?? null,
    title: cleanTitle(raw.title),
    year: raw.year ?? null,
    watched: raw.isWatched === true,
    watchedAt: dayOf(raw.watchedAt),
    favourite: raw.isFavorite === true,
    rewatches: Math.max(0, raw.rewatchCount ?? 0),
  };
}

/**
 * Specials (season 0, or flagged) are dropped: the catalog files no special
 * season, and TV Time scatters specials into regular seasons too.
 */
export function compactJsonShow(raw: TvTimeJsonShow): TvTimeShow {
  const seasons: TvTimeSeason[] = [];
  let watchedEpisodes = 0;

  for (const season of raw.seasons ?? []) {
    if (season.is_specials === true || season.number < 1) continue;
    const regular = (season.episodes ?? []).filter((episode) => episode.special !== true);
    const seen = regular.filter((episode) => episode.is_watched === true);
    watchedEpisodes += seen.length;
    const days = seen
      .map((episode) => dayOf(episode.watched_at))
      .filter((day): day is string => day !== null)
      .sort();
    const complete = regular.length > 0 && seen.length === regular.length;
    seasons.push({
      number: season.number,
      episodes: regular.length,
      position: Math.max(0, ...seen.map((episode) => episode.number)),
      complete,
      firstWatchedAt: days[0] ?? null,
      lastWatchedAt: days.at(-1) ?? null,
      // A season is rewatched only as often as its least-rewatched episode.
      rewatches: complete
        ? Math.max(0, Math.min(...seen.map((episode) => episode.rewatch_count ?? 0)))
        : 0,
    });
  }

  return {
    tvdb: raw.id?.tvdb ?? null,
    imdb: raw.id?.imdb ?? null,
    title: cleanTitle(raw.title),
    status: raw.status ?? null,
    favourite: raw.is_favorite === true,
    watchedEpisodes,
    seasons: seasons.sort((left, right) => left.number - right.number),
  };
}

/**
 * The summary keeps only the unseen regular episodes, so seasons are inferred
 * from what is missing — and only where that is sound:
 *
 * - a season below the last one with an unseen episode, and absent from the
 *   list, is fully seen (TVDB numbers seasons contiguously from 1);
 * - a season with unseen episodes is seen up to its first unseen one;
 * - a show with nothing unseen is complete, but the summary does not say how
 *   many seasons it has, so only season 1 is claimed.
 *
 * Seasons after the last unseen episode are invisible and are not guessed.
 */
export function compactHtmlShow(raw: TvTimeHtmlShow): TvTimeShow {
  const watched = Math.max(0, raw.watched ?? 0);
  const total = Math.max(0, raw.total ?? 0);
  const unseen = new Map<number, number[]>();
  for (const { season, episode } of raw.unwatchedRegularEps ?? []) {
    if (season < 1) continue;
    const bucket = unseen.get(season) ?? [];
    bucket.push(episode);
    unseen.set(season, bucket);
  }

  const blank = { episodes: null, firstWatchedAt: null, lastWatchedAt: null, rewatches: 0 };
  const seasons: TvTimeSeason[] = [];
  const last = Math.max(0, ...unseen.keys());

  if (watched === 0) {
    // Nothing seen: only the seasons the summary names, none of them started.
    for (const number of [...unseen.keys()].sort((left, right) => left - right)) {
      seasons.push({ ...blank, number, position: 0, complete: false });
    }
  } else if (last === 0) {
    if (total > 0 && watched >= total) {
      seasons.push({ ...blank, number: 1, position: 0, complete: true });
    }
  } else {
    for (let number = 1; number <= last; number++) {
      const missing = unseen.get(number);
      if (!missing) {
        seasons.push({ ...blank, number, position: 0, complete: true });
        continue;
      }
      seasons.push({ ...blank, number, position: Math.min(...missing) - 1, complete: false });
    }
  }

  return {
    tvdb: raw.tvdbId ?? null,
    imdb: raw.imdbId ?? null,
    title: cleanTitle(raw.title),
    status: raw.status ?? null,
    favourite: raw.isFavorite === true,
    watchedEpisodes: watched,
    seasons,
  };
}

type FileKind = 'movies' | 'series' | 'summary';

/** By content first; the file name only settles an empty JSON array. */
function kindOf(file: TvTimeFile, value: unknown): FileKind | null {
  if (!Array.isArray(value)) return null;
  const first = value.find((row) => typeof row === 'object' && row !== null) as
    Record<string, unknown> | undefined;
  if (first) {
    if ('seasons' in first) return 'series';
    if ('is_watched' in first || 'watched_at' in first || 'year' in first) return 'movies';
    return null;
  }
  const name = file.name.toLowerCase();
  if (name.includes('series') || name.includes('shows')) return 'series';
  if (name.includes('movie')) return 'movies';
  return null;
}

/**
 * Uploaded files → the compact export. Either the two JSON files, the HTML
 * summary, or any mix: a JSON file wins over the summary for the half it
 * carries, since it is the one with dates and per-season counts.
 */
export function readTvTimeUpload(files: readonly TvTimeFile[]): TvTimeExport {
  if (files.length === 0) {
    throw new ImportError(
      'attach the TV Time export: the two JSON files, or the HTML summary',
      'malformed',
    );
  }

  let jsonMovies: TvTimeMovie[] | null = null;
  let jsonShows: TvTimeShow[] | null = null;
  let htmlMovies: TvTimeMovie[] | null = null;
  let htmlShows: TvTimeShow[] | null = null;

  for (const file of files) {
    const content = file.content.replace(/^﻿/, '').trimStart();
    if (content.startsWith('<')) {
      const shows = htmlLiteral(content, 'SHOWS');
      const movies = htmlLiteral(content, 'MOVIES');
      if (!shows && !movies) {
        throw malformed(file.name, 'an HTML file without the summary’s SHOWS/MOVIES data');
      }
      if (shows) {
        htmlShows = parseRows(shows, TvTimeHtmlShowSchema, file.name, 'show').map(compactHtmlShow);
      }
      if (movies) {
        htmlMovies = parseRows(movies, TvTimeHtmlMovieSchema, file.name, 'movie').map(
          compactHtmlMovie,
        );
      }
      continue;
    }

    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw malformed(file.name, 'neither JSON nor the HTML summary');
    }
    const kind = kindOf(file, value);
    if (kind === 'series') {
      jsonShows = parseRows(value as unknown[], TvTimeJsonShowSchema, file.name, 'show').map(
        compactJsonShow,
      );
    } else if (kind === 'movies') {
      jsonMovies = parseRows(value as unknown[], TvTimeJsonMovieSchema, file.name, 'movie').map(
        compactJsonMovie,
      );
    } else {
      throw malformed(file.name, 'a JSON file that is neither the movies nor the series list');
    }
  }

  const shows = jsonShows ?? htmlShows;
  return {
    showsFrom: jsonShows ? 'json' : htmlShows ? 'html' : null,
    movies: jsonMovies ?? htmlMovies,
    shows,
  };
}

/** `tvtime-series-2026-07-07.json` → `export 2026-07-07`: what the wizard names the run. */
export function tvTimeUploadLabel(files: readonly TvTimeFile[]): string {
  for (const file of files) {
    const date = /(\d{4}-\d{2}-\d{2})/.exec(file.name)?.[1];
    if (date) return `export ${date}`;
  }
  return 'export';
}
