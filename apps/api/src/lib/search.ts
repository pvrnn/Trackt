import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import {
  DERIVATIVE_FORMATS,
  MEDIA_KINDS,
  SEARCH_RANK_WEIGHTS,
  SEARCH_SORT_TEXT_FLOOR,
  UNKNOWN_POPULARITY,
  mediaStatusesFor,
  type MediaKind,
  type SearchKindsQuery,
  type SearchQuery,
  type SearchResult,
  type SearchSort,
  type StatusFilter,
} from '@trackt/shared';
import { visibleMediaSql } from './visibility.js';

/** A local search hit, with `rank` exposed so callers can merge-sort against central hits. */
export type LocalSearchResult = SearchResult & { rank: number };

/**
 * `metadata.format IN (...)` over the shared derivative vocabulary. The
 * vocabulary arrives space-separated (`tv short`, `one shot`), so the catalog's
 * `tv_short` spelling matches nothing — see `DERIVATIVE_FORMATS`.
 */
const derivativeFormatSql = sql.join(
  Object.entries(DERIVATIVE_FORMATS).map(
    ([kind, formats]) =>
      sql`(kind = ${kind} AND metadata->>'format' IN (${sql.join(
        formats.map((format) => sql`${format}`),
        sql`, `,
      )}))`,
  ),
  sql` OR `,
);

export interface MediaFilters {
  year?: number | undefined;
  genres?: string[] | undefined;
  status?: StatusFilter | undefined;
}

/** Discover's genre and status filters over `media`; also narrows the browse shelf. */
export function mediaFilterSql({ genres, status }: MediaFilters) {
  return sql`${
    genres?.length
      ? sql`AND genres @> ARRAY[${sql.join(
          genres.map((genre) => sql`${genre}`),
          sql`, `,
        )}]::text[]`
      : sql``
  }
    ${
      status
        ? sql`AND status::text IN (${sql.join(
            mediaStatusesFor(status).map((value) => sql`${value}`),
            sql`, `,
          )})`
        : sql``
    }`;
}

/** The visible rows a query matches, shared by the ranked search and its per-kind counts. */
function matchSql(q: string, filters: MediaFilters) {
  const { year } = filters;
  return sql`(immutable_unaccent(lower(title)) % immutable_unaccent(lower(${q}))
         OR immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
         OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%')
    AND (${year ?? null}::int IS NULL OR year = ${year ?? null}::int)
    ${mediaFilterSql(filters)}
    AND ${visibleMediaSql()}`;
}

/**
 * Distinct genre tags on visible rows, with counts, for merging with the
 * catalog's. `userOnly` as in `countLocalMediaKinds`.
 */
export async function countLocalGenres(
  db: Db,
  { kind, q }: { kind?: MediaKind | undefined; q?: string | undefined },
  { userOnly }: { userOnly: boolean },
): Promise<Map<string, number>> {
  const rows = await db.execute(sql`
    SELECT genre, count(*)::int AS count
    FROM media, unnest(genres) AS genre
    WHERE ${visibleMediaSql()}
      ${kind ? sql`AND kind = ${kind}` : sql``}
      ${q ? sql`AND strpos(genre, ${q}) > 0` : sql``}
      ${userOnly ? sql`AND source <> 'provider'` : sql``}
    GROUP BY genre
  `);
  return new Map([...rows].map((row) => [row.genre as string, row.count as number]));
}

/**
 * The relevance floor a reordering sort applies (`SEARCH_SORT_TEXT_FLOOR`),
 * spelled over the base row so the per-kind counts can apply it too: tier ≥ 2
 * is exactly "the title or a synonym contains the query".
 */
function sortFloorSql(q: string, sort: SearchSort) {
  if (sort === 'relevance') return sql``;
  return sql`AND (immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
    OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
    OR GREATEST(
         similarity(immutable_unaccent(lower(title)), immutable_unaccent(lower(${q}))),
         similarity(immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))), immutable_unaccent(lower(${q})))
       ) >= ${SEARCH_SORT_TEXT_FLOOR})`;
}

