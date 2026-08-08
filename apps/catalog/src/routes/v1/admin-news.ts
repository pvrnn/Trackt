import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  NewsAdminArticleSchema,
  NewsAdminListQuerySchema,
  NewsAdminListResponseSchema,
  NewsArticleUpdateSchema,
  NewsDraftSchema,
  NewsItemsQuerySchema,
  NewsItemsResponseSchema,
  NewsSourceInputSchema,
  NewsSourceItemsInputSchema,
  NewsSourceItemsResponseSchema,
  NewsSourceSchema,
  NewsSourceUpdateSchema,
  NewsSourcesResponseSchema,
  mediaSlug,
  type ExternalIds,
  type NewsAdminArticle,
  type NewsMediaRef,
  type NewsSource,
  type NewsSourceItem,
  type NewsSourceRef,
} from '@trackt/shared';
import {
  catalogMedia,
  newsArticle,
  newsArticleMedia,
  newsArticleSource,
  newsSource,
  newsSourceItem,
} from '../../db/index.js';
import type { CatalogDb } from '../../db/index.js';
import { requireAdmin } from '../../lib/admin-auth.js';

/** The handle drizzle hands a `transaction` callback — a `CatalogDb` minus `$client`. */
type CatalogTx = Parameters<Parameters<CatalogDb['transaction']>[0]>[0];

/**
 * The editorial surface (ADR-0005), behind `CATALOG_ADMIN_TOKEN` via the same
 * `requireAdmin` preHandler as the media/relation publish path.
 *
 * The load-bearing rule here is that **nothing publishes itself**. Every write
 * lands `draft`; only an explicit `PATCH {status: 'published'}` puts an article
 * on the public feed and stamps `published_at`. That gate is what makes it safe
 * to point a model at this API in Phase 4.
 *
 * The source registry and the item ledger below have no consumer yet — they are
 * the server half of the newsroom agent, and are inert until it lands.
 */

function iso(value: unknown): string {
  return (value as Date).toISOString();
}

function isoOrNull(value: unknown): string | null {
  return value ? (value as Date).toISOString() : null;
}

