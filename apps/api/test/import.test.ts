import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Auth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';
import type { ImportQueue, ImportQueueAddOptions } from '../src/lib/import-queue.js';
import { loadEnv, type Env } from '@trackt/shared';
import type { ImportJobData, ImportJobResult } from '@trackt/imports';

/**
 * The producer half of the importer queue: the routes, with a fake queue and a
 * fake session. What matters is the contract — refusals at the door, one job per
 * (viewer, source), and a job's state readable only by its owner. The queue
 * itself, the worker and the pipeline are covered elsewhere.
 */

const USER_ID = '11111111-1111-5111-8111-111111111111';
const OTHER_ID = '22222222-2222-5222-8222-222222222222';

const baseEnv = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });

function fakeAuth(userId: string): Auth {
  return {
    api: {
      getSession: async () => ({ user: { id: userId, name: 'tester', role: 'user' } }),
    },
  } as unknown as Auth;
}

interface StoredJob {
  data: unknown;
  state: string;
  progress: unknown;
  returnvalue: unknown;
  failedReason: string;
}

/** A BullMQ stand-in: enough of it that the routes cannot tell the difference. */
function fakeQueue() {
  const jobs = new Map<string, StoredJob>();
  const adds: { data: ImportJobData; options: ImportQueueAddOptions }[] = [];

  const read = (id: string, job: StoredJob) => ({
    id,
    data: job.data,
    progress: job.progress,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    getState: async () => job.state,
    remove: async () => {
      jobs.delete(id);
    },
  });

  const queue: ImportQueue = {
    async add(_name, data, options) {
      adds.push({ data, options });
      jobs.set(options.jobId, {
        data,
        state: 'waiting',
        progress: 0,
        returnvalue: null,
        failedReason: '',
      });
      return read(options.jobId, jobs.get(options.jobId) as StoredJob);
    },
    async getJob(id) {
      const job = jobs.get(id);
      return job ? read(id, job) : undefined;
    },
    async close() {},
  };

  return { queue, jobs, adds };
}

const jobId = `${USER_ID}-anilist`;

const result: ImportJobResult = {
  report: {
    source: 'anilist',
    profile: 'alice',
    created: 1,
    updated: 0,
    skippedExisting: 0,
    withProgress: 1,
    ratings: 0,
    warnings: [],
    unmatched: [],
  },
  plan: {
    source: 'anilist',
    profile: 'alice',
    total: 1,
    matched: 1,
    unmatched: 0,
    existing: 0,
    pending: 1,
    warnings: 0,
    matchedByTitle: 0,
  },
  unmatched: { entries: [], truncated: false },
};

async function build(env: Env, withQueue: boolean, userId = USER_ID) {
  return buildApp({
    env,
    auth: fakeAuth(userId),
    ...(withQueue ? { importQueue: fakeQueue().queue } : {}),
  });
}

