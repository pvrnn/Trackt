import { and, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { favorite, media, rating, userMedia, type Db } from '@trackt/db';
import {
  ApiErrorSchema,
  MediaDetailSchema,
  type MediaDetail,
  type SearchResult,
  type ViewerState,
} from '@trackt/shared';
import { getSessionUser } from '../../lib/session.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadCommunity(db: Db, mediaId: string): Promise<MediaDetail['community']> {
  const [row] = await db
    .select({
      averageScore: sql<number | null>`avg(${rating.score})::float`,
      ratingCount: count(),
    })
    .from(rating)
    .where(
      and(
        eq(rating.targetType, 'media'),
        eq(rating.targetId, mediaId),
        sql`${rating.score} IS NOT NULL`,
      ),
    );
  return { averageScore: row?.averageScore ?? null, ratingCount: row?.ratingCount ?? 0 };
}

/** Same-kind suggestions sharing at least one genre, strongest overlap first. */
async function loadRelated(
  db: Db,
  row: { id: string; kind: string; genres: string[] },
): Promise<SearchResult[]> {
  if (row.genres.length === 0) return [];
  // Self-join on the source row: its genres never leave Postgres (array params
  // don't survive drizzle's sql interpolation).
  const rows = await db.execute(sql`
    SELECT m.id, m.slug, m.kind, m.title, m.year, m.status, m.cover_url, m.description,
           cardinality(ARRAY(SELECT unnest(m.genres) INTERSECT SELECT unnest(src.genres))) AS overlap
    FROM media m
    JOIN media src ON src.id = ${row.id}
    WHERE m.kind = src.kind
      AND m.id <> src.id
      AND m.genres && src.genres
      AND m.moderation <> 'rejected'
    ORDER BY overlap DESC, m.year DESC NULLS LAST, m.title ASC
    LIMIT 3
  `);
  return [...rows].map((related) => ({
    id: related.id as string,
    slug: related.slug as string,
    kind: related.kind as SearchResult['kind'],
    title: related.title as string,
    year: related.year as number | null,
    status: related.status as SearchResult['status'],
    coverUrl: related.cover_url as string | null,
    description: related.description as string | null,
  }));
}

async function loadViewer(db: Db, userId: string, mediaId: string): Promise<ViewerState> {
  const [log] = await db
    .select({ status: userMedia.status })
    .from(userMedia)
    .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, mediaId)));
  const [own] = await db
    .select({ score: rating.score })
    .from(rating)
    .where(
      and(eq(rating.userId, userId), eq(rating.targetType, 'media'), eq(rating.targetId, mediaId)),
    );
  const watchedRows = await db.execute(sql`
    SELECT mp.number FROM progress p
    JOIN media_part mp ON mp.id = p.part_id
    WHERE p.user_id = ${userId} AND mp.media_id = ${mediaId}
    ORDER BY mp.number ASC
  `);
  const [fav] = await db
    .select({ mediaId: favorite.mediaId })
    .from(favorite)
    .where(and(eq(favorite.userId, userId), eq(favorite.mediaId, mediaId)));
  return {
    status: log?.status ?? null,
    score: own?.score !== undefined && own.score !== null ? Number(own.score) : null,
    watched: [...watchedRows].map((row) => Number(row.number)),
    favorited: fav !== undefined,
  };
}

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/media/:idOrSlug',
    {
      schema: {
        tags: ['catalog'],
        params: z.object({ idOrSlug: z.string().min(1) }),
        response: {
          200: MediaDetailSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { idOrSlug } = request.params;
      const column = UUID_RE.test(idOrSlug) ? media.id : media.slug;
      const [row] = await db.select().from(media).where(eq(column, idOrSlug)).limit(1);
      if (!row || row.moderation === 'rejected') {
        return reply.status(404).send({ error: 'media not found' });
      }

      const user = await getSessionUser(app, request);
      const [community, related, viewer] = await Promise.all([
        loadCommunity(db, row.id),
        loadRelated(db, row),
        user ? loadViewer(db, user.id, row.id) : Promise.resolve(null),
      ]);

      return { ...row, community, related, viewer };
    },
  );
};
