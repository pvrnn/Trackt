import { z } from 'zod';
import { CatalogSearchHitSchema, type CatalogSearchHit } from './catalog.js';

/**
 * Live client for the central catalog's search endpoint (ADR-0002). Throws on
 * hard failures (network error, timeout, non-2xx, malformed envelope) — callers
 * on the interactive search path are expected to catch and degrade gracefully;
 * this layer stays honest so that policy lives in exactly one place.
 *
 * Individual hits, however, parse forward-compatibly: a newer central catalog
 * may emit enum values (kind/status) this build doesn't know, and one such hit
 * must not degrade the whole federated search to local-only. Unknown hits are
 * skipped and reported via `skipped` so callers can log them.
 */
export interface FetchCatalogSearchOptions {
  kind?: string;
  limit?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FetchCatalogSearchResult {
  /** Hits that match this build's contract, in rank order as served. */
  results: CatalogSearchHit[];
  /** Hits dropped because they don't match this build's contract. */
  skipped: { id: string | null; reason: string }[];
}

/** Envelope stays strict; per-hit contents are validated individually below. */
const LenientSearchEnvelopeSchema = z.object({
  results: z.array(z.looseObject({})),
});

export async function fetchCatalogSearch(
  catalogUrl: string,
  query: string,
  options: FetchCatalogSearchOptions,
): Promise<FetchCatalogSearchResult> {
  const { kind, limit, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/search', catalogUrl);
  url.searchParams.set('q', query);
  if (kind) url.searchParams.set('kind', kind);
  if (limit) url.searchParams.set('limit', String(limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`catalog search failed: ${response.status} ${response.statusText}`);
  }

  const envelope = LenientSearchEnvelopeSchema.parse(await response.json());
  const results: CatalogSearchHit[] = [];
  const skipped: FetchCatalogSearchResult['skipped'] = [];
  for (const raw of envelope.results) {
    const parsed = CatalogSearchHitSchema.safeParse(raw);
    if (parsed.success) {
      results.push(parsed.data);
    } else {
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(hit)'}: ${issue.message}`)
        .join('; ');
      skipped.push({ id: typeof raw.id === 'string' ? raw.id : null, reason });
    }
  }
  return { results, skipped };
}