describe('import routes', () => {
  let app: App;
  let queue: ReturnType<typeof fakeQueue>;

  beforeAll(async () => {
    queue = fakeQueue();
    app = await buildApp({ env: baseEnv, auth: fakeAuth(USER_ID), importQueue: queue.queue });
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/v1/me/import', payload: payload as object });

  const getJob = (id: string) =>
    app.inject({ method: 'GET', url: `/api/v1/me/import/${encodeURIComponent(id)}` });

  it('requires a session', async () => {
    // Wired queue, no auth: what stops the request is the missing session.
    const anonymous = await buildApp({ env: baseEnv, importQueue: fakeQueue().queue });
    expect(
      (
        await anonymous.inject({
          method: 'POST',
          url: '/api/v1/me/import',
          payload: { source: 'anilist', profile: 'alice' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await anonymous.inject({ method: 'GET', url: '/api/v1/me/import/x' })).statusCode).toBe(
      401,
    );
    expect(
      (await anonymous.inject({ method: 'GET', url: '/api/v1/me/import/sources' })).statusCode,
    ).toBe(401);
    await anonymous.close();
  });

  it('answers 503 when no queue is wired', async () => {
    const noQueue = await build(baseEnv, false);
    expect(
      (
        await noQueue.inject({
          method: 'POST',
          url: '/api/v1/me/import',
          payload: { source: 'anilist', profile: 'alice' },
        })
      ).statusCode,
    ).toBe(503);
    expect((await noQueue.inject({ method: 'GET', url: '/api/v1/me/import/x' })).statusCode).toBe(
      503,
    );
    await noQueue.close();
  });

  it('rejects an unknown source', async () => {
    const response = await post({ source: 'myspace', profile: 'alice' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/validation failed/);
  });

  it('validates the profile name', async () => {
    expect((await post({ source: 'anilist', profile: '   ' })).statusCode).toBe(400);
    expect((await post({ source: 'anilist', profile: 'x'.repeat(101) })).statusCode).toBe(400);
    expect((await post({ source: 'anilist' })).statusCode).toBe(400);
  });

  it('refuses a source whose credential is unset, naming the variable', async () => {
    const response = await post({ source: 'mal', profile: 'alice' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('MAL_CLIENT_ID');
  });

  it('enqueues a job and answers 202 with its id and state', async () => {
    const response = await post({ source: 'anilist', profile: '  alice  ' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId, state: 'waiting' });

    // Trimmed, owned by the session, with a retry policy the plan promised.
    const added = queue.adds.at(-1);
    expect(added?.data).toEqual({ userId: USER_ID, source: 'anilist', profile: 'alice' });
    expect(added?.options).toMatchObject({ jobId, attempts: 2 });
  });

  it('joins the job already in flight instead of starting a second one', async () => {
    const before = queue.adds.length;
    const response = await post({ source: 'anilist', profile: 'alice' });
    expect(response.statusCode).toBe(202);
    expect(response.json().state).toBe('waiting');
    expect(queue.adds.length).toBe(before);
  });

  it('re-runs a source once its previous job has finished', async () => {
    const stored = queue.jobs.get(jobId) as StoredJob;
    stored.state = 'completed';
    stored.returnvalue = result;

    const response = await post({ source: 'anilist', profile: 'alice' });
    expect(response.statusCode).toBe(202);
    expect(queue.jobs.get(jobId)?.state).toBe('waiting');
  });

  it('reports an unknown job as unknown rather than failing', async () => {
    const response = await getJob('nothing-here');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: 'unknown', result: null, errorKind: null });
  });

  it('hides another viewer’s job behind a 404', async () => {
    queue.jobs.set(jobId, {
      data: { userId: OTHER_ID, source: 'anilist', profile: 'bob' },
      state: 'active',
      progress: { done: 1, total: 2 },
      returnvalue: null,
      failedReason: '',
    });
    expect((await getJob(jobId)).statusCode).toBe(404);
  });

  it('reports progress and the result of a completed job', async () => {
    queue.jobs.set(jobId, {
      data: { userId: USER_ID, source: 'anilist', profile: 'alice' },
      state: 'completed',
      progress: { done: 1, total: 1 },
      returnvalue: result,
      failedReason: '',
    });

    const response = await getJob(jobId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jobId,
      state: 'completed',
      progress: { done: 1, total: 1 },
      result: { plan: { total: 1, matched: 1 } },
      failedReason: null,
      errorKind: null,
    });
  });

  it('reports why a failed job failed', async () => {
    queue.jobs.set(jobId, {
      data: { userId: USER_ID, source: 'anilist', profile: 'alice' },
      state: 'failed',
      progress: { done: 0, total: 0, errorKind: 'private' },
      returnvalue: null,
      failedReason: 'that profile is private',
    });

    const response = await getJob(jobId);
    expect(response.json()).toMatchObject({
      state: 'failed',
      result: null,
      failedReason: 'that profile is private',
      errorKind: 'private',
    });
  });
});

describe('GET /v1/me/import/sources', () => {
  it('lists every source and why one is unavailable', async () => {
    const app = await build(baseEnv, true);
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/import/sources' });
    expect(response.statusCode).toBe(200);

    const sources = response.json().sources as {
      id: string;
      available: boolean;
      reason?: string;
      requiresBrowser: boolean;
      kinds: string[];
    }[];
    expect(sources.map((source) => source.id)).toEqual(['mal', 'anilist', 'letterboxd', 'trakt']);

    const byId = new Map(sources.map((source) => [source.id, source]));
    expect(byId.get('anilist')).toMatchObject({ available: true, requiresBrowser: false });
    expect(byId.get('anilist')?.reason).toBeUndefined();

    // No MAL_CLIENT_ID in a test env: reported by variable name, never a value.
    expect(byId.get('mal')).toMatchObject({ available: false });
    expect(byId.get('mal')?.reason).toContain('MAL_CLIENT_ID');
    expect(byId.get('trakt')?.reason).toContain('TRAKT_CLIENT_ID');

    // A scrape source with the default transport is not runnable either.
    expect(byId.get('letterboxd')).toMatchObject({ available: false, requiresBrowser: true });
    expect(byId.get('letterboxd')?.reason).toContain('IMPORT_FETCH_MODE');

    await app.close();
  });

  it('offers the scrape source once a browser is configured', async () => {
    const app = await build(
      loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'error',
        IMPORT_FETCH_MODE: 'fallback',
        MAL_CLIENT_ID: 'a-client-id',
      }),
      true,
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/import/sources' });
    const sources = response.json().sources as { id: string; available: boolean }[];
    const byId = new Map(sources.map((source) => [source.id, source]));

    expect(byId.get('letterboxd')).toMatchObject({ available: true });
    expect(byId.get('mal')).toMatchObject({ available: true });
    // The credential value never leaves the process.
    expect(response.body).not.toContain('a-client-id');

    await app.close();
  });
});
