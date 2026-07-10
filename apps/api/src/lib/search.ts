import { sql } from 'drizzle-orm';
import type { Db } from '@trackt/db';
import type { SearchQuery, SearchResult } from '@trackt/shared';

/**
 * Typo-tolerant catalog search over the local `media` table: pg_trgm `%` on title
 * and synonyms (both GIN-indexed) plus ILIKE for short queries below the trgm
 * similarity threshold. `immutable_array_to_string` is created in migration 0003.
 */
export async function searchMedia(
  db: Db,
  { q, kind, limit }: SearchQuery,
): Promise<SearchResult[]> {
  const rows = await db.execute(sql`
    SELECT id, slug, kind, title, year, status, cover_url, description,
           GREATEST(similarity(title, ${q}),
                    similarity(immutable_array_to_string(synonyms, ' '), ${q})) AS rank
    FROM media
    WHERE (title % ${q}
           OR title ILIKE '%' || ${q} || '%'
           OR immutable_array_to_string(synonyms, ' ') ILIKE '%' || ${q} || '%')
      AND (${kind ?? null}::media_kind IS NULL OR kind = ${kind ?? null}::media_kind)
      AND moderation <> 'rejected'
    ORDER BY rank DESC, title ASC
    LIMIT ${limit}
  `);

  return [...rows].map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    kind: row.kind as SearchResult['kind'],
    title: row.title as string,
    year: row.year as number | null,
    status: row.status as SearchResult['status'],
    coverUrl: row.cover_url as string | null,
    description: row.description as string | null,
  }));
}
