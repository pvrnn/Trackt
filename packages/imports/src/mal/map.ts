import type { LogStatus } from '@trackt/shared';
import { applyDateRules, dateFromParts } from '../dates.js';
import { warning, type ImportEntry, type ImportWarning } from '../types.js';
import type { MalListRow } from './schemas.js';

/**
 * MAL numbers its list statuses rather than naming them, and the same numbers
 * mean watching/reading to each kind. Deliberately a closed map rather than a
 * fallback: an unknown number is skipped with a warning, because guessing at
 * "on hold" vs "dropped" is how a whole list lands in the wrong bucket.
 */
const STATUS_BY_MAL: Record<number, LogStatus> = {
  1: 'in_progress',
  2: 'completed',
  3: 'paused',
  4: 'dropped',
  6: 'planned',
};

/** MAL states `DD-MM-YY`; the two-digit year is a person's lifetime, not a century. */
const MAL_DAY = /^(\d{1,2})-(\d{1,2})-(\d{2})$/;

function malDayToIso(value: string): string | null {
  const match = MAL_DAY.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const short = Number(match[3]);
  return dateFromParts({
    year: short >= 70 ? 1900 + short : 2000 + short,
    month,
    day,
  });
}

function readListDate(
  value: string | null,
  row: { externalId: string | null; title: string | null },
  field: 'start' | 'finish',
  warnings: ImportWarning[],
): string | null {
  if (!value) return null;
  const iso = malDayToIso(value);
  if (!iso) {
    warnings.push(
      warning(
        'partial-date',
        row,
        `${field} date "${value}" is not a day MAL can state (DD-MM-YY) — a log date is a day, so it was left blank`,
      ),
    );
    return null;
  }
  return iso;
}

/** The work's own year, from the start date MAL prints beside the title. */
function releaseYear(releasedOn: string | null): number | null {
  if (!releasedOn) return null;
  const iso = malDayToIso(releasedOn);
  return iso ? Number(iso.slice(0, 4)) : null;
}

function readScore(
  score: number,
  row: { externalId: string | null; title: string | null },
  warnings: ImportWarning[],
): number | null {
  // MAL's 0 is its "not scored" sentinel, not a rating of zero.
  if (score === 0) return null;
  if (!Number.isInteger(score) || score < 0 || score > 10) {
    warnings.push(
      warning('score-invalid', row, `score ${score} is outside MAL's 0–10 range — dropped`),
    );
    return null;
  }
  return score;
}

function wholeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export interface MapOptions {
  /** Injected so the future-date rule is testable. */
  now?: Date;
  /** The profile pins this work as a favourite. */
  favourite?: boolean;
}

/**
 * One MAL list row → one import entry, or nothing when the row cannot be read.
 * Every departure from the source is recorded as a warning rather than silently
 * corrected.
 */
export function mapMalEntry(
  raw: MalListRow,
  options: MapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const row = { externalId: raw.externalId, title: raw.title };
  const warnings: ImportWarning[] = [];

  const mapped = STATUS_BY_MAL[raw.status];
  if (!mapped) {
    warnings.push(
      warning('unknown-status', row, `unknown ${raw.kind} status ${raw.status} — row skipped`),
    );
    return { entry: null, warnings };
  }

  const { startedAt, finishedAt } = applyDateRules(
    readListDate(raw.startedOn, row, 'start', warnings),
    readListDate(raw.finishedOn, row, 'finish', warnings),
    row,
    options.now ?? new Date(),
    warnings,
  );

  const progress = wholeCount(raw.progress);
  if (raw.kind === 'manga' && progress === 0 && wholeCount(raw.volumesRead) > 0) {
    // Volume-only tracking cannot be turned into chapters: the catalog carries a
    // volume count but no per-volume chapter boundaries (see ROADMAP).
    warnings.push(
      warning(
        'volume-only-progress',
        row,
        `only ${raw.volumesRead} volume(s) read — chapter progress left at 0`,
      ),
    );
  }

  return {
    entry: {
      source: 'mal',
      kind: raw.kind,
      externalId: raw.externalId,
      title: raw.title,
      year: releaseYear(raw.releasedOn),
      seasonNumber: null,
      status: mapped,
      score: readScore(raw.score, row, warnings),
      progress,
      // The page says only "currently rewatching", never how many runs came
      // before; one completed run is what that flag means.
      repeats: raw.repeating ? 1 : 0,
      startedAt,
      finishedAt,
      notes: raw.notes?.trim() ? raw.notes.trim() : null,
      favourite: options.favourite === true,
      externalIds: { mal: Number(raw.externalId) },
    },
    warnings,
  };
}
