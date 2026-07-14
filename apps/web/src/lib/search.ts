import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SearchResultSchema, type MediaKind, type SearchResult } from '@trackt/shared';
import { api } from './http';

export interface MediaSearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Kept across reloads so the grid doesn't flicker while a new query is in flight. */
  results: SearchResult[];
}

/**
 * Instance-catalog search against `GET /api/v1/search`, backed by React Query.
 * The caller already debounces via the URL `?q=` sync, so `query` changes are
 * pre-debounced — no second timer here. Empty query → idle with no request;
 * `keepPreviousData` holds the last grid while a new query loads, and React
 * Query aborts superseded requests via the `signal`, so stale responses can
 * never overwrite newer ones.
 */
export function useMediaSearch(query: string, kind?: MediaKind): MediaSearchState {
  const q = query.trim();
  const result = useQuery({
    queryKey: ['search', q, kind],
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const searchParams: Record<string, string> = { q };
      if (kind) searchParams.kind = kind;
      const json = await api.get('search', { searchParams, signal }).json();
      return SearchResultSchema.array().parse(json);
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

  return { status, results: result.data ?? [] };
}
