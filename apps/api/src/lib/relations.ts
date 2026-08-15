import { inArray, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  buildProviderMediaRow,
  insertNewProviderMedia,
  media,
  type Db,
  type PersistedMediaRow,
} from '@trackt/db';
import {
  MEDIA_RELATION_LABELS,
  fetchCatalogRelations,
  relationLabel,
  type CatalogRelationEdge,
  type MediaRelationLabel,
  type RelatedWork,
} from '@trackt/shared';
import { canViewMedia, visibleMediaSql } from './visibility.js';

/**
 * Typed relations for the media detail page (ADR-0004), merged from three
 * sources: edges already stored locally, edges the central catalog serves live,
 * and adjacent series seasons derived on the fly from `external_ids.tmdb` +
 * `season_number`.
 *
 * The catalog call is timeout-bounded and never fails the request — an
 * unreachable catalog degrades to locally-known relations, the same posture as
 * federated search. Catalog targets absent locally are materialized into `media`
 * once before their ids reach a client (extending ADR-0002 point 2 to a second
 * discovery path), so everything returned is a real, trackable local row.
 *
 * Edges carry no visibility of their own, so all three sources filter targets
 * through lib/visibility.ts — without that, a soft-deleted row would resurface
 * through a sibling, and legacy non-`verified` rows would leak as sequels.
 */

/** How many relations one detail page renders — enough for a show plus its adaptations. */
const RELATION_LIMIT = 12;

export interface LoadRelationsOptions {
  timeoutMs: number;
  logger: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
}

/** The media columns the relation queries need; a subset of the full row. */
interface RelationSourceRow {
  id: string;
  kind: string;
  seasonNumber: number | null;
  externalIds: Record<string, string | number>;
}

function displayOrder(label: MediaRelationLabel): number {
  return MEDIA_RELATION_LABELS.indexOf(label);
}

/** Map a raw snake_case `media` row from db.execute plus a label into the wire shape. */
function fromRawRow(row: Record<string, unknown>, relation: MediaRelationLabel): RelatedWork {
  return {
    id: row.id as string,
    slug: row.slug as string,
    kind: row.kind as RelatedWork['kind'],
    title: row.title as string,
    year: row.year as number | null,
    status: row.status as RelatedWork['status'],
    seasonNumber: row.season_number as number | null,
    coverUrl: row.cover_url as string | null,
    description: row.description as string | null,
    relation,
  };
}

/** Same, for a typed row off the query builder (an existing or freshly persisted row). */
function fromPersistedRow(row: PersistedMediaRow, relation: MediaRelationLabel): RelatedWork {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    year: row.year,
    status: row.status,
    seasonNumber: row.seasonNumber,
    coverUrl: row.coverUrl,
    description: row.description,
    relation,
  };
}

/**
 * Both halves of the stored-edge lookup. The table's no-self CHECK makes the two
 * branches disjoint, so UNION ALL needs no dedup sort. The reverse branch keeps
 * the stored type and flips only the label, in TS, via `relationLabel`.
 */
async function loadStoredRelations(db: Db, mediaId: string): Promise<RelatedWork[]> {
  const rows = await db.execute(sql`
    SELECT t.id, t.slug, t.kind, t.title, t.year, t.status, t.season_number,
           t.cover_url, t.description, r.type, r.direction
    FROM (
      SELECT to_id AS target_id, type, 'forward' AS direction
        FROM media_relation WHERE from_id = ${mediaId}
      UNION ALL
      SELECT from_id AS target_id, type, 'reverse' AS direction
        FROM media_relation WHERE to_id = ${mediaId}
    ) r
    JOIN media t ON t.id = r.target_id
    WHERE ${visibleMediaSql(sql.raw('t.'))}
  `);

  return [...rows].map((row) =>
    fromRawRow(
      row,
      relationLabel(
        row.type as CatalogRelationEdge['type'],
        row.direction as CatalogRelationEdge['direction'],
      ),
    ),
  );
}

/**
 * Adjacent seasons of the same show, derived rather than stored (ADR-0004
 * point 4). Only immediate neighbours: `sequel`/`prequel` mean adjacency, so
 * S1→S5 would be a factual error, and a full season list is a different
 * affordance.
 *
 * `kind = 'series'` is load-bearing — TMDB namespaces movie and TV ids
 * separately, so `{tmdb: 603}` on a movie and on a series are unrelated works.
 * `->>` (not `@>`) because a publisher may emit the id as a JSON number or
 * string; text comparison normalizes both, and `media_external_tmdb_idx` serves
 * it. Season 0 is TMDB "Specials", which is nobody's prequel.
 *
 * Anime is excluded by the `kind` filter and cannot be derived at all: AniList
 * issues unrelated ids per season (ADR-0003 point 3), so anime needs real edges.
 */
async function loadDerivedSeasonSiblings(db: Db, row: RelationSourceRow): Promise<RelatedWork[]> {
  const showId = row.externalIds.tmdb;
  const seasonNumber = row.seasonNumber;
  if (row.kind !== 'series' || seasonNumber === null || seasonNumber < 1 || showId == null) {
    return [];
  }

  const rows = await db.execute(sql`
    SELECT sib.id, sib.slug, sib.kind, sib.title, sib.year, sib.status, sib.season_number,
           sib.cover_url, sib.description,
           CASE WHEN sib.season_number > ${seasonNumber} THEN 'sequel' ELSE 'prequel' END AS label
    FROM media sib
    WHERE sib.kind = 'series'
      AND sib.external_ids ->> 'tmdb' = ${String(showId)}
      AND sib.season_number IN (${seasonNumber - 1}, ${seasonNumber + 1})
      AND sib.season_number >= 1
      AND sib.id <> ${row.id}
      AND ${visibleMediaSql(sql.raw('sib.'))}
    ORDER BY sib.season_number ASC
  `);

  return [...rows].map((sibling) => fromRawRow(sibling, sibling.label as MediaRelationLabel));
}

