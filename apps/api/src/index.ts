import httpProxy from '@fastify/http-proxy';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { createDb } from '@trackt/db';
import { createDefaultRegistry } from '@trackt/providers';
import { EnvValidationError, loadEnv } from '@trackt/shared';
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
    registry: createDefaultRegistry({
      tmdbApiKey: env.TMDB_API_KEY,
      logger: { warn: (message) => console.warn(message) },
    }),
    dbPing: async () => {
      await db.execute(sql`select 1`);
    },
    redisPing: async () => {
      await redis.ping();
    },
  });

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
    await app.close();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
