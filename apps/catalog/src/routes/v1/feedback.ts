import { desc } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  ApiErrorSchema,
  FeedbackListQuerySchema,
  FeedbackListResponseSchema,
  FeedbackReceiptSchema,
  FeedbackReportSchema,
} from '@trackt/shared';
import { feedback } from '../../db/index.js';
import { requireAdmin } from '../../lib/admin-auth.js';

/**
 * Feedback intake (ADR-0001's central service, and the only place reports are
 * stored). Instances forward their users' reports here so the project sees one
 * inbox across every deployment, instead of each self-hoster collecting
 * suggestions nobody upstream ever reads.
 *
 * `POST` is deliberately public: reporters are ordinary signed-in users of an
 * instance, and handing every self-hoster an admin token to receive feedback
 * would make the feature cost a configuration step per deployment. What stands
 * in for auth is a tight per-IP budget plus hard body limits — the route is a
 * write-only mailbox, not a query surface. Reading it back is admin-only.
 */
export const feedbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/feedback',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['feedback'],
        body: FeedbackReportSchema,
        response: {
          201: FeedbackReceiptSchema,
          400: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const [row] = await db
        .insert(feedback)
        .values({
          category: request.body.category,
          message: request.body.message,
          route: request.body.route ?? null,
          instanceUrl: request.body.instanceUrl ?? null,
          appVersion: request.body.appVersion ?? null,
        })
        .returning({ id: feedback.id, createdAt: feedback.createdAt });

      if (!row) return reply.status(503).send({ error: 'feedback was not stored' });

      return reply.status(201).send({ id: row.id, createdAt: row.createdAt.toISOString() });
    },
  );

  app.get(
    '/admin/feedback',
    {
      schema: {
        tags: ['admin'],
        querystring: FeedbackListQuerySchema,
        response: {
          200: FeedbackListResponseSchema,
          401: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
      preHandler: requireAdmin,
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const rows = await db
        .select()
        .from(feedback)
        .orderBy(desc(feedback.createdAt))
        .limit(request.query.limit);

      return {
        entries: rows.map((row) => ({
          id: row.id,
          category: row.category,
          message: row.message,
          route: row.route,
          instanceUrl: row.instanceUrl,
          appVersion: row.appVersion,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
  );
};
