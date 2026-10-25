/**
 * `pnpm --filter @trackt/catalog db:seed -- <file.json>`
 *
 * Loads a scraper seed file into the catalog database directly, with the same
 * canonical-id guard and upsert semantics the admin HTTP route uses. This is the
 * local path: no token, no running server, no 15k round trips.
 */
import { readFile } from 'node:fs/promises';
import { EnvValidationError, loadCatalogEnv } from '@trackt/shared';
import { createCatalogDb, runCatalogMigrations } from './db/index.js';
import { seedCatalog, type CatalogSeedFile } from './seed.js';

async function main(): Promise<void> {
  // `pnpm run db:seed -- <file>` forwards the separator on some versions.
  const path = process.argv.slice(2).find((arg) => arg !== '--');
  if (!path) {
    console.error('usage: db:seed <seed-file.json>');
    process.exit(1);
  }

  let env;
  try {
    env = loadCatalogEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const file = JSON.parse(await readFile(path, 'utf8')) as CatalogSeedFile;
  if (!Array.isArray(file.catalog_media) || !Array.isArray(file.catalog_media_relation)) {
    console.error(
      `${path} is not a catalog seed file (expected catalog_media and catalog_media_relation)`,
    );
    process.exit(1);
  }

  console.log(
    `seeding ${path}: ${file.catalog_media.length} media, ${file.catalog_media_relation.length} relations`,
  );
  await runCatalogMigrations(env.DATABASE_URL);
  const db = createCatalogDb(env.DATABASE_URL);
  try {
    const report = await seedCatalog(db, file);
    console.log(
      `media: ${report.media.inserted} inserted, ${report.media.updated} updated, ` +
        `${report.media.rejected.length} rejected`,
    );
    console.log(
      `relations: ${report.relations.inserted} inserted, ${report.relations.skipped} already present, ` +
        `${report.relations.missingEndpoint} skipped for a missing endpoint`,
    );
    for (const rejected of report.media.rejected.slice(0, 5)) {
      console.error(`rejected ${rejected.id}: ${rejected.reason}`);
    }
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
