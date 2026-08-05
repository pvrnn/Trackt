import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

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
 * Bearer guard for every `/v1/admin` route — one timing-safe comparison shared
 * by all of them rather than a copy per handler.
 *
 * Wired as a `preHandler`, so a route cannot forget to check the return value
 * the way an in-handler guard can. Fastify runs body validation *before*
 * preHandlers, so a malformed body still answers 400 ahead of 401; that
 * ordering predates this guard and is preserved deliberately.
 *
 * An unset `CATALOG_ADMIN_TOKEN` denies everything: a catalog deployed without
 * a token has no publish path, rather than an open one.
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = request.server.deps.env.CATALOG_ADMIN_TOKEN;
  const header = request.headers.authorization;
  const presented = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token || presented === undefined || !tokenMatches(presented, token)) {
    return reply.status(401).send({ error: 'unauthorized' });
  }
}
