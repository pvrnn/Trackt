import { runMigrations } from '../migrate.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set — cannot run migrations.');
  process.exit(1);
}

console.log('Running database migrations...');
try {
  await runMigrations(databaseUrl);
  console.log('Migrations complete.');
} catch (error) {
  console.error('Migration failed:', error);
  process.exit(1);
}
