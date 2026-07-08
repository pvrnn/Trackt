import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { mediaRoutes } from './media.js';
import { searchRoutes } from './search.js';

export const v1Routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(searchRoutes);
  await app.register(mediaRoutes);
};
