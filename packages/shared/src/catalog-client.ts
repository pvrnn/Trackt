import { z } from 'zod';
import {
  CatalogRelationEdgeSchema,
  CatalogSearchHitSchema,
  type CatalogRelationEdge,
  type CatalogSearchHit,
} from './catalog.js';

/**
 * Live client for the central catalog's read endpoints (ADR-0002, ADR-0004).
 * Throws on hard failures (network error, timeout, non-2xx, malformed envelope)
 * — callers on interactive request paths are expected to catch and degrade
 * gracefully; this layer stays honest so that policy lives in exactly one place.
 *
 * Individual items, however, parse forward-compatibly: a newer central catalog
 * may emit enum values (kind/status, or a relation type) this build doesn't
 * know, and one such item must not degrade the whole request. Unknown items are
 * skipped and reported via `skipped` so callers can log them.
 */

/** An item dropped because it doesn't match this build's contract. */
export interface SkippedItem {
  id: string | null;
  reason: string;
}

/** Envelopes stay strict; per-item contents are validated individually below. */
const SearchEnvelopeSchema = z.object({ results: z.array(z.looseObject({})) });
const RelationsEnvelopeSchema = z.object({ relations: z.array(z.looseObject({})) });

/**
 * Validate each item on its own so one unparseable entry costs only itself.
 * `label` names the item in a failure reason when the issue has no field path.
 */
function parseItems<T>(
  raws: Record<string, unknown>[],
  schema: z.ZodType<T>,
  label: string,
): { items: T[]; skipped: SkippedItem[] } {
  const items: T[] = [];
  const skipped: SkippedItem[] = [];
  for (const raw of raws) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || label}: ${issue.message}`)
        .join('; ');
      skipped.push({ id: typeof raw.id === 'string' ? raw.id : null, reason });
    }
  }
  return { items, skipped };
}

export interface FetchCatalogSearchOptions {
  kind?: string;
  limit?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FetchCatalogSearchResult {
  /** Hits that match this build's contract, in rank order as served. */
  results: CatalogSearchHit[];
  skipped: SkippedItem[];
}

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

  const envelope = SearchEnvelopeSchema.parse(await response.json());
  const { items, skipped } = parseItems(envelope.results, CatalogSearchHitSchema, '(hit)');
  return { results: items, skipped };
}

export interface FetchCatalogRelationsOptions {
  limit?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FetchCatalogRelationsResult {
  /** Edges touching the requested work, target-side, as served. */
  relations: CatalogRelationEdge[];
  skipped: SkippedItem[];
}

/**
 * Edges touching one work (ADR-0004). The forward-compat skip matters more here
 * than on search: a growing relation-type vocabulary is exactly what a newer
 * catalog looks like, and one unknown type must not blank the whole block.
 */
export async function fetchCatalogRelations(
  catalogUrl: string,
  id: string,
  options: FetchCatalogRelationsOptions,
): Promise<FetchCatalogRelationsResult> {
  const { limit, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/relations', catalogUrl);
  url.searchParams.set('id', id);
  if (limit) url.searchParams.set('limit', String(limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`catalog relations failed: ${response.status} ${response.statusText}`);
  }

  const envelope = RelationsEnvelopeSchema.parse(await response.json());
  const { items, skipped } = parseItems(envelope.relations, CatalogRelationEdgeSchema, '(edge)');
  return { relations: items, skipped };
}
