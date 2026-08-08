import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { adminRoutes } from './admin.js';
import { adminNewsRoutes } from './admin-news.js';
import { catalogRoutes } from './catalog.js';
import { newsRoutes } from './news.js';
import { relationsRoutes } from './relations.js';
import { searchRoutes } from './search.js';

export const v1Routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(catalogRoutes);
  await app.register(searchRoutes);
  await app.register(relationsRoutes);
  await app.register(newsRoutes);
  await app.register(adminRoutes);
  await app.register(adminNewsRoutes);
};
