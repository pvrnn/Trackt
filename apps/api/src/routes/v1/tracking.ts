import { and, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  canViewMedia,
  checkInPart,
  favorite,
  media,
  mediaPart,
  progress,
  rating,
  setLogStatus,
  setProgressUpTo,
  startLog,
  userMedia,
  type Db,
} from '@trackt/db';
import {
  ApiErrorSchema,
  LogDatesBodySchema,
  LogDatesSchema,
  LogStatusSchema,
  PART_KIND_BY_MEDIA,
  PartNumberParamSchema,
  RateBodySchema,
  RatingScoreSchema,
  SetProgressBodySchema,
  UpdateLogBodySchema,
} from '@trackt/shared';
import { getSessionUser, type SessionUser } from '../../lib/session.js';

/**
 * Tracking core (PRD §3.1–3.2): the viewer's log status, rating, and per-part
 * check-ins for a work. Progress parts are generated lazily from the slim
 * catalog's totals — flat numbered episodes/chapters until the catalog carries
 * per-part structure (titles, seasons).
 */

const MediaIdParamsSchema = z.object({ id: z.uuid() });
const ProgressParamsSchema = z.object({ id: z.uuid(), number: PartNumberParamSchema });

type MediaRow = typeof media.$inferSelect;

async function loadMedia(db: Db, id: string): Promise<MediaRow | undefined> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row && canViewMedia(row) ? row : undefined;
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
    const row = await loadMedia(db, id);
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
      await setLogStatus(ctx.db, ctx.user.id, ctx.row, status);
      return { status };
    },
  );

  /**
   * Manual date correction (ADR-0007). A separate endpoint rather than optional
   * dates on `PUT …/log`, for two reasons: `PUT` runs `setAllProgress` on
   * `completed`/`planned`, which for a 900-chapter manga is thousands of rows
   * across chunked inserts and must not be the price of fixing a typo; and
   * re-sending status as a side effect of a date edit is exactly the kind of
   * implicit write that makes a log row's history unreadable later.
   *
   * It deliberately does not touch `status`: filling in a finish date on an
   * in-progress show is recording history, not completing it. Wiring the two
   * together is a UI affordance, not a server rule.
   */
  app.patch(
    '/media/:id/log',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        body: LogDatesBodySchema,
        response: {
          200: LogDatesSchema,
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
      const where = and(eq(userMedia.userId, ctx.user.id), eq(userMedia.mediaId, ctx.row.id));
      const [existing] = await ctx.db
        .select({ startedAt: userMedia.startedAt, finishedAt: userMedia.finishedAt })
        .from(userMedia)
        .where(where);
      if (!existing) return reply.status(404).send({ error: 'no log for this media' });

      // Validated against the row *as it will be*, not as the body describes it:
      // a patch that moves only `startedAt` still has to hold against the stored
      // `finishedAt`.
      const merged = {
        startedAt:
          request.body.startedAt !== undefined ? request.body.startedAt : existing.startedAt,
        finishedAt:
          request.body.finishedAt !== undefined ? request.body.finishedAt : existing.finishedAt,
      };
      // Today in UTC, matching the UTC convention the rest of the log uses.
      const today = new Date().toISOString().slice(0, 10);
      if (
        (merged.startedAt !== null && merged.startedAt > today) ||
        (merged.finishedAt !== null && merged.finishedAt > today)
      ) {
        return reply.status(400).send({ error: 'dates cannot be in the future' });
      }
      if (
        merged.startedAt !== null &&
        merged.finishedAt !== null &&
        merged.finishedAt < merged.startedAt
      ) {
        return reply.status(400).send({ error: 'the finish date is before the start date' });
      }

      await ctx.db
        .update(userMedia)
        .set({ ...merged, updatedAt: new Date() })
        .where(where);
      return merged;
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

  /**
   * "I am at chapter 120" — the bulk position write (`SetProgressBodySchema`).
   *
   * The client for a work with hundreds of parts is a slider and a typed-in
   * number, not a grid of tiles, and both mean a *position*: everything up to
   * it is seen, everything past it is not. Ticking that off part by part would
   * be `upTo` requests, which is why this is a route rather than a loop in the
   * UI. Destructive of sparse check-ins by design — see `setProgressUpTo`.
   */
  app.put(
    '/media/:id/progress',
    {
      schema: {
        tags: ['tracking'],
        params: MediaIdParamsSchema,
        body: SetProgressBodySchema,
        response: {
          200: z.object({ upTo: z.number() }),
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
      const { upTo } = request.body;
      const partKind = PART_KIND_BY_MEDIA[ctx.row.kind];
      if (!partKind) {
        return reply
          .status(400)
          .send({ error: `${ctx.row.kind} entries have no episodes/chapters to check in` });
      }
      const total = ctx.row.partCount;
      if (total !== null && upTo > total) {
        return reply.status(400).send({ error: `number exceeds the ${total} known parts` });
      }

      await setProgressUpTo(ctx.db, ctx.user.id, ctx.row, upTo);
      // A position of zero is "none of this yet" and starts nothing; anything
      // above it is a check-in like any other.
      if (upTo > 0) await startLog(ctx.db, ctx.user.id, ctx.row.id);
      return { upTo };
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

      await checkInPart(ctx.db, ctx.user.id, ctx.row, number);
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
