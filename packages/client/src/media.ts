import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  LOG_DATE_FLOOR,
  LogDatesSchema,
  MediaDetailSchema,
  SearchResultSchema,
  type LogDates,
  type LogDatesBody,
  type LogStatus,
  type MediaDetail,
  type SearchResult,
} from '@trackt/shared';
import { toError } from './http.js';
import { http, useIsAuthed } from './runtime.js';

/**
 * Fetch helpers for the media detail page. Mutations return nothing — the page
 * applies optimistic cache updates and re-syncs by invalidating the query.
 */

export async function fetchMediaDetail(idOrSlug: string): Promise<MediaDetail | null> {
  const response = await http().get(`media/${encodeURIComponent(idOrSlug)}`, {
    throwHttpErrors: false,
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`media responded ${response.status}`);
  return MediaDetailSchema.parse(await response.json());
}

/**
 * Media detail query — gated on session. `data === null` means a real 404
 * (the page shows "Not found"); a thrown error surfaces as `isError`.
 */
export function useMediaDetail(slug: string) {
  const isAuthed = useIsAuthed();
  return useQuery({
    queryKey: ['media', slug],
    queryFn: () => fetchMediaDetail(slug),
    enabled: isAuthed,
  });
}

/**
 * What this instance carries, for the landing page's cover band. Public — the
 * landing page has no session, and the endpoint serves `verified` rows only.
 *
 * A failure is not worth surfacing here: the band is decoration above the fold
 * on a marketing page, and it has a designed fallback. `data ?? []` lets the
 * caller treat "failed" and "this instance has an empty catalog" as one state,
 * which is what the fallback is for.
 */
export function useShowcase() {
  return useQuery({
    queryKey: ['showcase'],
    queryFn: async ({ signal }): Promise<SearchResult[]> => {
      const json = await http().get('media/showcase', { signal }).json();
      return SearchResultSchema.array().parse(json);
    },
    // It changes when the catalog is populated, not between page views.
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/**
 * The lowest 1..limit part not yet ticked off, or null when they all are —
 * what the media page's "✓ WATCH E13" button offers next.
 *
 * A scan rather than a materialised range: the array version allocated one
 * element per part on every render, and a manga carries hundreds of chapters.
 */
export function firstUnwatched(watched: ReadonlySet<number>, limit: number): number | null {
  for (let n = 1; n <= limit; n++) if (!watched.has(n)) return n;
  return null;
}

/**
 * Past this many parts the media page stops offering a tile per part and leads
 * with a position instead — a slider and a typed-in number (`PUT …/progress`).
 *
 * Thirty is where the grid stops being a checklist and starts being a wall:
 * a two-cour anime is 24-26, and everything above that — a long-running manga,
 * a webtoon, a 500-episode shounen — is a work nobody catches up on one tap at
 * a time. The tiles do not go away; they stop being the first thing offered.
 */
export const PROGRESS_SLIDER_MIN_PARTS = 30;

/** Is this work long enough that a position beats a checklist? */
export function usesProgressSlider(total: number | null): boolean {
  return total !== null && total >= PROGRESS_SLIDER_MIN_PARTS;
}

/**
 * The viewer's *position*: the highest N with every part 1..N checked in.
 *
 * Not `watched.size`, and the difference is the whole reason this exists.
 * Progress can be sparse — someone who ticked episodes 1, 2 and 9 has a count
 * of three and a position of two — and a slider showing three would claim they
 * had seen episode 3. The count still has a place (it is what "X of N" means);
 * the position is what a control that sets a range may honestly show.
 */
export function progressUpTo(watched: ReadonlySet<number>): number {
  let n = 0;
  while (watched.has(n + 1)) n++;
  return n;
}

/**
 * How many parts one block covers (`Mobile Media.dc.html`, "VOLUMES, NOT
 * CHAPTERS"): 312 chapters becomes 8 rows of 40, each with its own count and
 * bar, so where you are in the whole work fits on one screen. Forty is the
 * mockup's number and roughly a manga volume.
 */
export const PART_BLOCK_SIZE = 40;

/** One block of parts, with the viewer's position folded in. */
export interface PartBlock {
  /** 1-based; `Volume 3`, `Episodes 41–80`. */
  index: number;
  from: number;
  to: number;
  size: number;
  /** Parts of this block at or below the position — 0..size. */
  done: number;
  complete: boolean;
  /** Started but not finished: what earns the pink half-state. */
  partial: boolean;
}

/**
 * Chop a work into blocks, or return none when it is short enough to list part
 * by part. The threshold is the block size itself: a 26-episode season is 26
 * rows, which is a list; a 312-chapter manga is 8 rows, which is a map.
 */
export function partBlocks(total: number, position: number, size = PART_BLOCK_SIZE): PartBlock[] {
  if (total <= size) return [];
  const blocks: PartBlock[] = [];
  for (let index = 1; (index - 1) * size < total; index++) {
    const from = (index - 1) * size + 1;
    const to = Math.min(total, index * size);
    const span = to - from + 1;
    const done = Math.min(Math.max(position - from + 1, 0), span);
    blocks.push({
      index,
      from,
      to,
      size: span,
      done,
      complete: done >= span,
      partial: done > 0 && done < span,
    });
  }
  return blocks;
}

/**
 * The rows an opened block actually renders: a window around where you are
 * (`Mobile Media.dc.html`, "ROWS LOAD IN A WINDOW") — two behind, the next one,
 * three ahead. Never the whole block, never the whole work; travelling further
 * than that is the slider's job, not scrolling's.
 *
 * When the position is outside the block the window starts at its beginning,
 * which is what makes an untouched volume open on its first chapter.
 */
export function partWindow(from: number, to: number, position: number, span = 6): number[] {
  const anchor = position >= from && position <= to ? position : from - 1;
  const start = Math.max(from, anchor - 2);
  const end = Math.min(to, start + span - 1);
  const rows: number[] = [];
  for (let n = start; n <= end; n++) rows.push(n);
  return rows;
}

/** `[1, 2, …, upTo]` — the watched list a position implies, for optimistic patches. */
export function partsUpTo(upTo: number): number[] {
  return Array.from({ length: Math.max(0, upTo) }, (_, i) => i + 1);
}

/**
 * What a status change does to the log's dates, mirroring the server's rules
 * (ADR-0007) so the stamped value shows the instant the status pill changes
 * instead of a request later. The server is still the authority — this feeds
 * the optimistic patch, which the following invalidation overwrites.
 */
export function stampedDates(status: LogStatus | null, current: LogDates, today: string): LogDates {
  if (status === null || status === 'planned') return { startedAt: null, finishedAt: null };
  const startedAt = current.startedAt ?? today;
  if (status === 'completed') return { startedAt, finishedAt: current.finishedAt ?? today };
  if (status === 'in_progress') return { startedAt, finishedAt: null };
  // paused / dropped: neither finishes the work, so the finish date stands.
  return { startedAt, finishedAt: current.finishedAt };
}

/**
 * The three checks the log-date form runs before it sends anything, mirroring
 * the server's exactly so the common typo never round-trips. The server keeps
 * them too — a client is not a validator — but a "dates can't be in the future"
 * that arrives as a 400 half a second later reads as a bug in the picker.
 *
 * Returns the problem as display copy, or null when the pair is sound. Both
 * clients call it: web's two `YYYY-MM-DD` fields and the app's native date
 * pickers can produce different mistakes, and neither may accept what the other
 * rejects.
 */
export function validateLogDates(dates: LogDates, today: string): string | null {
  const { startedAt, finishedAt } = dates;
  for (const value of [startedAt, finishedAt]) {
    if (value === null) continue;
    if (value < LOG_DATE_FLOOR) return `Dates start at ${LOG_DATE_FLOOR} — check the year.`;
    if (value > today) return 'Dates can’t be in the future.';
  }
  if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
    return 'The finish date is before the start date.';
  }
  return null;
}

/**
 * Every cached view derived from tracking data. One check-in changes the media
 * detail, the home dashboard (up next, in progress, stats) *and* the profile
 * activity feed — so a mutation that invalidates only its own page leaves the
 * others serving stale cache. That cache survives client-side navigation, so
 * the staleness lasted until a hard reload built a fresh QueryClient.
 *
 * `['media']` is a prefix: it matches every `['media', slug]` entry.
 */
const TRACKING_KEYS = [['media'], ['home'], ['profile'], ['history']] as const;

export async function invalidateTracking(queryClient: QueryClient): Promise<void> {
  await Promise.all(TRACKING_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}

async function mutate(
  path: string,
  method: 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<void> {
  const api = http();
  try {
    await api(path, { method, ...(body !== undefined ? { json: body } : {}) });
  } catch (error) {
    throw await toError(error, `${method} ${path}`);
  }
}

export const trackingApi = {
  setStatus: (id: string, status: LogStatus) => mutate(`media/${id}/log`, 'PUT', { status }),
  clearStatus: (id: string) => mutate(`media/${id}/log`, 'DELETE'),
  setScore: (id: string, score: number) => mutate(`media/${id}/rating`, 'PUT', { score }),
  clearScore: (id: string) => mutate(`media/${id}/rating`, 'DELETE'),
  checkIn: (id: string, number: number) => mutate(`media/${id}/progress/${number}`, 'PUT'),
  /**
   * "I am at part N": marks 1..upTo seen and clears anything past it, in one
   * request. `0` clears the work's progress.
   */
  setProgress: (id: string, upTo: number) => mutate(`media/${id}/progress`, 'PUT', { upTo }),
  uncheck: (id: string, number: number) => mutate(`media/${id}/progress/${number}`, 'DELETE'),
  favorite: (id: string) => mutate(`media/${id}/favorite`, 'PUT'),
  unfavorite: (id: string) => mutate(`media/${id}/favorite`, 'DELETE'),
  /**
   * Manual date correction (ADR-0007). The only tracking call that returns a
   * value: the server merges the patch against the stored row, so what the log
   * now says is not derivable from the request alone.
   */
  setDates: async (id: string, body: LogDatesBody): Promise<LogDates> => {
    try {
      const response = await http().patch(`media/${id}/log`, { json: body });
      return LogDatesSchema.parse(await response.json());
    } catch (error) {
      throw await toError(error, `PATCH media/${id}/log`);
    }
  },
};
