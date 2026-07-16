import { sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '@trackt/db';
import { isModerator, type ModerationStatus } from '@trackt/shared';
import { getSessionUser, type SessionUser } from './session.js';

/**
 * Who may see a media row (PRD §3.5): `verified` → everyone, `unverified` →
 * creator + moderators, `rejected` → creator only (moderators reach rejected
 * entries through the queue's rejected filter, not search/detail).
 * Soft-deleted rows (`deleted_at` set) are invisible to everyone — pulled
 * from circulation while user logs/progress stay intact.
 */
export function canViewMedia(
  row: { moderation: ModerationStatus; createdBy: string | null; deletedAt: Date | null },
  viewer: SessionUser | null,
): boolean {
  if (row.deletedAt !== null) return false;
  if (row.moderation === 'verified') return true;
  if (viewer !== null && row.createdBy === viewer.id) return true;
  return viewer !== null && isModerator(viewer.role) && row.moderation === 'unverified';
}

/**
 * The same rule as a SQL fragment, for raw queries over `media`. `alias` must
 * be a literal from our code (e.g. `sql.raw('m.')`) — the SQL type keeps user
 * input out of it.
 */
export function visibleMediaSql(viewer: SessionUser | null, alias: SQL = sql.raw('')): SQL {
  const viewerId = viewer?.id ?? null;
  const viewerIsModerator = viewer !== null && isModerator(viewer.role);
  return sql`(${alias}deleted_at IS NULL
    AND (${alias}moderation = 'verified'
      OR ${alias}created_by = ${viewerId}::uuid
      OR (${viewerIsModerator} AND ${alias}moderation = 'unverified')))`;
}

/** 503/401/403 preamble for moderator-only routes. */
export async function requireModerator(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<{ db: Db; user: SessionUser } | undefined> {
  const db = app.deps.db;
  if (!db) {
    await reply.status(503).send({ error: 'database unavailable' });
    return undefined;
  }
  const user = await getSessionUser(app, request);
  if (!user) {
    await reply.status(401).send({ error: 'authentication required' });
    return undefined;
  }
  if (!isModerator(user.role)) {
    await reply.status(403).send({ error: 'moderator access required' });
    return undefined;
  }
  return { db, user };
}
