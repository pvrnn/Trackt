import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { discordLink, findLinkCode, redeemLinkCode } from '@trackt/db';
import {
  ApiErrorSchema,
  DiscordLinkCodePreviewSchema,
  DiscordLinkCodeQuerySchema,
  DiscordLinkStatusSchema,
  LinkDiscordBodySchema,
  type DiscordLink,
} from '@trackt/shared';
import { getSessionUser } from '../../lib/session.js';

/**
 * Discord account linking. The bot's `/link` issues a one-time code and hands
 * it only to the Discord user; redeeming it here, signed in, proves the Trackt
 * side.
 */

function toLink(row: typeof discordLink.$inferSelect): DiscordLink {
  return {
    discordUserId: row.discordUserId,
    discordUsername: row.discordUsername,
    linkedAt: row.linkedAt.toISOString(),
  };
}

export const discordRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/discord',
    {
      schema: {
        tags: ['discord'],
        response: { 200: DiscordLinkStatusSchema, 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      const [row] = await db.select().from(discordLink).where(eq(discordLink.userId, user.id));
      return { linked: row ? toLink(row) : null };
    },
  );

  app.get(
    '/me/discord/link-code',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['discord'],
        querystring: DiscordLinkCodeQuerySchema,
        response: {
          200: DiscordLinkCodePreviewSchema,
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
      const pending = await findLinkCode(db, request.query.code);
      if (!pending) return reply.status(404).send({ error: 'link code not found or expired' });
      return {
        discordUsername: pending.discordUsername,
        expiresAt: pending.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/me/discord/link',
    {
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['discord'],
        body: LinkDiscordBodySchema,
        response: {
          200: DiscordLinkStatusSchema,
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
      const link = await redeemLinkCode(db, user.id, request.body.code);
      if (!link) return reply.status(404).send({ error: 'link code not found or expired' });
      return { linked: toLink(link) };
    },
  );

  app.delete(
    '/me/discord',
    {
      schema: {
        tags: ['discord'],
        response: { 204: z.null(), 401: ApiErrorSchema, 503: ApiErrorSchema },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });
      const user = await getSessionUser(app, request);
      if (!user) return reply.status(401).send({ error: 'authentication required' });
      await db.delete(discordLink).where(eq(discordLink.userId, user.id));
      return reply.status(204).send(null);
    },
  );
};
