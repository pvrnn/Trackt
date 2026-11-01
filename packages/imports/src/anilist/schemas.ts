import { z } from 'zod';

/**
 * AniList GraphQL (`https://graphql.anilist.co`) list shapes, parsed
 * permissively like MAL's: AniList adds fields without a version bump, and one
 * unreadable row must not take the whole import down — the mapper reads what it
 * recognises and warns about the rest.
 *
 * Every list the account has (Completed, Watching, custom lists) carries the
 * same entries under a name we do not need: the entry's own status says it all.
 */

export const AniListDateSchema = z.object({
  year: z.number().int().nullish(),
  month: z.number().int().nullish(),
  day: z.number().int().nullish(),
});

export const AniListMediaSchema = z.object({
  id: z.number().int(),
  /** The MAL id for the same work, when AniList has mapped it. */
  idMal: z.number().int().nullish(),
  episodes: z.number().int().nullish(),
  chapters: z.number().int().nullish(),
  format: z.string().nullish(),
  seasonYear: z.number().int().nullish(),
  title: z
    .object({
      romaji: z.string().nullish(),
      english: z.string().nullish(),
    })
    .nullish(),
});

export const AniListListEntrySchema = z.object({
  mediaId: z.number().int(),
  /** `CURRENT`, `COMPLETED`, `PLANNING`, `DROPPED`, `PAUSED`, `REPEATING`. */
  status: z.string(),
  /** 0–100 whatever the account's own score format; 0 means "not scored". */
  score: z.number().nullish(),
  progress: z.number().nullish(),
  repeat: z.number().nullish(),
  notes: z.string().nullish(),
  startedAt: AniListDateSchema.nullish(),
  completedAt: AniListDateSchema.nullish(),
  /** Null when the work itself was removed from AniList. */
  media: AniListMediaSchema.nullish(),
});

export const AniListMediaListCollectionSchema = z.object({
  lists: z
    .array(z.object({ name: z.string().nullish(), entries: z.array(AniListListEntrySchema) }))
    .nullish(),
});

export const AniListErrorSchema = z.object({
  message: z.string(),
  status: z.number().nullish(),
});

export const AniListResponseSchema = z.object({
  data: z.object({ MediaListCollection: AniListMediaListCollectionSchema.nullish() }).nullish(),
  errors: z.array(AniListErrorSchema).nullish(),
});

export type AniListDate = z.infer<typeof AniListDateSchema>;
export type AniListMedia = z.infer<typeof AniListMediaSchema>;
export type AniListListEntry = z.infer<typeof AniListListEntrySchema>;
export type AniListMediaListCollection = z.infer<typeof AniListMediaListCollectionSchema>;
