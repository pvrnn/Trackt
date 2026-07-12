import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { media, users } from '@trackt/db';
import {
  ApiErrorSchema,
  ModerationPatchBodySchema,
  ModerationQueueItemSchema,
  ModerationQueueQuerySchema,
  ModerationQueueResponseSchema,
} from '@trackt/shared';
import { requireModerator } from '../../lib/visibility.js';

/**
 * Per-instance moderation queue (PRD §3.5, §7): user-created entries wait as
 * `unverified` media rows — the row itself is the queue item, no extra table.
 * Moderators edit fields, verify, or reject; both verdict directions are
 * allowed so a rejection can be undone from the rejected filter.
 */

const QUEUE_LIMIT = 100;

export const moderationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/moderation/queue',
    {
      schema: {
        tags: ['moderation'],
        querystring: ModerationQueueQuerySchema,
        response: {
          200: ModerationQueueResponseSchema,
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireModerator(app, request, reply);
      if (!ctx) return;
      const rows = await ctx.db
        .select({
          id: media.id,
          slug: media.slug,
          kind: media.kind,
          title: media.title,
          originalTitle: media.originalTitle,
          year: media.year,
          description: media.description,
          genres: media.genres,
          synonyms: media.synonyms,
          episodeCount: media.episodeCount,
          seasonCount: media.seasonCount,
          chapterCount: media.chapterCount,
          volumeCount: media.volumeCount,
          coverUrl: media.coverUrl,
          moderation: media.moderation,
          createdAt: media.createdAt,
          creatorUsername: users.username,
          creatorName: users.name,
        })
        .from(media)
        .leftJoin(users, eq(users.id, media.createdBy))
        .where(and(eq(media.source, 'user'), eq(media.moderation, request.query.status)))
        .orderBy(asc(media.createdAt))
        .limit(QUEUE_LIMIT);

      return {
        items: rows.map(({ creatorUsername, creatorName, createdAt, ...item }) => ({
          ...item,
          createdAt: createdAt.toISOString(),
          // Left join misses when the creator's account was deleted.
          creator: creatorName === null ? null : { username: creatorUsername, name: creatorName },
        })),
      };
    },
  );

  app.patch(
    '/moderation/media/:id',
    {
      schema: {
        tags: ['moderation'],
        params: z.object({ id: z.uuid() }),
        body: ModerationPatchBodySchema,
        response: {
          200: ModerationQueueItemSchema.pick({ id: true, slug: true, moderation: true }),
          401: ApiErrorSchema,
          403: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireModerator(app, request, reply);
      if (!ctx) return;
      // Provider-synced rows stay off-limits: moderation only governs user entries.
      const [row] = await ctx.db
        .select({ id: media.id })
        .from(media)
        .where(and(eq(media.id, request.params.id), eq(media.source, 'user')))
        .limit(1);
      if (!row) return reply.status(404).send({ error: 'media not found' });

      const { moderation, ...fields } = request.body;
      const [updated] = await ctx.db
        .update(media)
        .set({
          ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
          ...(moderation !== undefined ? { moderation } : {}),
          updatedAt: new Date(),
        })
        .where(eq(media.id, row.id))
        .returning({ id: media.id, slug: media.slug, moderation: media.moderation });
      return updated;
    },
  );
};
