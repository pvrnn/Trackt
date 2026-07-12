import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { adminRoutes } from './admin.js';
import { catalogRoutes } from './catalog.js';
import { searchRoutes } from './search.js';

export const v1Routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(catalogRoutes);
  await app.register(searchRoutes);
  await app.register(adminRoutes);
};
