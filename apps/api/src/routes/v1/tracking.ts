import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { favorite, media, mediaPart, progress, rating, userMedia, type Db } from '@trackt/db';
import {
  ApiErrorSchema,
  LogStatusSchema,
  PART_KIND_BY_MEDIA,
  PartNumberParamSchema,
  RateBodySchema,
  RatingScoreSchema,
  UpdateLogBodySchema,
} from '@trackt/shared';
import { getSessionUser, type SessionUser } from '../../lib/session.js';
import { canViewMedia } from '../../lib/visibility.js';

/**
 * Tracking core (PRD §3.1–3.2): the viewer's log status, rating, and per-part
 * check-ins for a work. Progress parts are generated lazily from the slim
 * catalog's totals — flat numbered episodes/chapters until the catalog carries
 * per-part structure (titles, seasons).
 */

const MediaIdParamsSchema = z.object({ id: z.uuid() });
const ProgressParamsSchema = z.object({ id: z.uuid(), number: PartNumberParamSchema });

type MediaRow = typeof media.$inferSelect;

async function loadMedia(db: Db, id: string, viewer: SessionUser): Promise<MediaRow | undefined> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row && canViewMedia(row, viewer) ? row : undefined;
}

/** Postgres caps a statement at 65535 bind parameters; long manga run to thousands of parts. */
const BULK_CHUNK = 1000;

