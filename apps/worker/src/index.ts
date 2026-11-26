import { createServer } from 'node:http';
import { Redis } from 'ioredis';
import pino from 'pino';
import { Queue, Worker } from 'bullmq';
import { createDb, evaluateAllTrophies } from '@trackt/db';
import type { ImportJobData, ImportJobResult } from '@trackt/imports';
import { EnvValidationError, QUEUES, loadEnv, type Env } from '@trackt/shared';
import { createIdleController } from './idle.js';
import { createImportProcessor } from './importer.js';

/**
 * Background jobs (PRD §6). `importer` runs an account import off the request
 * path (the API's `POST /v1/me/import` produces it); `trophies` is a repeating
 * sweep that re-evaluates every account so the global leaderboard counts people
 * who have not opened their trophies lately. The
 * schedules this process used to register (`metadata-refresh`, then
 * `catalog-sync-repeat`) are retired with the central-catalog pivot (ADR-0002);
 * catalog population is the catalog service's own `db:seed`, not this worker.
 *
 * Reinstate scheduler cleanup — for whichever queue — only once a released
 * version has actually registered a scheduler in the wild.
 *
 * `WORKER_QUEUES` picks which of the two this process consumes, so imports can
 * run in a service of their own; `WORKER_IDLE_SECONDS` lets that service sleep
 * between imports (see idle.ts).
 */

