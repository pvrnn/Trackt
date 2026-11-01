import { z } from 'zod';
import type { ImportKind } from '../types.js';

/**
 * MyAnimeList's own list payloads, parsed permissively: the rows come from
 * `/animelist/<user>/load.json`, which is the endpoint the list page itself
 * calls, and MAL adds fields without telling anyone. The mapper reads what it
 * recognises and warns about the rest.
 *
 * Dates are MAL's `DD-MM-YY` strings, not ISO — converting them belongs to the
 * mapper, which is also where a date that is not a day is reported.
 */

const malDate = z.string().nullish();

export const MalAnimeRowSchema = z.object({
  anime_id: z.number().int().positive(),
  anime_title: z.string(),
  /** 1 watching, 2 completed, 3 on hold, 4 dropped, 6 plan to watch. */
  status: z.number().int(),
  /** 0 means "not scored". */
  score: z.number().nullish(),
  num_watched_episodes: z.number().nullish(),
  is_rewatching: z.number().nullish(),
  notes: z.string().nullish(),
  start_date_string: malDate,
  finish_date_string: malDate,
  /** When the work itself started airing. */
  anime_start_date_string: malDate,
});

export const MalMangaRowSchema = z.object({
  manga_id: z.number().int().positive(),
  manga_title: z.string(),
  /** 1 reading, 2 completed, 3 on hold, 4 dropped, 6 plan to read. */
  status: z.number().int(),
  score: z.number().nullish(),
  num_read_chapters: z.number().nullish(),
  num_read_volumes: z.number().nullish(),
  is_rereading: z.number().nullish(),
  notes: z.string().nullish(),
  start_date_string: malDate,
  finish_date_string: malDate,
  /** When the work itself started publishing. */
  manga_start_date_string: malDate,
});

export type MalAnimeRow = z.infer<typeof MalAnimeRowSchema>;
export type MalMangaRow = z.infer<typeof MalMangaRowSchema>;

/** One list row, both kinds flattened to the same fields. */
export interface MalListRow {
  kind: ImportKind;
  externalId: string;
  title: string;
  status: number;
  score: number;
  progress: number;
  volumesRead: number;
  /** Currently on a rewatch/reread — the row carries no total count. */
  repeating: boolean;
  notes: string | null;
  /** `DD-MM-YY` as MAL states it; null when the row has none. */
  startedOn: string | null;
  finishedOn: string | null;
  /** The work's own start date, `DD-MM-YY` — the year the title match needs. */
  releasedOn: string | null;
}

export interface MalFavorite {
  kind: ImportKind;
  externalId: string;
  title: string;
  /** The year the favourites page prints beside the format, when it prints one. */
  year: number | null;
}

function orNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function fromAnimeRow(row: MalAnimeRow): MalListRow {
  return {
    kind: 'anime',
    externalId: String(row.anime_id),
    title: row.anime_title,
    status: row.status,
    score: row.score ?? 0,
    progress: row.num_watched_episodes ?? 0,
    volumesRead: 0,
    repeating: (row.is_rewatching ?? 0) > 0,
    notes: orNull(row.notes),
    startedOn: orNull(row.start_date_string),
    finishedOn: orNull(row.finish_date_string),
    releasedOn: orNull(row.anime_start_date_string),
  };
}

export function fromMangaRow(row: MalMangaRow): MalListRow {
  return {
    kind: 'manga',
    externalId: String(row.manga_id),
    title: row.manga_title,
    status: row.status,
    score: row.score ?? 0,
    progress: row.num_read_chapters ?? 0,
    volumesRead: row.num_read_volumes ?? 0,
    repeating: (row.is_rereading ?? 0) > 0,
    notes: orNull(row.notes),
    startedOn: orNull(row.start_date_string),
    finishedOn: orNull(row.finish_date_string),
    releasedOn: orNull(row.manga_start_date_string),
  };
}