function toSource(row: typeof newsSource.$inferSelect): NewsSource {
  return {
    id: row.id,
    name: row.name,
    feedUrl: row.feedUrl,
    homepageUrl: row.homepageUrl,
    kinds: row.kinds,
    enabled: row.enabled,
    etag: row.etag,
    lastModified: row.lastModified,
    lastPolledAt: isoOrNull(row.lastPolledAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function toItem(row: typeof newsSourceItem.$inferSelect): NewsSourceItem {
  return {
    sourceId: row.sourceId,
    guid: row.guid,
    url: row.url,
    title: row.title,
    publishedAt: isoOrNull(row.publishedAt),
    status: row.status,
    articleId: row.articleId,
    seenAt: iso(row.seenAt),
  };
}

/**
 * A slug nobody else holds. `mediaSlug` is deterministic, so two stories about
 * the same show on the same day would collide; the numeric suffix keeps the
 * permalink unique without making it opaque.
 *
 * Runs inside the caller's transaction and re-checks each candidate, so a
 * concurrent insert loses to the unique constraint rather than silently
 * overwriting — the route surfaces that as a 409.
 */
async function uniqueSlug(tx: CatalogTx, title: string): Promise<string> {
  const base = mediaSlug(title);
  const existing = await tx
    .select({ slug: newsArticle.slug })
    .from(newsArticle)
    .where(or(eq(newsArticle.slug, base), sql`${newsArticle.slug} LIKE ${`${base}-%`}`));
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Full admin view of one article: the public shape plus editorial state. */
async function loadAdminArticle(db: CatalogDb, id: string): Promise<NewsAdminArticle | null> {
  const [row] = await db.select().from(newsArticle).where(eq(newsArticle.id, id));
  if (!row) return null;

  const [sourceRows, mediaRows] = await Promise.all([
    db
      .select()
      .from(newsArticleSource)
      .where(eq(newsArticleSource.articleId, id))
      .orderBy(desc(newsArticleSource.publishedAt), asc(newsArticleSource.url)),
    db
      .select({ media: catalogMedia, role: newsArticleMedia.role })
      .from(newsArticleMedia)
      .innerJoin(catalogMedia, eq(catalogMedia.id, newsArticleMedia.mediaId))
      .where(eq(newsArticleMedia.articleId, id))
      .orderBy(asc(newsArticleMedia.role), asc(catalogMedia.title)),
  ]);

  const sources: NewsSourceRef[] = sourceRows.map((source) => ({
    url: source.url,
    outlet: source.outlet,
    title: source.title,
    publishedAt: isoOrNull(source.publishedAt),
  }));

  const media: NewsMediaRef[] = mediaRows.map(({ media: work, role }) => ({
    id: work.id,
    kind: work.kind,
    title: work.title,
    synonyms: work.synonyms,
    year: work.year,
    status: work.status,
    genres: work.genres,
    partCount: work.partCount,
    seasonNumber: work.seasonNumber,
    externalIds: work.externalIds as ExternalIds,
    description: work.description,
    coverUrl: work.coverUrl,
    role,
  }));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    dek: row.dek,
    body: row.body,
    topic: row.topic,
    kinds: row.kinds,
    coverUrl: row.coverUrl,
    status: row.status,
    publishedAt: isoOrNull(row.publishedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    sources,
    media,
  };
}

/**
 * Editorial guardrail, enforced here rather than only in a prompt (ADR-0005):
 * an article whose headline reproduces a source's verbatim is a copy, not the
 * original synthesis the licence posture depends on.
 */
function copiesASourceHeadline(title: string, sources: { title: string }[]): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  const ours = normalize(title);
  return sources.some((source) => normalize(source.title) === ours);
}

/** Every linked work must exist and not be tombstoned, or the link is a dangling chip. */
async function findMissingMedia(db: CatalogDb, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: catalogMedia.id })
    .from(catalogMedia)
    .where(and(inArray(catalogMedia.id, ids), isNull(catalogMedia.deletedAt)));
  const present = new Set(rows.map((row) => row.id));
  return ids.filter((id) => !present.has(id));
}

export const adminNewsRoutes: FastifyPluginAsyncZod = async (app) => {
  /* ---------------------------- sources ---------------------------- */

  app.get(
    '/admin/news/sources',
    {
      schema: {
        tags: ['admin'],
        response: { 200: NewsSourcesResponseSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
      preHandler: requireAdmin,
    },
    async (_request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const rows = await db.select().from(newsSource).orderBy(asc(newsSource.name));
      return { sources: rows.map(toSource) };
    },
  );

  app.post(
    '/admin/news/sources',
    {
      schema: {
        tags: ['admin'],
        body: NewsSourceInputSchema,
        response: {
          200: NewsSourceSchema,
          401: ApiErrorSchema,
          409: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      // Idempotent on the feed URL: re-registering a known feed returns it
      // rather than failing, so an operator's setup script can be re-run.
      const [row] = await db
        .insert(newsSource)
        .values(request.body)
        .onConflictDoUpdate({ target: newsSource.feedUrl, set: { ...request.body } })
        .returning();
      if (!row) return reply.status(503).send({ error: 'source registration failed' });
      return toSource(row);
    },
  );

  app.patch(
    '/admin/news/sources/:id',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.uuid() }),
        body: NewsSourceUpdateSchema,
        response: {
          200: NewsSourceSchema,
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

      const patch = request.body;
      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'no fields to update' });
      }
      const [row] = await db
        .update(newsSource)
        .set(patch)
        .where(eq(newsSource.id, request.params.id))
        .returning();
      if (!row) return reply.status(404).send({ error: 'source not found' });
      return toSource(row);
    },
  );

  /* ----------------------------- items ----------------------------- */

  app.get(
    '/admin/news/items',
    {
      schema: {
        tags: ['admin'],
        querystring: NewsItemsQuerySchema,
        response: { 200: NewsItemsResponseSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const { status, limit } = request.query;
      const rows = await db
        .select()
        .from(newsSourceItem)
        .where(eq(newsSourceItem.status, status))
        .orderBy(desc(newsSourceItem.seenAt))
        .limit(limit);
      return { items: rows.map(toItem) };
    },
  );

  app.post(
    '/admin/news/items',
    {
      schema: {
        tags: ['admin'],
        body: NewsSourceItemsInputSchema,
        response: {
          200: NewsSourceItemsResponseSchema,
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

      const { items } = request.body;
      const sourceIds = [...new Set(items.map((item) => item.sourceId))];
      const known = await db
        .select({ id: newsSource.id })
        .from(newsSource)
        .where(inArray(newsSource.id, sourceIds));
      const present = new Set(known.map((row) => row.id));
      const missing = sourceIds.filter((id) => !present.has(id));
      if (missing.length > 0) {
        return reply.status(404).send({ error: `unknown source: ${missing.join(', ')}` });
      }

      // Dedup is the primary key's job, not the caller's: only rows that were
      // genuinely new come back, which is exactly the agent's work queue.
      const created = await db
        .insert(newsSourceItem)
        .values(
          items.map((item) => ({
            ...item,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
          })),
        )
        .onConflictDoNothing()
        .returning();
      return { created: created.map(toItem) };
    },
  );

  /* ---------------------------- articles ---------------------------- */

  app.get(
    '/admin/news',
    {
      schema: {
        tags: ['admin'],
        querystring: NewsAdminListQuerySchema,
        response: { 200: NewsAdminListResponseSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { status, limit } = request.query;
      const rows = await db
        .select({ id: newsArticle.id })
        .from(newsArticle)
        .where(eq(newsArticle.status, status))
        .orderBy(desc(newsArticle.createdAt))
        .limit(limit);

      const articles = await Promise.all(rows.map((row) => loadAdminArticle(db, row.id)));
      return { articles: articles.filter((article) => article !== null) };
    },
  );

  app.post(
    '/admin/news',
    {
      schema: {
        tags: ['admin'],
        body: NewsDraftSchema,
        response: {
          200: NewsAdminArticleSchema,
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

      const draft = request.body;
      if (copiesASourceHeadline(draft.title, draft.sources)) {
        return reply
          .status(400)
          .send({ error: 'title reproduces a source headline verbatim — write an original one' });
      }

      const missing = await findMissingMedia(
        db,
        draft.media.map((link) => link.id),
      );
      if (missing.length > 0) {
        return reply.status(404).send({ error: `unknown or deleted media: ${missing.join(', ')}` });
      }

      const id = await db.transaction(async (tx) => {
        const slug = await uniqueSlug(tx, draft.title);
        const [article] = await tx
          .insert(newsArticle)
          .values({
            slug,
            title: draft.title,
            dek: draft.dek,
            body: draft.body,
            topic: draft.topic,
            kinds: draft.kinds,
            coverUrl: draft.coverUrl,
            // Never from the client. Publication is a separate, deliberate act.
            status: 'draft',
          })
          .returning({ id: newsArticle.id });
        if (!article) throw new Error('draft insert returned no row');

        await tx.insert(newsArticleSource).values(
          draft.sources.map((source) => ({
            articleId: article.id,
            url: source.url,
            outlet: source.outlet,
            title: source.title,
            publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
          })),
        );

        if (draft.media.length > 0) {
          await tx
            .insert(newsArticleMedia)
            .values(
              draft.media.map((link) => ({
                articleId: article.id,
                mediaId: link.id,
                role: link.role,
              })),
            )
            .onConflictDoNothing();
        }

        // Close the ledger entries this story came from, so the next agent run
        // sees them as written rather than pending.
        for (const ref of draft.sourceItemIds) {
          await tx
            .update(newsSourceItem)
            .set({ status: 'used', articleId: article.id })
            .where(
              and(eq(newsSourceItem.sourceId, ref.sourceId), eq(newsSourceItem.guid, ref.guid)),
            );
        }

        return article.id;
      });

      const created = await loadAdminArticle(db, id);
      if (!created) return reply.status(503).send({ error: 'draft creation failed' });
      return created;
    },
  );

  app.patch(
    '/admin/news/:id',
    {
      schema: {
        tags: ['admin'],
        params: z.object({ id: z.uuid() }),
        body: NewsArticleUpdateSchema,
        response: {
          200: NewsAdminArticleSchema,
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

      const patch = request.body;
      if (Object.keys(patch).length === 0) {
        return reply.status(400).send({ error: 'no fields to update' });
      }

      const [existing] = await db
        .select()
        .from(newsArticle)
        .where(eq(newsArticle.id, request.params.id));
      if (!existing) return reply.status(404).send({ error: 'article not found' });

      // Check the headline against whichever source list will be in force after
      // this patch, not just the one it carries.
      if (patch.title !== undefined) {
        const sources =
          patch.sources ??
          (await db
            .select({ title: newsArticleSource.title })
            .from(newsArticleSource)
            .where(eq(newsArticleSource.articleId, existing.id)));
        if (copiesASourceHeadline(patch.title, sources)) {
          return reply
            .status(400)
            .send({ error: 'title reproduces a source headline verbatim — write an original one' });
        }
      }

      if (patch.media) {
        const missing = await findMissingMedia(
          db,
          patch.media.map((link) => link.id),
        );
        if (missing.length > 0) {
          return reply
            .status(404)
            .send({ error: `unknown or deleted media: ${missing.join(', ')}` });
        }
      }

      await db.transaction(async (tx) => {
        const { sources, media, status, ...fields } = patch;

        await tx
          .update(newsArticle)
          .set({
            ...fields,
            ...(status ? { status } : {}),
            // The publish gate. Stamped here and only here, and only once — a
            // republish after an unpublish keeps the original date rather than
            // silently jumping the article to the top of the feed.
            ...(status === 'published' && existing.publishedAt === null
              ? { publishedAt: new Date() }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(newsArticle.id, existing.id));

        // Both lists are replace-in-full, not merge: a review that removes a bad
        // source has to be able to actually remove it.
        if (sources) {
          await tx.delete(newsArticleSource).where(eq(newsArticleSource.articleId, existing.id));
          await tx.insert(newsArticleSource).values(
            sources.map((source) => ({
              articleId: existing.id,
              url: source.url,
              outlet: source.outlet,
              title: source.title,
              publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
            })),
          );
        }

        if (media) {
          await tx.delete(newsArticleMedia).where(eq(newsArticleMedia.articleId, existing.id));
          if (media.length > 0) {
            await tx
              .insert(newsArticleMedia)
              .values(
                media.map((link) => ({
                  articleId: existing.id,
                  mediaId: link.id,
                  role: link.role,
                })),
              )
              .onConflictDoNothing();
          }
        }
      });

      const updated = await loadAdminArticle(db, existing.id);
      if (!updated) return reply.status(404).send({ error: 'article not found' });
      return updated;
    },
  );
};
