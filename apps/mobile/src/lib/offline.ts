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
 * Offline, as data (mobile plan, phase 5).
 *
 * The subway case: a check-in is the one thing people do with no signal, so it
 * has to survive not just a dead connection but the app being killed while the
 * connection is still dead. React Query pauses a mutation whose `networkMode`
 * is `'online'` and resumes it when `onlineManager` says so — but a *resumed*
 * mutation is rebuilt from its persisted `mutationKey` and variables alone. The
 * closure that made the request is long gone.
 *
 * That is the whole reason this module exists: the tracking calls are described
 * here as **serialisable values**, and `runTrackingWrite` is the one function
 * that turns a value back into a request. It is registered once, against
 * `TRACKING_MUTATION_KEY`, with `setMutationDefaults` — which is what a
 * rehydrated mutation looks its `mutationFn` up in.
 *
 * The rest of the module is the same idea applied once more: the optimistic
 * patch a write implies (`trackingPatch`) is *derived* from the write rather
 * than passed beside it, so what the screen shows and what the server is
 * eventually told cannot drift apart across an hour of no signal.
 *
 * Kept free of `expo-*` and `react-native` imports so all of it is unit
 * testable in the node vitest project, the same rule `lib/instance.ts` follows.
 * The native half lives in `lib/persist.ts` and `lib/network.ts` next door, and
 * the React hook over this one is `lib/tracking.ts`.
 */

/**
 * A tracking write, as a value. Every field has to survive `JSON.stringify` and
 * come back meaning the same thing — that is the constraint the shape is for,
 * not tidiness. `id` is the media id rather than the slug because that is what
 * every endpoint is keyed by, and a slug can be re-pointed between the write
 * being queued and it being sent.
 */
export type TrackingWrite =
  | { op: 'checkIn'; id: string; part: number }
  | { op: 'uncheck'; id: string; part: number }
  /**
   * "I am at part N" — the whole position in one write, which is what the
   * slider on a 900-chapter work sends. It is not a batch of check-ins: parts
   * past `upTo` are cleared, so replaying it after an hour offline still means
   * the same thing it meant when it was queued.
   */
  | { op: 'setProgress'; id: string; upTo: number }
  | { op: 'setStatus'; id: string; status: LogStatus }
  | { op: 'clearStatus'; id: string }
  | { op: 'setScore'; id: string; score: number }
  | { op: 'clearScore'; id: string }
  | { op: 'favorite'; id: string }
  | { op: 'unfavorite'; id: string };

/**
 * The two writes that name a part — a check-in and its undo. Home deals only in
 * these, and saying so is narrower than `TrackingWrite` and truer than
 * hand-writing the pair.
 */
export type PartWrite = Extract<TrackingWrite, { part: number }>;

/**
 * The key every queued tracking write shares. One key, not one per operation:
 * `setMutationDefaults` resolves by key prefix, and a rehydrated mutation that
 * matched nothing would sit in the cache forever with no `mutationFn` to run.
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
 * Where one instance's persisted cache lives.
 *
 * Keyed by origin, and that is load-bearing rather than tidy: the query keys
 * are `['media', slug]`, `['home']` and so on — nothing in them names a server.
 * Restoring one instance's dump into another's session would serve someone
 * else's library under this account's name, which is the exact failure the
 * server picker exists to prevent.
 */
export function cacheKeyForOrigin(origin: string): string {
  return `query-cache:${origin}`;
}

/**
 * How stale a restored cache may be before it is thrown away instead.
 *
 * A week, because the point is a phone that has been in a drawer, not a phone
 * that has been offline for a minute — and because the alternative to showing
 * week-old data is showing nothing, which is worse. Everything restored is
 * immediately stale (`staleTime` is 30s), so a reachable instance refetches it
 * within a frame of the screen mounting.
 */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The persisted cache's version. Bump it to invalidate every stored dump at
 * once — a schema change in `@trackt/shared` that a restored payload would no
 * longer parse against is the case it exists for.
 */
export const PERSIST_BUSTER = 'v1';

/**
 * Is this network state one we should treat as online?
 *
 * Both fields are optional — `isInternetReachable` is unset on platforms that
 * cannot answer, and both are unset before the first reading lands — and the
 * default when we do not know has to be **online**. Guessing offline pauses
 * every write and swaps every screen for a stale marker on a phone that is
 * perfectly connected; guessing online costs one failed request and a toast.
 */
export function isOnlineState(state: {
  isConnected?: boolean | undefined;
  isInternetReachable?: boolean | undefined;
}): boolean {
  return state.isInternetReachable ?? state.isConnected ?? true;
}

/**
 * The app's `QueryClient`: `@trackt/client`'s defaults, plus the one thing only
 * the app needs — a `mutationFn` registered against `TRACKING_MUTATION_KEY`.
 *
 * `setMutationDefaults` is not a convenience here. It is the only way a paused
 * write that was restored from disk finds a function to run: the cache stores
 * the key and the variables, and looks the rest up here. The `onSettled` has to
 * live here for the same reason — a mutation that resumed on reconnect has no
 * screen behind it to invalidate anything, so without this the fan-out that
 * moves home, profile and history would simply not happen for a queued
 * check-in. Screens that add their own `onSettled` override it and re-do it.
 *
 * One client per instance, not per process: the query keys name no server, so
 * two instances sharing a cache would serve one library under the other's
 * session.
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
 * What a write does to the viewer's row, before the server has said anything.
 *
 * Pure, and derived from the write rather than passed alongside it: the pairing
 * of "check in part 7" with "and 7 is now watched" is not something a call site
 * should be able to get wrong, and from phase 5 the two are separated in time —
 * an offline write is patched now and sent on reconnect.
 *
 * `detail` is the row as currently cached, which is what makes the two sweeping
 * transitions expressible at all: `completed` ticks every part and `planned`
 * clears them (PRD §3.1), and both need to know how many parts there are.
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
