import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { media } from '@trackt/db';
import {
  ApiErrorSchema,
  ExternalIdsSchema,
  MediaKindSchema,
  MediaSourceSchema,
  MediaStatusSchema,
  ModerationStatusSchema,
} from '@trackt/shared';

const MediaResponseSchema = z.object({
  id: z.uuid(),
  kind: MediaKindSchema,
  title: z.string(),
  originalTitle: z.string().nullable(),
  slug: z.string(),
  description: z.string().nullable(),
  coverUrl: z.string().nullable(),
  releaseDate: z.string().nullable(),
  status: MediaStatusSchema.nullable(),
  externalIds: ExternalIdsSchema,
  metadata: z.record(z.string(), z.unknown()),
  source: MediaSourceSchema,
  moderation: ModerationStatusSchema,
});

export const mediaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/media/:id',
    {
      schema: {
        tags: ['catalog'],
        params: z.object({ id: z.uuid() }),
        response: {
          200: MediaResponseSchema,
          404: ApiErrorSchema,
          503: ApiErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const db = app.deps.db;
      if (!db) return reply.status(503).send({ error: 'database unavailable' });

      const [row] = await db.select().from(media).where(eq(media.id, request.params.id)).limit(1);
      if (!row) return reply.status(404).send({ error: 'media not found' });
      return row;
    },
  );
};
