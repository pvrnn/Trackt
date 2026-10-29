import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { FlagsSnapshotSchema, type FlagsSnapshot } from '@trackt/shared';
import { evaluateSnapshot } from '../../lib/flags.js';

/**
 * `GET /v1/flags` (ADR-0011) — every registry key, always, evaluated for the
 * requesting viewer.
 *
 * Anonymous-readable on purpose: public pages must render the same chrome as
 * the app, and a gate must never depend on a session. Booleans only; rule values
 * never leave the admin surface. Per-viewer (percentage, override, country), so
 * nothing shared may store it, but a weak ETag makes revalidation nearly free.
 */
export const flagsRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/flags',
    {
      schema: {
        tags: ['flags'],
        response: { 200: FlagsSnapshotSchema, 304: z.null() },
      },
    },
    async (request, reply) => {
      const snapshot: FlagsSnapshot = { flags: await evaluateSnapshot(app, request) };
      const etag = `W/"${createHash('sha256')
        .update(JSON.stringify(snapshot))
        .digest('base64url')
        .slice(0, 22)}"`;

      reply.header('cache-control', 'private, max-age=0, must-revalidate').header('etag', etag);

      if (request.headers['if-none-match'] === etag) {
        return reply.status(304).send(null);
      }
      return snapshot;
    },
  );
};