/**
 * The central catalog's edges, or an empty list. Mirrors `searchCentralSafe`:
 * an unset CATALOG_URL means the feature is off, and any failure degrades to
 * locally-known relations rather than failing the page.
 */
async function fetchCatalogRelationsSafe(
  catalogUrl: string | undefined,
  mediaId: string,
  options: LoadRelationsOptions,
): Promise<CatalogRelationEdge[]> {
  if (!catalogUrl) return [];
  try {
    const response = await fetchCatalogRelations(catalogUrl, mediaId, {
      limit: RELATION_LIMIT,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    if (response.skipped.length > 0) {
      // Forward-compat: a newer central catalog sent edges this build can't
      // parse (e.g. an unknown relation type); the rest still render.
      options.logger.warn(
        { skipped: response.skipped },
        'skipping central catalog relations that do not match this build (upgrade to pick them up)',
      );
    }
    return response.relations;
  } catch (error) {
    // A 429 here means the instance is over the catalog's per-IP budget — worth
    // naming, since the fix is operational (raise the ceiling or cache) not code.
    const rateLimited = error instanceof Error && error.message.includes(' 429 ');
    options.logger.warn(
      { err: error, rateLimited },
      rateLimited
        ? 'central catalog rate-limited this instance, relations degraded to local-only'
        : 'central catalog relations failed, degrading to local-only',
    );
    return [];
  }
}

/**
 * Turn catalog edges into local rows. Targets already present render from the
 * local row (no pointless insert); targets present but not visible are dropped
 * rather than materialized; the rest are inserted one at a time so one bad row
 * can't drop the others.
 *
 * The single batched lookup here subsumes `findSoftDeletedMediaIds` for this
 * path: `canViewMedia` checks `deleted_at` first and also covers moderation,
 * which the soft-delete helper does not.
 */
async function materializeCatalogEdges(
  db: Db,
  edges: CatalogRelationEdge[],
  logger: FastifyBaseLogger,
): Promise<RelatedWork[]> {
  if (edges.length === 0) return [];

  const existing = await db
    .select()
    .from(media)
    .where(
      inArray(
        media.id,
        edges.map((edge) => edge.id),
      ),
    );
  const byId = new Map(existing.map((row) => [row.id, row]));

  const resolved: RelatedWork[] = [];
  for (const edge of edges) {
    const label = relationLabel(edge.type, edge.direction);
    const local = byId.get(edge.id);

    if (local) {
      // Present already — never resurrect or leak it, and never re-insert.
      if (!canViewMedia(local)) continue;
      resolved.push(fromPersistedRow(local, label));
      continue;
    }

    try {
      const [persisted] = await insertNewProviderMedia(db, [buildProviderMediaRow(edge)]);
      if (!persisted) {
        logger.warn(
          { id: edge.id },
          'central catalog relation target missing after materialization',
        );
        continue;
      }
      // Build from the persisted row, never the edge: the stored slug can differ
      // (suffixed on collision, or the id already existed under another slug).
      resolved.push(fromPersistedRow(persisted, label));
    } catch (error) {
      logger.warn({ err: error, id: edge.id }, 'failed to materialize a relation target');
    }
  }
  return resolved;
}

export async function loadRelations(
  db: Db,
  catalogUrl: string | undefined,
  row: RelationSourceRow,
  options: LoadRelationsOptions,
): Promise<RelatedWork[]> {
  const [stored, derived] = await Promise.all([
    loadStoredRelations(db, row.id),
    loadDerivedSeasonSiblings(db, row),
  ]);

  // Skip the fan-out once a work has published edges materialized: re-asking
  // buys nothing, and this is what keeps per-detail-view catalog traffic bounded
  // after population. Keyed on *stored* edges only, so a series with nothing but
  // derived siblings still gets a chance to discover its cross-kind adaptation.
  const catalogEdges =
    stored.length > 0 ? [] : await fetchCatalogRelationsSafe(catalogUrl, row.id, options);
  const fromCatalog = await materializeCatalogEdges(db, catalogEdges, options.logger);

  // Keyed on the target id alone, not (target, label): one work must appear
  // once, under one heading, even when two sources disagree about the type.
  // Precedence is stored → catalog → derived, and sorting each source by display
  // order first makes the winning heading deterministic rather than an accident
  // of row order.
  const byTarget = new Map<string, RelatedWork>();
  for (const source of [stored, fromCatalog, derived]) {
    for (const work of [...source].sort(
      (a, b) => displayOrder(a.relation) - displayOrder(b.relation),
    )) {
      if (!byTarget.has(work.id)) byTarget.set(work.id, work);
    }
  }

  return [...byTarget.values()]
    .sort(
      (a, b) =>
        displayOrder(a.relation) - displayOrder(b.relation) ||
        (a.seasonNumber ?? Infinity) - (b.seasonNumber ?? Infinity) ||
        (a.year ?? Infinity) - (b.year ?? Infinity) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, RELATION_LIMIT);
}
