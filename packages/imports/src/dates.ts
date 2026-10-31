import { warning, type ImportWarning } from './types.js';

/**
 * A log date is a day (ADR-0007), so every provider's date has to survive the
 * same three rules: it must name a day, it must not be in the future, and a
 * finished date must not precede the start. Each departure is reported rather
 * than corrected quietly.
 */

interface DateRow {
  externalId: string | null;
  title: string | null;
}

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isFullDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Provider date parts → `YYYY-MM-DD`, or null when any part is missing. */
export function dateFromParts(
  parts: { year?: number | null; month?: number | null; day?: number | null } | null | undefined,
): string | null {
  if (!parts?.year || !parts.month || !parts.day) return null;
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  const value = `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
  return isFullDate(value) ? value : null;
}

/** The parts a provider actually stated — `2010`, `2010-05`, `2010-05-06`. */
export function formatDateParts(
  parts: { year?: number | null; month?: number | null; day?: number | null } | null | undefined,
): string | null {
  if (!parts?.year) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  const head = `${String(parts.year).padStart(4, '0')}`;
  if (!parts.month) return head;
  if (!parts.day) return `${head}-${pad(parts.month)}`;
  return `${head}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** A provider date string (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`) that must name a day. */
export function readFullDate(
  value: string | null | undefined,
  row: DateRow,
  field: 'start' | 'finish',
  warnings: ImportWarning[],
): string | null {
  if (!value) return null;
  if (!FULL_DATE.test(value) || !isFullDate(value)) {
    warnings.push(
      warning(
        'partial-date',
        row,
        `${field} date "${value}" is not a full day — a log date is a day, so it was left blank`,
      ),
    );
    return null;
  }
  return value;
}

export function applyDateRules(
  startedAt: string | null,
  finishedAt: string | null,
  row: DateRow,
  now: Date,
  warnings: ImportWarning[],
): { startedAt: string | null; finishedAt: string | null } {
  const today = now.toISOString().slice(0, 10);
  let start = startedAt;
  let finish = finishedAt;

  if (start && start > today) {
    warnings.push(warning('future-date', row, `start date ${start} is in the future — dropped`));
    start = null;
  }
  if (finish && finish > today) {
    warnings.push(warning('future-date', row, `finish date ${finish} is in the future — dropped`));
    finish = null;
  }
  if (start && finish && finish < start) {
    warnings.push(
      warning(
        'finish-before-start',
        row,
        `finish date ${finish} precedes start ${start} — finish dropped`,
      ),
    );
    finish = null;
  }
  return { startedAt: start, finishedAt: finish };
}
