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
    articles: query.data?.pages.flatMap((page) => page.articles) ?? [],
    isLoading: query.isPending,
    isError: query.isError,
    isLoadingMore: query.isFetchingNextPage,
    hasMore: query.hasNextPage,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
  };
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
