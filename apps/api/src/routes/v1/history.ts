import { sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  HistoryPageSchema,
  HistoryQuerySchema,
  decodeHistoryCursor,
  encodeHistoryCursor,
  seasonWindow,
  type HistoryEntry,
  type HistoryPage,
  type HistoryQuery,
  type MediaKind,
} from '@trackt/shared';
import { loadYearCheckinCounts } from '../../lib/me.js';
import { getSessionUser } from '../../lib/session.js';
import { visibleMediaSql } from '../../lib/visibility.js';

/**
 * `GET /v1/me/history` (ADR-0007) — the viewer's own year view.
 *
 * **Filing rule.** One expression decides which year a work belongs to, and the
 * filter, the sort, the cursor and the facets all read it:
 *
 *     COALESCE(um.finished_at, um.started_at) AS logged_on
 *
 * A completed work files under the day you finished it, because "what I watched
 * in 2025" is a list of things you *got through* in 2025; anything still open
 * files under the day you started. A series started in December 2025 and
 * finished in January 2026 therefore appears only under 2026 — the intended
 * reading, and the reason the rows show a full range rather than a single date.
 *
 * Rows where both dates are NULL are excluded. After the backfill that is
 * `planned` and nothing else, which is correct: a watchlist is not a history.
 */

/** The window the year/season filter narrows to, as an inclusive ISO date pair. */
function dateWindow(query: HistoryQuery): { from: string; to: string } | null {
  if (query.year === undefined) return null;
  if (query.season) return seasonWindow(query.year, query.season);
  return { from: `${query.year}-01-01`, to: `${query.year}-12-31` };
}

/** `logged_on` between the window's bounds, or nothing when there is no window. */
function windowSql(window: { from: string; to: string } | null): SQL {
  if (!window) return sql`TRUE`;
  return sql`COALESCE(um.finished_at, um.started_at) BETWEEN ${window.from}::date AND ${window.to}::date`;
}

function kindSql(kind: MediaKind | undefined): SQL {
  return kind ? sql`m.kind = ${kind}` : sql`TRUE`;
}

function statusSql(status: HistoryQuery['status']): SQL {
  return status ? sql`um.status = ${status}` : sql`TRUE`;
}

export const historyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/history',
    {
      schema: {
        tags: ['tracking'],
        querystring: HistoryQuerySchema,
        response: {
          200: HistoryPageSchema,
          400: ApiErrorSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });

      const query = request.query;
      const cursor = query.cursor ? decodeHistoryCursor(query.cursor) : null;
      if (query.cursor && !cursor) return reply.status(400).send({ error: 'invalid cursor' });

      const window = dateWindow(query);
      // Media visibility applies as everywhere else: a soft-deleted title
      // vanishes from the history while its log row survives (lib/me.ts).
      const visible = visibleMediaSql(sql.raw('m.'));
      const scoped = sql`
        um.user_id = ${user.id}
        AND COALESCE(um.finished_at, um.started_at) IS NOT NULL
        AND ${visible}
        AND ${windowSql(window)}
        AND ${kindSql(query.kind)}
        AND ${statusSql(query.status)}
      `;
      const keyset = cursor
        ? sql`AND (COALESCE(um.finished_at, um.started_at), um.media_id) < (${cursor.loggedOn}::date, ${cursor.mediaId}::uuid)`
        : sql``;

      const [entryRows, yearRows, totalRows, checkins] = await Promise.all([
        db.execute(sql`
          SELECT m.id, m.slug, m.kind, m.title, m.cover_url, um.status,
                 um.started_at, um.finished_at,
                 COALESCE(um.finished_at, um.started_at) AS logged_on,
                 r.score,
                 (SELECT count(*)::int FROM progress p
                    JOIN media_part mp ON mp.id = p.part_id
                   WHERE p.user_id = um.user_id AND mp.media_id = m.id) AS watched,
                 m.part_count
          FROM user_media um
          JOIN media m ON m.id = um.media_id
          LEFT JOIN rating r
            ON r.user_id = um.user_id AND r.target_type = 'media' AND r.target_id = m.id
          WHERE ${scoped} ${keyset}
          ORDER BY logged_on DESC, um.media_id DESC
          LIMIT ${query.limit + 1}
        `),
        // Unfiltered by year on purpose — this is the year picker's own data.
        db.execute(sql`
          SELECT EXTRACT(YEAR FROM COALESCE(um.finished_at, um.started_at))::int AS year,
                 count(*)::int AS count
          FROM user_media um
          JOIN media m ON m.id = um.media_id
          WHERE um.user_id = ${user.id}
            AND COALESCE(um.finished_at, um.started_at) IS NOT NULL
            AND ${visible}
            AND ${kindSql(query.kind)}
            AND ${statusSql(query.status)}
          GROUP BY 1
          ORDER BY 1 DESC
        `),
        db.execute(sql`
          SELECT count(*)::int AS titles,
                 count(*) FILTER (WHERE um.status = 'completed')::int AS completed
          FROM user_media um
          JOIN media m ON m.id = um.media_id
          WHERE ${scoped}
        `),
        loadYearCheckinCounts(db, user.id, window ?? 'all', query.kind),
      ]);

      const rows = [...entryRows];
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const entries: HistoryEntry[] = page.map((row) => ({
        id: row.id as string,
        slug: row.slug as string,
        kind: row.kind as MediaKind,
        title: row.title as string,
        coverUrl: row.cover_url as string | null,
        status: row.status as HistoryEntry['status'],
        startedAt: row.started_at as string | null,
        finishedAt: row.finished_at as string | null,
        loggedOn: row.logged_on as string,
        score: row.score !== null ? Number(row.score) : null,
        watched: Number(row.watched),
        // Movies have no parts to progress through (ADR-0003).
        total: row.kind === 'movie' ? null : (row.part_count as number | null),
      }));

      const last = page.at(-1);
      const totals = [...totalRows][0];
      const result: HistoryPage = {
        entries,
        nextCursor:
          hasMore && last
            ? encodeHistoryCursor({
                loggedOn: last.logged_on as string,
                mediaId: last.id as string,
              })
            : null,
        years: [...yearRows].map((row) => ({
          year: Number(row.year),
          count: Number(row.count),
        })),
        totals: {
          titles: Number(totals?.titles ?? 0),
          completed: Number(totals?.completed ?? 0),
          episodes: checkins.episodes,
          chapters: checkins.chapters,
        },
      };
      return result;
    },
  );
};
