import { z } from 'zod';

/** 0–10 with half-point granularity (PRD §3.2). */
export const ScoreSchema = z.number().min(0).max(10).multipleOf(0.5);
export type Score = z.infer<typeof ScoreSchema>;

/** Ratings and comments target either a whole work or a single part (episode/chapter). */
export const RATING_TARGETS = ['media', 'part'] as const;
export const RatingTargetSchema = z.enum(RATING_TARGETS);
export type RatingTarget = z.infer<typeof RatingTargetSchema>;

export const RateInputSchema = z.object({
  targetType: RatingTargetSchema,
  targetId: z.uuid(),
  score: ScoreSchema.nullish(),
  review: z.string().max(20_000).nullish(),
  hasSpoilers: z.boolean().default(false),
});
export type RateInput = z.infer<typeof RateInputSchema>;
