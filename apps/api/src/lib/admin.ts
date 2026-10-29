import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSessionUser } from './session.js';

/**
 * Session-role guard for `/v1/admin/*`. The API has had none since the
 * moderation queue was removed, and the flag surface is the first thing since
 * that is written by an operator rather than by a viewer.
 *
 * Wired as a `preHandler`, so a route cannot forget to check a boolean return.
 * Fastify runs body validation before preHandlers, so a malformed body still
 * answers 400 ahead of 401 — the same ordering the catalog's token guard keeps.
 */
export async function requireAdminRole(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const user = await getSessionUser(request.server, request);
  if (!user) return reply.status(401).send({ error: 'authentication required' });
  if (user.role !== 'admin') return reply.status(403).send({ error: 'admin role required' });
}