let env: Env;
try {
  env = loadEnv(process.env, { role: 'worker' });
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const logger = pino({
  level: env.LOG_LEVEL,
  ...(env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
    : {}),
});

const runImporter = env.WORKER_QUEUES.includes('importer');
const runTrophies = env.WORKER_QUEUES.includes('trophies');
// The sweep's schedule always leaves a delayed job behind, so a worker that
// runs it is never idle; and one that slept would miss sweeps anyway.
if (env.WORKER_IDLE_SECONDS !== undefined && (runTrophies || !runImporter)) {
  console.error('WORKER_IDLE_SECONDS needs WORKER_QUEUES=importer (the trophy sweep never idles)');
  process.exit(1);
}

/**
 * Boot-time dependency calls hang forever when the dependency is down (ioredis
 * retries indefinitely, postgres-js queues), so "worker started" would never log
 * and the hang would be silent. Fail fast instead — the orchestrator restarts
 * the container.
 */
async function withBootTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after 30s — is the service reachable?`)),
      30_000,
    );
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

interface Consumers {
  importQueue: Queue | undefined;
  close(): Promise<void>;
}

/** Connects to Redis and Postgres and starts consuming the configured queues. */
async function startConsumers(): Promise<Consumers> {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  // ioredis retries forever by design (fine once running), but every failed
  // attempt emits 'error' — without a listener that would crash the process.
  connection.on('error', (error) => {
    logger.warn({ err: error }, 'redis connection error (retrying)');
  });
  // An import writes log rows, so this process needs the database too — and one
  // pool of two is plenty for a job that is one loop of single-row writes.
  const db = createDb(env.DATABASE_URL, { max: 2 });
  const disconnect = async () => {
    await db.$client.end().catch(() => undefined);
    connection.disconnect();
  };

  try {
    await withBootTimeout(connection.ping(), 'redis connectivity check');
    await withBootTimeout(db.execute('select 1'), 'database connectivity check');
  } catch (error) {
    await disconnect();
    throw error;
  }

  const closers: Array<() => Promise<void>> = [];
  let importQueue: Queue | undefined;

  if (runImporter) {
    const processor = createImportProcessor({ db, env });
    const worker = new Worker<ImportJobData, ImportJobResult>(QUEUES.importer, processor, {
      connection,
      // An import is a scrape of somebody's profile: two at once is rude to the
      // provider and doubles the chance of being challenged.
      concurrency: 1,
    });
    worker.on('completed', (job, result) => {
      logger.info(
        {
          job: job.id,
          source: result?.plan.source,
          profile: result?.plan.profile,
          created: result?.report?.created,
          total: result?.plan.total,
        },
        'import completed',
      );
    });
    worker.on('failed', (job, error) => {
      logger.error({ job: job?.id, err: error }, 'import failed');
    });
    worker.on('error', (error) => {
      logger.warn({ err: error }, 'worker error');
    });
    importQueue = new Queue(QUEUES.importer, { connection });
    const queue = importQueue;
    // Lets the running import finish rather than dropping it mid-loop.
    closers.push(
      () => worker.close(),
      () => queue.close(),
    );
  }

  if (runTrophies) {
    const TROPHY_SWEEP_EVERY_MS = 30 * 60 * 1000;
    const trophyQueue = new Queue(QUEUES.trophies, { connection });
    await trophyQueue.upsertJobScheduler(
      'trophies-sweep',
      { every: TROPHY_SWEEP_EVERY_MS },
      { name: 'sweep' },
    );
    const trophyWorker = new Worker(
      QUEUES.trophies,
      async () => ({ evaluated: await evaluateAllTrophies(db) }),
      { connection, concurrency: 1 },
    );
    trophyWorker.on('completed', (job, result: { evaluated: number }) => {
      logger.info({ job: job.id, evaluated: result.evaluated }, 'trophy sweep completed');
    });
    trophyWorker.on('failed', (job, error) => {
      logger.error({ job: job?.id, err: error }, 'trophy sweep failed');
    });
    closers.push(
      () => trophyWorker.close(),
      () => trophyQueue.close(),
    );
  }

  return {
    importQueue,
    close: async () => {
      try {
        await Promise.all(closers.map((close) => close()));
      } finally {
        await disconnect();
      }
    },
  };
}

const exit = (code: number): never => process.exit(code);

if (env.WORKER_IDLE_SECONDS === undefined) {
  let consumers: Consumers;
  try {
    consumers = await startConsumers();
  } catch (error) {
    logger.error({ err: error }, 'worker boot failed');
    exit(1);
  }
  logger.info({ queues: env.WORKER_QUEUES }, 'worker started');

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    try {
      await consumers.close();
    } catch (error) {
      logger.error({ err: error }, 'error closing the worker');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
} else {
  const idleSeconds = env.WORKER_IDLE_SECONDS;
  let consumers: Consumers | undefined;
  const controller = createIdleController({
    idleMs: idleSeconds * 1000,
    checkEveryMs: Math.min(30_000, idleSeconds * 1000),
    start: async () => {
      consumers = await startConsumers();
    },
    stop: async () => {
      await consumers?.close();
      consumers = undefined;
    },
    hasWork: async () => {
      const counts = await consumers!.importQueue!.getJobCounts(
        'active',
        'waiting',
        'delayed',
        'prioritized',
        'waiting-children',
      );
      return Object.values(counts).some((count) => count > 0);
    },
    onIdle: () => logger.info({ idleSeconds }, 'no imports left: connections closed until woken'),
    onWake: () => logger.info('woken: consuming imports'),
    onCheckError: (error) => logger.warn({ err: error }, 'idle check failed'),
  });

  // The wake endpoint is the only way in once the consumers have stopped: the
  // API calls it after queueing an import (WORKER_WAKE_URL).
  const server = createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (path === '/healthz') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ status: 'ok', state: controller.state }));
      return;
    }
    if (path === '/wake' && request.method === 'POST') {
      controller.wake().then(
        () => {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ state: controller.state }));
        },
        (error: unknown) => {
          logger.error({ err: error }, 'wake failed');
          response.writeHead(503, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'worker could not reach its dependencies' }));
        },
      );
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(env.PORT, env.HOST);

  // A boot is a wake: the host only starts this service for a request, or for
  // a deploy, and either way there may be imports waiting.
  try {
    await controller.wake();
  } catch (error) {
    logger.error({ err: error }, 'worker boot failed');
    exit(1);
  }
  logger.info({ port: env.PORT, idleSeconds }, 'worker started in idle mode');

  const shutdown = async (signal: string) => {
    logger.info(`received ${signal}, shutting down`);
    server.close();
    try {
      await controller.close();
    } catch (error) {
      logger.error({ err: error }, 'error closing the worker');
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}
