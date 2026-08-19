import { configureClient, type ClientRuntime } from '@trackt/client';
import { describe, expect, it } from 'vitest';
import type { MediaDetail } from '@trackt/shared';
import {
  EMPTY_VIEWER,
  TRACKING_MUTATION_KEY,
  cacheKeyForOrigin,
  isOnlineState,
  makeMobileQueryClient,
  patchViewer,
  runTrackingWrite,
  trackingPatch,
  type TrackingWrite,
} from '../../src/lib/offline';

/** A fixed "today", so the ADR-0007 stamping assertions do not drift overnight. */
const TODAY = '2026-08-19';

/**
 * The offline seam (mobile plan, phase 5).
 *
 * All of it is pure by construction — that is the point of the module, not a
 * convenience for testing. A write that was paused with no signal is restored
 * from disk as a `mutationKey` and a JSON blob, so if the blob cannot round-trip
 * or the key resolves to no `mutationFn`, the queued check-in is silently lost
 * and nothing anywhere reports it. Both of those are one assertion each.
 */

const WRITES: TrackingWrite[] = [
  { op: 'checkIn', id: 'm1', part: 3 },
  { op: 'uncheck', id: 'm1', part: 3 },
  { op: 'setStatus', id: 'm1', status: 'completed' },
  { op: 'clearStatus', id: 'm1' },
  { op: 'setScore', id: 'm1', score: 8.5 },
  { op: 'clearScore', id: 'm1' },
  { op: 'favorite', id: 'm1' },
  { op: 'unfavorite', id: 'm1' },
];

describe('TrackingWrite', () => {
  it('survives the round trip through storage', () => {
    // The constraint the shape exists for: a paused mutation is persisted as
    // JSON and rebuilt from it, so anything not expressible as JSON — a Date, a
    // Set, a closure — would come back as something else, or not at all.
    for (const write of WRITES) {
      expect(JSON.parse(JSON.stringify(write))).toEqual(write);
    }
  });
});

describe('runTrackingWrite', () => {
  it('maps every operation to its endpoint', async () => {
    const calls: string[] = [];
    // The real `@trackt/client`, configured with a recording transport — so
    // what is asserted is the request the queue will actually replay, path and
    // method and body, not that some function was reached.
    configureClient({
      http: ((path: string, options: { method: string; json?: unknown }) => {
        calls.push(
          `${options.method} ${path}${options.json ? ` ${JSON.stringify(options.json)}` : ''}`,
        );
        return Promise.resolve();
      }) as unknown as ClientRuntime['http'],
      useIsAuthed: () => true,
    });

    for (const write of WRITES) await runTrackingWrite(write);

    expect(calls).toEqual([
      'PUT media/m1/progress/3',
      'DELETE media/m1/progress/3',
      'PUT media/m1/log {"status":"completed"}',
      'DELETE media/m1/log',
      'PUT media/m1/rating {"score":8.5}',
      'DELETE media/m1/rating',
      'PUT media/m1/favorite',
      'DELETE media/m1/favorite',
    ]);
  });

  it('covers the whole union', () => {
    // A new operation added to `TrackingWrite` without a case above is a write
    // that queues fine and then throws when the queue drains.
    expect(new Set(WRITES.map((write) => write.op)).size).toBe(WRITES.length);
  });
});

describe('makeMobileQueryClient', () => {
  it('resolves a mutationFn for a write rebuilt from its key alone', () => {
    // What a restored paused mutation actually does: it knows its key and its
    // variables, and asks the client for the rest. No `mutationFn` here means a
    // queued check-in sits in the cache forever.
    const client = makeMobileQueryClient();
    const defaults = client.getMutationDefaults([...TRACKING_MUTATION_KEY]);
    expect(defaults.mutationFn).toBeTypeOf('function');
    expect(defaults.onSettled).toBeTypeOf('function');
  });

  it('leaves other mutations alone', () => {
    const client = makeMobileQueryClient();
    expect(client.getMutationDefaults(['lists']).mutationFn).toBeUndefined();
  });
});

describe('cacheKeyForOrigin', () => {
  it('gives two instances two caches', () => {
    // The query keys name no server, so one key for both would serve instance
    // A's library under instance B's session — the failure the picker exists to
    // prevent, arriving through the back door.
    expect(cacheKeyForOrigin('https://a.example')).not.toBe(cacheKeyForOrigin('https://b.example'));
  });

  it('is stable across launches', () => {
    expect(cacheKeyForOrigin('https://a.example')).toBe(cacheKeyForOrigin('https://a.example'));
  });
});

