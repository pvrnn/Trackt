import type { LogStatus } from '@trackt/shared';
import { applyDateRules, dateFromParts, formatDateParts } from '../dates.js';
import { warning, type ImportEntry, type ImportKind, type ImportWarning } from '../types.js';
import type { AniListDate, AniListListEntry } from './schemas.js';

/**
 * AniList's words to ours, closed on purpose like MAL's: an unknown status is
 * skipped with a warning rather than guessed at.
 *
 * `REPEATING` is a rewatch in progress — `in_progress` is exactly what that is,
 * and `repeat` already counts the passes before it.
 */
const STATUS_BY_ANILIST: Record<string, LogStatus> = {
  CURRENT: 'in_progress',
  REPEATING: 'in_progress',
  COMPLETED: 'completed',
  PLANNING: 'planned',
  DROPPED: 'dropped',
  PAUSED: 'paused',
};

function readDate(
  parts: AniListDate | null | undefined,
  row: { externalId: string | null; title: string | null },
  field: 'start' | 'finish',
  warnings: ImportWarning[],
): string | null {
  const day = dateFromParts(parts);
  if (day) return day;
  // AniList always sends the object, with nulls for the parts it does not know:
  // all-null is "no date", some-null is a date that has no day (ADR-0007).
  const stated = formatDateParts(parts);
  if (!stated) return null;
  warnings.push(
    warning(
      'partial-date',
      row,
      `${field} date "${stated}" is not a full day — a log date is a day, so it was left blank`,
    ),
  );
  return null;
}

function readScore(
  score: number | null | undefined,
  row: { externalId: string | null; title: string | null },
  warnings: ImportWarning[],
): number | null {
  const raw = score ?? 0;
  // AniList's 0 is its "not scored" sentinel, not a rating of zero.
  if (raw <= 0) return null;
  if (!Number.isFinite(raw) || raw > 100) {
    warnings.push(
      warning('score-invalid', row, `score ${raw} is outside AniList's 0–100 range — dropped`),
    );
    return null;
  }
  // Trackt rates 0–10; a provider's half-point has no place to land.
  return Math.min(10, Math.max(1, Math.round(raw / 10)));
}

function wholeCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export interface MapOptions {
  /** Injected so the future-date rule is testable. */
  now?: Date;
}

/**
 * One AniList row → one import entry, or nothing when the row cannot be read.
 * Every departure from the source is recorded as a warning rather than
 * silently corrected.
 */
export function mapAniListEntry(
  kind: ImportKind,
  raw: AniListListEntry,
  options: MapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const media = raw.media;
  const title = media?.title?.english ?? media?.title?.romaji ?? null;
  const externalId = String(raw.mediaId);
  const row = { externalId, title };

  if (!media || !title) {
    warnings.push(
      warning(
        'malformed-row',
        row,
        `AniList entry for media ${raw.mediaId} names no work — row skipped`,
      ),
    );
    return { entry: null, warnings };
  }

  const mapped = STATUS_BY_ANILIST[raw.status];
  if (!mapped) {
    warnings.push(
      warning('unknown-status', row, `unknown ${kind} status "${raw.status}" — row skipped`),
    );
    return { entry: null, warnings };
  }

  const score = readScore(raw.score, row, warnings);
  const { startedAt, finishedAt } = applyDateRules(
    readDate(raw.startedAt, row, 'start', warnings),
    readDate(raw.completedAt, row, 'finish', warnings),
    row,
    options.now ?? new Date(),
    warnings,
  );

  return {
    entry: {
      source: 'anilist',
      kind,
      externalId,
      title,
      year: media.seasonYear ?? null,
      seasonNumber: null,
      status: mapped,
      score,
      progress: wholeCount(raw.progress),
      repeats: wholeCount(raw.repeat),
      startedAt,
      finishedAt,
      notes: raw.notes?.trim() ? raw.notes.trim() : null,
      externalIds: { anilist: media.id, ...(media.idMal ? { mal: media.idMal } : {}) },
    },
    warnings,
  };
}
