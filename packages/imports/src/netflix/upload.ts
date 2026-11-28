import { isFullDate } from '../dates.js';
import { ImportError } from '../errors.js';
import { normaliseTitle } from '../titles.js';
import type { NetflixExport, NetflixMovie, NetflixSeason, NetflixUnplaced } from './schemas.js';

/** One uploaded file, as text. */
export interface NetflixFile {
  name: string;
  content: string;
}

interface HistoryRow {
  title: string;
  day: string;
}

function malformed(name: string, why: string): ImportError {
  return new ImportError(`${name} is not a Netflix viewing history: ${why}`, 'malformed');
}

/** RFC 4180: quoted fields may hold commas, doubled quotes and line breaks. */
export function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index]!;
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && content[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

type DateOrder = 'ymd' | 'mdy' | 'dmy';

function dateParts(value: string): [string, string, string] | null {
  const parts = value.trim().split(/[/.-]/);
  return parts.length === 3 && parts.every((part) => /^\d{1,4}$/.test(part))
    ? (parts as [string, string, string])
    : null;
}

/**
 * The account's locale picks the format (`11/26/26` in the US, `26/11/2026` in
 * Europe), so the order is read off the whole file: a first field past 12 is a
 * day, a second one past 12 is too. A file that never says keeps the US order
 * for slashes, the only form whose order Netflix writes month-first.
 */
function dateOrder(values: readonly string[]): DateOrder {
  let dayFirst = false;
  let monthFirst = false;
  let slashes = false;
  for (const value of values) {
    const parts = dateParts(value);
    if (!parts) continue;
    if (parts[0].length === 4) return 'ymd';
    if (Number(parts[0]) > 12) dayFirst = true;
    if (Number(parts[1]) > 12) monthFirst = true;
    if (value.includes('/')) slashes = true;
  }
  if (dayFirst !== monthFirst) return dayFirst ? 'dmy' : 'mdy';
  return slashes ? 'mdy' : 'dmy';
}

function readDay(value: string, order: DateOrder): string | null {
  const parts = dateParts(value);
  if (!parts) return null;
  const [year, month, day] =
    order === 'ymd'
      ? parts
      : order === 'mdy'
        ? [parts[2], parts[0], parts[1]]
        : [parts[2], parts[1], parts[0]];
  const fullYear = year.length === 2 ? `20${year}` : year.padStart(4, '0');
  const iso = `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return isFullDate(iso) ? iso : null;
}

/** NBSPs (French typography puts one before `!`, `?` and a season's number) and stray spaces. */
function clean(value: string): string {
  return value.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Netflix's separator; a title's own colon (`Suits : avocats sur mesure`) survives the join. */
const SEPARATOR = ': ';

const SEASON_WORDS =
  'season|saison|temporada|staffel|stagione|seizoen|sezon|säsong|sæson|sesong|kausi|évad|sezóna|сезон' +
  '|part|partie|parte|teil|deel|część|del|osa';
const SEASON_MARKER = new RegExp(`^(?:${SEASON_WORDS})\\s+(\\d{1,3})$`, 'iu');
const LIMITED_MARKER =
  /^(?:limited series|mini-?s[ée]rie|mini-?series|miniserie|serie limitada|minissérie|miniserie)$/iu;
/** A season label with no number: the episodes cannot be placed. */
const UNNUMBERED_MARKER =
  /^(?:final season|the final season|dernière saison|saison finale|temporada final|última temporada|letzte staffel|finale staffel|stagione finale|ultima stagione|laatste seizoen)$/iu;
const EPISODE_MARKER =
  /^(?:episode|épisode|episodio|episódio|folge|aflevering|odcinek|avsnitt|afsnit|jakso|capítulo|capitulo|epizod|epizoda)\s+\d{1,4}$/iu;

type Placed =
  | { kind: 'season'; show: string; number: number; episode: string }
  | { kind: 'unplaced'; show: string; label: string; episode: string };

/** `Show: Season 2: Episode` and its kin; the marker must be followed by an episode. */
function placeMarked(segments: readonly string[]): Placed | null {
  for (let index = 1; index < segments.length - 1; index++) {
    const segment = clean(segments[index]!);
    const show = clean(segments.slice(0, index).join(SEPARATOR));
    const episode = clean(segments.slice(index + 1).join(SEPARATOR));
    if (!show || !episode) continue;
    const season = SEASON_MARKER.exec(segment);
    if (season && Number(season[1]) >= 1) {
      return { kind: 'season', show, number: Number(season[1]), episode };
    }
    if (LIMITED_MARKER.test(segment)) return { kind: 'season', show, number: 1, episode };
    if (UNNUMBERED_MARKER.test(segment)) return { kind: 'unplaced', show, label: segment, episode };
  }
  return null;
}

/** A sequel sits under the original's page: `Cyberpunk: Edgerunners: Cyberpunk: Edgerunners 2`. */
function showName(segments: readonly string[]): string {
  const first = normaliseTitle(segments[0] ?? '');
  const restart = segments.findLastIndex(
    (segment, index) => index > 0 && normaliseTitle(segment) === first,
  );
  return clean(segments.slice(Math.max(0, restart)).join(SEPARATOR));
}

interface SeasonBucket {
  show: string;
  number: number;
  assumed: boolean;
  episodes: Set<string>;
  days: string[];
}

function span(days: readonly string[]): { firstWatchedAt: string; lastWatchedAt: string } {
  const sorted = [...days].sort();
  return { firstWatchedAt: sorted[0]!, lastWatchedAt: sorted.at(-1)! };
}

/**
 * History rows → works.
 *
 * A row with a season marker is an episode of that season. A row without one is
 * an episode only when the rest of the history says so — another row shares its
 * leading segments, a marked row names that show, or it ends in "Episode N" —
 * because `Mad Max: Fury Road` is a film and nothing in its row says otherwise.
 * Such a show is placed in season 1, the form Netflix uses for a show with one.
 */
export function groupNetflixHistory(rows: readonly HistoryRow[]): Omit<NetflixExport, 'skipped'> {
  const seasons = new Map<string, SeasonBucket>();
  const unplaced = new Map<string, NetflixUnplaced & { names: Set<string> }>();
  const movies = new Map<string, { title: string; days: string[] }>();
  const unmarked: { row: HistoryRow; segments: string[] }[] = [];
  const markedShows = new Set<string>();

  const season = (show: string, number: number, assumed: boolean): SeasonBucket => {
    const key = `${normaliseTitle(show)}\u0000${number}`;
    let bucket = seasons.get(key);
    if (!bucket) {
      bucket = { show, number, assumed, episodes: new Set(), days: [] };
      seasons.set(key, bucket);
    }
    bucket.assumed &&= assumed;
    return bucket;
  };

  for (const row of rows) {
    const segments = row.title.split(SEPARATOR);
    const placed = placeMarked(segments);
    if (!placed) {
      unmarked.push({ row, segments });
      continue;
    }
    markedShows.add(normaliseTitle(placed.show));
    if (placed.kind === 'season') {
      const bucket = season(placed.show, placed.number, false);
      bucket.episodes.add(normaliseTitle(placed.episode));
      bucket.days.push(row.day);
    } else {
      const key = `${normaliseTitle(placed.show)}\u0000${placed.label.toLowerCase()}`;
      const bucket = unplaced.get(key) ?? {
        show: placed.show,
        label: placed.label,
        episodes: 0,
        names: new Set<string>(),
      };
      bucket.names.add(normaliseTitle(placed.episode));
      bucket.episodes = bucket.names.size;
      unplaced.set(key, bucket);
    }
  }

  // How many distinct titles open with each run of leading segments.
  const prefixCounts = new Map<string, number>();
  const distinct = new Map<string, string[]>();
  for (const { row, segments } of unmarked) {
    if (segments.length > 1) distinct.set(normaliseTitle(row.title), segments);
  }
  const prefixKey = (segments: readonly string[], length: number) =>
    normaliseTitle(segments.slice(0, length).join(SEPARATOR));
  for (const segments of distinct.values()) {
    for (let length = 1; length < segments.length; length++) {
      const key = prefixKey(segments, length);
      prefixCounts.set(key, (prefixCounts.get(key) ?? 0) + 1);
    }
  }

  for (const { row, segments } of unmarked) {
    let showLength = 0;
    if (segments.length > 1) {
      // The longest run a marked row names as a show or another title shares:
      // `Show: Arc: Episode` keeps its arc in the show.
      for (let length = segments.length - 1; length >= 1 && showLength === 0; length--) {
        const key = prefixKey(segments, length);
        if (markedShows.has(key) || (prefixCounts.get(key) ?? 0) >= 2) showLength = length;
      }
      if (showLength === 0 && EPISODE_MARKER.test(clean(segments.at(-1)!))) {
        showLength = segments.length - 1;
      }
    }

    const show = showName(segments.slice(0, showLength));
    const episode = clean(segments.slice(showLength).join(SEPARATOR));
    if (showLength > 0 && show && episode) {
      const bucket = season(show, 1, true);
      bucket.episodes.add(normaliseTitle(episode));
      bucket.days.push(row.day);
      continue;
    }

    const title = clean(row.title);
    const key = normaliseTitle(title);
    const movie = movies.get(key) ?? { title, days: [] };
    movie.days.push(row.day);
    movies.set(key, movie);
  }

  return {
    movies: [...movies.values()].map(({ title, days }): NetflixMovie => ({ title, ...span(days) })),
    seasons: [...seasons.values()]
      .map(({ show, number, assumed, episodes, days }): NetflixSeason => ({
        show,
        number,
        episodes: episodes.size,
        assumed,
        ...span(days),
      }))
      .sort((left, right) => left.show.localeCompare(right.show) || left.number - right.number),
    unplaced: [...unplaced.values()].map(({ show, label, episodes }) => ({
      show,
      label,
      episodes,
    })),
  };
}

function readRows(file: NetflixFile): { rows: HistoryRow[]; skipped: number } {
  const content = file.content.replace(/^﻿/, '');
  if (content.trimStart().startsWith('<') || content.trimStart().startsWith('{')) {
    throw malformed(file.name, 'expected the CSV file, not a web page or JSON');
  }
  const table = parseCsv(content);
  if (table.length === 0) throw malformed(file.name, 'the file is empty');
  if (table.some((cells) => cells.length !== 2)) {
    throw malformed(file.name, 'every row should have two columns, a title and a date');
  }

  const order = dateOrder(table.map((cells) => cells[1]!));
  // The header (`Title,Date`) is the one row whose second cell is not a date.
  const body = readDay(table[0]![1]!, order) === null ? table.slice(1) : table;
  const rows: HistoryRow[] = [];
  let skipped = 0;
  for (const [title, date] of body) {
    const day = readDay(date!, order);
    // Netflix sometimes drops the show and keeps `: Episode 3`.
    if (!clean(title!.split(SEPARATOR)[0]!) || !day) {
      skipped++;
      continue;
    }
    rows.push({ title: title!.replace(/[  ]/g, ' '), day });
  }
  if (rows.length === 0 && body.length > 0) {
    throw malformed(file.name, 'no row has a date it can read');
  }
  return { rows, skipped };
}

/** One history per profile; several files are read as one. */
export function readNetflixUpload(files: readonly NetflixFile[]): NetflixExport {
  if (files.length === 0) {
    throw new ImportError(
      'attach NetflixViewingHistory.csv from netflix.com/settings/viewed',
      'malformed',
    );
  }
  const rows: HistoryRow[] = [];
  let skipped = 0;
  for (const file of files) {
    const read = readRows(file);
    rows.push(...read.rows);
    skipped += read.skipped;
  }
  return { ...groupNetflixHistory(rows), skipped };
}

/** What the wizard names the run: the history's last day, since the file name carries none. */
export function netflixUploadLabel(upload: NetflixExport): string {
  const days = [
    ...upload.movies.map((movie) => movie.lastWatchedAt),
    ...upload.seasons.map((season) => season.lastWatchedAt),
  ].sort();
  const last = days.at(-1);
  return last ? `history to ${last}` : 'history';
}
