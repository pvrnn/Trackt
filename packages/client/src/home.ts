import { useQuery } from '@tanstack/react-query';
import {
  HomeSummarySchema,
  trackingVerbLabel,
  type ActivityEntry,
  type HomeSummary,
  type UpNextEntry,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/** Fetch the authenticated home dashboard summary. */
export async function fetchHomeSummary(): Promise<HomeSummary> {
  try {
    return HomeSummarySchema.parse(await http().get('me/home').json());
  } catch (error) {
    throw await toError(error, 'home summary');
  }
}

/** Home dashboard query — gated on an active session so it never fires signed-out. */
export function useHomeSummary() {
  const isAuthed = useIsAuthed();
  return useQuery({ queryKey: ['home'], queryFn: fetchHomeSummary, enabled: isAuthed });
}

/**
 * Identifies the *part* a one-tap check-in logged, not the title it belongs to.
 *
 * The home page marks a card done optimistically and needs to know when that
 * mark is spent. Keyed on `entry.id` alone it never was: the refetched summary
 * keeps the same media id and only advances `next`, so the card stayed
 * `✓ WATCHED` and its button stayed inert — one check-in per title per page
 * load, until a full reload built a fresh dashboard.
 */
export function upNextPartKey(entry: UpNextEntry): string {
  return `${entry.id}:${entry.next}`;
}

/**
 * The verb an activity row reads as, capitalised: a check-in says 'Watched' or
 * 'Read' depending on the media kind. Shared by the home and profile feeds,
 * which differ only in casing (`.toLowerCase()` mid-sentence).
 */
export function activityVerbLabel(entry: ActivityEntry): string {
  switch (entry.verb) {
    case 'checked_in':
      return trackingVerbLabel(entry.kind);
    case 'rated':
      return 'Rated';
    case 'status':
      return 'Marked';
  }
}

/** Compact relative timestamp for activity rows: 2H, 1D, 3W. */
export function relativeTime(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}D`;
  return `${Math.round(days / 7)}W`;
}
