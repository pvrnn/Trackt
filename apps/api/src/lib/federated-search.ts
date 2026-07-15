import type { FastifyBaseLogger } from 'fastify';
import { buildProviderMediaRow, insertNewProviderMedia, type Db } from '@trackt/db';
import {
  fetchCatalogSearch,
  type CatalogSearchHit,
  type SearchQuery,
  type SearchResult,
} from '@trackt/shared';
import type { SessionUser } from './session.js';
import { searchLocalMedia } from './search.js';

/**
 * Federated catalog search (ADR-0002): queries the instance's local `media`
 * table and the central catalog live, in parallel, and merges by canonical
 * id. Central-only hits are materialized into `media` once, as a one-time
 * snapshot (never re-synced — canonical UUIDs make dedup trivial, so no
 * background staleness tracking exists). The central call never fails the
 * request: any timeout/network/schema error degrades to local-only results.
 */

export interface SearchFederatedOptions {
  timeoutMs: number;
  logger: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
}

async function searchCentralSafe(
  catalogUrl: string | undefined,
  query: SearchQuery,
  options: SearchFederatedOptions,
): Promise<CatalogSearchHit[]> {
  if (!catalogUrl) return [];
  try {
    const response = await fetchCatalogSearch(catalogUrl, query.q, {
      kind: query.kind,
      limit: query.limit,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    if (response.skipped.length > 0) {
      // Forward-compat: a newer central catalog sent hits this build can't
      // parse (e.g. an unknown media kind); the rest of the page still counts.
      options.logger.warn(
        { skipped: response.skipped },
        'skipping central catalog hits that do not match this build (upgrade to pick them up)',
      );
    }
    return response.results;
  } catch (error) {
    options.logger.warn({ err: error }, 'central catalog search failed, degrading to local-only');
    return [];
  }
}

/** Materializes central-only hits one at a time so one bad row can't drop the rest. */
async function materializeCentralHits(
  db: Db,
  hits: CatalogSearchHit[],
  logger: FastifyBaseLogger,
): Promise<(SearchResult & { rank: number })[]> {
  const materialized: (SearchResult & { rank: number })[] = [];
  for (const hit of hits) {
    const row = buildProviderMediaRow(hit);
    try {
      await insertNewProviderMedia(db, [row]);
      materialized.push({
        id: row.id,
        slug: row.slug,
        kind: row.kind,
        title: row.title,
        year: row.year ?? null,
        status: row.status ?? null,
        coverUrl: row.coverUrl ?? null,
        description: row.description ?? null,
        rank: hit.rank,
      });
    } catch (error) {
      logger.warn({ err: error, id: hit.id }, 'failed to materialize a central catalog hit');
    }
  }
  return materialized;
}

export async function searchFederated(
  db: Db,
  catalogUrl: string | undefined,
  query: SearchQuery,
  viewer: SessionUser | null,
  options: SearchFederatedOptions,
): Promise<SearchResult[]> {
  const [local, central] = await Promise.all([
    searchLocalMedia(db, query, viewer),
    searchCentralSafe(catalogUrl, query, options),
  ]);

  const localIds = new Set(local.map((r) => r.id));
  const centralOnly = central.filter((hit) => !localIds.has(hit.id));
  const materialized = await materializeCentralHits(db, centralOnly, options.logger);

  return [...local, ...materialized]
    .sort((a, b) => b.rank - a.rank || a.title.localeCompare(b.title))
    .slice(0, query.limit)
    .map(({ rank: _rank, ...result }) => result);
}
