import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Apply pending migrations from packages/db/migrations.
 * Runs on container boot (PRD §6.1: upgrades are `docker compose pull && up`).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));
  const client = postgres(databaseUrl, { max: 1 });
  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
}
