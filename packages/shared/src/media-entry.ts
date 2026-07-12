import { z } from 'zod';
import {
  MediaKindSchema,
  MediaStatusSchema,
  ModerationStatusSchema,
  type UserRole,
} from './media.js';

/**
 * Contracts for user-created entries and the per-instance moderation queue
 * (PRD §3.5, §7): any signed-in user can add a missing title (usable
 * immediately, visible only to them until verified); moderators approve,
 * edit, or reject via `/api/v1/moderation`.
 */

/** Moderators and admins share all moderation powers (PRD §7). */
export function isModerator(role: UserRole): boolean {
  return role === 'moderator' || role === 'admin';
}

/** Per-user cap on entry creation, per rolling 24h (PRD §7 rate-limiting). */
export const MEDIA_CREATE_DAILY_LIMIT = 20;

const TitleSchema = z.string().trim().min(1).max(300);
const TagListSchema = z.array(z.string().trim().min(1).max(60)).max(12);
const CountSchema = z.number().int().positive().max(100_000);
const YearSchema = z
  .number()
  .int()
  .min(1850)
  .refine((year) => year <= new Date().getFullYear() + 5, 'year is too far in the future');

/** Fields a creator sets and a moderator may later edit. */
const EditableMediaFields = z.object({
  title: TitleSchema,
  originalTitle: TitleSchema.nullable(),
  year: YearSchema.nullable(),
  description: z.string().trim().max(5000).nullable(),
  genres: TagListSchema,
  synonyms: TagListSchema,
  status: MediaStatusSchema.nullable(),
  releaseDate: z.iso.date().nullable(),
  episodeCount: CountSchema.nullable(),
  seasonCount: CountSchema.nullable(),
  chapterCount: CountSchema.nullable(),
  volumeCount: CountSchema.nullable(),
});

/** Count fields that make sense per kind; the rest must stay unset. */
const COUNT_FIELDS_BY_KIND = {
  movie: [],
  series: ['episodeCount', 'seasonCount'],
  anime: ['episodeCount', 'seasonCount'],
  manga: ['chapterCount', 'volumeCount'],
  webtoon: ['chapterCount', 'volumeCount'],
} as const;
const ALL_COUNT_FIELDS = ['episodeCount', 'seasonCount', 'chapterCount', 'volumeCount'] as const;

/** `POST /api/v1/media` — create a user entry (starts `unverified`). */
export const CreateMediaBodySchema = EditableMediaFields.partial()
  .extend({
    kind: MediaKindSchema,
    title: TitleSchema,
  })
  .superRefine((body, ctx) => {
    const allowed: readonly string[] = COUNT_FIELDS_BY_KIND[body.kind];
    for (const field of ALL_COUNT_FIELDS) {
      if (body[field] != null && !allowed.includes(field)) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} does not apply to ${body.kind}`,
        });
      }
    }
  });
export type CreateMediaBody = z.infer<typeof CreateMediaBodySchema>;

export const CreateMediaResponseSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  moderation: ModerationStatusSchema,
});
export type CreateMediaResponse = z.infer<typeof CreateMediaResponseSchema>;

/**
 * `PATCH /api/v1/moderation/media/:id` — moderator edit and/or verdict.
 * Both verdict directions are allowed so a rejected entry can be re-approved
 * from the queue's rejected filter.
 */
export const ModerationPatchBodySchema = EditableMediaFields.partial()
  .extend({
    moderation: z.enum(['verified', 'rejected']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');
export type ModerationPatchBody = z.infer<typeof ModerationPatchBodySchema>;

export const ModerationQueueQuerySchema = z.object({
  status: z.enum(['unverified', 'rejected']).default('unverified'),
});
export type ModerationQueueQuery = z.infer<typeof ModerationQueueQuerySchema>;

export const ModerationQueueItemSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  originalTitle: z.string().nullable(),
  year: z.number().int().nullable(),
  description: z.string().nullable(),
  genres: z.array(z.string()),
  synonyms: z.array(z.string()),
  episodeCount: z.number().int().nullable(),
  seasonCount: z.number().int().nullable(),
  chapterCount: z.number().int().nullable(),
  volumeCount: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  moderation: ModerationStatusSchema,
  createdAt: z.iso.datetime(),
  /** Null when the creator's account was deleted. */
  creator: z.object({ username: z.string().nullable(), name: z.string() }).nullable(),
});
export type ModerationQueueItem = z.infer<typeof ModerationQueueItemSchema>;

export const ModerationQueueResponseSchema = z.object({
  items: z.array(ModerationQueueItemSchema),
});
export type ModerationQueueResponse = z.infer<typeof ModerationQueueResponseSchema>;

/** `POST /api/v1/media/:id/cover` — same constraints as avatars. */
export const CoverResponseSchema = z.object({ coverUrl: z.string() });
export type CoverResponse = z.infer<typeof CoverResponseSchema>;
