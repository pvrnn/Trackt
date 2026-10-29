import httpProxy from '@fastify/http-proxy';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createDb } from '@trackt/db';
import { EnvValidationError, loadEnv, parseFlagOverrides } from '@trackt/shared';
import { buildApp } from './app.js';
import { createAuth } from './auth.js';

async function main(): Promise<void> {
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

  const db = createDb(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const auth = createAuth(db, env);

  const app = await buildApp({
    env,
    db,
    auth,
    dbPing: async () => {
      await db.execute(sql`select 1`);
    },
    redisPing: async () => {
      await redis.ping();
    },
  });

  // Without a listener ioredis 'error' events crash the process (unhandled
  // 'error' on an EventEmitter); route them through the app logger instead.
  redis.on('error', (error) => {
    app.log.warn({ err: error }, 'redis connection error');
  });

  // The flag grammar is warned about once, at boot, rather than on every
  // evaluation: an operator's stale FEATURE_FLAGS must not brick an upgrade,
  // but it must not be silent either (ADR-0011).
  for (const warning of parseFlagOverrides(env.FEATURE_FLAGS).warnings) {
    app.log.warn(warning);
  }

  // Monolith mode: everything that isn't an API route is proxied to the web SSR server.
  if (env.WEB_PROXY_UPSTREAM) {
    await app.register(httpProxy, {
      upstream: env.WEB_PROXY_UPSTREAM,
      prefix: '/',
      websocket: false,
      // OPTIONS is owned by @fastify/cors's preflight wildcard route.
      httpMethods: ['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT'],
    });
    app.log.info(`proxying non-API routes to ${env.WEB_PROXY_UPSTREAM}`);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`received ${signal}, shutting down`);
    try {
      // buildApp sets forceCloseConnections, so lingering keep-alives can't hang this.
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, 'error during shutdown');
    } finally {
      redis.disconnect();
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
