import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient per client bootstrap: on web that's `getRouter()` — one per
 * request on the server (no cross-request cache bleed), one per hydration in
 * the browser, so the cache persists across client-side navigations. On mobile
 * it is one per process, and switching instance replaces it rather than
 * clearing it (a cache keyed by query name alone would serve one instance's
 * rows to another).
 *
 * Defaults are conservative for an app whose data is all auth-gated and fetched
 * client-side: a short stale window, no refetch-on-focus, and a single retry
 * for transient failures (our fetch helpers throw plain Errors, so we retry by
 * count rather than status — 404s are modelled as data, not errors).
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