/** Mirrors `compareSearchHits` in `@trackt/shared`, which merges federated pages. */
function orderSql(sort: SearchSort) {
  if (sort === 'newest') return sql`year DESC NULLS LAST, rank DESC, title ASC, id ASC`;
  if (sort === 'az') return sql`immutable_unaccent(lower(title)) ASC, rank DESC, id ASC`;
  return sql`rank DESC, title ASC, id ASC`;
}

/**
 * Typo-tolerant catalog search over the local `media` table. The string match
 * tier (exact, prefix, substring, synonym) is the integer part of `rank` and
 * outranks every other signal; inside a tier, text relevance, format class and
 * provider score are a weighted sum — ADR-0010, with the weights and their
 * rationale in `@trackt/shared`. `immutable_array_to_string` is created in
 * migration 0003.
 */
export async function searchLocalMedia(
  db: Db,
  { q, kind, sort, limit, ...filters }: SearchQuery,
): Promise<LocalSearchResult[]> {
  const rows = await db.execute(sql`
    SELECT scored.*,
           scored.tier
           + ${SEARCH_RANK_WEIGHTS.text} * scored.text_score
           + ${SEARCH_RANK_WEIGHTS.formatClass}
             * (CASE WHEN scored.tier >= 4 THEN scored.format_class ELSE 0 END)
           + ${SEARCH_RANK_WEIGHTS.popularity} * scored.popularity AS rank
    FROM (
      SELECT id, slug, kind, title, year, status, season_number, cover_url, description, metadata,
             (CASE
                WHEN immutable_unaccent(lower(title)) = immutable_unaccent(lower(${q})) THEN 5
                WHEN immutable_unaccent(lower(title)) LIKE immutable_unaccent(lower(${q})) || '%' THEN 4
                WHEN immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%' THEN 3
                WHEN immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%' THEN 2
                ELSE 1
              END) AS tier,
             GREATEST(
               similarity(immutable_unaccent(lower(title)), immutable_unaccent(lower(${q}))),
               similarity(immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))), immutable_unaccent(lower(${q})))
             ) AS text_score,
             (CASE WHEN ${derivativeFormatSql} THEN 0 ELSE 1 END)::double precision AS format_class,
             (CASE
                WHEN metadata->>'providerScore' ~ '^[0-9]+([.][0-9]+)?$'
                  THEN LEAST(100, GREATEST(0, (metadata->>'providerScore')::double precision)) / 100
                ELSE ${UNKNOWN_POPULARITY}
              END) AS popularity
      FROM media
      WHERE ${matchSql(q, filters)}
        AND (${kind ?? null}::media_kind IS NULL OR kind = ${kind ?? null}::media_kind)
        ${sortFloorSql(q, sort)}
    ) scored
    ORDER BY ${orderSql(sort)}
    LIMIT ${limit}
  `);

  return [...rows].map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    kind: row.kind as SearchResult['kind'],
    title: row.title as string,
    year: row.year as number | null,
    status: row.status as SearchResult['status'],
    seasonNumber: row.season_number as number | null,
    coverUrl: row.cover_url as string | null,
    description: row.description as string | null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? {},
    rank: row.rank as number,
  }));
}

/**
 * Per-kind counts of the visible rows a query matches. `userOnly` narrows to
 * entries this instance created itself: provider rows are materialized copies
 * of the central catalog, so when the catalog's own counts are added these
 * would be counted twice.
 */
export async function countLocalMediaKinds(
  db: Db,
  { q, sort, ...filters }: SearchKindsQuery,
  { userOnly }: { userOnly: boolean },
): Promise<Partial<Record<MediaKind, number>>> {
  const rows = await db.execute(sql`
    SELECT kind, count(*)::int AS count
    FROM media
    WHERE ${matchSql(q, filters)}
      ${sortFloorSql(q, sort)}
      ${userOnly ? sql`AND source <> 'provider'` : sql``}
    GROUP BY kind
  `);
  const counts: Partial<Record<MediaKind, number>> = {};
  for (const row of rows) {
    const kind = row.kind as MediaKind;
    if (MEDIA_KINDS.includes(kind)) counts[kind] = row.count as number;
  }
  return counts;
}
