import { z } from 'zod';
import { MediaKindSchema } from './media.js';

/**
 * The home dashboard summary (`GET /api/v1/me/home`): everything the page
 * needs in one authenticated payload, derived entirely from the viewer's own
 * tracking rows (the mockup's Friends feed waits for the v1.x follow system).
 */

export const UpNextEntrySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  coverUrl: z.string().nullable(),
  /** Lowest unwatched episode/chapter number — the one-tap check-in target. */
  next: z.number().int().positive(),
  total: z.number().int().nullable(),
  partKind: z.enum(['episode', 'chapter']),
});
export type UpNextEntry = z.infer<typeof UpNextEntrySchema>;

export const InProgressEntrySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  coverUrl: z.string().nullable(),
  watched: z.number().int().nonnegative(),
  total: z.number().int().nullable(),
});
export type InProgressEntry = z.infer<typeof InProgressEntrySchema>;

export const ActivityEntrySchema = z.object({
  verb: z.enum(['checked_in', 'rated', 'status']),
  title: z.string(),
  slug: z.string(),
  /** Human fragment after the title, e.g. 'E5', '★ 8.5', 'completed'. */
  detail: z.string(),
  at: z.iso.datetime(),
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;

export const HomeSummarySchema = z.object({
  upNext: z.array(UpNextEntrySchema),
  inProgress: z.array(InProgressEntrySchema),
  activity: z.array(ActivityEntrySchema),
  stats: z.object({
    episodesThisYear: z.number().int().nonnegative(),
    chaptersThisYear: z.number().int().nonnegative(),
    /** Consecutive days with at least one check-in, ending today or yesterday. */
    dayStreak: z.number().int().nonnegative(),
    completedThisYear: z.number().int().nonnegative(),
  }),
});
export type HomeSummary = z.infer<typeof HomeSummarySchema>;
