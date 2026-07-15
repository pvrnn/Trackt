import { sql } from 'drizzle-orm';
import { EnvValidationError, loadCatalogEnv } from '@trackt/shared';
import { buildApp, type CatalogAppDeps } from './app.js';
import { createCatalogDb, runCatalogMigrations } from './db/index.js';

async function main(): Promise<void> {
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

  // In development the catalog DB may simply not be up (it's the project's own
  // service, not part of self-hosted deployments) — serve /healthz anyway so
  // `pnpm dev` keeps working; catalog routes respond 503.
  const deps: CatalogAppDeps = { env };
  try {
    await runCatalogMigrations(env.DATABASE_URL);
    const db = createCatalogDb(env.DATABASE_URL);
    deps.db = db;
    deps.dbPing = async () => {
      await db.execute(sql`select 1`);
    };
  } catch (error) {
    if (env.NODE_ENV === 'production') throw error;
    console.warn(`catalog database unavailable (${(error as Error).message}) — serving without it`);
  }

  const app = await buildApp(deps);

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      // buildApp sets forceCloseConnections, so lingering keep-alives can't hang this.
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
