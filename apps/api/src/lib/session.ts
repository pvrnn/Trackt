import type { FastifyInstance, FastifyRequest } from 'fastify';

/** Convert Fastify's header map to a WHATWG Headers object (better-auth's input). */
export function toWebHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(key, v);
    else headers.append(key, value);
  }
  return headers;
}

export interface SessionUser {
  id: string;
  name: string;
}

/**
 * Resolve the requesting user from the better-auth session cookie.
 * Null when unauthenticated or when auth isn't wired (unit tests).
 */
export async function getSessionUser(
  app: FastifyInstance,
  request: FastifyRequest,
): Promise<SessionUser | null> {
  const auth = app.deps.auth;
  if (!auth) return null;
  const session = await auth.api.getSession({ headers: toWebHeaders(request) });
  return session ? { id: session.user.id, name: session.user.name } : null;
}
