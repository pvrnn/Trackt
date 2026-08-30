import { todayIso, useNewsFeed } from '@trackt/client';
import { MEDIA_KINDS, type MediaKind } from '@trackt/shared';
import { useMemo } from 'react';

/** The four date windows the feed filter offers. */
export const WINDOWS = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'week', label: 'This week', days: 7 },
  { key: 'month', label: 'This month', days: 30 },
  { key: 'all', label: 'All time', days: null },
] as const;

export type WindowKey = (typeof WINDOWS)[number]['key'];

/** `days` before today, as the ISO date the feed's `from` bound takes. */
export function windowStart(days: number): string {
  const start = new Date(`${todayIso()}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString().slice(0, 10);
}

/**
 * The story count each window would show.
 *
 * The feed is keyset-paginated and returns no totals, so the counts come from
 * the *unbounded* feed for the current kinds — the same query key ALL TIME
 * uses, so selecting it costs no extra request. A count is exact when the
 * loaded prefix already reaches past that window's start; otherwise it is a
 * floor, printed with a `+`.
 */
export function useWindowCounts(kinds: MediaKind[]): Record<WindowKey, string> {
  const { articles, hasMore } = useNewsFeed({ kinds: kindsFilter(kinds) });

  return useMemo(() => {
    const oldest = articles.at(-1)?.publishedAt.slice(0, 10);
    const counts = {} as Record<WindowKey, string>;
    for (const entry of WINDOWS) {
      if (entry.days === null) {
        counts[entry.key] = storyCount(articles.length, hasMore);
        continue;
      }
      const start = windowStart(entry.days);
      const inWindow = articles.filter((article) => article.publishedAt.slice(0, 10) >= start);
      const partial = hasMore && !(oldest !== undefined && oldest < start);
      counts[entry.key] = storyCount(inWindow.length, partial);
    }
    return counts;
  }, [articles, hasMore]);
}

/**
 * The selection as the feed takes it: ALL KINDS is the *absence* of a filter,
 * which shares its cache entry with the feed a reader who never opened the menu
 * is already looking at.
 */
export function kindsFilter(kinds: MediaKind[]): MediaKind[] {
  return everyKind(kinds) ? [] : kinds;
}

/** True for ALL KINDS, and for the hand-assembled equivalent. */
export function everyKind(kinds: MediaKind[]): boolean {
  return kinds.length === 0 || kinds.length === MEDIA_KINDS.length;
}

/** "8 STORIES", or "20+ STORIES" when the feed has pages nobody has asked for. */
export function storyCount(n: number, partial: boolean): string {
  const noun = n === 1 && !partial ? 'story' : 'stories';
  return `${n}${partial ? '+' : ''} ${noun}`;
}
