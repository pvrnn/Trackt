import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { EnvValidationError, QUEUES, loadEnv } from '@trackt/shared';

/**
 * Background jobs (PRD §6): importers, notifications (not yet built). Catalog
 * population moved off this worker: search now queries the central catalog
 * live from the API's request path and materializes hits on first sight
 * (ADR-0002) — this process no longer mirrors the whole catalog on a
 * schedule. The open Redis connection below is what keeps this process alive
 * for docker/entrypoint.sh's liveness check until a real job lands on it.
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

/**
 * Boot-time Redis calls hang forever when Redis is down (ioredis retries
 * indefinitely), so "worker started" would never log and the hang is silent
 * apart from the error listener above. Fail fast instead — the orchestrator
 * restarts the container.
 */
async function withBootTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after 30s — is Redis reachable?`)),
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
  // Remove schedulers from retired jobs: self-hosted Redis volumes persist
  // across upgrades, so old schedulers would keep firing otherwise.
  const legacyQueue = new Queue(QUEUES.metadataRefresh, { connection });
  await withBootTimeout(
    (async () => {
      await legacyQueue.removeJobScheduler('refresh-airing-daily');
      await legacyQueue.removeJobScheduler('refresh-ended-weekly');
      await legacyQueue.close();
    })(),
    'legacy scheduler cleanup',
  );

  // 'catalog-sync' (bulk full-catalog mirror, ADR-0001) was retired by
  // ADR-0002 in favor of live federated search — no QUEUES entry for it
  // anymore, name kept here as a literal purely to clean up the scheduler an
  // already-upgraded instance may still have registered.
  const retiredCatalogQueue = new Queue('catalog-sync', { connection });
  await withBootTimeout(
    (async () => {
      await retiredCatalogQueue.removeJobScheduler('catalog-sync-repeat');
      await retiredCatalogQueue.close();
    })(),
    'retired catalog-sync scheduler cleanup',
  );
} catch (error) {
  logger.error({ err: error }, 'worker boot failed');
  process.exit(1);
}

logger.info('worker started');

const shutdown = async (signal: string) => {
  logger.info(`received ${signal}, shutting down`);
  connection.disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
