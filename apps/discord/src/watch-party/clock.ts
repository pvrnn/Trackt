/** Where a live party is: pure functions over the persisted clock columns. */

export interface PartyClock {
  itemStartedAt: Date | null;
  pausedAt: Date | null;
  pausedMs: number;
}

/** Time watched of the current item, excluding pauses; 0 before Start. */
export function elapsedMs(clock: PartyClock, now: Date): number {
  if (!clock.itemStartedAt) return 0;
  const until = clock.pausedAt ?? now;
  return Math.max(0, until.getTime() - clock.itemStartedAt.getTime() - clock.pausedMs);
}

/** `42:10`, or `1:52:00` from an hour up. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function progressBar(fraction: number, width = 16): string {
  const filled = Math.round(Math.min(1, Math.max(0, fraction)) * width);
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}
