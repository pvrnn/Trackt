/**
 * `pnpm --filter @trackt/catalog db:seed:all`
 *
 * Load every scraper seed in `apps/catalog/seed` in one pass, in dependency
 * order: the AniList seeds each carry the other kind's rows because they are
 * closed graphs (an anime seed ships the manga it adapts), so both have to be in
 * before anything that might point at them. Every file upserts, so this is safe
 * to run over a populated catalog as well as an empty one.
 *
 * `--dir <path>` seeds a different directory; `--only <file.json>` limits the
 * run to one file (repeatable).
 */
import { readFile, readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { EnvValidationError, loadCatalogEnv } from '@trackt/shared';
import { createCatalogDb, runCatalogMigrations } from './db/index.js';
import { seedCatalog, type CatalogSeedFile, type SeedReport } from './seed.js';

/** Order matters: a seed's relation edges need both endpoints to exist already. */
const ORDER = [
  'top-anime-anilist.json',
  'top-manga-anilist.json',
  'top-games-igdb.json',
  'top-movies-tmdb.json',
  'top-series-tmdb.json',
];

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const only: string[] = [];
  let dir = 'seed';
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--dir' && argv[index + 1]) {
      dir = argv[++index]!;
    } else if (argv[index] === '--only' && argv[index + 1]) {
      only.push(argv[++index]!);
    }
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

  const present = new Set((await readdir(resolve(dir))).filter((name) => name.endsWith('.json')));
  // A checkpoint, a dedup log or a backup is not a seed; only the known files are.
  const wanted = only.length
    ? only.map((name) => basename(name))
    : ORDER.filter((name) => present.has(name));
  if (!wanted.length) {
    console.error(`no seed files in ${resolve(dir)}`);
    process.exit(1);
  }

  await runCatalogMigrations(env.DATABASE_URL);
  const db = createCatalogDb(env.DATABASE_URL);
  const total: SeedReport = {
    media: { inserted: 0, updated: 0, rejected: [] },
    relations: { inserted: 0, skipped: 0, missingEndpoint: 0 },
  };
  try {
    for (const name of wanted) {
      const file = JSON.parse(await readFile(resolve(dir, name), 'utf8')) as CatalogSeedFile;
      if (!Array.isArray(file.catalog_media) || !Array.isArray(file.catalog_media_relation)) {
        console.error(`${name} is not a catalog seed file; skipped`);
        continue;
      }
      const report = await seedCatalog(db, file);
      console.log(
        `${name}: ${report.media.inserted} inserted, ${report.media.updated} updated, ` +
          `${report.media.rejected.length} rejected; relations ${report.relations.inserted} inserted, ` +
          `${report.relations.skipped} present, ${report.relations.missingEndpoint} missing endpoint`,
      );
      total.media.inserted += report.media.inserted;
      total.media.updated += report.media.updated;
      total.media.rejected.push(...report.media.rejected);
      total.relations.inserted += report.relations.inserted;
      total.relations.skipped += report.relations.skipped;
      total.relations.missingEndpoint += report.relations.missingEndpoint;
    }
  } finally {
    await db.$client.end();
  }

  console.log(
    `total: ${total.media.inserted} inserted, ${total.media.updated} updated, ` +
      `${total.media.rejected.length} rejected; relations ${total.relations.inserted} inserted, ` +
      `${total.relations.skipped} present, ${total.relations.missingEndpoint} missing endpoint`,
  );
  for (const rejected of total.media.rejected.slice(0, 5)) {
    console.error(`rejected ${rejected.id}: ${rejected.reason}`);
  }
  if (total.media.rejected.length) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const cause = (error as { cause?: unknown }).cause;
  console.error(
    cause instanceof Error ? cause.message : error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
