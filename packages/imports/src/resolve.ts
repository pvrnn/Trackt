import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { media, userMedia, type Db } from '@trackt/db';
import type { MediaKind } from '@trackt/shared';
import { warning, type ImportEntry, type ImportKind, type ImportWarning } from './types.js';

/**
 * Provider id → local media row. The seeds carry `externalIds.mal` on the
 * AniList-derived rows (14 240 anime / 13 886 manga at the time of writing) and
 * the instances materialize it verbatim, so this join needs no title matching:
 * the id either exists here or it does not.
 */

export interface ImportTarget {
  id: string;
  kind: MediaKind;
  title: string;
  /** Episodes/chapters the catalog states; null for whole-work kinds and ongoing works. */
  partCount: number | null;
}

/** The map key: MAL's anime and manga ids are separate namespaces. */
export function importKey(kind: ImportKind, externalId: number): string {
  return `${kind}:${externalId}`;
}

const KINDS_BY_IMPORT: Record<ImportKind, MediaKind[]> = {
  anime: ['anime'],
  manga: ['manga'],
};

export interface ResolveResult {
  targets: Map<string, ImportTarget>;
  warnings: ImportWarning[];
}

/**
 * Resolve the entries' provider ids against the instance's `media` rows.
 *
 * Rows the viewer cannot see are not resolvable on purpose — the same
 * `deleted_at IS NULL AND moderation = 'verified'` rule as `canViewMedia`: a
 * work pulled from circulation must not silently collect the import's progress,
 * and an old unverified user-entry row must not become the target of one.
 */
export async function resolveImportEntries(db: Db, entries: ImportEntry[]): Promise<ResolveResult> {
  const targets = new Map<string, ImportTarget>();
  const warnings: ImportWarning[] = [];

  const malId = sql<string>`${media.externalIds}->>'mal'`;

  for (const importKind of Object.keys(KINDS_BY_IMPORT) as ImportKind[]) {
    const ids = entries
      .filter((entry) => entry.kind === importKind)
      .map((entry) => String(entry.externalId));
    if (ids.length === 0) continue;

    const rows = await db
      .select({
        id: media.id,
        kind: media.kind,
        title: media.title,
        partCount: media.partCount,
        malId,
      })
      .from(media)
      .where(
        and(
          inArray(media.kind, KINDS_BY_IMPORT[importKind]),
          isNull(media.deletedAt),
          eq(media.moderation, 'verified'),
          inArray(malId, ids),
        ),
      );

    for (const row of rows) {
      const key = importKey(importKind, Number(row.malId));
      const existing = targets.get(key);
      if (existing) {
        warnings.push(
          warning(
            'duplicate-external-id',
            { externalId: Number(row.malId), title: row.title },
            `${importKind} ${row.malId} matches both "${existing.title}" and "${row.title}" — using the first`,
          ),
        );
        continue;
      }
      targets.set(key, {
        id: row.id,
        kind: row.kind,
        title: row.title,
        partCount: row.partCount,
      });
    }
  }

  return { targets, warnings };
}

/** Local media ids among `mediaIds` the viewer already has a log row for. */
export async function findLoggedMediaIds(
  db: Db,
  userId: string,
  mediaIds: string[],
): Promise<Set<string>> {
  if (mediaIds.length === 0) return new Set();
  const rows = await db
    .select({ mediaId: userMedia.mediaId })
    .from(userMedia)
    .where(and(eq(userMedia.userId, userId), inArray(userMedia.mediaId, mediaIds)));
  return new Set(rows.map((row) => row.mediaId));
}
