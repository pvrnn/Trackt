import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import type { SearchQuery, SearchResult } from '@trackt/shared';
import { visibleMediaSql } from './visibility.js';

/** A local search hit, with `rank` exposed so callers can merge-sort against central hits. */
export type LocalSearchResult = SearchResult & { rank: number };

/**
 * Typo-tolerant catalog search over the local `media` table. Text match tier
 * dominates provider score; format only breaks otherwise equal score ties.
 * `immutable_array_to_string` is created in migration 0003.
 */
export async function searchLocalMedia(
  db: Db,
  { q, kind, limit }: SearchQuery,
): Promise<LocalSearchResult[]> {
  const rows = await db.execute(sql`
    SELECT id, slug, kind, title, year, status, season_number, cover_url, description, metadata,
           (
             CASE
               WHEN immutable_unaccent(lower(title)) = immutable_unaccent(lower(${q})) THEN 5
               WHEN immutable_unaccent(lower(title)) LIKE immutable_unaccent(lower(${q})) || '%' THEN 4
               WHEN immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%' THEN 3
               WHEN immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%' THEN 2
               ELSE 1
             END * 1000000
             + GREATEST(
                 similarity(immutable_unaccent(lower(title)), immutable_unaccent(lower(${q}))),
                 similarity(immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))), immutable_unaccent(lower(${q})))
               ) * 10000
             + CASE
                 WHEN metadata->>'providerScore' ~ '^[0-9]+([.][0-9]+)?$'
                   THEN LEAST(100, GREATEST(0, (metadata->>'providerScore')::double precision)) * 10
                 ELSE 0
               END
             + CASE
                 WHEN kind = 'anime' AND metadata->>'format' = 'tv' THEN 0.05
                 WHEN kind = 'anime' AND metadata->>'format' = 'tv_short' THEN 0.04
                 WHEN kind = 'anime' AND metadata->>'format' = 'movie' THEN 0.03
                 WHEN kind = 'anime' AND metadata->>'format' = 'ona' THEN 0.02
                 WHEN kind = 'anime' AND metadata->>'format' = 'ova' THEN 0.01
                 WHEN kind = 'manga' AND metadata->>'format' = 'manga' THEN 0.02
                 WHEN kind = 'manga' AND metadata->>'format' = 'one_shot' THEN 0.01
                 ELSE 0
               END
           ) AS rank
    FROM media
    WHERE (immutable_unaccent(lower(title)) % immutable_unaccent(lower(${q}))
           OR immutable_unaccent(lower(title)) LIKE '%' || immutable_unaccent(lower(${q})) || '%'
           OR immutable_unaccent(lower(immutable_array_to_string(synonyms, ' '))) LIKE '%' || immutable_unaccent(lower(${q})) || '%')
      AND (${kind ?? null}::media_kind IS NULL OR kind = ${kind ?? null}::media_kind)
      AND ${visibleMediaSql()}
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
