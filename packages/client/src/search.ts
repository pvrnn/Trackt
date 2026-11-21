import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  SearchGenresSchema,
  SearchKindCountsSchema,
  SearchResultSchema,
  type MediaKind,
  type SearchResult,
  type SearchSort,
  type StatusFilter,
} from '@trackt/shared';
import { http } from './runtime.js';

export interface MediaSearchState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Kept across reloads so the grid doesn't flicker while a new query is in flight. */
  results: SearchResult[];
  /**
   * `results` belongs to the previous query key while this one loads
   * (`keepPreviousData`), not to the key now being asked for.
   */
  isPlaceholder: boolean;
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

/**
 * Oldest year Discover's year pill offers. The catalog's silent-era films sit
 * above it, and a bound keeps a hand-typed `?year=` from asking for a nonsense
 * century.
 */
export const SEARCH_YEAR_FLOOR = 1900;

/**
 * Every year from next year (announced releases) down to `SEARCH_YEAR_FLOOR`,
 * newest first. Static rather than a facet of what an instance holds: a fresh
 * self-host has materialized almost nothing, and the central catalog answers
 * for the years it hasn't. Both Discover screens build the same pill from it.
 */
export const SELECTABLE_YEARS: readonly number[] = (() => {
  const newest = new Date().getUTCFullYear() + 1;
  return Array.from({ length: newest - SEARCH_YEAR_FLOOR + 1 }, (_, index) => newest - index);
})();

/** Whether a value names a year the picker actually offers, as a whole number. */
export function isSelectableYear(year: number): boolean {
  return Number.isInteger(year) && year >= SEARCH_YEAR_FLOOR && year <= SELECTABLE_YEARS[0]!;
}

/** Discover's filter panel: genres a work must all carry, and its release status. */
export interface DiscoverFilters {
  genres?: readonly string[] | undefined;
  status?: StatusFilter | undefined;
}

export function hasDiscoverFilters({ genres, status }: DiscoverFilters = {}): boolean {
  return (genres?.length ?? 0) > 0 || status !== undefined;
}

/** Query-key tail and request params for the panel; both empty when it narrows nothing. */
export function discoverFilterParams({ genres, status }: DiscoverFilters = {}): {
  key: unknown[];
  params: Record<string, string>;
} {
  const params: Record<string, string> = {};
  if (genres?.length) params.genres = [...genres].sort().join(',');
  if (status) params.status = status;
  return { key: Object.keys(params).length > 0 ? [params] : [], params };
}

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
export function useMediaSearch(
  query: string,
  kind?: MediaKind,
  year?: number,
  sort: SearchSort = 'relevance',
  filters?: DiscoverFilters,
): MediaSearchState {
  const q = query.trim();
  const filter = discoverFilterParams(filters);
  const narrowed = filter.key.length > 0;
  const result = useInfiniteQuery({
    // No `year` or `sort` element when the filter is off, so the key stays
    // byte-identical to the nav typeahead's and Enter on its results is a cache hit.
    queryKey: [
      'search',
      q,
      kind,
      ...(year || sort !== 'relevance' || narrowed ? [year] : []),
      ...(sort !== 'relevance' || narrowed ? [sort] : []),
      ...filter.key,
    ],
    enabled: q.length >= MIN_MEDIA_SEARCH_QUERY,
    placeholderData: keepPreviousData,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const searchParams: Record<string, string> = {
        q,
        limit: String(MEDIA_SEARCH_LIMIT),
        offset: String(pageParam),
        ...filter.params,
      };
      if (kind) searchParams.kind = kind;
      if (year) searchParams.year = String(year);
      if (sort !== 'relevance') searchParams.sort = sort;
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
    isPlaceholder: result.isPlaceholderData,
    hasMore: hasNextPage,
    loadMore,
    loadingMore: isFetchingNextPage,
  };
}

/**
 * Hits per kind for the Discover kind strip, over the query, year and sort
 * (never the kind: the strip needs every option's count). Undefined until it lands or
 * when the query is too short, and the strip then shows names only.
 */
export function useSearchKindCounts(
  query: string,
  year?: number,
  sort: SearchSort = 'relevance',
  filters?: DiscoverFilters,
): Partial<Record<MediaKind, number>> | undefined {
  const q = query.trim();
  const filter = discoverFilterParams(filters);
  const { data } = useQuery({
    queryKey: ['search', 'kinds', q, year, sort, ...filter.key],
    enabled: q.length >= MIN_MEDIA_SEARCH_QUERY,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const searchParams: Record<string, string> = { q, ...filter.params };
      if (year) searchParams.year = String(year);
      if (sort !== 'relevance') searchParams.sort = sort;
      const json = await http().get('search/kinds', { searchParams, signal }).json();
      return SearchKindCountsSchema.parse(json).kinds;
    },
  });
  return q.length >= MIN_MEDIA_SEARCH_QUERY ? data : undefined;
}

/**
 * Genres containing `text`, for Discover's genre search box: nothing is asked
 * until something is typed, so the full vocabulary never loads. The caller
 * debounces `text`.
 */
export function useGenreSuggestions(kind: MediaKind | undefined, text: string) {
  const q = text.trim().toLowerCase();
  const result = useQuery({
    queryKey: ['search', 'genres', kind ?? 'all', q],
    enabled: q.length > 0,
    staleTime: 60 * 60_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const searchParams: Record<string, string> = { q };
      if (kind) searchParams.kind = kind;
      const json = await http().get('search/genres', { searchParams, signal }).json();
      return SearchGenresSchema.parse(json).genres;
    },
  });
  return {
    genres: q ? (result.data ?? []) : [],
    isFetching: q.length > 0 && result.isFetching,
    isError: q.length > 0 && result.isError,
  };
}
