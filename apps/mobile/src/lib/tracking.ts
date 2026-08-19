import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateTracking, todayIso } from '@trackt/client';
import type { MediaDetail } from '@trackt/shared';
import { commitHaptic, errorHaptic } from './haptics';
import { useIsOnline } from './network';
import { TRACKING_MUTATION_KEY, patchViewer, trackingPatch, type TrackingWrite } from './offline';
import { useWriteFailedToast } from './toast';

/**
 * The media screen's write path (mobile plan, phase 3, reworked for phase 5).
 *
 * The same optimistic mutation web's `/media/$slug` route runs, kept here
 * rather than in `packages/client` because it is a *screen's* cache policy, not
 * a data-layer one: it patches `['media', slug]`, which only a screen holding
 * that slug can be sure it wants. What the two clients genuinely share —
 * `invalidateTracking`'s fan-out and `stampedDates`' ADR-0007 rules — comes
 * from the package, unchanged.
 *
 * What phase 5 changed is where the request comes from. It used to be a closure
 * the caller handed in (`apply(patch, () => trackingApi.checkIn(…))`), which
 * made the patch and the request independent — and made both unrepeatable. A
 * write that is paused offline is stored as its `mutationKey` and its variables
 * and nothing else, so a closure cannot survive it. Now the caller passes a
 * `TrackingWrite` **value**, the request comes from `runTrackingWrite` via the
 * client's mutation defaults, and the optimistic patch is derived from the same
 * value by `trackingPatch`. All three live in `lib/offline.ts`, which is what
 * is left once the parts that need React are taken out — and is therefore the
 * part that can be tested.
 *
 * React Query serialises and cancels for us, so rapid check-ins can't clobber
 * each other's patches.
 */

/**
 * `apply(write)` — patch the cached viewer, send the write (or queue it), roll
 * back and say so on failure, re-sync on settle.
 *
 * The haptics are the ones §07 allows: a medium impact when a write the user
 * asked for commits, an error notification when one comes back rejected. The
 * failure also surfaces as a toast, because a rolled-back optimistic patch is
 * otherwise indistinguishable from a tap that never registered.
 */
export function useViewerMutation(slug: string) {
  const queryClient = useQueryClient();
  const writeFailed = useWriteFailedToast();
  const isOnline = useIsOnline();
  const queryKey = ['media', slug] as const;

  const mutation = useMutation({
    // No `mutationFn`: it comes from the client's defaults for this key, which
    // is the only copy a write restored from disk can also reach (phase 5).
    mutationKey: TRACKING_MUTATION_KEY,
    onMutate: async (write: TrackingWrite) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MediaDetail | null>(queryKey);
      if (previous) {
        const patch = trackingPatch(write, previous, todayIso());
        queryClient.setQueryData<MediaDetail | null>(queryKey, (current) =>
          patchViewer(current, patch),
        );
      }
      // Offline there will never be a 200 to buzz on, and the write really has
      // been taken — it is sitting in the queue. The commit is the queueing.
      if (!isOnline) commitHaptic();
      return { previous };
    },
    onSuccess: () => commitHaptic(),
    onError: (error, _write, context) => {
      if (context) queryClient.setQueryData(queryKey, context.previous);
      errorHaptic();
      writeFailed(error);
    },
    // Not just this screen: a check-in also moves the home dashboard, the
    // profile feed and history, which would otherwise stay stale until the app
    // was killed. Extended twice already after cache-staleness bugs — reuse it,
    // never re-derive it.
    onSettled: () => invalidateTracking(queryClient),
  });

  return {
    apply: (write: TrackingWrite) => mutation.mutate(write),
    isPending: mutation.isPending,
  };
}
