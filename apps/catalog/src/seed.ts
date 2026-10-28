import { sql } from 'drizzle-orm';
import type { CatalogDb } from './db/index.js';
import { catalogMedia, catalogMediaRelation } from './db/index.js';
import { checkCanonicalId } from './lib/canonical-id.js';
import type { MediaRelationType, SlimMedia } from '@trackt/shared';

/**
 * Load a scraper seed file into the catalog (ADR-0001's project-operated publish
 * path, without the HTTP hop).
 *
 * The rows are the same shape `POST /v1/admin/media` accepts, so every one is run
 * through the same canonical-id guard: an id that does not derive from the
 * external id it claims would poison the catalog permanently, and no later
 * migration could tell the bad rows from the good. Rows are upserted (republishing
 * is normal), edges are `onConflictDoNothing` since their primary key covers every
 * column.
 *
 * The whole batch runs in ONE transaction holding the catalog-wide advisory lock:
 * `seq` is assigned by a trigger and the publish path is documented as
 * single-writer for exactly that reason, so a 15k-row import must not take the
 * lock 15k times — that is minutes of lock churn instead of seconds of work.
 */

export interface SeedReport {
  media: { inserted: number; updated: number; rejected: { id: string; reason: string }[] };
  relations: { inserted: number; skipped: number; missingEndpoint: number };
}

/**
 * The scraper's output, as far as this seeder cares: one array per table. The
 * file's `urls` and `report` blocks are provenance for a human and are ignored.
 */
export interface CatalogSeedFile {
  generatedAt?: string;
  catalog_media: SlimMedia[];
  catalog_media_relation: { fromId: string; toId: string; type: MediaRelationType }[];
}

const CHUNK = 500;

export async function seedCatalog(db: CatalogDb, file: CatalogSeedFile): Promise<SeedReport> {
  const report: SeedReport = {
    media: { inserted: 0, updated: 0, rejected: [] },
    relations: { inserted: 0, skipped: 0, missingEndpoint: 0 },
  };

  const accepted: SlimMedia[] = [];
  for (const row of file.catalog_media) {
    const check = checkCanonicalId(row);
    if (!check.ok) {
      report.media.rejected.push({ id: row.id, reason: check.error });
      continue;
    }
    accepted.push(row);
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('catalog-publish', 0))`);

    for (let offset = 0; offset < accepted.length; offset += CHUNK) {
      const chunk = accepted.slice(offset, offset + CHUNK);
      const inserted = await tx
        .insert(catalogMedia)
        .values(
          chunk.map((row) => ({
            id: row.id,
            kind: row.kind,
            title: row.title,
            synonyms: row.synonyms,
            year: row.year,
            status: row.status,
            genres: row.genres,
            partCount: row.partCount,
            seasonNumber: row.seasonNumber,
            externalIds: row.externalIds,
            metadata: row.metadata,
            description: row.description,
            coverUrl: row.coverUrl,
            bannerUrl: row.bannerUrl,
          })),
        )
        .onConflictDoUpdate({
          target: catalogMedia.id,
          set: {
            kind: sql`excluded.kind`,
            title: sql`excluded.title`,
            synonyms: sql`excluded.synonyms`,
            year: sql`excluded.year`,
            status: sql`excluded.status`,
            genres: sql`excluded.genres`,
            partCount: sql`excluded.part_count`,
            seasonNumber: sql`excluded.season_number`,
            externalIds: sql`excluded.external_ids`,
            // Merged, not replaced, for the same reason as the artwork below: a
            // seed file scraped before a key was imported must not erase it.
            metadata: sql`${catalogMedia.metadata} || excluded.metadata`,
            // COALESCE: `--with-description` controls the payload of a scrape, not
            // the stored row, so a re-scrape without it must not blank synopses an
            // earlier run imported.
            description: sql`coalesce(excluded.description, ${catalogMedia.description})`,
            // COALESCE: a seed file without artwork must not erase covers an
            // enrichment pass has since filled in.
            coverUrl: sql`coalesce(excluded.cover_url, ${catalogMedia.coverUrl})`,
            bannerUrl: sql`coalesce(excluded.banner_url, ${catalogMedia.bannerUrl})`,
            deletedAt: null,
            updatedAt: new Date(),
          },
        })
        .returning({ created: sql<boolean>`xmax = 0` });
      const created = inserted.filter((row) => row.created).length;
      report.media.inserted += created;
      report.media.updated += inserted.length - created;
    }

    // Edges last: both endpoints are FKs, and an edge to a row that was rejected
    // above must be reported rather than blowing up the transaction.
    const known = new Set(
      (await tx.select({ id: catalogMedia.id }).from(catalogMedia)).map((row) => row.id),
    );
    const edges = file.catalog_media_relation.filter((edge) => {
      if (known.has(edge.fromId) && known.has(edge.toId)) return true;
      report.relations.missingEndpoint++;
      return false;
    });

    for (let offset = 0; offset < edges.length; offset += CHUNK) {
      const chunk = edges.slice(offset, offset + CHUNK);
      const inserted = await tx
        .insert(catalogMediaRelation)
        .values(chunk)
        .onConflictDoNothing()
        .returning({ fromId: catalogMediaRelation.fromId });
      report.relations.inserted += inserted.length;
      report.relations.skipped += chunk.length - inserted.length;
    }
  });

  return report;
}
