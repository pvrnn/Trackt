import { z } from 'zod';
import { RelatedWorkSchema, SearchResultSchema } from './api.js';
import {
  ExternalIdsSchema,
  LogStatusSchema,
  MediaKindSchema,
  MediaSourceSchema,
  MediaStatusSchema,
  ModerationStatusSchema,
} from './media.js';

/**
 * Contracts for the media detail page and the tracking core (PRD §3.1–3.2):
 * one detail payload carrying everything the page needs, plus the bodies of
 * the log/rating/progress mutations.
 */

/** Rating score: 0–10 in half-point steps (PRD §3.2). */
export const RatingScoreSchema = z
  .number()
  .min(0)
  .max(10)
  .refine((score) => Number.isInteger(score * 2), 'score must be in 0.5 steps');

/** The requesting user's relationship to a work; null when unauthenticated. */
export const ViewerStateSchema = z.object({
  status: LogStatusSchema.nullable(),
  score: RatingScoreSchema.nullable(),
  /** Checked-in episode/chapter numbers (integers — generated flat parts). */
  watched: z.array(z.number()),
  favorited: z.boolean(),
  /** When the viewer started / finished the work (ADR-0007); ISO dates. */
  startedAt: z.iso.date().nullable(),
  finishedAt: z.iso.date().nullable(),
});
export type ViewerState = z.infer<typeof ViewerStateSchema>;

export const MediaDetailSchema = z.object({
  id: z.uuid(),
  kind: MediaKindSchema,
  title: z.string(),
  originalTitle: z.string().nullable(),
  slug: z.string(),
  synonyms: z.array(z.string()),
  genres: z.array(z.string()),
  year: z.number().int().nullable(),
  /** Episodes (series/anime season) or chapters (manga/webtoon); null for movies (ADR-0003). */
  partCount: z.number().int().nullable(),
  /** Season number for series/anime split per season (ADR-0003); null otherwise. */
  seasonNumber: z.number().int().nullable(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  releaseDate: z.string().nullable(),
  status: MediaStatusSchema.nullable(),
  externalIds: ExternalIdsSchema,
  source: MediaSourceSchema,
  moderation: ModerationStatusSchema,
  community: z.object({
    averageScore: z.number().nullable(),
    ratingCount: z.number().int().nonnegative(),
  }),
  /**
   * Typed links to other works (ADR-0004), pre-labelled for display: a
   * reverse-traversed edge already reads as prequel/source/parent. Empty for
   * anything but adjacent series seasons until the catalog publishes edges —
   * the client then falls back to `related` below.
   */
  relations: z.array(RelatedWorkSchema),
  /**
   * Same-kind, genre-overlapping *suggestions* — not relations. The labelled
   * fallback the client renders ("You might also like") when `relations` is
   * empty; always sent, so the payload's meaning never depends on hidden state.
   */
  related: z.array(SearchResultSchema),
  viewer: ViewerStateSchema.nullable(),
});
export type MediaDetail = z.infer<typeof MediaDetailSchema>;

export const UpdateLogBodySchema = z.object({ status: LogStatusSchema });
export type UpdateLogBody = z.infer<typeof UpdateLogBodySchema>;

/**
 * Manual date edit (`PATCH /v1/media/:id/log`). Both fields optional *and*
 * nullable, and the difference matters: an absent key leaves the column alone,
 * an explicit `null` clears it. A body that mentions neither has nothing to do,
 * so it is rejected rather than silently succeeding.
 *
 * A floor of 1900-01-01 catches the slipped keystroke (`0202-08-14`) that would
 * otherwise file a title 1800 years back and stretch every year facet on the
 * history page. The other two rules — no future date, and
 * `finishedAt >= startedAt` — are server-side only: both have to be checked
 * against the *stored* row, which a body schema cannot see (ADR-0007).
 */
export const LOG_DATE_FLOOR = '1900-01-01';

/** ISO dates are zero-padded and fixed-width, so `>=` is a date comparison. */
const LogDateSchema = z.iso
  .date()
  .refine((value) => value >= LOG_DATE_FLOOR, `date must be on or after ${LOG_DATE_FLOOR}`);

export const LogDatesBodySchema = z
  .object({
    startedAt: LogDateSchema.nullable(),
    finishedAt: LogDateSchema.nullable(),
  })
  .partial()
  .refine(
    (body) => body.startedAt !== undefined || body.finishedAt !== undefined,
    'nothing to update',
  );
export type LogDatesBody = z.infer<typeof LogDatesBodySchema>;

/** What the PATCH returns: the row's dates after the merge. */
export const LogDatesSchema = z.object({
  startedAt: z.iso.date().nullable(),
  finishedAt: z.iso.date().nullable(),
});
export type LogDates = z.infer<typeof LogDatesSchema>;

export const RateBodySchema = z.object({ score: RatingScoreSchema });
export type RateBody = z.infer<typeof RateBodySchema>;

/**
 * Path param for check-ins: the 1-based episode/chapter number.
 * Capped well below the DB column limit (`media_part.number` is numeric(8,2),
 * max 999999.99) so absurd numbers 400 instead of overflowing to a 500 —
 * `partCount` is null for airing seasons and user entries, so the route can't
 * always bound it.
 */
export const PartNumberParamSchema = z.coerce.number().int().positive().max(99999);
