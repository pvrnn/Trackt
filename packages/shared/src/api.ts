import { z } from 'zod';
import { MediaKindSchema, MediaRelationLabelSchema, MediaStatusSchema } from './media.js';

export const APP_VERSION = '0.1.0';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ReadyCheckSchema = z.enum(['ok', 'error', 'skipped']);
export const ReadyResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), ReadyCheckSchema),
});
export type ReadyResponse = z.infer<typeof ReadyResponseSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().min(1).max(200),
  /** Optional filter — search is cross-kind by default. */
  kind: MediaKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** A search hit from the instance's local catalog (ADR-0001). */
export const SearchResultSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  year: z.number().int().nullable(),
  status: MediaStatusSchema.nullable(),
  /** Season number for series/anime split per season (ADR-0003); null otherwise — lets cards label "Season N". */
  seasonNumber: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  description: z.string().nullable(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * How many titles `GET /v1/media/showcase` returns: what this instance has, for
 * the landing page's cover band. Enough to fill a wide viewport twice over (the
 * band duplicates its contents to loop seamlessly) without making an anonymous
 * endpoint worth hammering.
 */
export const SHOWCASE_LIMIT = 24;

/** Kinds are round-robined into the band, so this is its per-kind depth. */
export const SHOWCASE_PER_KIND = 5;

/**
 * A work linked to another by a typed relation (ADR-0004), with the direction
 * already resolved into the label it renders under — a reverse-traversed
 * `sequel` edge arrives as `prequel`, so clients never reimplement the flip.
 */
export const RelatedWorkSchema = SearchResultSchema.extend({
  relation: MediaRelationLabelSchema,
});
export type RelatedWork = z.infer<typeof RelatedWorkSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
