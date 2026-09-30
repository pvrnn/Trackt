import postgres from 'postgres';

/**
 * The bot's integration tests share one `trackt_discord_test` database on the
 * dev compose Postgres, created on first use. `available` is false when
 * Postgres is down, so suites can self-skip.
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_DISCORD ??
  'postgres://trackt:trackt@localhost:5432/trackt_discord_test';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt';
  const admin = postgres(adminUrl.href, { max: 1, connect_timeout: 3 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
    return true;
  } catch (error) {
    if (process.env.CI_REQUIRE_DB) {
      throw new Error(`Postgres is unavailable but CI_REQUIRE_DB is set: ${String(error)}`, {
        cause: error,
      });
    }
    return false;
  } finally {
    await admin.end();
  }
}

export const available = await ensureTestDatabase();
