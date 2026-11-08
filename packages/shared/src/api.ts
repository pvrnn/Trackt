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
  /** Optional release-year filter; a hit with no year never matches one. */
  year: z.coerce.number().int().min(1800).max(2200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** Number of ranked results to skip; bounded to keep federated prefix scans finite. */
  offset: z.coerce.number().int().min(0).max(1000).default(0),
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
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * How many titles a `GET /v1/media/showcase` batch carries: this instance's own
 * catalog, for the landing page's cover band and Discover's browse shelf. Enough
 * to fill a wide viewport twice over (the band duplicates its contents to loop
 * seamlessly) without making an anonymous endpoint worth hammering — and small
 * enough that scrolling the shelf one batch at a time stays cheap.
 */
export const SHOWCASE_LIMIT = 24;

/**
 * Farthest `offset` the shelf may page to. Like search, a browse surface is a
 * suggestion, not an exhaustive listing: past ~40 batches the caller has seen
 * everything a shelf is for, and the bound keeps an anonymous walk of the whole
 * catalog off the table. Mirrored by `useShowcase`'s stop condition.
 */
export const SHOWCASE_MAX_OFFSET = 1000;

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
