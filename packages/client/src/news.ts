import { queryOptions, useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  MEDIA_KINDS,
  NewsArticleDetailSchema,
  NewsListResponseSchema,
  type MediaKind,
  type NewsArticleSummary,
  type NewsTopic,
} from '@trackt/shared';
import { errorStatus } from './http.js';
import { http } from './runtime.js';

/**
 * News reads against the instance API (ADR-0005), which proxies the central
 * catalog. The feed degrades to empty rather than erroring, so a `success` with
 * no articles is a normal state here — the page says so in words rather than
 * showing a failure.
 */

/** Topic labels as the design writes them: short, uppercase, on a tag pill. */
export const TOPIC_LABELS: Record<NewsTopic, string> = {
  announcement: 'ANNOUNCED',
  renewal: 'NEW SEASON',
  cancellation: 'CANCELLED',
  release_date: 'RELEASE DATE',
  trailer: 'TRAILER',
  casting: 'CASTING',
  adaptation: 'ADAPTATION',
  award: 'AWARD',
  general: 'NEWS',
};

/**
 * The card's date stamp: `02 JUL`, in UTC so every reader sees the same day.
 * `locale` is trailing and defaults to `en-GB`, so mobile keeps its copy.
 */
export function formatNewsDate(iso: string, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(iso))
    .toLocaleUpperCase(locale);
}

export interface NewsFilters {
  /** Empty or absent means every kind; the API takes them as one CSV. */
  kinds?: MediaKind[] | undefined;
  topic?: NewsTopic | undefined;
  /** Inclusive ISO date bounds (YYYY-MM-DD). */
  from?: string | undefined;
  to?: string | undefined;
  /** Stories per request; the server's default when absent. */
  limit?: number | undefined;
}

function toSearchParams(filters: NewsFilters): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (Array.isArray(value)) {
      if (value.length > 0) params[key] = value.join(',');
    } else if (value) {
      params[key] = String(value);
    }
  }
  return params;
}

export interface NewsFeedState {
  articles: NewsArticleSummary[];
  /** The articles of each page fetched so far, in order. */
  pages: NewsArticleSummary[][];
  /**
   * The feed's size and per-kind counts, from its first page. Undefined while
   * loading or when the catalog does not count; `kinds` holds only kinds this
   * build knows.
   */
  facets: { total: number; anyKind: number; kinds: Partial<Record<MediaKind, number>> } | undefined;
  /** Fetches forward until `count` pages are loaded or the feed ends. */
  loadPages: (count: number) => void;
  isLoading: boolean;
  isError: boolean;
  /** True while a "load more" page is in flight. */
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  /**
  /**
   * When this data was last successfully fetched, as an epoch millisecond
   * stamp — 0 while nothing has landed. Mobile shows it as the age of a cache
   * it is serving offline (mobile plan, phase 5); web has no use for it yet.
   */
  updatedAt: number;
  /**
   * Pull-to-refresh. Re-fetches every page loaded so far rather than just the
   * first: the feed is keyset-paged and strictly forward, so dropping back to
   * one page would silently discard everything the reader had already scrolled
   * past.
   */
  refresh: () => void;
  isRefreshing: boolean;
}

/**
 * The paginated feed. Keyset cursors are opaque and strictly forward, which maps
 * exactly onto `useInfiniteQuery`'s append-only page list — there is no
 * `getPreviousPageParam` because the contract cannot page backwards.
 */
