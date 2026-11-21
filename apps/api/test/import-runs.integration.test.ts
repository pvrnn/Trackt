import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, importRun, runMigrations, users, type Db } from '@trackt/db';
import { loadEnv } from '@trackt/shared';
import type { Auth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';
import { fakeQueue } from './fake-import-queue.js';

/**
 * Postgres-backed `import_run` tests (own `trackt_import_runs_test` db,
 * self-skips without Docker): the row a POST records, joins and closes. The
 * queue is the fake one; the worker's half is covered in apps/worker.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_IMPORT_RUNS ??
  'postgres://trackt:trackt@localhost:5432/trackt_import_runs_test';

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

const available = await ensureTestDatabase();

function fakeAuth(userId: string): Auth {
  return {
    api: {
      getSession: async () => ({ user: { id: userId, name: 'tester', role: 'user' } }),
    },
  } as unknown as Auth;
}

describe.runIf(available)('import runs (postgres)', () => {
  let db: Db;
  let app: App;
  let queue: ReturnType<typeof fakeQueue>;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    // A fresh viewer per run: the test database is never dropped.
    const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const [user] = await db
      .insert(users)
      .values({ name: 'Importer', email: `importer-${stamp}@example.com` })
      .returning({ id: users.id });
    userId = user!.id;
    queue = fakeQueue();
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
    app = await buildApp({ env, db, auth: fakeAuth(userId), importQueue: queue.queue });
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/me/import', payload });

  const runsOf = () => db.select().from(importRun).where(eq(importRun.userId, userId));

  it('records a queued run and hands its id to the job', async () => {
    const response = await post({ source: 'anilist', profile: 'alice' });

    expect(response.statusCode).toBe(202);
    const { runId } = response.json() as { runId: string };
    expect(runId).toEqual(expect.any(String));
    expect(queue.adds.at(-1)?.data.runId).toBe(runId);

    const [row] = await runsOf();
    expect(row).toMatchObject({ id: runId, source: 'anilist', profile: 'alice', state: 'queued' });
  });

  it('joins the live run instead of recording a second one', async () => {
    const first = (await runsOf())[0]!;
    const response = await post({ source: 'anilist', profile: 'alice' });

    expect(response.json()).toMatchObject({ runId: first.id });
    expect(await runsOf()).toHaveLength(1);
  });

  it('records nothing for a preview', async () => {
    const response = await post({ source: 'mal', profile: 'alice', dryRun: true });

    expect(response.json()).toMatchObject({ runId: null });
    expect((await runsOf()).filter((row) => row.source === 'mal')).toHaveLength(0);
  });

  it('closes a run the queue lost before recording the next one', async () => {
    const lost = (await runsOf())[0]!;
    // The job is gone while its row still reads queued: a Redis flush.
    queue.jobs.clear();

    const response = await post({ source: 'anilist', profile: 'alice' });
    const { runId } = response.json() as { runId: string };

    expect(runId).not.toBe(lost.id);
    const rows = await runsOf();
    expect(rows.find((row) => row.id === lost.id)).toMatchObject({
      state: 'failed',
      errorKind: 'lost',
    });
    expect(rows.find((row) => row.id === runId)).toMatchObject({ state: 'queued' });
  });

  it('lists the viewer’s runs, newest first', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/import/runs' });

    expect(response.statusCode).toBe(200);
    const { runs } = response.json() as { runs: { state: string; errorKind: string | null }[] };
    expect(runs.map((run) => run.state)).toEqual(['queued', 'failed']);
    expect(runs[1]).toMatchObject({ errorKind: 'lost' });
  });
});
