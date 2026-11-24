import { useEffect, useRef, type RefObject } from 'react';

/**
 * Pulls the next batch when the sentinel `ref` comes within 600px of the
 * viewport, so the batch is usually there before the last row is.
 *
 * `reobserve` is the trap: an IntersectionObserver only reports *changes*, so a
 * sentinel that stays in view across a batch would never fire again and the grid
 * would stall one screen short of the fold. Each caller passes something that
 * moves with every batch — the rows loaded, and whether one is in flight for a
 * batch that appended nothing new (a deduplicated overlap), which a row count
 * alone misses. Re-attaching when the list stops being rendered is the other
 * half: `enabled` drops to false and the observer disconnects rather than
 * watching a detached node.
 */
export function useLoadMoreSentinel(
  ref: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  reobserve: string,
  loadMore: () => void,
): void {
  const latest = useRef(loadMore);
  useEffect(() => {
    latest.current = loadMore;
  });
  useEffect(() => {
    const node = ref.current;
    if (!node || !enabled) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) latest.current();
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, reobserve, ref]);
}
