import { z } from 'zod';
import { SearchResultSchema } from './api.js';
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
  episodeCount: z.number().int().nullable(),
  seasonCount: z.number().int().nullable(),
  chapterCount: z.number().int().nullable(),
  volumeCount: z.number().int().nullable(),
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
  /** Same-kind, genre-overlapping suggestions for the sidebar. */
  related: z.array(SearchResultSchema),
  viewer: ViewerStateSchema.nullable(),
});
export type MediaDetail = z.infer<typeof MediaDetailSchema>;

export const UpdateLogBodySchema = z.object({ status: LogStatusSchema });
export type UpdateLogBody = z.infer<typeof UpdateLogBodySchema>;

export const RateBodySchema = z.object({ score: RatingScoreSchema });
export type RateBody = z.infer<typeof RateBodySchema>;

/**
 * Path param for check-ins: the 1-based episode/chapter number.
 * Capped well below the DB column limit (`media_part.number` is numeric(8,2),
 * max 999999.99) so absurd numbers 400 instead of overflowing to a 500 —
 * episodeCount/chapterCount is null for airing series and user entries, so the
 * route can't always bound it.
 */
export const PartNumberParamSchema = z.coerce.number().int().positive().max(99999);
