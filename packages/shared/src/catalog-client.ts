import { CatalogSearchResponseSchema, type CatalogSearchResponse } from './catalog.js';

/**
 * Live client for the central catalog's search endpoint (ADR-0002). Throws on
 * any failure (network error, timeout, non-2xx, schema mismatch) — callers on
 * the interactive search path are expected to catch and degrade gracefully;
 * this layer stays honest so that policy lives in exactly one place.
 */
export interface FetchCatalogSearchOptions {
  kind?: string;
  limit?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export async function fetchCatalogSearch(
  catalogUrl: string,
  query: string,
  options: FetchCatalogSearchOptions,
): Promise<CatalogSearchResponse> {
  const { kind, limit, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/search', catalogUrl);
  url.searchParams.set('q', query);
  if (kind) url.searchParams.set('kind', kind);
  if (limit) url.searchParams.set('limit', String(limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`catalog search failed: ${response.status} ${response.statusText}`);
  }
  return CatalogSearchResponseSchema.parse(await response.json());
}
