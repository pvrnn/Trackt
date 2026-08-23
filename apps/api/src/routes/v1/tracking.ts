import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { favorite, media, mediaPart, progress, rating, userMedia, type Db } from '@trackt/db';
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
  type LogStatus,
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

async function loadMedia(db: Db, id: string): Promise<MediaRow | undefined> {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  return row && canViewMedia(row) ? row : undefined;
}

/** Postgres caps a statement at 65535 bind parameters; long manga run to thousands of parts. */
const BULK_CHUNK = 1000;

function chunked<T>(items: T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Set the viewer's position in a work: every part up to `upTo` is checked in,
 * and everything past it is cleared. The bulk primitive behind both the
 * `completed`/`planned` sweeps (PRD §3.1) and `PUT …/progress` — done
 * server-side so it stays one request and one consistent state, where per-part
 * calls would be N round trips (a 900-chapter manga is not a UI's problem).
 *
 * Clearing above the mark is the point rather than a side effect: "I am at
 * chapter 120" is a statement about the whole work, so a stray check-in at 400
 * cannot survive it. That makes the call destructive of sparse progress, and
 * the only control that issues it is one whose meaning is a *position*.
 */
async function setProgressUpTo(db: Db, userId: string, row: MediaRow, upTo: number): Promise<void> {
  const partKind = PART_KIND_BY_MEDIA[row.kind];
  if (!partKind) return; // movies have no parts

  const partsOfMedia = db
    .select({ id: mediaPart.id })
    .from(mediaPart)
    .where(and(eq(mediaPart.mediaId, row.id), eq(mediaPart.kind, partKind)));

  if (upTo <= 0) {
    await db
      .delete(progress)
      .where(and(eq(progress.userId, userId), inArray(progress.partId, partsOfMedia)));
    return;
  }

  const numbers = Array.from({ length: upTo }, (_, i) => i + 1);
  for (const chunk of chunked(numbers)) {
    await db
      .insert(mediaPart)
      .values(chunk.map((number) => ({ mediaId: row.id, kind: partKind, number: String(number) })))
      .onConflictDoNothing();
  }

  const parts = await db
    .select({ id: mediaPart.id, number: mediaPart.number })
    .from(mediaPart)
    .where(and(eq(mediaPart.mediaId, row.id), eq(mediaPart.kind, partKind)));
  const within = parts.filter((part) => Number(part.number) <= upTo);
  const beyond = parts.filter((part) => Number(part.number) > upTo);

  for (const chunk of chunked(within)) {
    await db
      .insert(progress)
      .values(chunk.map((part) => ({ userId, partId: part.id })))
      .onConflictDoNothing();
  }
  for (const chunk of chunked(beyond)) {
    await db.delete(progress).where(
      and(
        eq(progress.userId, userId),
        inArray(
          progress.partId,
          chunk.map((part) => part.id),
        ),
      ),
    );
  }
}

/**
 * Check in, or clear, every part of a work at once — what `completed` and
 * `planned` mean for progress (PRD §3.1).
 *
 * Clearing is destructive and has no undo: `planned` discards existing check-ins.
 */
async function setAllProgress(
  db: Db,
  userId: string,
  row: MediaRow,
  watched: boolean,
): Promise<void> {
  if (!watched) return setProgressUpTo(db, userId, row, 0);
  // Nothing to complete against until the catalog knows how many parts exist.
  const total = row.partCount;
  if (total === null || total <= 0) return;
  await setProgressUpTo(db, userId, row, total);
}

/**
 * First interaction starts the log; never overrides an existing status.
 *
 * Status is untouched on purpose: checking in an episode of a `paused` show
 * must not silently re-open it (the original `DO NOTHING` contract). Only a
 * missing start date is filled in — `setWhere` keeps the statement a no-op for
 * the overwhelmingly common case, so a check-in stays one cheap upsert.
 */
async function startLog(db: Db, userId: string, mediaId: string): Promise<void> {
  await db
    .insert(userMedia)
    .values({ userId, mediaId, status: 'in_progress', startedAt: sql`CURRENT_DATE` })
    .onConflictDoUpdate({
      target: [userMedia.userId, userMedia.mediaId],
      set: { startedAt: sql`CURRENT_DATE` },
      setWhere: sql`${userMedia.startedAt} IS NULL`,
    });
}

/**
 * What a status change does to the log's dates (ADR-0007). `CURRENT_DATE` is
 * evaluated *in the statement*, never as a JS `new Date()`, so the API and the
 * database can never disagree about which day it is.
 *
 * Three rules the table encodes deliberately:
 *
 * - **COALESCE, never overwrite.** Marking a series completed, then paused,
 *   then completed again must not replace the real start date with today's.
 * - **`planned` clears both**, because it already means "none of this has
 *   happened" — the route sweeps every check-in for it, and the dates leaving
 *   with the check-ins is the consistent behaviour.
 * - **`in_progress` clears `finished_at`.** Re-opening a completed log is
 *   either a correction or a rewatch; under both readings "finished on" is no
 *   longer true. The lost date is recoverable through `PATCH …/log`. This is
 *   the rule that changes when dated rewatch runs land.
 * - **`dropped` does not stamp `finished_at`.** Dropped works still appear in
 *   the history, filed under their start date, but `finished_at` keeps meaning
 *   *completed on* — what the column is called and what the UI labels it.
 */
function insertDates(status: LogStatus): { startedAt: SQL | null; finishedAt: SQL | null } {
  if (status === 'planned') return { startedAt: null, finishedAt: null };
  return {
    startedAt: sql`CURRENT_DATE`,
    finishedAt: status === 'completed' ? sql`CURRENT_DATE` : null,
  };
}

/** Same rules against a row that already exists — hence the COALESCEs. */
function updateDates(status: LogStatus): { startedAt: SQL | null; finishedAt: SQL | null } {
  if (status === 'planned') return { startedAt: null, finishedAt: null };
  const startedAt = sql`COALESCE(${userMedia.startedAt}, CURRENT_DATE)`;
  if (status === 'completed') {
    return { startedAt, finishedAt: sql`COALESCE(${userMedia.finishedAt}, CURRENT_DATE)` };
  }
  if (status === 'in_progress') return { startedAt, finishedAt: null };
  // paused / dropped: neither finishes the work, so `finished_at` is left as-is.
  return { startedAt, finishedAt: sql`${userMedia.finishedAt}` };
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
      await ctx.db
        .insert(userMedia)
        .values({ userId: ctx.user.id, mediaId: ctx.row.id, status, ...insertDates(status) })
        .onConflictDoUpdate({
          target: [userMedia.userId, userMedia.mediaId],
          set: { status, ...updateDates(status), updatedAt: new Date() },
        });
      // `completed` means every part is seen; `planned` means none is yet.
      if (status === 'completed') await setAllProgress(ctx.db, ctx.user.id, ctx.row, true);
      else if (status === 'planned') await setAllProgress(ctx.db, ctx.user.id, ctx.row, false);
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
      await startLog(ctx.db, ctx.user.id, ctx.row.id);

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
