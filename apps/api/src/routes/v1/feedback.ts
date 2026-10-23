import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  APP_VERSION,
  ApiErrorSchema,
  FeedbackReceiptSchema,
  FeedbackSubmissionSchema,
  submitFeedback,
} from '@trackt/shared';
import { getSessionUser } from '../../lib/session.js';

/**
 * The instance's half of feedback intake: signed-in users only, forwarded to the
 * central catalog, which is the only place reports are stored.
 *
 * A session is required even though the catalog's own endpoint is public — the
 * dialog lives on `/profile`, and "you must be signed in to send feedback" is a
 * cheaper spam gate than anything the central service could do with an IP.
 *
 * Unlike news, a catalog failure here is not degraded to an empty result: the
 * reporter is watching, and a 502 they can retry beats a silent no-op.
 */
export const feedbackRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/feedback',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
      schema: {
        tags: ['feedback'],
        body: FeedbackSubmissionSchema,
        response: {
          201: FeedbackReceiptSchema,
          401: ApiErrorSchema,
          502: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'unauthorized' });

      const catalogUrl = app.deps.env.CATALOG_URL;
      if (!catalogUrl) {
        return reply.status(503).send({
          error: 'this instance is not connected to a catalog, so feedback cannot be sent',
        });
      }

      try {
        const receipt = await submitFeedback(
          catalogUrl,
          {
            ...request.body,
            instanceUrl: app.deps.env.APP_URL,
            appVersion: APP_VERSION,
          },
          { timeoutMs: app.deps.env.CATALOG_FEEDBACK_TIMEOUT_MS },
        );
        return reply.status(201).send(receipt);
      } catch (error) {
        request.log.warn({ err: error }, 'feedback forward failed');
        return reply.status(502).send({ error: 'could not reach the catalog — try again' });
      }
    },
  );
};
