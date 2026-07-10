import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export * from './schema.js';
export { schema };

export function createCatalogDb(databaseUrl: string, options: { max?: number } = {}) {
  const client = postgres(databaseUrl, { max: options.max ?? 10 });
  return drizzle(client, { schema });
}

export type CatalogDb = ReturnType<typeof createCatalogDb>;

/** Apply pending migrations from apps/catalog/migrations. Runs on service boot. */
export async function runCatalogMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = fileURLToPath(new URL('../../migrations', import.meta.url));
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
