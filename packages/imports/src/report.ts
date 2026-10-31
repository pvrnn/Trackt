import type { ImportPlan } from './plan.js';
import type { ImportSource } from './types.js';

/**
 * A plan, flattened for a file. The pipeline itself keeps nothing about a run —
 * an unmatched row writes no row anywhere — so a report is the only durable
 * record of what an import saw and what it did with it.
 *
 * It carries the plan's *warnings* and each guess's *score* for the same
 * reason: "not in the catalog" and "two rows scored alike" are different
 * answers, and a file that cannot tell them apart sends someone hunting for a
 * title the instance already carries.
 */

export interface PlanReportRow {
  externalId: string;
  title: string;
  year: number | null;
  seasonNumber: number | null;
  kind: string;
  status: string;
  score: number | null;
  progress: number;
  repeats: number;
  startedAt: string | null;
  finishedAt: string | null;
  notes: string | null;
  /** The provider pinned it (Letterboxd's diary "Like"). */
  favourite: boolean;
  /** Whether this instance carries the work at all. */
  matched: boolean;
  /** `external-id` is a fact, `title` a fallback, `catalog` a pull from the central catalog. */
  matchedBy: 'external-id' | 'title' | 'catalog' | null;
  /** 0–1 when the row was guessed by title; null when an id pinned it. */
  matchScore: number | null;
  /** Unmatched only: how close the best rejected candidate came, and its title. */
  closestScore: number | null;
  closestTitle: string | null;
  /**
   * What the provider said about where the work is from, kept so a replay
   * matches as well as the run that wrote it (a country can break a tie).
   */
  originCountry: string[] | null;
  /** The catalog row's title, once matched — so a title match can be checked by eye. */
  mediaTitle: string | null;
  warnings: { code: string; message: string }[];
}

export interface PlanReport {
  source: ImportSource;
  profile: string;
  /** ISO instant. */
  generatedAt: string;
  /** False for a dry run: the rows were planned, not written. */
  applied: boolean;
  summary: ImportPlan['summary'];
  /** Plan-level warnings — ambiguous matches, partial sources, capped lookups. */
  warnings: { code: string; message: string }[];
  rows: PlanReportRow[];
}

export interface BuildReportOptions {
  applied?: boolean;
  now?: Date;
}

export function buildPlanReport(plan: ImportPlan, options: BuildReportOptions = {}): PlanReport {
  return {
    source: plan.source,
    profile: plan.profile,
    generatedAt: (options.now ?? new Date()).toISOString(),
    applied: options.applied ?? false,
    summary: plan.summary,
    warnings: plan.warnings.map((w) => ({ code: w.code, message: w.message })),
    rows: plan.rows.map((row) => ({
      externalId: row.entry.externalId,
      title: row.entry.title,
      year: row.entry.year,
      seasonNumber: row.entry.seasonNumber,
      kind: row.entry.kind,
      status: row.entry.status,
      score: row.entry.score,
      progress: row.entry.progress,
      repeats: row.entry.repeats,
      startedAt: row.entry.startedAt,
      finishedAt: row.entry.finishedAt,
      notes: row.entry.notes,
      favourite: row.entry.favourite,
      matched: row.target !== null,
      matchedBy: row.matchedBy,
      matchScore: row.matchScore,
      closestScore: row.uncertain?.candidates[0]?.score ?? null,
      closestTitle: row.uncertain?.candidates[0]?.title ?? null,
      originCountry: row.entry.originCountry ? [...row.entry.originCountry] : null,
      mediaTitle: row.target?.title ?? null,
      warnings: row.warnings.map((w) => ({ code: w.code, message: w.message })),
    })),
  };
}

/** Field safe for a comma-separated file: quotes doubled, newlines flattened. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n/g, ' ');
  return /[",]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const CSV_COLUMNS: { header: string; value: (row: PlanReportRow) => string | number | null }[] = [
  { header: 'external_id', value: (row) => row.externalId },
  { header: 'title', value: (row) => row.title },
  { header: 'year', value: (row) => row.year },
  { header: 'kind', value: (row) => row.kind },
  { header: 'status', value: (row) => row.status },
  { header: 'score', value: (row) => row.score },
  { header: 'progress', value: (row) => row.progress },
  { header: 'favourite', value: (row) => (row.favourite ? 'yes' : 'no') },
  { header: 'matched', value: (row) => (row.matched ? 'yes' : 'no') },
  { header: 'matched_by', value: (row) => row.matchedBy },
  { header: 'match_score', value: (row) => row.matchScore?.toFixed(2) ?? null },
  { header: 'closest_score', value: (row) => row.closestScore?.toFixed(2) ?? null },
  { header: 'closest_title', value: (row) => row.closestTitle },
  { header: 'media_title', value: (row) => row.mediaTitle },
  { header: 'started_at', value: (row) => row.startedAt },
  { header: 'finished_at', value: (row) => row.finishedAt },
  { header: 'warnings', value: (row) => row.warnings.map((w) => w.code).join(' ') },
];

/** The same rows as one CSV line each — what a spreadsheet can re-check. */
export function planReportCsv(report: PlanReport): string {
  const lines = [CSV_COLUMNS.map((column) => column.header).join(',')];
  for (const row of report.rows) {
    lines.push(CSV_COLUMNS.map((column) => cell(column.value(row))).join(','));
  }
  return `${lines.join('\n')}\n`;
}
