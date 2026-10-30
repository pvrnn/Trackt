import type { ImportPlan } from './plan.js';
import type { ImportSource } from './types.js';

/**
 * A plan, flattened for a file. The pipeline itself keeps nothing about a run —
 * an unmatched row writes no row anywhere — so a report is the only durable
 * record of what an import saw and what it did with it.
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
  /** Whether this instance carries the work at all. */
  matched: boolean;
  /** `external-id` is a fact, `title` is a fallback that matched, null is unmatched. */
  matchedBy: 'external-id' | 'title' | null;
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
      matched: row.target !== null,
      matchedBy: row.matchedBy,
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
  { header: 'matched', value: (row) => (row.matched ? 'yes' : 'no') },
  { header: 'matched_by', value: (row) => row.matchedBy },
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
