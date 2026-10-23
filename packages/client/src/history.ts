import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import {
  HistoryPageSchema,
  seasonOf,
  type HistoryEntry,
  type HistoryTotals,
  type LogStatus,
  type MediaKind,
} from '@trackt/shared';
import { http, useIsAuthed } from './runtime.js';

/**
 * History data layer (ADR-0007). Keyset cursors are opaque and strictly
 * forward, which maps onto `useInfiniteQuery`'s append-only page list — the
 * same shape `news.ts` uses, for the same reason.
 */

export interface HistoryFilters {
  /** Undefined = all time. */
  year?: number | undefined;
  kind?: MediaKind | undefined;
  status?: LogStatus | undefined;
}

export const historyKey = (filters: HistoryFilters) =>
  ['history', filters.year ?? 'all', filters.kind, filters.status] as const;

export interface HistoryState {
  entries: HistoryEntry[];
  /** Every year the viewer has anything in, newest first. Never year-filtered. */
  years: { year: number; count: number }[];
  totals: HistoryTotals;
  isLoading: boolean;
  isError: boolean;
  /** True while a "load more" page is in flight. */
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /**
   * When this data was last successfully fetched, as an epoch millisecond
   * stamp — 0 while nothing has landed. Mobile shows it as the age of a cache
   * it is serving offline (mobile plan, phase 5); web has no use for it yet.
   */
  updatedAt: number;
}

const EMPTY_TOTALS: HistoryTotals = { titles: 0, completed: 0, episodes: 0, chapters: 0 };

export function useHistory(filters: HistoryFilters): HistoryState {
  const isAuthed = useIsAuthed();
  const query = useInfiniteQuery({
    queryKey: historyKey(filters),
    enabled: isAuthed,
    initialPageParam: undefined as string | undefined,
    // Switching year re-fetches; without this the whole page blanks between
    // the click and the response, including the year chips you clicked from.
    placeholderData: keepPreviousData,
    queryFn: async ({ pageParam, signal }) => {
      const searchParams: Record<string, string> = {};
      if (filters.year !== undefined) searchParams.year = String(filters.year);
      if (filters.kind) searchParams.kind = filters.kind;
      if (filters.status) searchParams.status = filters.status;
      if (pageParam) searchParams.cursor = pageParam;
      const json = await http().get('me/history', { searchParams, signal }).json();
      return HistoryPageSchema.parse(json);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // The facets and totals describe the whole filtered set, not one page, so the
  // first page is the authority — later pages repeat them unchanged.
  const first = query.data?.pages[0];
  return {
    updatedAt: query.dataUpdatedAt,
    entries: query.data?.pages.flatMap((page) => page.entries) ?? [],
    years: first?.years ?? [],
    totals: first?.totals ?? EMPTY_TOTALS,
    isLoading: query.isPending,
    isError: query.isError,
    isLoadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
}

/* ------------------------------------------------------------------ *
 * Pure display helpers — the framework-free half, and where the
 * off-by-one bugs live.
 * ------------------------------------------------------------------ */

/** Today in UTC — the same day the server stamps with `CURRENT_DATE`. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** UTC midnight for an ISO date, so formatting cannot shift the day. */
function utcDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/** '2026-02-11' → '11 FEB' (or '11 FÉVR.' with `fr`). */
export function shortDate(isoDate: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(utcDate(isoDate))
    .toLocaleUpperCase(locale);
}

/**
 * The span a log covers, as the media page's pill and the history row both show
 * it: '04 JAN → 11 FEB' when both dates exist, the bare day when they're equal
 * (a film watched in one sitting), 'FROM 04 JAN' while it's still open, and
 * 'UNTIL 11 FEB' in the odd case where only a finish date was typed in.
 *
 * The words are English: web composes its own from translated keys and
 * `shortDate`, because "FROM"/"UNTIL" are copy, not formatting.
 */
export function dateRangeLabel(startedAt: string | null, finishedAt: string | null): string | null {
  if (startedAt === null && finishedAt === null) return null;
  if (startedAt === null) return `UNTIL ${shortDate(finishedAt!)}`;
  if (finishedAt === null) return `FROM ${shortDate(startedAt)}`;
  if (startedAt === finishedAt) return shortDate(startedAt);
  return `${shortDate(startedAt)} → ${shortDate(finishedAt)}`;
}

/** How the list breaks into headed blocks. Month is the default reading. */
export const HISTORY_GROUPINGS = ['year', 'season', 'month'] as const;
export type HistoryGrouping = (typeof HISTORY_GROUPINGS)[number];

export interface HistoryGroup {
  /** 'YYYY' / 'YYYY-summer' / 'YYYY-MM' — stable across renders, and the React key. */
  key: string;
  /** 'FEBRUARY', or 'FEBRUARY 2026' when the list spans years. */
  label: string;
  entries: HistoryEntry[];
}

/** Translated season names, when the caller has a catalog. */
export type HistorySeasonLabels = Record<string, string>;

/** The block one entry belongs to, under a given grouping. */
function blockOf(
  loggedOn: string,
  grouping: HistoryGrouping,
  withYear: boolean,
  locale: string,
  seasonLabels: HistorySeasonLabels,
): { key: string; label: string } {
  const year = loggedOn.slice(0, 4);
  if (grouping === 'year') return { key: year, label: year };
  if (grouping === 'season') {
    const season = seasonOf(loggedOn);
    const label = seasonLabels[season] ?? season.toLocaleUpperCase(locale);
    return { key: `${year}-${season.toUpperCase()}`, label: withYear ? `${label} ${year}` : label };
  }
  const month = new Intl.DateTimeFormat(locale, {
    month: 'long',
    timeZone: 'UTC',
  })
    .format(utcDate(loggedOn))
    .toLocaleUpperCase(locale);
  return { key: loggedOn.slice(0, 7), label: withYear ? `${month} ${year}` : month };
}

/**
 * Split an already-sorted page into headed blocks. The server sends one ordered
 * stream and a heading is a rendering concern, so the grouping lives here rather
 * than in the response shape — which is also why changing it costs no request.
 *
 * Consecutive-run grouping rather than a keyed bucket: year, season and month
 * are all monotonic in `loggedOn`, and the stream arrives sorted by it, so equal
 * keys are always adjacent. That keeps the server's order exactly.
 *
 * `withYear` is set when no year filter is active: 'FEBRUARY' twice in one
 * scroll is ambiguous once the list spans 2026 and 2025.
 */
export function groupEntries(
  entries: HistoryEntry[],
  grouping: HistoryGrouping,
  withYear: boolean,
  locale = 'en-GB',
  seasonLabels: HistorySeasonLabels = {},
): HistoryGroup[] {
  const groups: HistoryGroup[] = [];
  for (const entry of entries) {
    const block = blockOf(entry.loggedOn, grouping, withYear, locale, seasonLabels);
    let group = groups.at(-1);
    if (!group || group.key !== block.key) {
      group = { ...block, entries: [] };
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}
