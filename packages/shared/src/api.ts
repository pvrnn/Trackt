import { z } from 'zod';
import { MediaKindSchema } from './media.js';

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
  kind: MediaKindSchema,
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** A search hit as returned by a metadata provider, before it is cached locally. */
export const SearchResultSchema = z.object({
  provider: z.string(),
  externalId: z.string(),
  kind: MediaKindSchema,
  title: z.string(),
  originalTitle: z.string().optional(),
  year: z.number().int().optional(),
  coverUrl: z.string().optional(),
  description: z.string().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
