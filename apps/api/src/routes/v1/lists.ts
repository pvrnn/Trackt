import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { list, listItem, media, users, type Db } from '@trackt/db';
import {
  AddListItemBodySchema,
  ApiErrorSchema,
  CreateListBodySchema,
  ListDetailSchema,
  ListSummarySchema,
  ListsQuerySchema,
  MoveListItemBodySchema,
  UpdateListBodySchema,
  type ListCover,
  type ListDetail,
  type ListEntry,
  type ListSummary,
} from '@trackt/shared';
import { areFriends } from '../../lib/friends.js';
import { canEditList, canViewList } from '../../lib/list-visibility.js';
import { getSessionUser, type SessionUser } from '../../lib/session.js';
import { canViewMedia, visibleMediaSql } from '../../lib/visibility.js';

/**
 * Custom lists (PRD §3.4). Two visibility rules compose on every read: the list
 * itself (lib/list-visibility.ts) and each entry's media (lib/visibility.ts) —
 * without the second, a public list would be a way to enumerate soft-deleted
 * titles and legacy non-`verified` rows.
 *
 * Ownership failures answer 404 rather than 403, so a private list is
 * indistinguishable from one that doesn't exist.
 */

/** How many cover panels a list card fans out. */
const COVER_COUNT = 4;

