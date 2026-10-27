import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SearchResultSchema, type MediaKind, type SearchResult } from '@trackt/shared';
import { http } from './runtime.js';

export interface MediaSearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Kept across reloads so the grid doesn't flicker while a new query is in flight. */
  results: SearchResult[];
  hasMore: boolean;
}

/** Maximum supported by the search endpoints; the page renders this batch in pages. */
export const MEDIA_SEARCH_LIMIT = 30;

/**
 * Instance-catalog search against `GET /api/v1/search`, backed by React Query.
 * The caller already debounces via the URL `?q=` sync, so `query` changes are
 * pre-debounced — no second timer here. Empty query → idle with no request;
 * `keepPreviousData` holds the last grid while a new query loads, and React
 * Query aborts superseded requests via the `signal`, so stale responses can
 * never overwrite newer ones.
 */
export function useMediaSearch(query: string, kind?: MediaKind, pageIndex = 0): MediaSearchState {
  const q = query.trim();
  const result = useQuery({
    queryKey: ['search', q, kind, pageIndex],
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const searchParams: Record<string, string> = { q };
      if (kind) searchParams.kind = kind;
      searchParams.limit = String(MEDIA_SEARCH_LIMIT);
      searchParams.offset = String(pageIndex * MEDIA_SEARCH_LIMIT);
      const response = await http().get('search', { searchParams, signal });
      const page = SearchResultSchema.array().parse(await response.json());
      return {
        results: page.slice(0, MEDIA_SEARCH_LIMIT),
        hasMore: response.headers.get('x-has-more') === 'true',
      };
    },
  });

  const status: MediaSearchState['status'] =
    q === ''
      ? 'idle'
      : result.isError
        ? 'error'
        : result.isPending || result.isFetching
          ? 'loading'
          : 'success';

  return {
    status,
    results: result.data?.results ?? [],
    hasMore: result.data?.hasMore ?? false,
  };
}
