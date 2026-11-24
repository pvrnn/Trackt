import { LOG_STATUSES, MEDIA_KINDS, type LogStatus, type MediaKind } from '@trackt/shared';
import { HISTORY_GROUPINGS, type HistoryGrouping } from '@trackt/client';

/**
 * The history page's URL state, shared by `/users/$username/history` and the
 * legacy `/history` redirect, so an old link to a year still lands on that year.
 */

/** The URL's year: a number, or 'all'. Absent means the current year. */
export interface HistorySearchParams {
  year?: number | 'all';
  kind?: MediaKind;
  status?: LogStatus;
  /** How the list breaks into headed blocks. Absent means year. */
  group?: HistoryGrouping;
  /** Timeline or poster grid. Absent means timeline. */
  view?: HistoryViewMode;
}

export const HISTORY_VIEWS = ['timeline', 'grid'] as const;
export type HistoryViewMode = (typeof HISTORY_VIEWS)[number];

export const ALL_YEARS = 'all';
export const ALL_KINDS = 'all';
export const ALL_STATUSES = '';

/** Statuses a history row can actually have — a watchlist is not a history. */
export const HISTORY_STATUSES: LogStatus[] = LOG_STATUSES.filter((status) => status !== 'planned');

function asYear(value: unknown): number | 'all' | undefined {
  if (value === ALL_YEARS) return ALL_YEARS;
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 2999 ? year : undefined;
}

export function validateHistorySearch(search: Record<string, unknown>): HistorySearchParams {
  return {
    year: asYear(search.year),
    kind: MEDIA_KINDS.includes(search.kind as MediaKind) ? (search.kind as MediaKind) : undefined,
    status: HISTORY_STATUSES.includes(search.status as LogStatus)
      ? (search.status as LogStatus)
      : undefined,
    group: HISTORY_GROUPINGS.includes(search.group as HistoryGrouping)
      ? (search.group as HistoryGrouping)
      : undefined,
    view: HISTORY_VIEWS.includes(search.view as HistoryViewMode)
      ? (search.view as HistoryViewMode)
      : undefined,
  };
}
