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

/**
 * Query for `GET /v1/catalog/search` — the live federated-search surface
 * (ADR-0002). Deliberately mirrors `SearchQuerySchema` in api.ts; kept as a
 * separate schema because it's a distinct service's contract.
 */
export const CatalogSearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  kind: MediaKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CatalogSearchQuery = z.infer<typeof CatalogSearchQuerySchema>;

/** A central-catalog search hit; `rank` lets callers merge-sort against local results. */
export const CatalogSearchHitSchema = SlimMediaSchema.extend({
  rank: z.number(),
});
export type CatalogSearchHit = z.infer<typeof CatalogSearchHitSchema>;

export const CatalogSearchResponseSchema = z.object({
  results: z.array(CatalogSearchHitSchema),
});
export type CatalogSearchResponse = z.infer<typeof CatalogSearchResponseSchema>;
