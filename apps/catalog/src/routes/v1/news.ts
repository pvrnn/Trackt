import { sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiErrorSchema,
  NewsArticleSchema,
  NewsByMediaQuerySchema,
  NewsListQuerySchema,
  NewsListResponseSchema,
  decodeNewsCursor,
  encodeNewsCursor,
  type ExternalIds,
  type NewsArticle,
  type NewsArticleSummary,
  type NewsMediaRef,
  type NewsSourceRef,
} from '@trackt/shared';

/**
 * The public news surface (ADR-0005). Instances read these live through their
 * own API — nothing here is mirrored, the same posture ADR-0002 takes toward
 * media. Anonymous and unauthenticated: news is public by definition.
 *
 * Drafts are invisible here by construction. Every read filters
 * `status = 'published' AND published_at <= now()`, so an unpublished or
 * future-dated article cannot leak through any of the three routes.
 */

/** Columns a feed card needs — deliberately not `body`, which a 20-item page would multiply. */
const SUMMARY_COLUMNS = sql`a.id, a.slug, a.title, a.dek, a.topic, a.kinds, a.cover_url, a.published_at`;

/** The predicate that makes a row public. Repeated on every route on purpose. */
const PUBLISHED = sql`a.status = 'published' AND a.published_at IS NOT NULL AND a.published_at <= now()`;

/**
 * Timestamps out of `db.execute` arrive as strings, not Dates — unlike the query
 * builder, the raw path does no column mapping. Normalize both so the wire shape
 * is always an ISO string whichever way a row was read.
 */
function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

function toSummary(row: Record<string, unknown>): NewsArticleSummary {
  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    dek: row.dek as string | null,
    topic: row.topic as NewsArticleSummary['topic'],
    kinds: row.kinds as NewsArticleSummary['kinds'],
    coverUrl: row.cover_url as string | null,
    publishedAt: toIso(row.published_at),
  };
}

export const newsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/news',
    {
      // The feed is anonymous and the only paginated read here — same tighter
      // bucket as /catalog/search, for the same reason.
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['news'],
        querystring: NewsListQuerySchema,
        response: { 200: NewsListResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { kind, topic, from, to, limit, cursor } = request.query;
      // A malformed cursor restarts the feed rather than 500ing: cursors outlive
      // deploys in bookmarks and shared links, and a broken one is not an error
      // the reader can act on.
      const after = cursor ? decodeNewsCursor(cursor) : null;

      // Keyset, not offset: articles publish while a reader pages, which would
      // make an OFFSET skip or repeat rows, and Postgres would walk every
      // skipped row to find the window. The row-value comparison below matches
      // `news_article_feed_idx`'s (published_at DESC, id DESC) ordering exactly.
      //
      // limit + 1 probes for a next page without a second COUNT query.
      const rows = await db.execute(sql`
        SELECT ${SUMMARY_COLUMNS}
        FROM news_article a
        WHERE ${PUBLISHED}
          AND (${kind ?? null}::text IS NULL OR a.kinds @> ARRAY[${kind ?? null}]::text[])
          AND (${topic ?? null}::text IS NULL OR a.topic = ${topic ?? null}::text)
          AND (${from ?? null}::date IS NULL OR a.published_at >= ${from ?? null}::date)
          AND (${to ?? null}::date IS NULL
               OR a.published_at < (${to ?? null}::date + INTERVAL '1 day'))
          AND (${after?.publishedAt ?? null}::timestamptz IS NULL
               OR (a.published_at, a.id)
                  < (${after?.publishedAt ?? null}::timestamptz, ${after?.id ?? null}::uuid))
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT ${limit + 1}
      `);

      const page = [...rows];
      const hasMore = page.length > limit;
      const articles = page.slice(0, limit).map(toSummary);
      const last = articles.at(-1);
      return {
        articles,
        nextCursor:
          hasMore && last ? encodeNewsCursor({ publishedAt: last.publishedAt, id: last.id }) : null,
      };
    },
  );

  app.get(
    '/news/by-media',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['news'],
        querystring: NewsByMediaQuerySchema,
        // Same envelope as the feed so one client parser serves both; the cursor
        // is always null because this block never pages.
        response: { 200: NewsListResponseSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const { id, limit } = request.query;
      const rows = await db.execute(sql`
        SELECT ${SUMMARY_COLUMNS}
        FROM news_article a
        JOIN news_article_media m ON m.article_id = a.id AND m.media_id = ${id}
        WHERE ${PUBLISHED}
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT ${limit}
      `);
      // One article can link a work twice (subject *and* mentioned), which the
      // join would duplicate — dedupe on id rather than DISTINCT so the ordering
      // stays index-served.
      const seen = new Set<string>();
      const articles: NewsArticleSummary[] = [];
      for (const row of rows) {
        const summary = toSummary(row);
        if (seen.has(summary.id)) continue;
        seen.add(summary.id);
        articles.push(summary);
      }
      return { articles, nextCursor: null };
    },
  );

  app.get(
    '/news/:slug',
    {
      schema: {
        tags: ['news'],
        params: z.object({ slug: z.string().min(1).max(300) }),
        response: { 200: NewsArticleSchema, 404: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const [article] = [
        ...(await db.execute(sql`
          SELECT ${SUMMARY_COLUMNS}, a.body
          FROM news_article a
          WHERE a.slug = ${request.params.slug} AND ${PUBLISHED}
        `)),
      ];
      // Unpublished and non-existent answer alike: a draft's slug must not be
      // probeable from the public route.
      if (!article) return reply.status(404).send({ error: 'article not found' });

      const articleId = article.id as string;
      const [sourceRows, mediaRows] = await Promise.all([
        db.execute(sql`
          SELECT url, outlet, title, published_at
          FROM news_article_source
          WHERE article_id = ${articleId}
          ORDER BY published_at DESC NULLS LAST, url ASC
        `),
        // Works are inlined in full slim form so an instance can materialize one
        // it has never seen (ADR-0005), the same way relation targets are.
        // Tombstoned works drop out via the join, as everywhere else.
        db.execute(sql`
          SELECT t.id, t.kind, t.title, t.synonyms, t.year, t.status, t.genres,
                 t.part_count, t.season_number, t.external_ids, t.description, t.cover_url,
                 m.role
          FROM news_article_media m
          JOIN catalog_media t ON t.id = m.media_id AND t.deleted_at IS NULL
          WHERE m.article_id = ${articleId}
          ORDER BY m.role ASC, t.year ASC NULLS LAST, t.title ASC
        `),
      ]);

      const sources: NewsSourceRef[] = [...sourceRows].map((row) => ({
        url: row.url as string,
        outlet: row.outlet as string,
        title: row.title as string,
        publishedAt: row.published_at ? toIso(row.published_at) : null,
      }));

      const media: NewsMediaRef[] = [...mediaRows].map((row) => ({
        id: row.id as string,
        kind: row.kind as NewsMediaRef['kind'],
        title: row.title as string,
        synonyms: row.synonyms as string[],
        year: row.year as number | null,
        status: row.status as NewsMediaRef['status'],
        genres: row.genres as string[],
        partCount: row.part_count as number | null,
        seasonNumber: row.season_number as number | null,
        externalIds: row.external_ids as ExternalIds,
        description: row.description as string | null,
        coverUrl: row.cover_url as string | null,
        role: row.role as NewsMediaRef['role'],
      }));

      const full: NewsArticle = {
        ...toSummary(article),
        body: article.body as string,
        sources,
        media,
      };
      return full;
    },
  );
};
