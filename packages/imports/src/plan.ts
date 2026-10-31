import { PART_KIND_BY_MEDIA } from '@trackt/shared';
import { entryKey, type ImportTarget } from './resolve.js';
import type { UncertainMatch } from './uncertain.js';
import { warning, type ImportEntry, type ImportSource, type ImportWarning } from './types.js';

/**
 * What an import *would* do, computed without writing anything — the shape a
 * dry run prints and (later) a preview screen renders. Applying is a separate
 * step so the same plan can be inspected first.
 */
export interface ImportPlanRow {
  entry: ImportEntry;
  /** Null when neither this instance nor the central catalog carries the work. */
  target: ImportTarget | null;
  /** How the entry found its row; null when unmatched. */
  matchedBy: 'external-id' | 'title' | 'catalog' | null;
  /** 0–1 when the row was guessed by title, null when an id pinned it. */
  matchScore: number | null;
  /**
   * Unmatched only: what the score could not settle — a shortlist above
   * `UNCERTAIN_FLOOR`, or the rows that tied. Stored for a picker, and its top
   * candidate is what the report calls the near miss.
   */
  uncertain: UncertainMatch | null;
  /** The viewer already logs this work; left alone unless the run overwrites. */
  existing: boolean;
  /** Progress position the import will write, after clamping to what the catalog knows. */
  upTo: number;
  warnings: ImportWarning[];
}

export interface ImportPlan {
  source: ImportSource;
  profile: string;
  rows: ImportPlanRow[];
  warnings: ImportWarning[];
  summary: {
    total: number;
    matched: number;
    unmatched: number;
    existing: number;
    /** Matched and not yet logged: what a non-overwriting run writes. */
    pending: number;
    /** Of `matched`, the rows the central catalog supplied (materialized by this run). */
    fromCatalog: number;
    /** Matched rows the provider pinned as a favourite — written even when already logged. */
    favourites: number;
    warnings: number;
  };
}

export interface BuildPlanInput {
  source: ImportSource;
  profile: string;
  entries: ImportEntry[];
  targets: Map<string, ImportTarget>;
  /** Local media ids the viewer already has a log row for. */
  loggedMediaIds: Set<string>;
  /** Warnings the mapper produced, keyed by `entryKey`. */
  entryWarnings?: Map<string, ImportWarning[]>;
  /** Warnings resolution produced (duplicate provider ids, ambiguous titles). */
  warnings?: ImportWarning[];
  /** Per entry, the shortlist the score could not settle (see `ImportPlanRow.uncertain`). */
  uncertain?: Map<string, UncertainMatch>;
}

/**
 * `completed` means every part is seen (PRD §3.1), so it writes the catalog's
 * total rather than the provider's count — a MAL list that says 12/12 for a
 * show the catalog knows as 13 episodes is a disagreement about the total, not
 * a request to leave one episode unchecked.
 *
 * A work the catalog states no total for (an ongoing manga) keeps the
 * provider's number: there is no ceiling to clamp to, and refusing the progress
 * would silently drop the one fact the import exists to carry.
 */
function progressFor(entry: ImportEntry, target: ImportTarget, warnings: ImportWarning[]): number {
  if (PART_KIND_BY_MEDIA[target.kind] === null) return 0;
  // `planned` already means "nothing has happened" — the log row is the record.
  if (entry.status === 'planned') return 0;

  const total = target.partCount;
  if (total === null || total <= 0) return entry.progress;
  if (entry.status === 'completed') return total;

  if (entry.progress > total) {
    warnings.push(
      warning(
        'progress-clamped',
        { externalId: entry.externalId, title: entry.title },
        `${entry.progress} seen but the catalog states ${total} — clamped`,
      ),
    );
    return total;
  }
  return entry.progress;
}

/**
 * A work with no parts is seen in one sitting, so its two log dates are one
 * day: a provider that states only one of them states the other too. Sources
 * that already say so stay untouched, and a part-carrying work (a season, a
 * manga) keeps whatever the provider published — a run of episodes really can
 * span weeks.
 *
 * This lives in the plan rather than in each mapper because the preview reads
 * it: a preview that showed a film starting today and never finishing would be
 * describing a log the run does not write.
 */
export function datesForTarget(entry: ImportEntry, target: ImportTarget): ImportEntry {
  if (PART_KIND_BY_MEDIA[target.kind] !== null) return entry;
  const day = entry.startedAt ?? entry.finishedAt;
  if (!day || (entry.startedAt !== null && entry.finishedAt !== null)) return entry;
  return { ...entry, startedAt: day, finishedAt: day };
}

export function buildImportPlan(input: BuildPlanInput): ImportPlan {
  const rows: ImportPlanRow[] = [];
  let matched = 0;
  let existing = 0;

  for (const rawEntry of input.entries) {
    const key = entryKey(rawEntry);
    const target = input.targets.get(key) ?? null;
    const entry = target ? datesForTarget(rawEntry, target) : rawEntry;
    const rowWarnings = [...(input.entryWarnings?.get(key) ?? [])];
    const isExisting = target ? input.loggedMediaIds.has(target.id) : false;

    const upTo = target ? progressFor(entry, target, rowWarnings) : 0;
    if (target) matched += 1;
    if (isExisting) existing += 1;

    rows.push({
      entry,
      target,
      matchedBy: target?.matchedBy ?? null,
      matchScore: target?.matchScore ?? null,
      uncertain: target ? null : (input.uncertain?.get(key) ?? null),
      existing: isExisting,
      upTo,
      warnings: rowWarnings,
    });
  }

  const warnings = [...(input.warnings ?? []), ...rows.flatMap((row) => row.warnings)];

  return {
    source: input.source,
    profile: input.profile,
    rows,
    // Unmatched rows carry no warning *code* of their own; the count is in the
    // summary. Keeping them out of `warnings` avoids a 200-line wall of "not in
    // the catalog" in a normal first import.
    warnings,
    summary: {
      total: rows.length,
      matched,
      unmatched: rows.length - matched,
      existing,
      pending: matched - existing,
      fromCatalog: rows.filter((row) => row.target?.matchedBy === 'catalog' && !row.existing)
        .length,
      favourites: rows.filter((row) => row.target !== null && row.entry.favourite).length,
      warnings: warnings.length,
    },
  };
}

export function unmatchedTitles(plan: ImportPlan): { externalId: string; title: string }[] {
  return plan.rows
    .filter((row) => row.target === null)
    .map((row) => ({ externalId: row.entry.externalId, title: row.entry.title }));
}
