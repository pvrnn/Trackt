import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { SearchResultSchema, type MediaKind, type SearchResult } from '@trackt/shared';
import { http } from './runtime.js';

export interface MediaSearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Kept across reloads so the grid doesn't flicker while a new query is in flight. */
  results: SearchResult[];
  /** Whether the server holds another batch past the ones loaded. */
  hasMore: boolean;
  /** Appends the next batch; a no-op once `hasMore` is false or one is in flight. */
  loadMore: () => void;
  /** True only while a `loadMore` is in flight, never during the first batch. */
  loadingMore: boolean;
}

/** Results per search page: what the hook asks for and what a caller pages by. */
export const MEDIA_SEARCH_LIMIT = 30;

/**
 * Shortest query worth a request. Both surfaces that search sit behind a 60
 * req/min per-IP bucket, and one or two letters match half the catalog anyway —
 * callers show `idle` and say so rather than asking.
 */
export const MIN_MEDIA_SEARCH_QUERY = 3;

/** Mirrors `SearchQuerySchema`'s `offset` ceiling: a batch starting past it is refused. */
const MAX_SEARCH_OFFSET = 1000;

interface MediaSearchPage {
  /** The `offset` this batch was asked for, so the next one can follow from it. */
  offset: number;
  results: SearchResult[];
  hasMore: boolean;
}

/**
 * Instance-catalog search against `GET /api/v1/search`, backed by React Query.
 * The caller already debounces via the URL `?q=` sync, so `query` changes are
 * pre-debounced — no second timer here. A query shorter than
 * `MIN_MEDIA_SEARCH_QUERY` is `idle` with no request; `keepPreviousData` holds
 * the last grid while a new query loads, and React Query aborts superseded
 * requests via the `signal`, so stale responses can never overwrite newer ones.
 *
 * Batches accumulate rather than replace, so a caller can page by appending
 * (`loadMore`) instead of re-asking for everything it already shows. Ids are
 * deduplicated across batches: federation materializes central-only hits as it
 * serves them, so a later batch can legitimately contain a row an earlier one
 * already carried.
 */
export function useMediaSearch(query: string, kind?: MediaKind): MediaSearchState {
  const q = query.trim();
  const result = useInfiniteQuery({
    queryKey: ['search', q, kind],
    enabled: q.length >= MIN_MEDIA_SEARCH_QUERY,
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const searchParams: Record<string, string> = {
        q,
        limit: String(MEDIA_SEARCH_LIMIT),
        offset: String(pageParam),
      };
      if (kind) searchParams.kind = kind;
      const response = await http().get('search', { searchParams, signal });
      const page = SearchResultSchema.array().parse(await response.json());
      return {
        offset: pageParam,
        results: page.slice(0, MEDIA_SEARCH_LIMIT),
        hasMore: response.headers.get('x-has-more') === 'true',
      } satisfies MediaSearchPage;
    },
    getNextPageParam: (last): number | undefined => {
      if (!last.hasMore) return undefined;
      const next = last.offset + MEDIA_SEARCH_LIMIT;
      return next > MAX_SEARCH_OFFSET ? undefined : next;
    },
  });

  const status: MediaSearchState['status'] =
    q.length < MIN_MEDIA_SEARCH_QUERY
      ? 'idle'
      : result.isError
        ? 'error'
        : // A next batch in flight is not the grid reloading: callers keep the
          // batch they render and show their own "loading more" affordance.
          result.isPending || (result.isFetching && !result.isFetchingNextPage)
          ? 'loading'
          : 'success';

  const pages = result.data?.pages ?? [];
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  for (const page of pages) {
    for (const item of page.results) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      results.push(item);
    }
  }

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = result;
  const loadMore = () => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  };

  return {
    status,
    results,
    hasMore: hasNextPage,
    loadMore,
    loadingMore: isFetchingNextPage,
  };
}
