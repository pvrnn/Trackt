import { z } from 'zod';

/**
 * MyAnimeList API v2 (`https://api.myanimelist.net/v2`) list shapes, parsed
 * permissively: MAL adds fields without a version bump, and an unparsable
 * `list_status` must not take the whole import down — the mapper reads what it
 * recognises and warns about the rest.
 */

export const MalListStatusSchema = z.object({
  status: z.string(),
  /** 0 means "not scored". */
  score: z.number().nullish(),
  num_episodes_watched: z.number().nullish(),
  num_chapters_read: z.number().nullish(),
  num_volumes_read: z.number().nullish(),
  is_rewatching: z.boolean().nullish(),
  is_rereading: z.boolean().nullish(),
  num_times_rewatched: z.number().nullish(),
  num_times_reread: z.number().nullish(),
  /** `YYYY-MM-DD`, or a partial `YYYY-MM` / `YYYY`. */
  start_date: z.string().nullish(),
  finish_date: z.string().nullish(),
  comments: z.string().nullish(),
  updated_at: z.string().nullish(),
});

export const MalListEntrySchema = z.object({
  node: z.object({
    id: z.number().int().positive(),
    title: z.string(),
  }),
  list_status: MalListStatusSchema,
});

export const MalListResponseSchema = z.object({
  data: z.array(MalListEntrySchema),
  paging: z.object({ next: z.string().nullish() }).nullish(),
});

export type MalListEntry = z.infer<typeof MalListEntrySchema>;
export type MalListStatus = z.infer<typeof MalListStatusSchema>;
