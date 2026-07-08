import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { EnvValidationError, QUEUES, loadEnv } from '@trackt/shared';

/**
 * Background jobs (PRD §6): metadata refresh, importers, notifications.
 * v0.1 wires the queue plumbing and a daily metadata-refresh schedule;
 * job handlers grow with the features that need them.
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

const metadataQueue = new Queue(QUEUES.metadataRefresh, { connection });

// Cache policy (PRD §4): airing/publishing titles refresh daily, ended titles weekly.
await metadataQueue.upsertJobScheduler(
  'refresh-airing-daily',
  { pattern: '0 3 * * *' },
  { name: 'refresh-airing', data: {} },
);
await metadataQueue.upsertJobScheduler(
  'refresh-ended-weekly',
  { pattern: '0 4 * * 1' },
  { name: 'refresh-ended', data: {} },
);

const metadataWorker = new Worker(
  QUEUES.metadataRefresh,
  async (job) => {
    logger.info({ jobId: job.id, name: job.name, data: job.data }, 'processing metadata refresh');
    // TODO(v0.1): select stale media rows and re-fetch via @trackt/providers.
  },
  { connection },
);

metadataWorker.on('completed', (job) => {
  logger.debug({ jobId: job.id, name: job.name }, 'job completed');
});
metadataWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, name: job?.name, err: error }, 'job failed');
});

logger.info({ queue: QUEUES.metadataRefresh }, 'worker started');

const shutdown = async (signal: string) => {
  logger.info(`received ${signal}, shutting down`);
  await metadataWorker.close();
  await metadataQueue.close();
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
