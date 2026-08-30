import { z } from 'zod';
import { LogStatusSchema, MediaKindSchema } from './media.js';

/**
 * The History contract (ADR-0007): the viewer's own tracked works, filed under
 * the day they were finished — or started, when they aren't.
 *
 * The page this serves absorbs the ROADMAP's Library item: `?year` omitted is
 * "everything I've ever tracked", filterable by kind and status.
 */

/**
 * Anime quarters, not meteorological seasons: the audience PRD §2 names —
 * people who "track anime seasons" — think in these, and meteorological winter
 * (Dec–Feb) straddles the year boundary.
 *
 * These survive as a *grouping* only. History used to filter by them too
 * (`?year=2025&season=winter`); that axis is gone, and with it the window
 * helper the SQL used. Breaking a list into quarters is still a useful reading
 * of it — {@link seasonOf} is what `groupEntries` calls.
 */
export const HISTORY_SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const;
export type HistorySeason = (typeof HISTORY_SEASONS)[number];

/** Inclusive 1-based month bounds — what {@link seasonOf} reads. */
export const SEASON_MONTHS: Record<HistorySeason, [number, number]> = {
  winter: [1, 3],
  spring: [4, 6],
  summer: [7, 9],
  autumn: [10, 12],
};

/** Which quarter an ISO date (YYYY-MM-DD) falls in. */
export function seasonOf(isoDate: string): HistorySeason {
  const month = Number(isoDate.slice(5, 7));
  for (const season of HISTORY_SEASONS) {
    const [from, to] = SEASON_MONTHS[season];
    if (month >= from && month <= to) return season;
  }
  // Unreachable for a valid ISO date; a bad month is not worth a throw here.
  return 'winter';
}

/** How many entries one history page serves. */
export const HISTORY_PAGE_LIMIT = 60;

/** The year is the only date axis: one window, which the keyset sorts inside. */
export const HistoryQuerySchema = z.object({
  /** Omitted = all time. */
  year: z.coerce.number().int().min(1900).max(2999).optional(),
  kind: MediaKindSchema.optional(),
  status: LogStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(HISTORY_PAGE_LIMIT),
  /** Opaque keyset cursor from the previous page's `nextCursor`. */
  cursor: z.string().max(200).optional(),
});
export type HistoryQuery = z.infer<typeof HistoryQuerySchema>;

/**
 * One row: enough for a cover, a date range, a rating and an `8/12` progress
 * fragment without a second request.
 */
export const HistoryEntrySchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  kind: MediaKindSchema,
  title: z.string(),
  coverUrl: z.string().nullable(),
  status: LogStatusSchema,
  startedAt: z.iso.date().nullable(),
  finishedAt: z.iso.date().nullable(),
  /** The day the entry is filed under: `finishedAt ?? startedAt`, never null. */
  loggedOn: z.iso.date(),
  score: z.number().nullable(),
  watched: z.number().int().nonnegative(),
  /** Known part count; null for movies and for works the catalog hasn't counted. */
  total: z.number().int().nullable(),
});
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/**
 * The stats strip. The two halves answer genuinely different questions —
 * "titles you finished in 2025" versus "episodes you watched during 2025" — and
 * a long-running show makes them disagree, so the page labels them apart.
 * `episodes`/`chapters` are check-in counts in the window, not parts of the
 * titles listed.
 */
export const HistoryTotalsSchema = z.object({
  titles: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  episodes: z.number().int().nonnegative(),
  chapters: z.number().int().nonnegative(),
});
export type HistoryTotals = z.infer<typeof HistoryTotalsSchema>;

export const HistoryPageSchema = z.object({
  entries: z.array(HistoryEntrySchema),
  /** null on the last page. Opaque — decode only via {@link decodeHistoryCursor}. */
  nextCursor: z.string().nullable(),
  /**
   * Every year the viewer has anything in — the year picker's data source, so
   * it is deliberately *not* filtered by the selected year (that would leave one
   * chip on screen). It is filtered by kind/status, so the picker reflects the
   * rest of the filter row.
   */
  years: z.array(z.object({ year: z.number().int(), count: z.number().int().nonnegative() })),
  totals: HistoryTotalsSchema,
});
export type HistoryPage = z.infer<typeof HistoryPageSchema>;

/**
 * Keyset cursor over `(logged_on DESC, media_id DESC)` — the news feed's shape
 * with one field renamed. Copied rather than generalised: it is eight lines,
 * and the news cursor is part of a published contract that should not start
 * moving because history needed a tweak.
 *
 * Base64url of `loggedOn|mediaId`. Opaque by contract, not by encryption: it
 * carries only values the same page already returned. `btoa`/`atob` rather than
 * `Buffer`, which does not exist in a browser — this package is imported by
 * apps/web and stays runtime-neutral.
 */
export interface HistoryCursor {
  loggedOn: string;
  mediaId: string;
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return btoa(`${cursor.loggedOn}|${cursor.mediaId}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Returns null for anything malformed — the route turns that into a 400. */
export function decodeHistoryCursor(raw: string): HistoryCursor | null {
  let decoded: string;
  try {
    decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  const parsed = z.object({ loggedOn: z.iso.date(), mediaId: z.uuid() }).safeParse({
    loggedOn: decoded.slice(0, separator),
    mediaId: decoded.slice(separator + 1),
  });
  return parsed.success ? parsed.data : null;
}
