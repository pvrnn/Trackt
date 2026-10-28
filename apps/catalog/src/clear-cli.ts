/**
 * `pnpm --filter @trackt/catalog db:clear -- --yes`
 *
 * Empty the catalog so a full seed can be loaded from scratch: media and the
 * edges between them go, everything else (news, feedback, the migration table)
 * stays. `catalog_seq` is deliberately NOT reset — it is the monotonic change
 * cursor behind the catalog version, and rewinding it would make a running
 * instance believe the catalog went backwards.
 *
 * `--yes` is required because DATABASE_URL can point at a hosted catalog, and
 * this is the one operation in the repo that deletes published rows.
 */
import { sql } from 'drizzle-orm';
import { EnvValidationError, loadCatalogEnv } from '@trackt/shared';
import { createCatalogDb } from './db/index.js';

async function main(): Promise<void> {
  if (!process.argv.slice(2).includes('--yes')) {
    console.error('db:clear deletes every published catalog row. Re-run with --yes to confirm.');
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

  const db = createCatalogDb(env.DATABASE_URL);
  try {
    const before = (await db.execute<{ media: number; relations: number; news: number }>(sql`
      SELECT
        (SELECT count(*) FROM catalog_media) AS media,
        (SELECT count(*) FROM catalog_media_relation) AS relations,
        (SELECT count(*) FROM news_article_media) AS news
    `)) as unknown as { media: number; relations: number; news: number }[];
    const counts = before[0];

    // One statement: news_article_media and catalog_media_relation both point at
    // catalog_media, and Postgres refuses to truncate a table another one references
    // unless they go together. News articles themselves survive; their media links do not.
    await db.execute(sql`TRUNCATE TABLE catalog_media_relation, news_article_media, catalog_media`);

    console.log(
      `cleared ${env.DATABASE_URL}: ${counts?.media ?? 0} media, ${counts?.relations ?? 0} relations, ` +
        `${counts?.news ?? 0} news links deleted`,
    );
  } finally {
    await db.$client.end();
  }
}

main().catch((error: unknown) => {
  // Drizzle wraps driver failures; the Postgres reason is the cause.
  const cause = (error as { cause?: unknown }).cause;
  console.error(
    cause instanceof Error ? cause.message : error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
