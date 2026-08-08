import { Redis } from 'ioredis';
import pino from 'pino';
import { EnvValidationError, loadEnv } from '@trackt/shared';

/**
 * Background jobs (PRD §6): importers, notifications (not yet built). Catalog
 * population moved off this worker: search now queries the central catalog
 * live from the API's request path and materializes hits on first sight
 * (ADR-0002) — this process no longer mirrors the whole catalog on a
 * schedule, and runs no jobs at all today. The open Redis connection below is
 * what keeps this process alive for docker/entrypoint.sh's liveness check
 * until a real job lands on it.
 *
 * This file used to unregister the schedulers of two retired jobs
 * (`metadata-refresh`'s crons, then `catalog-sync-repeat`) on every boot, to
 * stop them firing on self-hosted Redis volumes that survived an upgrade.
 * Removed: the project is pre-launch, so no such instance exists. Reinstate
 * that cleanup — for whichever queue — only once a released version has
 * actually registered a scheduler in the wild.
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
  // Nothing to register yet, so this is purely the liveness assertion: prove
  // Redis is actually reachable rather than letting ioredis retry silently
  // behind a "worker started" log.
  await withBootTimeout(connection.ping(), 'redis connectivity check');
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
