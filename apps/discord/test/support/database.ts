import postgres from 'postgres';

/**
 * A database of its own for one integration test file, on the dev compose
 * Postgres, created on first use. One per file, as in apps/api: vitest runs
 * files in parallel, and two suites migrating one database race on the newest
 * migration. Resolves to null when Postgres is down, so suites can self-skip.
 */
export async function testDatabase(name: string): Promise<string | null> {
  const url = `postgres://trackt:trackt@localhost:5432/${name}`;
  const adminUrl = new URL(url);
  adminUrl.pathname = '/trackt';
  const admin = postgres(adminUrl.href, { max: 1, connect_timeout: 3 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${name}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${name}"`);
    return url;
  } catch (error) {
    if (process.env.CI_REQUIRE_DB) {
      throw new Error(`Postgres is unavailable but CI_REQUIRE_DB is set: ${String(error)}`, {
        cause: error,
      });
    }
    return null;
  } finally {
    await admin.end();
  }
}
