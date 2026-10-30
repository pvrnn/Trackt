import type { LogStatus } from '@trackt/shared';
import { applyDateRules, readFullDate } from '../dates.js';
import { warning, type ImportEntry, type ImportKind, type ImportWarning } from '../types.js';
import type { MalListEntry, MalListStatus } from './schemas.js';

/**
 * MAL's words to ours. Deliberately a closed map rather than a fallback: an
 * unknown status is skipped with a warning, because guessing at "reading" vs
 * "in_progress" is how a whole list lands in the wrong bucket.
 */
const STATUS_BY_MAL: Partial<Record<ImportKind, Record<string, LogStatus>>> = {
  anime: {
    watching: 'in_progress',
    completed: 'completed',
    on_hold: 'paused',
    dropped: 'dropped',
    plan_to_watch: 'planned',
  },
  manga: {
    reading: 'in_progress',
    completed: 'completed',
    on_hold: 'paused',
    dropped: 'dropped',
    plan_to_read: 'planned',
  },
};

function readScore(
  status: MalListStatus,
  row: { externalId: string | null; title: string | null },
  warnings: ImportWarning[],
): number | null {
  const score = status.score ?? 0;
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

function wholeCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export interface MapOptions {
  /** Injected so the future-date rule is testable. */
  now?: Date;
}

/**
 * One MAL row → one import entry, or nothing when the row cannot be read.
 * Every departure from the source is recorded as a warning rather than
 * silently corrected.
 */
export function mapMalEntry(
  kind: ImportKind,
  raw: MalListEntry,
  options: MapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const { node, list_status: status } = raw;
  const externalId = String(node.id);
  const row = { externalId, title: node.title };
  const warnings: ImportWarning[] = [];

  const mapped = STATUS_BY_MAL[kind]?.[status.status];
  if (!mapped) {
    warnings.push(
      warning('unknown-status', row, `unknown ${kind} status "${status.status}" — row skipped`),
    );
    return { entry: null, warnings };
  }

  const score = readScore(status, row, warnings);
  const { startedAt, finishedAt } = applyDateRules(
    readFullDate(status.start_date, row, 'start', warnings),
    readFullDate(status.finish_date, row, 'finish', warnings),
    row,
    options.now ?? new Date(),
    warnings,
  );

  const progress = wholeCount(
    kind === 'anime' ? status.num_episodes_watched : status.num_chapters_read,
  );
  if (kind === 'manga' && progress === 0 && wholeCount(status.num_volumes_read) > 0) {
    // Volume-only tracking cannot be turned into chapters: the catalog carries a
    // volume count but no per-volume chapter boundaries (see ROADMAP).
    warnings.push(
      warning(
        'volume-only-progress',
        row,
        `only ${status.num_volumes_read} volume(s) read — chapter progress left at 0`,
      ),
    );
  }

  const repeats = wholeCount(
    kind === 'anime' ? status.num_times_rewatched : status.num_times_reread,
  );

  return {
    entry: {
      source: 'mal',
      kind,
      externalId,
      title: node.title,
      year: null,
      seasonNumber: null,
      status: mapped,
      score,
      progress,
      repeats,
      startedAt,
      finishedAt,
      notes: status.comments?.trim() ? status.comments.trim() : null,
      externalIds: { mal: node.id },
    },
    warnings,
  };
}
