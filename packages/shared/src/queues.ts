/** BullMQ queue names shared between the API (producers) and the worker (consumers). */
export const QUEUES = {
  metadataRefresh: 'metadata-refresh',
  importer: 'importer',
  notifications: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
