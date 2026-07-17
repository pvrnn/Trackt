import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { ApiErrorSchema, SlimMediaSchema } from '@trackt/shared';

/**
 * Constant-time token comparison: hashing both sides first makes the buffers
 * equal-length (timingSafeEqual requires that) without leaking length via an
 * early return.
 */
function tokenMatches(presented: string, expected: string): boolean {
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Publish surface stub — validates the contract and the token, but publishing
 * itself lands with the population sprint (ADR-0001). The publish path must stay
 * single-writer so seq values commit in order.
 */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/admin/media',
    {
      schema: {
        tags: ['admin'],
        body: SlimMediaSchema,
        response: { 401: ApiErrorSchema, 501: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const token = app.deps.env.CATALOG_ADMIN_TOKEN;
      const header = request.headers.authorization;
      const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      if (!token || presented === undefined || !tokenMatches(presented, token)) {
        return reply.status(401).send({ error: 'unauthorized' });
      }
      return reply.status(501).send({ error: 'publishing not implemented yet' });
    },
  );
};
