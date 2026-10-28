import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import {
  DERIVATIVE_FORMATS,
  SEARCH_RANK_WEIGHTS,
  UNKNOWN_POPULARITY,
  type SearchQuery,
  type SearchResult,
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
  { q, kind, limit }: SearchQuery,
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
      WHERE (immutable_unaccent(lower(title)) % immutable_unaccent(lower(${q}))
             OR immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
             OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%')
        AND (${kind ?? null}::media_kind IS NULL OR kind = ${kind ?? null}::media_kind)
        AND ${visibleMediaSql()}
    ) scored
    ORDER BY rank DESC, title ASC, id ASC
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
