import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadCatalogEnv } from '@trackt/shared';
import {
  createCatalogDb,
  feedback,
  runCatalogMigrations,
  type CatalogDb,
} from '../src/db/index.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed tests for feedback intake. Self-skips when Postgres is down,
 * so `pnpm test` stays green without Docker.
 *
 * The load-bearing assertions: a report is stored verbatim with the context the
 * instance attached, a too-short message never reaches the table, and the
 * operator's list is admin-only and newest-first.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_CATALOG_FEEDBACK ??
  'postgres://trackt:trackt@localhost:5433/trackt_catalog_feedback_test';

const ADMIN_TOKEN = 'test-admin-token-at-least-16';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt_catalog';
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

const available = await ensureTestDatabase();

const auth = { authorization: `Bearer ${ADMIN_TOKEN}` };

const report = {
  category: 'bug',
  message: 'Marking an episode watched left the card unchecked until a reload.',
  route: '/media/ashfall-chronicle-2025',
  instanceUrl: 'https://trackt.example.com',
  appVersion: '0.1.0',
};

describe.runIf(available)('feedback (postgres)', () => {
  let app: App;
  let db: CatalogDb;

  beforeAll(async () => {
    await runCatalogMigrations(TEST_DATABASE_URL);
    db = createCatalogDb(TEST_DATABASE_URL, { max: 1 });
    app = await buildApp({
      env: loadCatalogEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        CATALOG_ADMIN_TOKEN: ADMIN_TOKEN,
      }),
      db,
    });
  });

  afterEach(async () => {
    await db.delete(feedback);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('stores a report with the context the instance attached', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/feedback', payload: report });

    expect(response.statusCode).toBe(201);
    const receipt = response.json();
    expect(receipt.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(receipt.createdAt)).not.toBeNaN();

    const [row] = await db.select().from(feedback);
    expect(row).toMatchObject(report);
  });

  it('accepts a report without the optional context', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      payload: { category: 'other', message: 'The dark theme is lovely, no notes.' },
    });

    expect(response.statusCode).toBe(201);
    const [row] = await db.select().from(feedback);
    expect(row).toMatchObject({ route: null, instanceUrl: null, appVersion: null });
  });

  it('rejects an unknown category and a too-short message', async () => {
    const badCategory = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      payload: { ...report, category: 'rant' },
    });
    const shortMessage = await app.inject({
      method: 'POST',
      url: '/v1/feedback',
      payload: { ...report, message: 'broken' },
    });

    expect(badCategory.statusCode).toBe(400);
    expect(shortMessage.statusCode).toBe(400);
    expect(await db.select().from(feedback)).toHaveLength(0);
  });

  it('lists reports newest first, for admins only', async () => {
    // Inserted directly with explicit timestamps: two POSTs can land in the same
    // millisecond, and then "newest first" has no order to assert.
    await db.insert(feedback).values([
      {
        category: 'bug',
        message: 'The first thing that went wrong today.',
        createdAt: new Date('2026-01-01T09:00:00.000Z'),
      },
      {
        category: 'feature',
        message: 'The second thing that went wrong today.',
        createdAt: new Date('2026-01-02T09:00:00.000Z'),
      },
    ]);

    const anonymous = await app.inject({ method: 'GET', url: '/v1/admin/feedback' });
    expect(anonymous.statusCode).toBe(401);

    const response = await app.inject({ method: 'GET', url: '/v1/admin/feedback', headers: auth });
    expect(response.statusCode).toBe(200);

    const { entries } = response.json();
    expect(entries).toHaveLength(2);
    expect(entries.map((entry: { message: string }) => entry.message)).toEqual([
      'The second thing that went wrong today.',
      'The first thing that went wrong today.',
    ]);
  });
});
