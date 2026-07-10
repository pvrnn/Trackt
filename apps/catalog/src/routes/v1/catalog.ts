import { asc, count, gt, max } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogChangesQuerySchema,
  CatalogChangesResponseSchema,
  CatalogVersionSchema,
  type CatalogChange,
} from '@trackt/shared';
import { catalogMedia } from '../../db/index.js';

/**
 * Read-only sync surface. A full snapshot is `changes?since=0` paged to completion,
 * so instances use one code path for initial and incremental sync (ADR-0001).
 */
export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/catalog/version',
    {
      schema: {
        tags: ['catalog'],
        response: { 200: CatalogVersionSchema, 503: ApiErrorSchema },
      },
    },
    async (_request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const [row] = await db
        .select({ version: max(catalogMedia.seq), mediaCount: count() })
        .from(catalogMedia);
      return {
        version: row?.version ?? 0,
        mediaCount: row?.mediaCount ?? 0,
        generatedAt: new Date().toISOString(),
      };
    },
  );

  app.get(
    '/catalog/changes',
    {
      schema: {
        tags: ['catalog'],
        querystring: CatalogChangesQuerySchema,
        response: { 200: CatalogChangesResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { since, limit } = request.query;
      const [latest] = await db.select({ version: max(catalogMedia.seq) }).from(catalogMedia);
      const rows = await db
        .select()
        .from(catalogMedia)
        .where(gt(catalogMedia.seq, since))
        .orderBy(asc(catalogMedia.seq))
        .limit(limit);

      const changes: CatalogChange[] = rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        synonyms: row.synonyms,
        year: row.year,
        status: row.status,
        genres: row.genres,
        episodeCount: row.episodeCount,
        seasonCount: row.seasonCount,
        chapterCount: row.chapterCount,
        volumeCount: row.volumeCount,
        externalIds: row.externalIds,
        description: row.description,
        coverUrl: row.coverUrl,
        seq: row.seq,
        deletedAt: row.deletedAt?.toISOString() ?? null,
      }));

      return {
        latestVersion: latest?.version ?? 0,
        nextSince: rows.length === limit ? (changes.at(-1)?.seq ?? null) : null,
        changes,
      };
    },
  );
};
