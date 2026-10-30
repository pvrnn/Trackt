import { Queue } from 'bullmq';
import { QUEUES } from '@trackt/shared';
import type { ImportJobData, ImportJobResult } from '@trackt/imports';

/**
 * The API's view of the `importer` queue. Deliberately narrower than BullMQ's
 * `Queue`: `buildApp` takes one of these, so route tests inject a fake and never
 * need Redis, and the routes cannot start depending on queue internals.
 */

export interface ImportQueueJob {
  id?: string | undefined;
  data: unknown;
  /** Whatever the processor last reported; an object for this job, `0` until then. */
  progress: unknown;
  /** The processor's return value once the job completes. */
  returnvalue: unknown;
  failedReason: string;
  getState(): Promise<string>;
  /** Only a finished job is removed, so a viewer can import the same source again. */
  remove(): Promise<void>;
}

export interface ImportQueueAddOptions {
  jobId: string;
  attempts?: number;
  backoff?: { type: 'exponential'; delay: number };
}

export interface ImportQueue {
  add(name: string, data: ImportJobData, options: ImportQueueAddOptions): Promise<ImportQueueJob>;
  getJob(jobId: string): Promise<ImportQueueJob | undefined>;
  close(): Promise<void>;
}

/** The real queue, on the instance's Redis. `maxRetriesPerRequest: null` is BullMQ's requirement. */
export function createImportQueue(redisUrl: string): ImportQueue {
  const queue = new Queue<ImportJobData, ImportJobResult>(QUEUES.importer, {
    connection: { url: redisUrl, maxRetriesPerRequest: null },
  });

  return {
    add: (name, data, options) => queue.add(name, data, options),
    getJob: (jobId) => queue.getJob(jobId),
    close: () => queue.close(),
  };
}
