import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { EnvValidationError, QUEUES, loadEnv } from '@trackt/shared';

/**
 * Background jobs (PRD §6): catalog sync, importers, notifications.
 * v0.1 wires the queue plumbing; the catalog-sync handler (pull slim-catalog
 * changes from the central service, ADR-0001) lands with the sync sprint.
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

const catalogQueue = new Queue(QUEUES.catalogSync, { connection });

// Remove the provider-refresh schedulers from the pre-pivot era (ADR-0001):
// dev Redis volumes persist, so old schedulers would keep firing otherwise.
const legacyQueue = new Queue(QUEUES.metadataRefresh, { connection });
await legacyQueue.removeJobScheduler('refresh-airing-daily');
await legacyQueue.removeJobScheduler('refresh-ended-weekly');
await legacyQueue.close();

const catalogWorker = new Worker(
  QUEUES.catalogSync,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name, data: job.data }, 'processing catalog sync');
    // TODO(v0.2): pull /v1/catalog/changes from the central catalog and upsert media rows.
  },
  { connection },
);

catalogWorker.on('completed', (job) => {
  logger.debug({ jobId: job.id, name: job.name }, 'job completed');
});
catalogWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, err: error }, 'job failed');
});

logger.info({ queue: QUEUES.catalogSync }, 'worker started');

const shutdown = async (signal: string) => {
  logger.info(`received ${signal}, shutting down`);
  await catalogWorker.close();
  await catalogQueue.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
