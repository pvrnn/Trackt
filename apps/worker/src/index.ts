import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { createDb } from '@trackt/db';
import { EnvValidationError, QUEUES, loadEnv } from '@trackt/shared';
import { runCatalogSync } from './catalog-sync.js';

/**
 * Background jobs (PRD §6): catalog sync, importers, notifications.
 * The catalog-sync job mirrors the central slim catalog into the local
 * `media` table (ADR-0001) — scheduled below, plus an immediate run on boot
 * so a fresh instance starts its initial full sync right away.
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
const db = createDb(env.DATABASE_URL, { max: 3 });

const catalogQueue = new Queue(QUEUES.catalogSync, { connection });

// Remove the provider-refresh schedulers from the pre-pivot era (ADR-0001):
// dev Redis volumes persist, so old schedulers would keep firing otherwise.
const legacyQueue = new Queue(QUEUES.metadataRefresh, { connection });
await legacyQueue.removeJobScheduler('refresh-airing-daily');
await legacyQueue.removeJobScheduler('refresh-ended-weekly');
await legacyQueue.close();

const catalogUrl = env.CATALOG_URL;
if (catalogUrl) {
  // Repeatable sync; BullMQ runs the first iteration immediately, which
  // doubles as the initial full sync (cursor 0) on a fresh instance.
  await catalogQueue.upsertJobScheduler(
    'catalog-sync-repeat',
    { every: 6 * 60 * 60 * 1000 },
    { name: 'sync', opts: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } } },
  );
} else {
  await catalogQueue.removeJobScheduler('catalog-sync-repeat');
  logger.warn('CATALOG_URL is not set — catalog sync disabled, local search stays empty');
}

const catalogWorker = new Worker(
  QUEUES.catalogSync,
  async (job) => {
    if (!catalogUrl) {
      logger.warn({ jobId: job.id }, 'skipping catalog sync: CATALOG_URL is not set');
      return;
    }
    logger.info({ jobId: job.id, name: job.name }, 'catalog sync started');
    return runCatalogSync({ db, catalogUrl, logger });
  },
  { connection },
);

catalogWorker.on('completed', (job) => {
  logger.debug({ jobId: job.id, name: job.name }, 'job completed');
});
catalogWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, err: error }, 'job failed');
});

logger.info({ queue: QUEUES.catalogSync, catalogUrl }, 'worker started');

const shutdown = async (signal: string) => {
  logger.info(`received ${signal}, shutting down`);
  await catalogWorker.close();
  await catalogQueue.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
