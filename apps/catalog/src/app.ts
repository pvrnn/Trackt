import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { APP_VERSION, type CatalogEnv } from '@trackt/shared';
import type { CatalogDb } from './db/index.js';
import { healthRoutes } from './routes/health.js';
import { v1Routes } from './routes/v1/index.js';

export interface CatalogAppDeps {
  env: CatalogEnv;
  /** Absent in unit tests: routes that need it respond 503. */
  db?: CatalogDb;
  dbPing?: () => Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: CatalogAppDeps;
  }
}

export async function buildApp(deps: CatalogAppDeps): Promise<FastifyInstance> {
  const { env } = deps;

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
        : {}),
    },
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('deps', deps);

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Trackt Catalog API',
        description:
          'Central slim catalog (ADR-0001): the shared media catalog every Trackt instance syncs. Read-only for instances; publishing is a project-operated admin path.',
        version: APP_VERSION,
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  await app.register(healthRoutes);
  await app.register(v1Routes, { prefix: '/v1' });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