function chunked<T>(items: T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Check in, or clear, every part of a work at once — what `completed` and
 * `planned` mean for progress (PRD §3.1). Done server-side so it stays one
 * request and one consistent state; per-part calls would be N round trips.
 *
 * Clearing is destructive and has no undo: `planned` discards existing check-ins.
 */
async function setAllProgress(
  db: Db,
  userId: string,
  row: MediaRow,
  watched: boolean,
): Promise<void> {
  const partKind = PART_KIND_BY_MEDIA[row.kind];
  if (!partKind) return; // movies have no parts

  const partsOfMedia = db
    .select({ id: mediaPart.id })
    .from(mediaPart)
    .where(and(eq(mediaPart.mediaId, row.id), eq(mediaPart.kind, partKind)));

  if (!watched) {
    await db
      .delete(progress)
      .where(and(eq(progress.userId, userId), inArray(progress.partId, partsOfMedia)));
    return;
  }

  // Nothing to complete against until the catalog knows how many parts exist.
  const total = row.partCount;
  if (total === null || total <= 0) return;

  const numbers = Array.from({ length: total }, (_, i) => i + 1);
  for (const chunk of chunked(numbers)) {
    await db
      .insert(mediaPart)
      .values(chunk.map((number) => ({ mediaId: row.id, kind: partKind, number: String(number) })))
      .onConflictDoNothing();
  }

  const parts = await partsOfMedia;
  for (const chunk of chunked(parts)) {
    await db
      .insert(progress)
      .values(chunk.map((part) => ({ userId, partId: part.id })))
      .onConflictDoNothing();
  }
}

export const trackingRoutes: FastifyPluginAsyncZod = async (app) => {
  /** 503/401/404 preamble shared by every tracking route. */
  async function requireUserAndMedia(
    request: FastifyRequest,
    reply: FastifyReply,
    id: string,
  ): Promise<{ db: Db; user: SessionUser; row: MediaRow } | undefined> {
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
    const row = await loadMedia(db, id, user);
    if (!row) {
      await reply.status(404).send({ error: 'media not found' });
      return undefined;
    }
    return { db, user, row };
  }

  app.put(
    '/media/:id/log',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        body: UpdateLogBodySchema,
        response: {
          200: z.object({ status: LogStatusSchema }),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      const { status } = request.body;
      await ctx.db
        .insert(userMedia)
        .values({ userId: ctx.user.id, mediaId: ctx.row.id, status })
        .onConflictDoUpdate({
          target: [userMedia.userId, userMedia.mediaId],
          set: { status, updatedAt: new Date() },
        });
      // `completed` means every part is seen; `planned` means none is yet.
      if (status === 'completed') await setAllProgress(ctx.db, ctx.user.id, ctx.row, true);
      else if (status === 'planned') await setAllProgress(ctx.db, ctx.user.id, ctx.row, false);
      return { status };
    },
  );

  app.delete(
    '/media/:id/log',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        response: {
          200: z.object({ removed: z.boolean() }),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      await ctx.db
        .delete(userMedia)
        .where(and(eq(userMedia.userId, ctx.user.id), eq(userMedia.mediaId, ctx.row.id)));
      return { removed: true };
    },
  );

  app.put(
    '/media/:id/rating',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        body: RateBodySchema,
        response: {
          200: z.object({ score: RatingScoreSchema }),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      const { score } = request.body;
      await ctx.db
        .insert(rating)
        .values({
          userId: ctx.user.id,
          targetType: 'media',
          targetId: ctx.row.id,
          score: String(score),
        })
        .onConflictDoUpdate({
          target: [rating.userId, rating.targetType, rating.targetId],
          set: { score: String(score), updatedAt: new Date() },
        });
      return { score };
    },
  );

  app.put(
    '/media/:id/favorite',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        response: {
          200: z.object({ favorited: z.literal(true) }),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      // Rank = insertion order within the kind shelf (max position + 1).
      await ctx.db.execute(sql`
        INSERT INTO favorite (user_id, media_id, kind, position)
        VALUES (
          ${ctx.user.id}, ${ctx.row.id}, ${ctx.row.kind},
          COALESCE((SELECT max(position) + 1 FROM favorite
                    WHERE user_id = ${ctx.user.id} AND kind = ${ctx.row.kind}), 1)
        )
        ON CONFLICT (user_id, media_id) DO NOTHING
      `);
      return { favorited: true as const };
    },
  );

  app.delete(
    '/media/:id/favorite',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        response: {
          200: z.object({ removed: z.boolean() }),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      await ctx.db
        .delete(favorite)
        .where(and(eq(favorite.userId, ctx.user.id), eq(favorite.mediaId, ctx.row.id)));
      return { removed: true };
    },
  );

  app.delete(
    '/media/:id/rating',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        response: {
          200: z.object({ removed: z.boolean() }),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      await ctx.db
        .delete(rating)
        .where(
          and(
            eq(rating.userId, ctx.user.id),
            eq(rating.targetType, 'media'),
            eq(rating.targetId, ctx.row.id),
          ),
        );
      return { removed: true };
    },
  );

  app.put(
    '/media/:id/progress/:number',
    {
      schema: {
        tags: ['tracking'],
        params: ProgressParamsSchema,
        response: {
          200: z.object({ number: z.number(), watched: z.literal(true) }),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      const { number } = request.params;
      const partKind = PART_KIND_BY_MEDIA[ctx.row.kind];
      if (!partKind) {
        return reply
          .status(400)
          .send({ error: `${ctx.row.kind} entries have no episodes/chapters to check in` });
      }
      const total = ctx.row.partCount;
      if (total !== null && number > total) {
        return reply.status(400).send({ error: `number exceeds the ${total} known parts` });
      }

      // Lazy flat parts: create the numbered row on first check-in (any user).
      await ctx.db
        .insert(mediaPart)
        .values({ mediaId: ctx.row.id, kind: partKind, number: String(number) })
        .onConflictDoNothing();
      const [part] = await ctx.db
        .select({ id: mediaPart.id })
        .from(mediaPart)
        .where(
          and(
            eq(mediaPart.mediaId, ctx.row.id),
            eq(mediaPart.kind, partKind),
            eq(mediaPart.number, String(number)),
          ),
        );

      await ctx.db
        .insert(progress)
        .values({ userId: ctx.user.id, partId: part!.id })
        .onConflictDoNothing();
      // First interaction starts the log; never overrides an existing status.
      await ctx.db
        .insert(userMedia)
        .values({ userId: ctx.user.id, mediaId: ctx.row.id, status: 'in_progress' })
        .onConflictDoNothing();

      return { number, watched: true as const };
    },
  );

  app.delete(
    '/media/:id/progress/:number',
    {
      schema: {
        tags: ['tracking'],
        params: ProgressParamsSchema,
        response: {
          200: z.object({ removed: z.boolean() }),
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const ctx = await requireUserAndMedia(request, reply, request.params.id);
      if (!ctx) return;
      const { number } = request.params;
      const partKind = PART_KIND_BY_MEDIA[ctx.row.kind];
      if (!partKind) {
        return reply
          .status(400)
          .send({ error: `${ctx.row.kind} entries have no episodes/chapters to check in` });
      }
      const [part] = await ctx.db
        .select({ id: mediaPart.id })
        .from(mediaPart)
        .where(
          and(
            eq(mediaPart.mediaId, ctx.row.id),
            eq(mediaPart.kind, partKind),
            eq(mediaPart.number, String(number)),
          ),
        );
      if (part) {
        await ctx.db
          .delete(progress)
          .where(and(eq(progress.userId, ctx.user.id), eq(progress.partId, part.id)));
      }
      return { removed: true };
    },
  );
};
