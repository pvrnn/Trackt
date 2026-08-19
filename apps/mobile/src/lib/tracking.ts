import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invalidateTracking } from '@trackt/client';
import type { MediaDetail } from '@trackt/shared';
import { commitHaptic, errorHaptic } from './haptics';
import { useWriteFailedToast } from './toast';

/**
 * The media screen's write path (mobile plan, phase 3).
 *
 * The same optimistic mutation web's `/media/$slug` route runs, kept here
 * rather than in `packages/client` because it is a *screen's* cache policy, not
 * a data-layer one: it patches `['media', slug]`, which only a screen holding
 * that slug can be sure it wants. What the two clients genuinely share —
 * `invalidateTracking`'s fan-out and `stampedDates`' ADR-0007 rules — comes
 * from the package, unchanged.
 *
 * React Query serialises and cancels for us, so rapid check-ins can't clobber
 * each other's patches.
 */

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
 * `apply(patch, run)` — patch the cached viewer, run the tracking call, roll
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
  const queryKey = ['media', slug] as const;

  const mutation = useMutation({
    mutationFn: ({ run }: { patch: ViewerPatch; run: () => Promise<void> }) => run(),
    onMutate: async ({ patch }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<MediaDetail | null>(queryKey);
      queryClient.setQueryData<MediaDetail | null>(queryKey, (current) =>
        patchViewer(current, patch),
      );
      return { previous };
    },
    onSuccess: () => commitHaptic(),
    onError: (error, _variables, context) => {
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
    apply: (patch: ViewerPatch, run: () => Promise<void>) => mutation.mutate({ patch, run }),
    isPending: mutation.isPending,
  };
}
