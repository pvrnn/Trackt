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

/**
 * Linkable platforms shown on the profile. `base` composes a URL from a bare
 * handle ('website' takes full URLs only).
 */
export const SOCIAL_PLATFORMS = {
  website: { label: 'Website', base: null },
  x: { label: 'X', base: 'https://x.com/' },
  instagram: { label: 'Instagram', base: 'https://instagram.com/' },
  bluesky: { label: 'Bluesky', base: 'https://bsky.app/profile/' },
  anilist: { label: 'AniList', base: 'https://anilist.co/user/' },
  myanimelist: { label: 'MyAnimeList', base: 'https://myanimelist.net/profile/' },
  letterboxd: { label: 'Letterboxd', base: 'https://letterboxd.com/' },
} as const;
export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;
export const SOCIAL_PLATFORM_KEYS = Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[];

/** Sparse platform → https URL map; absent key = not linked. */
export const SocialLinksSchema = z
  .partialRecord(
    z.enum(SOCIAL_PLATFORM_KEYS as [SocialPlatform, ...SocialPlatform[]]),
    z.url({ protocol: /^https$/ }).max(200),
  )
  .refine((links) => Object.keys(links).length <= SOCIAL_PLATFORM_KEYS.length);
export type SocialLinks = z.infer<typeof SocialLinksSchema>;

/** 'handle or URL' input → canonical https URL for the platform; null if unusable. */
export function normalizeSocialLink(platform: SocialPlatform, input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  const base = SOCIAL_PLATFORMS[platform].base;
  if (!base) return null; // website requires a full URL
  return `${base}${value.replace(/^@/, '')}`;
}

export const ProfileSummarySchema = z.object({
  user: z.object({
    name: z.string(),
    username: z.string(),
    bio: z.string().nullable(),
    image: z.string().nullable(),
    socialLinks: SocialLinksSchema,
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
    /** Full replacement of the links map (sparse — omit a platform to unlink it). */
    socialLinks: SocialLinksSchema,
  })
  .partial();
export type UpdateProfileBody = z.infer<typeof UpdateProfileBodySchema>;

/** Avatar constraints shared by the upload endpoint and the edit form. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const AvatarResponseSchema = z.object({ image: z.string().nullable() });
export type AvatarResponse = z.infer<typeof AvatarResponseSchema>;