/** The transaction handle drizzle hands `db.transaction`. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Executor = Db | Tx;

/** Serialize per list so concurrent adds can't be handed the same position. */
function lockList(tx: Executor, listId: string) {
  return tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${listId}::text, 0))`);
}

/** Item writes must age the parent row — the card's "UPDATED …" reads from it. */
function touchList(tx: Executor, listId: string) {
  return tx.update(list).set({ updatedAt: new Date() }).where(eq(list.id, listId));
}

type ListRow = typeof list.$inferSelect;

function toSummary(
  row: ListRow,
  covers: ListCover[],
  itemCount: number,
  containsMedia?: boolean,
): ListSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    isRanked: row.isRanked,
    isCollaborative: row.isCollaborative,
    visibility: row.visibility,
    itemCount,
    updatedAt: row.updatedAt.toISOString(),
    covers,
    ...(containsMedia === undefined ? {} : { containsMedia }),
  };
}

/**
 * Cover seeds and visible item counts for many lists in one pass. A window
 * function ranks each list's items so the first four and the total come back
 * together; a list whose every item is hidden from the viewer returns no rows,
 * which is the count of 0 we want.
 */
async function loadCoversAndCounts(
  db: Db,
  listIds: string[],
): Promise<Map<string, { covers: ListCover[]; itemCount: number }>> {
  const result = new Map<string, { covers: ListCover[]; itemCount: number }>();
  if (listIds.length === 0) return result;

  const rows = await db.execute(sql`
    SELECT list_id, kind, title, cover_url, total
    FROM (
      SELECT li.list_id, m.kind, m.title, m.cover_url,
             row_number() OVER (PARTITION BY li.list_id
                                ORDER BY li.position ASC, li.created_at ASC) AS rn,
             count(*) OVER (PARTITION BY li.list_id) AS total
      FROM list_item li
      JOIN media m ON m.id = li.media_id
      WHERE li.list_id IN (${sql.join(
        listIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})
        AND ${visibleMediaSql(sql.raw('m.'))}
    ) ranked
    WHERE rn <= ${COVER_COUNT}
    ORDER BY list_id, rn
  `);

  for (const row of rows) {
    const listId = row.list_id as string;
    const entry = result.get(listId) ?? { covers: [], itemCount: Number(row.total) };
    entry.covers.push({
      kind: row.kind as ListCover['kind'],
      title: row.title as string,
      coverUrl: row.cover_url as string | null,
    });
    result.set(listId, entry);
  }
  return result;
}

/** The full detail payload; shared by GET and the reorder response. */
async function loadListDetail(
  db: Db,
  row: ListRow,
  viewer: SessionUser | null,
): Promise<ListDetail> {
  const [owner] = await db
    .select({ name: users.name, username: users.displayUsername })
    .from(users)
    .where(eq(users.id, row.ownerId))
    .limit(1);

  // The owner's own score is what makes a ranked list legible to a visitor, so
  // the rating join is keyed on the owner rather than the viewer.
  const entryRows = await db.execute(sql`
    SELECT m.id, m.slug, m.kind, m.title, m.year, m.status, m.season_number,
           m.cover_url, m.description, li.position, r.score AS owner_score
    FROM list_item li
    JOIN media m ON m.id = li.media_id
    LEFT JOIN rating r
      ON r.user_id = ${row.ownerId} AND r.target_type = 'media' AND r.target_id = m.id
    WHERE li.list_id = ${row.id}
      AND ${visibleMediaSql(sql.raw('m.'))}
    ORDER BY li.position ASC, li.created_at ASC
  `);

  const entries: ListEntry[] = [...entryRows].map((entry) => ({
    id: entry.id as string,
    slug: entry.slug as string,
    kind: entry.kind as ListEntry['kind'],
    title: entry.title as string,
    year: entry.year as number | null,
    status: entry.status as ListEntry['status'],
    seasonNumber: entry.season_number as number | null,
    coverUrl: entry.cover_url as string | null,
    description: entry.description as string | null,
    position: Number(entry.position),
    ownerScore: entry.owner_score === null ? null : Number(entry.owner_score),
  }));

  return {
    ...toSummary(
      row,
      entries.slice(0, COVER_COUNT).map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        coverUrl: entry.coverUrl,
      })),
      entries.length,
    ),
    owner: { name: owner?.name ?? 'Unknown', username: owner?.username ?? '' },
    isOwner: canEditList(row, viewer),
    entries,
  };
}

/** Re-read a list plus its card extras — the shape every mutation answers with. */
async function summaryAfterWrite(
  db: Db,
  listId: string,
  viewer: SessionUser | null,
  containsMedia?: boolean,
): Promise<ListSummary> {
  const [row] = await db.select().from(list).where(eq(list.id, listId)).limit(1);
  const extras = await loadCoversAndCounts(db, [listId]);
  const extra = extras.get(listId);
  return toSummary(row!, extra?.covers ?? [], extra?.itemCount ?? 0, containsMedia);
}

async function loadList(db: Db, listId: string): Promise<ListRow | undefined> {
  const [row] = await db.select().from(list).where(eq(list.id, listId)).limit(1);
  return row;
}

export const listRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/lists',
    {
      schema: {
        tags: ['lists'],
        querystring: ListsQuerySchema,
        response: { 200: z.array(ListSummarySchema), 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const rows = await db
        .select()
        .from(list)
        .where(eq(list.ownerId, user.id))
        .orderBy(desc(list.updatedAt));
      const extras = await loadCoversAndCounts(
        db,
        rows.map((row) => row.id),
      );

      const { containsMedia } = request.query;
      let holding = new Set<string>();
      if (containsMedia !== undefined && rows.length > 0) {
        const held = await db
          .select({ listId: listItem.listId })
          .from(listItem)
          .where(eq(listItem.mediaId, containsMedia));
        holding = new Set(held.map((row) => row.listId));
      }

      return rows.map((row) => {
        const extra = extras.get(row.id);
        return toSummary(
          row,
          extra?.covers ?? [],
          extra?.itemCount ?? 0,
          containsMedia === undefined ? undefined : holding.has(row.id),
        );
      });
    },
  );

  app.post(
    '/lists',
    {
      schema: {
        tags: ['lists'],
        body: CreateListBodySchema,
        response: { 201: ListSummarySchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const body = request.body;
      const [row] = await db
        .insert(list)
        .values({
          ownerId: user.id,
          title: body.title,
          description: body.description ?? null,
          isRanked: body.isRanked,
          visibility: body.visibility,
        })
        .returning();
      return reply.status(201).send(toSummary(row!, [], 0));
    },
  );

  app.get(
    '/lists/:id',
    {
      schema: {
        tags: ['lists'],
        params: z.object({ id: z.uuid() }),
        response: { 200: ListDetailSchema, 404: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const viewer = await getSessionUser(app, request);
      const row = await loadList(db, request.params.id);
      const isFriend =
        row !== undefined &&
        row.visibility === 'followers' &&
        viewer !== null &&
        row.ownerId !== viewer.id
          ? await areFriends(db, viewer.id, row.ownerId)
          : false;
      if (!row || !canViewList(row, viewer, isFriend)) {
        return reply.status(404).send({ error: 'list not found' });
      }
      return loadListDetail(db, row, viewer);
    },
  );

  app.patch(
    '/lists/:id',
    {
      schema: {
        tags: ['lists'],
        params: z.object({ id: z.uuid() }),
        body: UpdateListBodySchema,
        response: {
          200: ListSummarySchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      const existing = await loadList(db, request.params.id);
      if (!existing || !canEditList(existing, user)) {
        return reply.status(404).send({ error: 'list not found' });
      }

      const body = request.body;
      await db
        .update(list)
        .set({
          ...(body.title === undefined ? {} : { title: body.title }),
          ...(body.description === undefined ? {} : { description: body.description ?? null }),
          ...(body.isRanked === undefined ? {} : { isRanked: body.isRanked }),
          ...(body.visibility === undefined ? {} : { visibility: body.visibility }),
          updatedAt: new Date(),
        })
        .where(eq(list.id, existing.id));
      return summaryAfterWrite(db, existing.id, user);
    },
  );

  app.delete(
    '/lists/:id',
    {
      schema: {
        tags: ['lists'],
        params: z.object({ id: z.uuid() }),
        response: {
          204: z.null(),
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      const existing = await loadList(db, request.params.id);
      if (!existing || !canEditList(existing, user)) {
        return reply.status(404).send({ error: 'list not found' });
      }

      // `list_item` cascades from `list` (schema/lists.ts).
      await db.delete(list).where(eq(list.id, existing.id));
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/lists/:id/items',
    {
      schema: {
        tags: ['lists'],
        params: z.object({ id: z.uuid() }),
        body: AddListItemBodySchema,
        response: {
          200: ListSummarySchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      const existing = await loadList(db, request.params.id);
      if (!existing || !canEditList(existing, user)) {
        return reply.status(404).send({ error: 'list not found' });
      }

      // 404 for media the user can't see, so a list can't probe hidden entries.
      const [target] = await db
        .select()
        .from(media)
        .where(eq(media.id, request.body.mediaId))
        .limit(1);
      if (!target || !canViewMedia(target)) {
        return reply.status(404).send({ error: 'media not found' });
      }

      await db.transaction(async (tx) => {
        await lockList(tx, existing.id);
        const [last] = await tx
          .select({ position: sql<number>`COALESCE(max(${listItem.position}), 0)` })
          .from(listItem)
          .where(eq(listItem.listId, existing.id));
        // Re-adding a title is a no-op by construction — the PK is
        // (list_id, media_id) — so it never duplicates or reorders.
        await tx
          .insert(listItem)
          .values({
            listId: existing.id,
            mediaId: request.body.mediaId,
            position: Number(last?.position ?? 0) + 1,
            addedBy: user.id,
          })
          .onConflictDoNothing();
        await touchList(tx, existing.id);
      });

      return summaryAfterWrite(db, existing.id, user, true);
    },
  );

  app.delete(
    '/lists/:id/items/:mediaId',
    {
      schema: {
        tags: ['lists'],
        params: z.object({ id: z.uuid(), mediaId: z.uuid() }),
        response: {
          200: ListSummarySchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      const existing = await loadList(db, request.params.id);
      if (!existing || !canEditList(existing, user)) {
        return reply.status(404).send({ error: 'list not found' });
      }

      await db.transaction(async (tx) => {
        await lockList(tx, existing.id);
        // Removal leaves a gap in `position`; ordering is unaffected, so there
        // is nothing to renumber.
        await tx
          .delete(listItem)
          .where(
            and(eq(listItem.listId, existing.id), eq(listItem.mediaId, request.params.mediaId)),
          );
        await touchList(tx, existing.id);
      });

      return summaryAfterWrite(db, existing.id, user, false);
    },
  );

  app.patch(
    '/lists/:id/items/:mediaId',
    {
      schema: {
        tags: ['lists'],
        params: z.object({ id: z.uuid(), mediaId: z.uuid() }),
        body: MoveListItemBodySchema,
        response: {
          200: ListDetailSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      const existing = await loadList(db, request.params.id);
      if (!existing || !canEditList(existing, user)) {
        return reply.status(404).send({ error: 'list not found' });
      }

      const present = await db.transaction(async (tx) => {
        await lockList(tx, existing.id);
        const items = await tx
          .select({ mediaId: listItem.mediaId, position: listItem.position })
          .from(listItem)
          .where(eq(listItem.listId, existing.id))
          .orderBy(listItem.position, listItem.createdAt);

        const index = items.findIndex((item) => item.mediaId === request.params.mediaId);
        if (index === -1) return false;
        const target = request.body.direction === 'up' ? index - 1 : index + 1;
        // At either end there is nothing to swap with — a no-op rather than an
        // error, so the client can fire the control without bounds-checking.
        if (target < 0 || target >= items.length) return true;

        const a = items[index]!;
        const b = items[target]!;
        // Distinct positions keep the swap meaningful even if an earlier write
        // left two rows sharing one.
        const [posA, posB] =
          a.position === b.position
            ? [Math.min(index, target) + 1, Math.max(index, target) + 1]
            : [b.position, a.position];
        await tx
          .update(listItem)
          .set({ position: posA })
          .where(and(eq(listItem.listId, existing.id), eq(listItem.mediaId, a.mediaId)));
        await tx
          .update(listItem)
          .set({ position: posB })
          .where(and(eq(listItem.listId, existing.id), eq(listItem.mediaId, b.mediaId)));
        await touchList(tx, existing.id);
        return true;
      });

      if (!present) return reply.status(404).send({ error: 'media not in list' });
      // Answer with the whole list so the client re-renders from server order
      // rather than inferring what the swap did.
      const row = await loadList(db, existing.id);
      return loadListDetail(db, row!, user);
    },
  );
};
