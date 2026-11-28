import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  buildProviderMediaRow,
  insertNewProviderMedia,
  media,
  userMedia,
  type Db,
} from '@trackt/db';
import { fetchCatalogMedia } from '@trackt/shared';
import { canViewMedia } from './visibility.js';

export type MatchMediaRow = typeof media.$inferSelect;

export interface CatalogAccess {
  catalogUrl: string | undefined;
  timeoutMs: number;
  logger: FastifyBaseLogger;
}

/** Catalog fetches in flight at once while a match list is served. */
const MATERIALIZE_CONCURRENCY = 4;

/**
 * The instance's visible rows for these ids, pulling any it has never served
 * from the central catalog first: a shortlist can name catalog works, and a
 * picker needs their cover, kind and slug — the same one-time materialization a
 * search hit gets (ADR-0002).
 */
export async function loadMatchMedia(
  db: Db,
  ids: readonly string[],
  catalog: CatalogAccess,
): Promise<Map<string, MatchMediaRow>> {
  const unique = [...new Set(ids)];
  const rows = new Map<string, MatchMediaRow>();
  if (unique.length === 0) return rows;

  for (const row of await db.select().from(media).where(inArray(media.id, unique))) {
    rows.set(row.id, row);
  }

  const missing = unique.filter((id) => !rows.has(id));
  const { catalogUrl } = catalog;
  if (catalogUrl && missing.length > 0) {
    let next = 0;
    const runners = Array.from(
      { length: Math.min(MATERIALIZE_CONCURRENCY, missing.length) },
      async () => {
        for (;;) {
          const id = missing[next++];
          if (id === undefined) return;
          try {
            const hit = await fetchCatalogMedia(catalogUrl, id, { timeoutMs: catalog.timeoutMs });
            if (!hit) continue;
            const [persisted] = await insertNewProviderMedia(db, [buildProviderMediaRow(hit)]);
            if (persisted) rows.set(id, persisted);
          } catch (error) {
            catalog.logger.warn({ err: error, id }, 'failed to materialize an import candidate');
          }
        }
      },
    );
    await Promise.all(runners);
  }

  for (const [id, row] of rows) if (!canViewMedia(row)) rows.delete(id);
  return rows;
}

/** Of these media ids, the ones the viewer already logs. */
export async function loggedMediaIds(
  db: Db,
  userId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ mediaId: userMedia.mediaId })
    .from(userMedia)
    .where(and(eq(userMedia.userId, userId), inArray(userMedia.mediaId, [...ids])));
  return new Set(rows.map((row) => row.mediaId));
}
