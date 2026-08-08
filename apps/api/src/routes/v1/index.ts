import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { homeRoutes } from './home.js';
import { listRoutes } from './lists.js';
import { mediaRoutes } from './media.js';
import { moderationRoutes } from './moderation.js';
import { newsRoutes } from './news.js';
import { profileRoutes } from './profile.js';
import { searchRoutes } from './search.js';
import { trackingRoutes } from './tracking.js';

export const v1Routes: FastifyPluginAsyncZod = async (app) => {
  await app.register(searchRoutes);
  await app.register(mediaRoutes);
  await app.register(trackingRoutes);
  await app.register(homeRoutes);
  await app.register(profileRoutes);
  await app.register(listRoutes);
  await app.register(moderationRoutes);
  await app.register(newsRoutes);
};
