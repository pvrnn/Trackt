import { z } from 'zod';
import { ExternalIdsSchema, MediaKindSchema, MediaStatusSchema } from './media.js';

/** Free-form lowercase genre tags — deliberately not an enum, sources disagree too much. */
export const GenreSchema = z.string().min(1).max(64);

/**
 * The slim media contract shared by the central catalog service and every instance
 * (ADR-0001): only redistributable facts. `description`/`coverUrl` are enrichment
 * fields and stay nullable in the catalog.
 */
export const SlimMediaSchema = z.object({
  /** Canonical uuidv5 for provider-identified works; random for user-created ones. */
  id: z.uuid(),
  kind: MediaKindSchema,
  title: z.string().min(1),
  /** Alternative titles (original language, romanizations, common aliases). */
  synonyms: z.array(z.string()),
  year: z.number().int().nullable(),
  status: MediaStatusSchema.nullable(),
  genres: z.array(GenreSchema),
  episodeCount: z.number().int().nullable(),
  seasonCount: z.number().int().nullable(),
  chapterCount: z.number().int().nullable(),
  volumeCount: z.number().int().nullable(),
  externalIds: ExternalIdsSchema,
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
});
export type SlimMedia = z.infer<typeof SlimMediaSchema>;

export const CatalogVersionSchema = z.object({
  /** Monotonic change cursor (max seq); 0 for an empty catalog. */
  version: z.number().int().nonnegative(),
  mediaCount: z.number().int().nonnegative(),
  generatedAt: z.iso.datetime(),
});
export type CatalogVersion = z.infer<typeof CatalogVersionSchema>;

/** One changed catalog row; `deletedAt` set means the entry is tombstoned. */
export const CatalogChangeSchema = SlimMediaSchema.extend({
  seq: z.number().int().positive(),
  deletedAt: z.iso.datetime().nullable(),
});
export type CatalogChange = z.infer<typeof CatalogChangeSchema>;

/**
 * Query for `GET /v1/catalog/changes`. A full snapshot is `since=0` paged to
 * completion — the future instance sync job uses the same endpoint for initial
 * and incremental sync.
 */
export const CatalogChangesQuerySchema = z.object({
  since: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type CatalogChangesQuery = z.infer<typeof CatalogChangesQuerySchema>;

export const CatalogChangesResponseSchema = z.object({
  latestVersion: z.number().int().nonnegative(),
  /** Cursor for the next page, or null when this page is the last. */
  nextSince: z.number().int().positive().nullable(),
  changes: z.array(CatalogChangeSchema),
});
export type CatalogChangesResponse = z.infer<typeof CatalogChangesResponseSchema>;
