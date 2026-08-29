import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateTracking, todayIso } from '@trackt/client';
import type { MediaDetail } from '@trackt/shared';
import { commitHaptic, errorHaptic } from './haptics';
import { useIsOnline } from './network';
import { TRACKING_MUTATION_KEY, patchViewer, trackingPatch, type TrackingWrite } from './offline';
import { useWriteFailedToast } from './toast';

/**
 * `apply(write)` — patch the cached viewer, send the write (or queue it), roll
 * back and say so on failure, re-sync on settle.
 *
 * A write is a **value**, never a closure: React Query stores a paused write as
 * its key and its variables and nothing else, so the request comes from
 * `runTrackingWrite` via the client's mutation defaults and the optimistic
 * patch from `trackingPatch` — both in `lib/offline.ts`, both testable.
 *
 * The failure surfaces as a toast as well as a haptic: a rolled-back optimistic
 * patch is otherwise indistinguishable from a tap that never registered.
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
