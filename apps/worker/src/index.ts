import { Redis } from 'ioredis';
import pino from 'pino';
import { Worker } from 'bullmq';
import { createDb } from '@trackt/db';
import type { ImportJobData, ImportJobResult } from '@trackt/imports';
import { EnvValidationError, QUEUES, loadEnv } from '@trackt/shared';
import { createImportProcessor } from './importer.js';

/**
 * Background jobs (PRD §6). One queue is real today: `importer` runs an account
 * import off the request path (the API's `POST /v1/me/import` produces it). The
 * schedules this process used to register (`metadata-refresh`, then
 * `catalog-sync-repeat`) are retired with the central-catalog pivot (ADR-0002);
 * catalog population is the catalog service's own `db:seed`, not this worker.
 *
 * Reinstate scheduler cleanup — for whichever queue — only once a released
 * version has actually registered a scheduler in the wild.
 */

let env;
try {
  env = loadEnv();
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

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
// ioredis retries forever by design (fine once running), but every failed
// attempt emits 'error' — without a listener that would crash the process.
connection.on('error', (error) => {
  logger.warn({ err: error }, 'redis connection error (retrying)');
});

// An import writes log rows, so this process needs the database too — and one
// pool of two is plenty for a job that is one loop of single-row writes.
const db = createDb(env.DATABASE_URL, { max: 2 });

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

try {
  await withBootTimeout(connection.ping(), 'redis connectivity check');
  await withBootTimeout(db.execute('select 1'), 'database connectivity check');
} catch (error) {
  logger.error({ err: error }, 'worker boot failed');
  process.exit(1);
}

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

logger.info('worker started');

const shutdown = async (signal: string) => {
  logger.info(`received ${signal}, shutting down`);
  try {
    // Lets the running import finish rather than dropping it mid-loop.
    await worker.close();
  } catch (error) {
    logger.error({ err: error }, 'error closing the worker');
  } finally {
    await db.$client.end().catch(() => undefined);
    connection.disconnect();
    process.exit(0);
  }
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
