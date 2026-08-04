import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  CatalogPublishMediaResponseSchema,
  CatalogPublishRelationResponseSchema,
  CatalogPublishRelationSchema,
  SlimMediaSchema,
} from '@trackt/shared';
import { catalogMedia, catalogMediaRelation } from '../../db/index.js';
import { requireAdmin } from '../../lib/admin-auth.js';
import { checkCanonicalId } from '../../lib/canonical-id.js';

/**
 * The project-operated publish surface (ADR-0001). Instances only ever read the
 * catalog; everything that puts data *into* it comes through here, behind
 * `CATALOG_ADMIN_TOKEN`.
 *
 * Both routes are idempotent by design. Importers replay batches — after a
 * partial failure, a re-run, or a source that re-emits unchanged records — so a
 * repeat publish is a normal event, not a conflict. The response says which it
 * was via `created`.
 */
export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/admin/media',
    {
      schema: {
        tags: ['admin'],
        body: SlimMediaSchema,
        response: {
          200: CatalogPublishMediaResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const media = request.body;

      // The identity guard runs on CREATE only (ADR-0005). Identity is settled at
      // first publish and frozen thereafter, so an update must be free to correct
      // the title or year of a work that instances already track — recomputing the
      // key on every publish would make every rename a 400 and leave typos
      // permanent. The trade is deliberate: an update trusts the id it is given,
      // and a work that turns out to be *misidentified* (not merely mistitled) is
      // resolved by publishing under the corrected id plus a `catalog_media_alias`
      // row, never by mutating the id in place.
      const [existing] = await db
        .select({ id: catalogMedia.id })
        .from(catalogMedia)
        .where(eq(catalogMedia.id, media.id))
        .limit(1);
      if (!existing) {
        const check = checkCanonicalId(media);
        if (!check.ok) return reply.status(400).send({ error: check.error });
      }

      const row = await db.transaction(async (tx) => {
        // Single-writer publish path. `seq` is assigned by a BEFORE trigger from a
        // sequence, so two concurrent writers can draw 5 and 6 and commit them in
        // the other order — leaving a window where max(seq) has advanced past a row
        // that isn't visible yet. One catalog-wide lock (not per row) because
        // ordering is a property of the cursor, not of any single work. The bulk
        // pull feed this protected is gone (ADR-0002), but `/v1/catalog/version`
        // still reports max(seq) and the schema documents the requirement.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('catalog-publish', 0))`);

        const [inserted] = await tx
          .insert(catalogMedia)
          .values({
            id: media.id,
            kind: media.kind,
            title: media.title,
            synonyms: media.synonyms,
            year: media.year,
            status: media.status,
            genres: media.genres,
            partCount: media.partCount,
            seasonNumber: media.seasonNumber,
            discriminator: media.discriminator,
            externalIds: media.externalIds,
            description: media.description,
            coverUrl: media.coverUrl,
          })
          .onConflictDoUpdate({
            target: catalogMedia.id,
            set: {
              kind: media.kind,
              title: media.title,
              synonyms: media.synonyms,
              year: media.year,
              status: media.status,
              genres: media.genres,
              partCount: media.partCount,
              seasonNumber: media.seasonNumber,
              discriminator: media.discriminator,
              externalIds: media.externalIds,
              description: media.description,
              coverUrl: media.coverUrl,
              // Republishing resurrects a tombstoned work: the id was derived from
              // the work's own identity attributes, so this is provably the same
              // work coming back, and leaving the tombstone would drop the publish.
              deletedAt: null,
              // Set explicitly — Drizzle's $onUpdate hook covers .update(), not
              // the conflict branch of an upsert.
              updatedAt: new Date(),
            },
          })
          .returning({
            id: catalogMedia.id,
            seq: catalogMedia.seq,
            // Postgres leaves xmax at 0 on a freshly inserted tuple and sets it to
            // the locking xid on the ON CONFLICT branch — the standard way to tell
            // an upsert's two paths apart without a prior SELECT.
            created: sql<boolean>`xmax = 0`,
          });
        return inserted;
      });

      if (!row) return reply.status(503).send({ error: 'publish failed' });
      return { id: row.id, seq: row.seq, created: row.created };
    },
  );

  app.post(
    '/admin/relations',
    {
      schema: {
        tags: ['admin'],
        body: CatalogPublishRelationSchema,
        response: {
          200: CatalogPublishRelationResponseSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { fromId, toId, type } = request.body;
      // The table's no-self CHECK would reject this too, but that surfaces as an
      // opaque 500; and the read route's UNION ALL depends on the constraint
      // holding, so it is worth a clear error rather than a raised exception.
      if (fromId === toId) {
        return reply.status(400).send({ error: 'a work cannot relate to itself' });
      }

      // Edges carry no visibility of their own, so a tombstoned endpoint must not
      // gain new ones — the read route already drops them via its join, which
      // would make the write a silent no-op from a publisher's point of view.
      const endpoints = await db
        .select({ id: catalogMedia.id })
        .from(catalogMedia)
        .where(and(inArray(catalogMedia.id, [fromId, toId]), isNull(catalogMedia.deletedAt)));
      const present = new Set(endpoints.map((endpoint) => endpoint.id));
      const missing = [fromId, toId].filter((id) => !present.has(id));
      if (missing.length > 0) {
        return reply.status(404).send({ error: `unknown or deleted media: ${missing.join(', ')}` });
      }

      // No publish lock here: catalog_media_relation carries no seq, so there is
      // no ordering to protect (see the table's schema comment).
      const inserted = await db
        .insert(catalogMediaRelation)
        .values({ fromId, toId, type })
        .onConflictDoNothing()
        .returning({ fromId: catalogMediaRelation.fromId });

      return { created: inserted.length > 0 };
    },
  );
};
