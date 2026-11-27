import { z } from 'zod';
import {
  CatalogGenresResponseSchema,
  CatalogRelationEdgeSchema,
  CatalogSearchHitSchema,
  CatalogSearchKindsResponseSchema,
  SlimMediaSchema,
  type CatalogGenresResponse,
  type CatalogRelationEdge,
  type CatalogSearchHit,
  type SlimMedia,
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

/** Discover's narrowing filters, as the catalog's query string spells them. */
interface CatalogFilterOptions {
  genres?: readonly string[] | undefined;
  status?: string | undefined;
}

function setFilterParams(url: URL, { genres, status }: CatalogFilterOptions): void {
  if (genres && genres.length > 0) url.searchParams.set('genres', genres.join(','));
  if (status) url.searchParams.set('status', status);
}

export interface FetchCatalogSearchOptions extends CatalogFilterOptions {
  kind?: string;
  year?: number;
  /** Omitted for relevance, so a catalog that predates `sort` sees the request it always did. */
  sort?: string;
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
  const { kind, year, sort, limit, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/search', catalogUrl);
  url.searchParams.set('q', query);
  if (kind) url.searchParams.set('kind', kind);
  if (year) url.searchParams.set('year', String(year));
  setFilterParams(url, options);
  if (sort && sort !== 'relevance') url.searchParams.set('sort', sort);
  if (limit) url.searchParams.set('limit', String(limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`catalog search failed: ${response.status} ${response.statusText}`);
  }

  const envelope = SearchEnvelopeSchema.parse(await response.json());
  const { items, skipped } = parseItems(envelope.results, CatalogSearchHitSchema, '(hit)');
  return { results: items, skipped };
}

export interface FetchCatalogSearchKindsOptions extends CatalogFilterOptions {
  year?: number | undefined;
  sort?: string | undefined;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Per-kind hit counts for a query. Returns null when the catalog predates the
 * route (404), so the caller can tell "no counts to give" from "zero hits".
 */
export async function fetchCatalogSearchKinds(
  catalogUrl: string,
  query: string,
  options: FetchCatalogSearchKindsOptions,
): Promise<Record<string, number> | null> {
  const { year, sort, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/search/kinds', catalogUrl);
  url.searchParams.set('q', query);
  if (year) url.searchParams.set('year', String(year));
  if (sort && sort !== 'relevance') url.searchParams.set('sort', sort);
  setFilterParams(url, options);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`catalog search kinds failed: ${response.status} ${response.statusText}`);
  }
  return CatalogSearchKindsResponseSchema.parse(await response.json()).kinds;
}

export interface FetchCatalogGenresOptions {
  kind?: string | undefined;
  q?: string | undefined;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** Genre tags in use on the catalog, or null when it predates the route (404). */
export async function fetchCatalogGenres(
  catalogUrl: string,
  options: FetchCatalogGenresOptions,
): Promise<CatalogGenresResponse['genres'] | null> {
  const { kind, q, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/genres', catalogUrl);
  if (kind) url.searchParams.set('kind', kind);
  if (q) url.searchParams.set('q', q);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`catalog genres failed: ${response.status} ${response.statusText}`);
  }
  return CatalogGenresResponseSchema.parse(await response.json()).genres;
}

export interface FetchCatalogShowcaseOptions extends CatalogFilterOptions {
  kind?: string | undefined;
  year?: number | undefined;
  offset?: number;
  limit?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FetchCatalogShowcaseResult {
  /** Works that match this build's contract, in shelf order as served. */
  results: SlimMedia[];
  skipped: SkippedItem[];
}

/** One batch of the catalog's browse shelf, or null when the catalog predates the route (404). */
export async function fetchCatalogShowcase(
  catalogUrl: string,
  options: FetchCatalogShowcaseOptions,
): Promise<FetchCatalogShowcaseResult | null> {
  const { kind, year, offset, limit, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/catalog/showcase', catalogUrl);
  if (kind) url.searchParams.set('kind', kind);
  if (year) url.searchParams.set('year', String(year));
  setFilterParams(url, options);
  if (offset) url.searchParams.set('offset', String(offset));
  if (limit) url.searchParams.set('limit', String(limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`catalog showcase failed: ${response.status} ${response.statusText}`);
  }

  const envelope = SearchEnvelopeSchema.parse(await response.json());
  const { items, skipped } = parseItems(envelope.results, SlimMediaSchema, '(work)');
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

export interface FetchCatalogMediaOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/** One work by canonical id, or null when the catalog has no live row for it. */
export async function fetchCatalogMedia(
  catalogUrl: string,
  id: string,
  options: FetchCatalogMediaOptions,
): Promise<SlimMedia | null> {
  const { timeoutMs, fetchImpl = fetch } = options;
  const url = new URL(`/v1/catalog/media/${encodeURIComponent(id)}`, catalogUrl);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`catalog media failed: ${response.status} ${response.statusText}`);
  }
  return SlimMediaSchema.parse(await response.json());
}
