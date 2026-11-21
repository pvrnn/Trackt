import type { FastifyBaseLogger } from 'fastify';
import {
  buildProviderMediaRow,
  findSoftDeletedMediaIds,
  insertNewProviderMedia,
  type Db,
} from '@trackt/db';
import {
  MEDIA_KINDS,
  compareSearchHits,
  GENRE_SUGGESTION_LIMIT,
  fetchCatalogGenres,
  fetchCatalogSearch,
  fetchCatalogSearchKinds,
  mediaStatusesFor,
  type CatalogSearchHit,
  type MediaKind,
  type SearchGenres,
  type SearchGenresQuery,
  type SearchKindCounts,
  type SearchKindsQuery,
  type SearchQuery,
  type SearchResult,
} from '@trackt/shared';
import type { SessionUser } from './session.js';
import { countLocalGenres, countLocalMediaKinds, searchLocalMedia } from './search.js';

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
      year: query.year,
      genres: query.genres,
      status: query.status,
      sort: query.sort,
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
    // A catalog older than the genre/status filters ignores them and answers unfiltered.
    return response.results.filter((hit) => matchesFilters(hit, query));
  } catch (error) {
    options.logger.warn({ err: error }, 'central catalog search failed, degrading to local-only');
    return [];
  }
}

function matchesFilters(hit: CatalogSearchHit, { genres, status }: SearchQuery): boolean {
  if (genres && !genres.every((genre) => hit.genres.includes(genre))) return false;
  if (status && (hit.status === null || !mediaStatusesFor(status).includes(hit.status))) {
    return false;
  }
  return true;
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
        seasonNumber: persisted.seasonNumber,
        coverUrl: persisted.coverUrl,
        description: persisted.description,
        metadata: persisted.metadata,
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
): Promise<{ results: SearchResult[]; hasMore: boolean }> {
  const sourceQuery = { ...query, limit: query.offset + query.limit + 1, offset: 0 };
  const [local, central] = await Promise.all([
    searchLocalMedia(db, sourceQuery),
    searchCentralSafe(catalogUrl, sourceQuery, options),
  ]);

  const localIds = new Set(local.map((r) => r.id));
  const centralById = new Map(central.map((hit) => [hit.id, hit]));
  const centralOnly = central.filter((hit) => !localIds.has(hit.id));
  // A soft-deleted local row is invisible to the local search above, so its
  // central hit lands here — filter it out or federation would resurrect a
  // title deliberately pulled from circulation. (The insert below couldn't
  // overwrite the row anyway, but the hit must not display either.)
  const softDeleted = await findSoftDeletedMediaIds(
    db,
    centralOnly.map((hit) => hit.id),
  );
  const insertable = centralOnly.filter((hit) => !softDeleted.has(hit.id));
  const merged = [
    ...local.map((result) => {
      const centralHit = centralById.get(result.id);
      return {
        source: 'local' as const,
        id: result.id,
        rank: result.rank,
        title: result.title,
        year: result.year,
        result: centralHit
          ? {
              ...result,
              metadata: { ...result.metadata, ...centralHit.metadata },
            }
          : result,
      };
    }),
    ...insertable.map((result) => ({
      source: 'central' as const,
      id: result.id,
      rank: result.rank,
      title: result.title,
      year: result.year,
      result,
    })),
  ].sort(compareSearchHits(query.sort));
  const page = merged.slice(query.offset, query.offset + query.limit + 1);
  const hasMore = page.length > query.limit;
  const visiblePage = page.slice(0, query.limit);
  const pageHits = visiblePage.flatMap((item) => (item.source === 'central' ? [item.result] : []));
  const materialized = await materializeCentralHits(db, pageHits, options.logger);
  const byId = new Map(materialized.map((result) => [result.id, result]));

  const results = visiblePage.flatMap((item) => {
    if (item.source === 'local') {
      const { rank: _rank, ...result } = item.result;
      return [result];
    }
    const result = byId.get(item.result.id);
    return result ? [result] : [];
  });
  return { results, hasMore };
}

/**
 * Hits per kind for the Discover kind strip: the central catalog's counts plus
 * the entries this instance created itself (its provider rows are copies of
 * catalog rows, already counted there). Without a reachable catalog that knows
 * the route, every local row counts, which is the search the viewer would get.
 * A soft-deleted local copy of a catalog row still counts on the catalog side,
 * so ALL can run a hit or two over what paging the results would reach.
 */
export async function countSearchKinds(
  db: Db,
  catalogUrl: string | undefined,
  query: SearchKindsQuery,
  options: SearchFederatedOptions,
): Promise<SearchKindCounts> {
  const central = catalogUrl
    ? await fetchCatalogSearchKinds(catalogUrl, query.q, {
        year: query.year,
        sort: query.sort,
        genres: query.genres,
        status: query.status,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      }).catch((error: unknown) => {
        options.logger.warn({ err: error }, 'central catalog kind counts failed, counting locally');
        return null;
      })
    : null;
  const local = await countLocalMediaKinds(db, query, { userOnly: central !== null });
  const kinds: Partial<Record<MediaKind, number>> = {};
  for (const kind of MEDIA_KINDS) {
    const count = (central?.[kind] ?? 0) + (local[kind] ?? 0);
    if (count > 0) kinds[kind] = count;
  }
  return { kinds };
}

/**
 * The genre vocabulary for Discover's filter panel: the catalog's tags plus any
 * only this instance's own entries carry, commonest first. Local-only when the
 * catalog is unreachable or predates the route.
 */
export async function listSearchGenres(
  db: Db,
  catalogUrl: string | undefined,
  { kind, q }: SearchGenresQuery,
  options: SearchFederatedOptions,
): Promise<SearchGenres> {
  const central = catalogUrl
    ? await fetchCatalogGenres(catalogUrl, {
        kind,
        q,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      }).catch((error: unknown) => {
        options.logger.warn({ err: error }, 'central catalog genres failed, listing locally');
        return null;
      })
    : null;
  const counts = await countLocalGenres(db, { kind, q }, { userOnly: central !== null });
  for (const { genre, count } of central ?? []) {
    // A catalog older than `q` answers with every genre.
    if (q && !genre.includes(q)) continue;
    counts.set(genre, (counts.get(genre) ?? 0) + count);
  }
  const prefix = (genre: string) => (q && genre.startsWith(q) ? 1 : 0);
  const genres = [...counts]
    .sort(
      ([a, countA], [b, countB]) => prefix(b) - prefix(a) || countB - countA || a.localeCompare(b),
    )
    .map(([genre]) => genre);
  return { genres: q ? genres.slice(0, GENRE_SUGGESTION_LIMIT) : genres };
}
