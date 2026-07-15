import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export * from './schema/index.js';
export { schema };
export { isUniqueViolation } from './errors.js';
export { runMigrations } from './migrate.js';
export { seedMedia } from './seed.js';
export { SEED_MEDIA } from './seed-data.js';
export {
  buildProviderMediaRow,
  findSoftDeletedMediaIds,
  insertNewProviderMedia,
} from './catalog-media.js';

export interface CreateDbOptions {
  /** Max pool connections (default 10). */
  max?: number;
}

export function createDb(databaseUrl: string, options: CreateDbOptions = {}) {
  const client = postgres(databaseUrl, { max: options.max ?? 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
