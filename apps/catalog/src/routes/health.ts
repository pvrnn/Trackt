import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  APP_VERSION,
  HealthResponseSchema,
  ReadyResponseSchema,
  type ReadyResponse,
} from '@trackt/shared';

/** /healthz and /readyz for deploy orchestration, mirroring apps/api. */
export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/healthz', { schema: { response: { 200: HealthResponseSchema } } }, async () => ({
    status: 'ok' as const,
    version: APP_VERSION,
  }));

  app.get(
    '/readyz',
    { schema: { response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema } } },
    async (_request, reply) => {
      const checks: ReadyResponse['checks'] = {
        database: await runCheck(app.deps.dbPing),
      };
      const degraded = Object.values(checks).includes('error');
      return reply
        .status(degraded ? 503 : 200)
        .send({ status: degraded ? 'degraded' : 'ok', checks });
    },
  );
};

async function runCheck(ping?: () => Promise<void>): Promise<'ok' | 'error' | 'skipped'> {
  if (!ping) return 'skipped';
  try {
    await ping();
    return 'ok';
  } catch {
    return 'error';
  }
}