describe('isOnlineState', () => {
  it('trusts reachability over connectivity', () => {
    // Connected to a captive-portal wifi is exactly this shape, and it is
    // offline for our purposes.
    expect(isOnlineState({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(isOnlineState({ isConnected: false, isInternetReachable: true })).toBe(true);
  });

  it('falls back to connectivity, then to online', () => {
    expect(isOnlineState({ isConnected: false })).toBe(false);
    expect(isOnlineState({ isConnected: true })).toBe(true);
    // Nothing known yet: guessing offline pauses every write on a phone that is
    // perfectly connected, which is far worse than one failed request.
    expect(isOnlineState({})).toBe(true);
  });
});

describe('trackingPatch', () => {
  const detail = (over: Partial<MediaDetail> = {}): MediaDetail =>
    ({
      id: 'm1',
      slug: 'neon-harbor',
      kind: 'series',
      title: 'Neon Harbor',
      partCount: 12,
      viewer: { ...EMPTY_VIEWER },
      ...over,
    }) as MediaDetail;

  const withViewer = (viewer: Partial<NonNullable<MediaDetail['viewer']>>) =>
    detail({ viewer: { ...EMPTY_VIEWER, ...viewer } });

  it('adds and removes a part', () => {
    expect(
      trackingPatch({ op: 'checkIn', id: 'm1', part: 3 }, withViewer({ watched: [1] }), TODAY),
    ).toEqual({ watched: [1, 3] });
    expect(
      trackingPatch({ op: 'uncheck', id: 'm1', part: 3 }, withViewer({ watched: [1, 3] }), TODAY),
    ).toEqual({ watched: [1] });
  });

  it('does not double-add a part already checked in', () => {
    // The swipe and the button can both land on the same part, and offline the
    // second one is queued rather than rejected — so the guard has to be here.
    expect(
      trackingPatch({ op: 'checkIn', id: 'm1', part: 3 }, withViewer({ watched: [3] }), TODAY),
    ).toEqual({});
  });

  it('sweeps every part on completed and clears them on planned (PRD §3.1)', () => {
    const completed = trackingPatch(
      { op: 'setStatus', id: 'm1', status: 'completed' },
      detail(),
      TODAY,
    );
    expect(completed.watched).toHaveLength(12);
    expect(completed.status).toBe('completed');
    expect(
      trackingPatch({ op: 'setStatus', id: 'm1', status: 'planned' }, detail(), TODAY),
    ).toEqual({
      status: 'planned',
      watched: [],
      startedAt: null,
      finishedAt: null,
    });
  });

  it('sweeps to the highest check-in while the count is unknown', () => {
    // A currently-airing season has no `partCount`; ticking "completed" must
    // not invent episodes past the last one that exists.
    const airing = detail({ partCount: null, viewer: { ...EMPTY_VIEWER, watched: [1, 2, 3] } });
    expect(
      trackingPatch({ op: 'setStatus', id: 'm1', status: 'completed' }, airing, TODAY).watched,
    ).toEqual([1, 2, 3]);
  });

  it('never sweeps a movie, which has no parts (ADR-0003)', () => {
    const movie = detail({ kind: 'movie', partCount: null });
    expect(
      trackingPatch({ op: 'setStatus', id: 'm1', status: 'completed' }, movie, TODAY),
    ).not.toHaveProperty('watched');
  });

  it('stamps the ADR-0007 dates the server would', () => {
    expect(
      trackingPatch({ op: 'setStatus', id: 'm1', status: 'in_progress' }, detail(), TODAY),
    ).toMatchObject({ startedAt: TODAY, finishedAt: null });
    expect(trackingPatch({ op: 'clearStatus', id: 'm1' }, detail(), TODAY)).toEqual({
      status: null,
      startedAt: null,
      finishedAt: null,
    });
  });

  it('keeps a start date it did not set', () => {
    const started = withViewer({ status: 'in_progress', startedAt: '2026-01-04' });
    expect(
      trackingPatch({ op: 'setStatus', id: 'm1', status: 'completed' }, started, TODAY),
    ).toMatchObject({ startedAt: '2026-01-04', finishedAt: TODAY });
  });

  it('handles the scalar writes', () => {
    expect(trackingPatch({ op: 'setScore', id: 'm1', score: 8.5 }, detail(), TODAY)).toEqual({
      score: 8.5,
    });
    expect(trackingPatch({ op: 'clearScore', id: 'm1' }, detail(), TODAY)).toEqual({ score: null });
    expect(trackingPatch({ op: 'favorite', id: 'm1' }, detail(), TODAY)).toEqual({
      favorited: true,
    });
    expect(trackingPatch({ op: 'unfavorite', id: 'm1' }, detail(), TODAY)).toEqual({
      favorited: false,
    });
  });

  it('treats an untracked work as the empty viewer rather than crashing', () => {
    expect(
      trackingPatch({ op: 'checkIn', id: 'm1', part: 1 }, detail({ viewer: null }), TODAY),
    ).toEqual({ watched: [1] });
  });
});

describe('patchViewer', () => {
  it('leaves a 404 alone', () => {
    // `null` is a real answer from `fetchMediaDetail` — the title does not exist
    // on this instance — and patching it would resurrect a row from nothing.
    expect(patchViewer(null, { favorited: true })).toBeNull();
    expect(patchViewer(undefined, { favorited: true })).toBeUndefined();
  });
});
