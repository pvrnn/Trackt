import { z } from 'zod';
import { ActivityEntrySchema } from './home.js';
import { MediaKindSchema } from './media.js';

/**
 * Own-profile summary (`GET /api/v1/me/profile`). Followers/badges/visibility
 * wait for the v1.x social layer; everything here derives from the viewer's
 * account and tracking rows.
 */

export const FavoriteEntrySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  coverUrl: z.string().nullable(),
  /** 1-based rank within the kind block (insertion order for now). */
  rank: z.number().int().positive(),
});
export type FavoriteEntry = z.infer<typeof FavoriteEntrySchema>;

export const ProfileSummarySchema = z.object({
  user: z.object({
    name: z.string(),
    username: z.string(),
    joinedAt: z.iso.datetime(),
  }),
  stats: z.object({
    episodesThisYear: z.number().int().nonnegative(),
    chaptersThisYear: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    titlesTracked: z.number().int().nonnegative(),
    /** Mean of the viewer's media ratings, null while unrated. */
    meanRating: z.number().nullable(),
    dayStreak: z.number().int().nonnegative(),
  }),
  /** Grouped client-side by kind; ordered by kind then rank. */
  favorites: z.array(FavoriteEntrySchema),
  activity: z.array(ActivityEntrySchema),
});
export type ProfileSummary = z.infer<typeof ProfileSummarySchema>;
