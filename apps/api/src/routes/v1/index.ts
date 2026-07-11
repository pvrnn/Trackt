import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { homeRoutes } from './home.js';
import { mediaRoutes } from './media.js';
import { searchRoutes } from './search.js';
import { trackingRoutes } from './tracking.js';

export const v1Routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(searchRoutes);
  await app.register(mediaRoutes);
  await app.register(trackingRoutes);
  await app.register(homeRoutes);
};
