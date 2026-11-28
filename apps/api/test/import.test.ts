import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Auth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';
import { loadEnv, type Env } from '@trackt/shared';
import type { ImportJobResult } from '@trackt/imports';
import { fakeQueue, type StoredJob } from './fake-import-queue.js';

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

const jobId = `${USER_ID}-anilist`;

const result: ImportJobResult = {
  report: {
    source: 'anilist',
    profile: 'alice',
    created: 1,
    updated: 0,
    merged: 0,
    skippedExisting: 0,
    withProgress: 1,
    ratings: 0,
    favourites: 0,
    uncertain: 0,
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
    fromCatalog: 0,
    favourites: 0,
    warnings: 0,
    matchedByTitle: 0,
    uncertain: 0,
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
    const response = await post({ source: 'trakt', profile: 'alice' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('TRAKT_CLIENT_ID');
  });

  describe('a file source', () => {
    const movies = [
      {
        id: { tvdb: 169, imdb: 'tt0133093' },
        title: 'The Matrix',
        year: 1999,
        watched_at: '2021-03-04T20:00:00Z',
        is_watched: true,
        is_favorite: false,
        rewatch_count: 0,
      },
    ];

    it('reads the upload at the door and queues only its compact form', async () => {
      const response = await post({
        source: 'tvtime',
        dryRun: true,
        files: [{ name: 'tvtime-movies-2026-07-07.json', content: JSON.stringify(movies) }],
      });
      expect(response.statusCode).toBe(202);
      expect(response.json().jobId).toBe(`${USER_ID}-tvtime-preview`);

      const added = queue.adds.at(-1);
      expect(added?.data).toMatchObject({
        userId: USER_ID,
        source: 'tvtime',
        profile: 'export 2026-07-07',
        dryRun: true,
        upload: {
          showsFrom: null,
          shows: null,
          movies: [{ imdb: 'tt0133093', watched: true, watchedAt: '2021-03-04' }],
        },
      });
      expect(added?.data).not.toHaveProperty('files');
    });

    it('refuses a file source without a file, and a file that is not the export', async () => {
      expect((await post({ source: 'tvtime', profile: 'me' })).statusCode).toBe(400);
      const wrong = await post({
        source: 'tvtime',
        files: [{ name: 'notes.json', content: '{}' }],
      });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error).toMatch(/notes\.json is not a TV Time export/);
    });

    it('reads a Netflix viewing history and refuses a file that is not one', async () => {
      const response = await post({
        source: 'netflix',
        dryRun: true,
        files: [
          {
            name: 'NetflixViewingHistory.csv',
            content: 'Title,Date\n"Arcane: Season 1: Welcome to the Playground","11/6/24"\n',
          },
        ],
      });
      expect(response.statusCode).toBe(202);
      expect(queue.adds.at(-1)?.data).toMatchObject({
        source: 'netflix',
        profile: 'history to 2024-11-06',
        upload: { seasons: [{ show: 'Arcane', number: 1, episodes: 1 }] },
      });

      const wrong = await post({
        source: 'netflix',
        files: [{ name: 'tvtime-movies.json', content: JSON.stringify(movies) }],
      });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json().error).toMatch(/is not a Netflix viewing history/);
    });

    it('accepts an export larger than the default body limit', async () => {
      const big = Array.from({ length: 12_000 }, (_, index) => ({
        ...movies[0],
        title: `Film ${index}`,
      }));
      const content = JSON.stringify(big);
      expect(content.length).toBeGreaterThan(1024 * 1024);
      const response = await post({
        source: 'tvtime',
        files: [{ name: 'tvtime-movies.json', content }],
      });
      expect(response.statusCode).toBe(202);
    });
  });

  it('enqueues a job and answers 202 with its id and state', async () => {
    const response = await post({ source: 'anilist', profile: '  alice  ' });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId, state: 'waiting', runId: null });

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

  it('queues a preview as its own job, so it cannot swallow the real run', async () => {
    const response = await post({ source: 'anilist', profile: 'alice', dryRun: true });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId: `${jobId}-preview`, state: 'waiting', runId: null });

    const added = queue.adds.at(-1);
    expect(added?.data).toEqual({
      userId: USER_ID,
      source: 'anilist',
      profile: 'alice',
      dryRun: true,
    });
    // The real run queued earlier is still waiting under its own id.
    expect(queue.jobs.get(jobId)?.state).toBe('waiting');
  });

  it('wakes an idle-mode worker for a queued job, and not for a running one', async () => {
    const local = fakeQueue();
    let wakes = 0;
    const woken = await buildApp({
      env: baseEnv,
      auth: fakeAuth(USER_ID),
      importQueue: local.queue,
      wakeWorker: () => {
        wakes++;
      },
    });
    try {
      await woken.inject({
        method: 'POST',
        url: '/api/v1/me/import',
        payload: { source: 'anilist', profile: 'alice' },
      });
      expect(wakes).toBe(1);
      // Polling a job that still waits wakes again, in case the first was lost.
      await woken.inject({ method: 'GET', url: `/api/v1/me/import/${jobId}` });
      expect(wakes).toBe(2);
      (local.jobs.get(jobId) as StoredJob).state = 'active';
      await woken.inject({ method: 'GET', url: `/api/v1/me/import/${jobId}` });
      expect(wakes).toBe(2);
    } finally {
      await woken.close();
    }
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
    expect(sources.map((source) => source.id)).toEqual([
      'mal',
      'anilist',
      'letterboxd',
      'trakt',
      'steam',
      'tvtime',
      'netflix',
    ]);

    const byId = new Map(sources.map((source) => [source.id, source]));
    expect(byId.get('anilist')).toMatchObject({ available: true, requiresBrowser: false });
    expect(byId.get('anilist')?.reason).toBeUndefined();

    // MAL needs no credential and answers plain HTTP; its browser path is an
    // option, not a requirement.
    expect(byId.get('mal')).toMatchObject({
      available: true,
      access: 'scrape',
      requiresBrowser: true,
    });
    expect(byId.get('mal')?.reason).toBeUndefined();
    expect(byId.get('trakt')?.reason).toContain('TRAKT_CLIENT_ID');

    // Steam is a keyed API with nothing to scrape, so a missing key is its only
    // reason to be unavailable.
    expect(byId.get('steam')).toMatchObject({
      available: false,
      access: 'api',
      requiresBrowser: false,
      kinds: ['game'],
    });
    expect(byId.get('steam')?.reason).toContain('STEAM_API_KEY');

    // An upload needs nothing from the operator.
    expect(byId.get('tvtime')).toMatchObject({ available: true, access: 'file' });

    // A scrape source that plain HTTP is refused for is not runnable either.
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
        TRAKT_CLIENT_ID: 'a-client-id',
        STEAM_API_KEY: 'a-steam-key',
      }),
      true,
    );
    const response = await app.inject({ method: 'GET', url: '/api/v1/me/import/sources' });
    const sources = response.json().sources as { id: string; available: boolean }[];
    const byId = new Map(sources.map((source) => [source.id, source]));

    expect(byId.get('letterboxd')).toMatchObject({ available: true });
    expect(byId.get('mal')).toMatchObject({ available: true });
    expect(byId.get('steam')).toMatchObject({ available: true });
    // The credential values never leave the process.
    expect(response.body).not.toContain('a-client-id');
    expect(response.body).not.toContain('a-steam-key');

    await app.close();
  });
});
