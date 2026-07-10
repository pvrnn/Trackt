import { createDb } from '../index.js';
import { seedMedia } from '../seed.js';

// Same dev fallback as drizzle.config.ts — dev needs no .env (README).
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://trackt:trackt@localhost:5432/trackt';

console.log('Seeding dev fixture catalog...');
const db = createDb(databaseUrl, { max: 1 });
try {
  await seedMedia(db);
  console.log('Seed complete.');
  process.exit(0);
} catch (error) {
  console.error('Seed failed:', error);
  process.exit(1);
}