export function useNewsFeed(filters: NewsFilters): NewsFeedState {
  const queryKey = [
    'news',
    // Sorted so two orderings of the same selection are one cache entry.
    [...(filters.kinds ?? [])].sort().join(',') || undefined,
    filters.topic,
    filters.from,
    filters.to,
    filters.limit,
  ];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const searchParams = toSearchParams(filters);
      if (pageParam) searchParams.cursor = pageParam;
      const json = await http().get('news', { searchParams, signal }).json();
      return NewsListResponseSchema.parse(json);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const raw = query.data?.pages[0]?.facets;
  const facets = raw
    ? {
        total: raw.total,
        anyKind: raw.anyKind,
        kinds: Object.fromEntries(
          MEDIA_KINDS.filter((kind) => raw.kinds[kind] !== undefined).map((kind) => [
            kind,
            raw.kinds[kind],
          ]),
        ) as Partial<Record<MediaKind, number>>,
      }
    : undefined;
  const loaded = query.data?.pages.length ?? 0;

  // A numbered page is the Nth cursor hop: walk forward one page per render
  // until the asked-for page is in, so the keyset contract never becomes OFFSET.
  // Scoped to the filters: a new feed starts again from its first page.
  const feedKey = JSON.stringify(queryKey);
  const [target, setTarget] = useState({ feedKey, count: 1 });
  const wanted = target.feedKey === feedKey ? target.count : 1;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  // Stable, and a no-op when nothing changes: callers ask for a page from an effect.
  const loadPages = useCallback(
    (count: number) =>
      setTarget((current) => {
        const next = Math.max(current.feedKey === feedKey ? current.count : 1, count);
        return current.feedKey === feedKey && current.count === next
          ? current
          : { feedKey, count: next };
      }),
    [feedKey],
  );
  useEffect(() => {
    if (loaded > 0 && loaded < wanted && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [loaded, wanted, hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    updatedAt: query.dataUpdatedAt,
    articles: query.data?.pages.flatMap((page) => page.articles) ?? [],
    pages: query.data?.pages.map((page) => page.articles) ?? [],
    facets,
    loadPages,
    isLoading: query.isPending,
    isError: query.isError,
    isLoadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    refresh: () => {
      void query.refetch();
    },
    // `isRefetching` is also true while a *next* page is loading, and a
    // pull-to-refresh spinner that appears when the reader hits the bottom of
    // the list is a lie about what is happening.
    isRefreshing: query.isRefetching && !query.isFetchingNextPage,
  };
}

/**
 * Recent articles touching one work — the media detail page's "In the news"
 * strip. Summaries only; each links out to the article.
 *
 * Never paged, so a plain `useQuery` rather than the feed's infinite one, and
 * the API degrades a dead catalog to an empty list here too: a work with no
 * news and an instance whose catalog is down look the same, which is what lets
 * the caller simply omit the section.
 */
function mediaNewsQuery(mediaId: string) {
  return queryOptions({
    queryKey: ['news', 'by-media', mediaId],
    queryFn: async ({ signal }): Promise<NewsArticleSummary[]> => {
      const json = await http()
        .get('news/by-media', { searchParams: { id: mediaId }, signal })
        .json();
      return NewsListResponseSchema.parse(json).articles;
    },
  });
}

export function useMediaNews(mediaId: string) {
  return useQuery(mediaNewsQuery(mediaId));
}

/** Newest first, and one copy of a story that touches several of the works. */
export function mergeNewsLists(
  lists: readonly (readonly NewsArticleSummary[])[],
  limit: number,
): NewsArticleSummary[] {
  const byId = new Map<string, NewsArticleSummary>();
  for (const list of lists) for (const article of list) byId.set(article.id, article);
  return [...byId.values()]
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .slice(0, limit);
}

/**
 * News about a handful of works the viewer tracks — mobile home's "from what
 * you track". There is no per-viewer feed endpoint, so this is one by-media read
 * per work (sharing the media page's cache entries): keep `mediaIds` short, the
 * route is rate-limited.
 */
export function useTrackedNews(mediaIds: readonly string[], limit: number) {
  return useQueries({
    queries: mediaIds.map(mediaNewsQuery),
    combine: (results) => ({
      articles: mergeNewsLists(
        results.map((result) => result.data ?? []),
        limit,
      ),
      isPending: results.some((result) => result.isPending),
      refetch: () => {
        for (const result of results) void result.refetch();
      },
    }),
  });
}

export function useNewsArticle(slug: string) {
  return useQuery({
    queryKey: ['news', 'article', slug],
    queryFn: async ({ signal }) => {
      const json = await http()
        .get(`news/${encodeURIComponent(slug)}`, { signal })
        .json();
      return NewsArticleDetailSchema.parse(json);
    },
    // A missing article is a permanent answer; retrying it just delays the 404.
    // A 503 is the degraded-catalog case and *is* worth retrying.
    retry: (failureCount, error) => {
      if (errorStatus(error) === 404) return false;
      return failureCount < 2;
    },
  });
}
