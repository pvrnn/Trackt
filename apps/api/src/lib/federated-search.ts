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
    return response.results;
  } catch (error) {
    options.logger.warn({ err: error }, 'central catalog search failed, degrading to local-only');
    return [];
  }
}

/**
 * Materializes central-only hits one at a time so one bad row can't drop the
 * rest. Results are built from the rows as persisted, not from the central
 * hit: the stored slug can differ (suffixed on a slug collision, or the id
 * may already exist locally under another slug), and answering with the
 * requested slug would navigate the client to the wrong media.
 */
async function materializeCentralHits(
  db: Db,
  hits: CatalogSearchHit[],
  logger: FastifyBaseLogger,
): Promise<(SearchResult & { rank: number })[]> {
  const materialized: (SearchResult & { rank: number })[] = [];
  for (const hit of hits) {
    const row = buildProviderMediaRow(hit);
    try {
      const [persisted] = await insertNewProviderMedia(db, [row]);
      if (!persisted) {
        logger.warn({ id: hit.id }, 'central catalog hit missing after materialization');
        continue;
      }
      materialized.push({
        id: persisted.id,
        slug: persisted.slug,
        kind: persisted.kind,
        title: persisted.title,
        year: persisted.year,
        status: persisted.status,
        coverUrl: persisted.coverUrl,
        description: persisted.description,
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
