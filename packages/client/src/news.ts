import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
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

/** The card's date stamp: `02 JUL`, in UTC so every reader sees the same day. */
export function formatNewsDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .toUpperCase();
}

export interface NewsFilters {
  kind?: MediaKind | undefined;
  topic?: NewsTopic | undefined;
  /** Inclusive ISO date bounds (YYYY-MM-DD). */
  from?: string | undefined;
  to?: string | undefined;
}

function toSearchParams(filters: NewsFilters): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value) params[key] = value;
  }
  return params;
}

export interface NewsFeedState {
  articles: NewsArticleSummary[];
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
  const query = useInfiniteQuery({
    queryKey: ['news', filters.kind, filters.topic, filters.from, filters.to],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) => {
      const searchParams = toSearchParams(filters);
      if (pageParam) searchParams.cursor = pageParam;
      const json = await http().get('news', { searchParams, signal }).json();
      return NewsListResponseSchema.parse(json);
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  return {
    updatedAt: query.dataUpdatedAt,
    articles: query.data?.pages.flatMap((page) => page.articles) ?? [],
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
export function useMediaNews(mediaId: string) {
  return useQuery({
    queryKey: ['news', 'by-media', mediaId],
    queryFn: async ({ signal }): Promise<NewsArticleSummary[]> => {
      const json = await http()
        .get('news/by-media', { searchParams: { id: mediaId }, signal })
        .json();
      return NewsListResponseSchema.parse(json).articles;
    },
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
