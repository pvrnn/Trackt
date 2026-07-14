import { inArray } from 'drizzle-orm';
import { mediaSlug, type SlimMedia } from '@trackt/shared';
import { media } from './schema/media.js';
import type { Db } from './index.js';

/**
 * Materializes a central-catalog search hit into the local `media` table
 * (ADR-0002): a one-time snapshot insert, never re-synced or refreshed —
 * canonical UUIDs make dedup by `id` trivial, so no background staleness
 * tracking is needed once a row lands here.
 */

const UNIQUE_VIOLATION = '23505';

/** Insert shape with the id required — provider rows always carry a canonical id. */
type ProviderMediaRow = typeof media.$inferInsert & { id: string };

/** A row as it actually landed in the `media` table. */
export type PersistedMediaRow = typeof media.$inferSelect;

export function buildProviderMediaRow(hit: SlimMedia): ProviderMediaRow {
  return {
    id: hit.id,
    kind: hit.kind,
    title: hit.title,
    slug: mediaSlug(hit.title, hit.year),
    synonyms: hit.synonyms,
    genres: hit.genres,
    year: hit.year,
    status: hit.status,
    episodeCount: hit.episodeCount,
    seasonCount: hit.seasonCount,
    chapterCount: hit.chapterCount,
    volumeCount: hit.volumeCount,
    externalIds: hit.externalIds,
    description: hit.description,
    coverUrl: hit.coverUrl,
    source: 'provider',
    moderation: 'verified',
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  return code === UNIQUE_VIOLATION || isUniqueViolation(cause);
}

/**
 * Insert rows discovered for the first time. Targets the conflict on `id`
 * only, so an already-materialized row is silently skipped while a slug
 * collision (a different work already owns the same title+year) still
 * surfaces and is retried with a deterministic id-fragment suffix — same
 * fallback shape the old catalog-sync job used.
 *
 * Returns the rows as they actually landed (re-selected by canonical id),
 * because the persisted slug can differ from the requested one: the insert
 * may have been suffixed on a slug collision, or skipped entirely because
 * the id already exists under another slug. Callers must build responses
 * from these persisted rows, never from the pre-insert input.
 */
export async function insertNewProviderMedia(
  db: Db,
  rows: ProviderMediaRow[],
): Promise<PersistedMediaRow[]> {
  if (rows.length === 0) return [];
  try {
    await db.insert(media).values(rows).onConflictDoNothing({ target: media.id });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    for (const row of rows) {
      try {
        await db.insert(media).values(row).onConflictDoNothing({ target: media.id });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const deduped = { ...row, slug: `${row.slug}-${row.id.slice(0, 8)}` };
        await db.insert(media).values(deduped).onConflictDoNothing({ target: media.id });
      }
    }
  }
  return db
    .select()
    .from(media)
    .where(
      inArray(
        media.id,
        rows.map((row) => row.id),
      ),
    );
}
