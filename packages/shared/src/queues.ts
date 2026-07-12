/** BullMQ queue names shared between the API (producers) and the worker (consumers). */
export const QUEUES = {
  /** Parked: provider refresh crons were removed with the central-catalog pivot (ADR-0001). */
  metadataRefresh: 'metadata-refresh',
  importer: 'importer',
  notifications: 'notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
