import { QueryClient } from '@tanstack/react-query';

/**
 * One QueryClient per `getRouter()` call: on the server that's one per request
 * (no cross-request cache bleed), on the client it's created once at hydration
 * so the cache persists across client-side navigations.
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
