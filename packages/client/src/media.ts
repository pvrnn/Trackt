import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  LogDatesSchema,
  MediaDetailSchema,
  SearchResultSchema,
  type LogDates,
  type LogDatesBody,
  type LogStatus,
  type MediaDetail,
  type SearchResult,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/**
 * Fetch helpers for the media detail page. Mutations return nothing — the page
 * applies optimistic cache updates and re-syncs by invalidating the query.
 */

export async function fetchMediaDetail(idOrSlug: string): Promise<MediaDetail | null> {
  const response = await http().get(`media/${encodeURIComponent(idOrSlug)}`, {
    throwHttpErrors: false,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`media responded ${response.status}`);
  return MediaDetailSchema.parse(await response.json());
}

/**
 * Media detail query — gated on session. `data === null` means a real 404
 * (the page shows "Not found"); a thrown error surfaces as `isError`.
 */
export function useMediaDetail(slug: string) {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: ['media', slug],
    queryFn: () => fetchMediaDetail(slug),
    enabled: isAuthed,
  });
}

/**
 * What this instance carries, for the landing page's cover band. Public — the
 * landing page has no session, and the endpoint serves `verified` rows only.
 *
 * A failure is not worth surfacing here: the band is decoration above the fold
 * on a marketing page, and it has a designed fallback. `data ?? []` lets the
 * caller treat "failed" and "this instance has an empty catalog" as one state,
 * which is what the fallback is for.
 */
export function useShowcase() {
  return useQuery({
    queryKey: ['showcase'],
    queryFn: async ({ signal }): Promise<SearchResult[]> => {
      const json = await http().get('media/showcase', { signal }).json();
      return SearchResultSchema.array().parse(json);
    },
    // It changes when the catalog is populated, not between page views.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * The lowest 1..limit part not yet ticked off, or null when they all are —
 * what the media page's "✓ WATCH E13" button offers next.
 *
 * A scan rather than a materialised range: the array version allocated one
 * element per part on every render, and a manga carries hundreds of chapters.
 */
export function firstUnwatched(watched: ReadonlySet<number>, limit: number): number | null {
  for (let n = 1; n <= limit; n++) if (!watched.has(n)) return n;
  return null;
}

/**
 * What a status change does to the log's dates, mirroring the server's rules
 * (ADR-0007) so the stamped value shows the instant the status pill changes
 * instead of a request later. The server is still the authority — this feeds
 * the optimistic patch, which the following invalidation overwrites.
 */
export function stampedDates(status: LogStatus | null, current: LogDates, today: string): LogDates {
  if (status === null || status === 'planned') return { startedAt: null, finishedAt: null };
  const startedAt = current.startedAt ?? today;
  if (status === 'completed') return { startedAt, finishedAt: current.finishedAt ?? today };
  if (status === 'in_progress') return { startedAt, finishedAt: null };
  // paused / dropped: neither finishes the work, so the finish date stands.
  return { startedAt, finishedAt: current.finishedAt };
}

/**
 * Every cached view derived from tracking data. One check-in changes the media
 * detail, the home dashboard (up next, in progress, stats) *and* the profile
 * activity feed — so a mutation that invalidates only its own page leaves the
 * others serving stale cache. That cache survives client-side navigation, so
 * the staleness lasted until a hard reload built a fresh QueryClient.
 *
 * `['media']` is a prefix: it matches every `['media', slug]` entry.
 */
const TRACKING_KEYS = [['media'], ['home'], ['profile'], ['history']] as const;

export async function invalidateTracking(queryClient: QueryClient): Promise<void> {
  await Promise.all(TRACKING_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

async function mutate(
  path: string,
  method: 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<void> {
  const api = http();
  try {
    await api(path, { method, ...(body !== undefined ? { json: body } : {}) });
  } catch (error) {
    throw await toError(error, `${method} ${path}`);
  }
}

export const trackingApi = {
  setStatus: (id: string, status: LogStatus) => mutate(`media/${id}/log`, 'PUT', { status }),
  clearStatus: (id: string) => mutate(`media/${id}/log`, 'DELETE'),
  setScore: (id: string, score: number) => mutate(`media/${id}/rating`, 'PUT', { score }),
  clearScore: (id: string) => mutate(`media/${id}/rating`, 'DELETE'),
  checkIn: (id: string, number: number) => mutate(`media/${id}/progress/${number}`, 'PUT'),
  uncheck: (id: string, number: number) => mutate(`media/${id}/progress/${number}`, 'DELETE'),
  favorite: (id: string) => mutate(`media/${id}/favorite`, 'PUT'),
  unfavorite: (id: string) => mutate(`media/${id}/favorite`, 'DELETE'),
  /**
   * Manual date correction (ADR-0007). The only tracking call that returns a
   * value: the server merges the patch against the stored row, so what the log
   * now says is not derivable from the request alone.
   */
  setDates: async (id: string, body: LogDatesBody): Promise<LogDates> => {
    try {
      const response = await http().patch(`media/${id}/log`, { json: body });
      return LogDatesSchema.parse(await response.json());
    } catch (error) {
      throw await toError(error, `PATCH media/${id}/log`);
    }
  },
};
