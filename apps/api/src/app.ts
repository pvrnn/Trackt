import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { APP_VERSION, AVATAR_MAX_BYTES, type Env } from '@trackt/shared';
import type { Db } from '@trackt/db';
import type { Auth } from './auth.js';
import { errorHandler } from './lib/error-handler.js';
import { toWebHeaders } from './lib/session.js';
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1/index.js';

export interface AppDeps {
  env: Env;
  /** Absent in unit tests: routes that need them respond 503. */
  db?: Db;
  auth?: Auth;
  dbPing?: () => Promise<void>;
  redisPing?: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
    // Sever keep-alive connections on close() so shutdown can't hang until SIGKILL.
    forceCloseConnections: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.decorate('deps', deps);

  await app.register(cors, {
    origin: env.NODE_ENV === 'production' ? [env.APP_URL] : true,
    credentials: true,
  });

  // Blunt per-IP abuse guard; health probes stay exempt. Search gets a tighter
  // per-route bucket below (anonymous, and the most expensive read).
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (request) => request.url === '/healthz' || request.url === '/readyz',
  });

  // User uploads (avatars; later, covers for user-created entries — PRD §6.1).
  // Local disk for now; the S3_* env vars are reserved for object storage.
  const uploadsRoot = resolve(env.UPLOADS_DIR);
  mkdirSync(uploadsRoot, { recursive: true });
  await app.register(fastifyStatic, { root: uploadsRoot, prefix: '/uploads/' });
  await app.register(multipart, { limits: { fileSize: AVATAR_MAX_BYTES, files: 1 } });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Trackt API',
        description:
          'Public REST API — data portability is the founding principle, so everything the app can do, the API can do.',
        version: APP_VERSION,
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes);
  if (deps.auth) mountAuth(app, deps.auth);
  await app.register(v1Routes, { prefix: '/api/v1' });

  return app;
}

/** Bridge Fastify requests to better-auth's WHATWG Request handler. */
function mountAuth(app: FastifyInstance, auth: Auth): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      const webRequest = new Request(url, {
        method: request.method,
        headers: toWebHeaders(request),
        body: request.body ? JSON.stringify(request.body) : undefined,
      });
      const response = await auth.handler(webRequest);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}

export type App = Awaited<ReturnType<typeof buildApp>>;
export type AppWithTypes = FastifyInstance & { withTypeProvider: () => ZodTypeProvider };
