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
    bio: z.string().nullable(),
    image: z.string().nullable(),
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

/** Editable profile fields (`PATCH /api/v1/me/profile`). Username is fixed. */
export const UpdateProfileBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    bio: z.string().trim().max(280).nullable(),
  })
  .partial();
export type UpdateProfileBody = z.infer<typeof UpdateProfileBodySchema>;

/** Avatar constraints shared by the upload endpoint and the edit form. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const AvatarResponseSchema = z.object({ image: z.string().nullable() });
export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;
