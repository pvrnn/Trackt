import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { media, syncState, type Db } from '@trackt/db';
import {
  CatalogChangesResponseSchema,
  mediaSlug,
  type CatalogChange,
  type CatalogChangesResponse,
} from '@trackt/shared';

/**
 * Instance-side catalog sync (ADR-0001): pull the change stream from the
 * central slim catalog and mirror it into the local `media` table. One code
 * path serves initial full sync (cursor 0) and incremental deltas — the
 * cursor is persisted after every applied page, so an interrupted run
 * resumes where it stopped.
 */

export const CATALOG_SYNC_CURSOR_KEY = 'catalog';
const PAGE_LIMIT = 500;
/** Unique-violation SQLSTATE — thrown when a different work already owns a slug. */
const UNIQUE_VIOLATION = '23505';

export interface CatalogSyncResult {
  cursor: number;
  latestVersion: number;
  pages: number;
  upserted: number;
  deleted: number;
}

export interface CatalogSyncDeps {
  db: Db;
  catalogUrl: string;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

async function readCursor(db: Db): Promise<number> {
  const [row] = await db
    .select({ cursor: syncState.cursor })
    .from(syncState)
    .where(eq(syncState.key, CATALOG_SYNC_CURSOR_KEY));
  return row?.cursor ?? 0;
}

async function writeCursor(db: Db, cursor: number): Promise<void> {
  await db
    .insert(syncState)
    .values({ key: CATALOG_SYNC_CURSOR_KEY, cursor })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { cursor, updatedAt: new Date() },
    });
}

async function fetchPage(
  catalogUrl: string,
  since: number,
  fetchImpl: typeof fetch,
): Promise<CatalogChangesResponse> {
  const url = new URL('/v1/catalog/changes', catalogUrl);
  url.searchParams.set('since', String(since));
  url.searchParams.set('limit', String(PAGE_LIMIT));
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`catalog responded ${response.status} for ${url.pathname}${url.search}`);
  }
  return CatalogChangesResponseSchema.parse(await response.json());
}

/** Insert shape with the id required — sync rows always carry a canonical id. */
type MediaRow = typeof media.$inferInsert & { id: string };

function toMediaRow(change: CatalogChange): MediaRow {
  return {
    id: change.id,
    kind: change.kind,
    title: change.title,
    slug: mediaSlug(change.title, change.year),
    synonyms: change.synonyms,
    genres: change.genres,
    year: change.year,
    status: change.status,
    episodeCount: change.episodeCount,
    seasonCount: change.seasonCount,
    chapterCount: change.chapterCount,
    volumeCount: change.volumeCount,
    externalIds: change.externalIds,
    description: change.description,
    coverUrl: change.coverUrl,
    source: 'provider',
    moderation: 'verified',
  };
}

/**
 * Columns refreshed on every sync. Deliberately excluded:
 * - `slug` — set on insert only, so instance URLs never churn on retitles and
 *   updates can't trip the unique slug index;
 * - `description`/`coverUrl` use COALESCE so a slim (null) catalog value never
 *   clobbers local enrichment (ADR-0001 keeps enrichment per-instance).
 */
const UPSERT_SET = {
  kind: sql`excluded.kind`,
  title: sql`excluded.title`,
  synonyms: sql`excluded.synonyms`,
  genres: sql`excluded.genres`,
  year: sql`excluded.year`,
  status: sql`excluded.status`,
  episodeCount: sql`excluded.episode_count`,
  seasonCount: sql`excluded.season_count`,
  chapterCount: sql`excluded.chapter_count`,
  volumeCount: sql`excluded.volume_count`,
  externalIds: sql`excluded.external_ids`,
  description: sql`coalesce(excluded.description, ${media.description})`,
  coverUrl: sql`coalesce(excluded.cover_url, ${media.coverUrl})`,
  updatedAt: sql`now()`,
};

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, cause } = error as { code?: unknown; cause?: unknown };
  // Drizzle wraps the driver error; the SQLSTATE lives on the cause chain.
  return code === UNIQUE_VIOLATION || isUniqueViolation(cause);
}

async function upsertRows(db: Db, rows: MediaRow[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    await db.insert(media).values(rows).onConflictDoUpdate({ target: media.id, set: UPSERT_SET });
    return;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  // A different work already owns one of the slugs (same title + year).
  // Redo the page row by row, retrying collisions with an id-fragment suffix —
  // deterministic, so re-syncs land on the same slug.
  for (const row of rows) {
    try {
      await db.insert(media).values(row).onConflictDoUpdate({ target: media.id, set: UPSERT_SET });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const deduped = { ...row, slug: `${row.slug}-${row.id.slice(0, 8)}` };
      await db
        .insert(media)
        .values(deduped)
        .onConflictDoUpdate({ target: media.id, set: UPSERT_SET });
    }
  }
}

/**
 * Pull all pending catalog changes and apply them locally. Throws on fetch or
 * database errors — BullMQ handles retries; the per-page cursor makes retries
 * cheap.
 */
export async function runCatalogSync(deps: CatalogSyncDeps): Promise<CatalogSyncResult> {
  const { db, catalogUrl, logger, fetchImpl = fetch } = deps;
  let cursor = await readCursor(db);
  const startCursor = cursor;
  let pages = 0;
  let upserted = 0;
  let deleted = 0;
  let latestVersion = cursor;

  for (;;) {
    const page = await fetchPage(catalogUrl, cursor, fetchImpl);
    latestVersion = page.latestVersion;
    if (page.changes.length === 0) break;

    const tombstoned = page.changes.filter((change) => change.deletedAt !== null);
    const live = page.changes.filter((change) => change.deletedAt === null);

    await upsertRows(db, live.map(toMediaRow));
    if (tombstoned.length > 0) {
      // Only provider rows mirror the catalog; user-created entries (random
      // UUIDs) are never touched. Cascades intentionally drop local tracking
      // data for the removed entry — the catalog is the source of truth.
      await db.delete(media).where(
        and(
          inArray(
            media.id,
            tombstoned.map((change) => change.id),
          ),
          eq(media.source, 'provider'),
        ),
      );
    }

    cursor = page.changes.at(-1)!.seq;
    await writeCursor(db, cursor);
    pages += 1;
    upserted += live.length;
    deleted += tombstoned.length;

    if (page.nextSince === null) break;
  }

  const result: CatalogSyncResult = { cursor, latestVersion, pages, upserted, deleted };
  logger.info({ ...result, startCursor }, 'catalog sync finished');
  return result;
}
