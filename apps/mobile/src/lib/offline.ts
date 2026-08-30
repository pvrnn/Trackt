import type { QueryClient } from '@tanstack/react-query';
import {
  invalidateTracking,
  makeQueryClient,
  partsUpTo,
  stampedDates,
  trackingApi,
} from '@trackt/client';
import type { LogStatus, MediaDetail } from '@trackt/shared';

/**
 * Offline, as data. A check-in has to survive the app being killed while the
 * connection is still dead — and a resumed mutation is rebuilt from its
 * persisted key and variables alone, so the closure that made the request is
 * gone. Hence: writes are serialisable **values**, `runTrackingWrite` is the
 * one function that turns one back into a request, and the optimistic patch is
 * derived from the same value rather than passed beside it.
 *
 * No `expo-*` or `react-native` imports, so all of it is unit testable in the
 * node vitest project. The native half is `persist.ts` and `network.ts`; the
 * React hook over it is `tracking.ts`.
 */

/**
 * A tracking write, as a value. Every field has to survive `JSON.stringify` and
 * come back meaning the same thing. `id` is the media id, not the slug: a slug
 * can be re-pointed between a write being queued and being sent.
 */
export type TrackingWrite =
  | { op: 'checkIn'; id: string; part: number }
  | { op: 'uncheck'; id: string; part: number }
  /**
   * "I am at part N" — the whole position in one write, not a batch of
   * check-ins: parts past `upTo` are cleared, so replaying it an hour later
   * still means what it meant when it was queued.
   */
  | { op: 'setProgress'; id: string; upTo: number }
  | { op: 'setStatus'; id: string; status: LogStatus }
  | { op: 'clearStatus'; id: string }
  | { op: 'setScore'; id: string; score: number }
  | { op: 'clearScore'; id: string }
  | { op: 'favorite'; id: string }
  | { op: 'unfavorite'; id: string };

/** The two writes that name a part — a check-in and its undo. All home deals in. */
export type PartWrite = Extract<TrackingWrite, { part: number }>;

/**
 * The key every queued tracking write shares. One key, not one per operation:
 * a rehydrated mutation matching nothing would sit in the cache forever with no
 * `mutationFn` to run.
 */
export const TRACKING_MUTATION_KEY = ['tracking'] as const;

/** The value → request map. The inverse of `TrackingWrite` and its only reader. */
export function runTrackingWrite(write: TrackingWrite): Promise<void> {
  switch (write.op) {
    case 'checkIn':
      return trackingApi.checkIn(write.id, write.part);
    case 'uncheck':
      return trackingApi.uncheck(write.id, write.part);
    case 'setProgress':
      return trackingApi.setProgress(write.id, write.upTo);
    case 'setStatus':
      return trackingApi.setStatus(write.id, write.status);
    case 'clearStatus':
      return trackingApi.clearStatus(write.id);
    case 'setScore':
      return trackingApi.setScore(write.id, write.score);
    case 'clearScore':
      return trackingApi.clearScore(write.id);
    case 'favorite':
      return trackingApi.favorite(write.id);
    case 'unfavorite':
      return trackingApi.unfavorite(write.id);
  }
}

/**
 * Where one instance's persisted cache lives. Keyed by origin because nothing
 * in the query keys names a server — restoring one instance's dump into
 * another's session would serve someone else's library under this account.
 */
export function cacheKeyForOrigin(origin: string): string {
  return `query-cache:${origin}`;
}

/** How stale a restored cache may be before it is dropped: a phone left in a drawer. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The persisted cache's version. Bump it to invalidate every stored dump at
 * once — a schema change in `@trackt/shared` that a restored payload would no
 * longer parse against is the case it exists for.
 */
export const PERSIST_BUSTER = 'v1';

/**
 * Both fields are optional, and the default when we do not know has to be
 * online: guessing offline pauses every write on a perfectly connected phone,
 * while guessing online costs one failed request and a toast.
 */
export function isOnlineState(state: {
  isConnected?: boolean | undefined;
  isInternetReachable?: boolean | undefined;
}): boolean {
  return state.isInternetReachable ?? state.isConnected ?? true;
}

/**
 * The app's `QueryClient`. `setMutationDefaults` is the only way a restored
 * paused write finds a function to run, and `onSettled` has to live here for
 * the same reason: a mutation resumed on reconnect has no screen behind it to
 * invalidate anything. One client per instance, never per process.
 */
export function makeMobileQueryClient(): QueryClient {
  const client = makeQueryClient();
  client.setMutationDefaults(TRACKING_MUTATION_KEY, {
    mutationFn: runTrackingWrite,
    onSettled: () => invalidateTracking(client),
  });
  return client;
}

export type ViewerPatch = Partial<NonNullable<MediaDetail['viewer']>>;

/** What an untracked work looks like — the base every optimistic patch lands on. */
export const EMPTY_VIEWER: NonNullable<MediaDetail['viewer']> = {
  status: null,
  score: null,
  watched: [],
  favorited: false,
  startedAt: null,
  finishedAt: null,
};

/** Merge a patch into a cached detail's viewer, or leave a 404/absent entry alone. */
export function patchViewer(
  current: MediaDetail | null | undefined,
  patch: ViewerPatch,
): MediaDetail | null | undefined {
  if (!current) return current;
  return { ...current, viewer: { ...EMPTY_VIEWER, ...current.viewer, ...patch } };
}

/**
 * What a write does to the viewer's row before the server has said anything.
 * Pure, and derived from the write — an offline write is patched now and sent
 * on reconnect, so the two must not be able to disagree.
 */
export function trackingPatch(
  write: TrackingWrite,
  detail: MediaDetail,
  today: string,
): ViewerPatch {
  const viewer = { ...EMPTY_VIEWER, ...detail.viewer };
  switch (write.op) {
    case 'checkIn':
      return viewer.watched.includes(write.part)
        ? {}
        : { watched: [...viewer.watched, write.part] };
    case 'uncheck':
      return { watched: viewer.watched.filter((n) => n !== write.part) };
    case 'setProgress':
      // Everything up to the mark, and nothing past it — the server's rule,
      // mirrored, or the grid would keep showing check-ins the write drops.
      return { watched: partsUpTo(write.upTo) };
    case 'clearStatus':
      return { status: null, startedAt: null, finishedAt: null };
    case 'setStatus': {
      // Mirror the server's progress sweep optimistically, or the grid lags a
      // refetch behind the pill that caused it.
      const length = sweepLength(detail, viewer);
      const sweep =
        length === 0
          ? {}
          : write.status === 'completed'
            ? { watched: Array.from({ length }, (_, i) => i + 1) }
            : write.status === 'planned'
              ? { watched: [] }
              : {};
      return { status: write.status, ...sweep, ...stampedDates(write.status, viewer, today) };
    }
    case 'setScore':
      return { score: write.score };
    case 'clearScore':
      return { score: null };
    case 'favorite':
      return { favorited: true };
    case 'unfavorite':
      return { favorited: false };
  }
}

/**
 * How many parts a sweep covers: the known count, or one past the highest
 * check-in while a season is still airing. Zero for a movie, which tracks in one
 * step and has no parts to sweep (ADR-0003).
 */
function sweepLength(detail: MediaDetail, viewer: NonNullable<MediaDetail['viewer']>): number {
  if (detail.kind === 'movie') return 0;
  return detail.partCount ?? (viewer.watched.length > 0 ? Math.max(...viewer.watched) : 0);
}
