import type { ImportJobData } from '@trackt/imports';
import type { ImportQueue, ImportQueueAddOptions } from '../src/lib/import-queue.js';

export interface StoredJob {
  data: unknown;
  state: string;
  progress: unknown;
  returnvalue: unknown;
  failedReason: string;
}

/** A BullMQ stand-in: enough of it that the routes cannot tell the difference. */
export function fakeQueue() {
  const jobs = new Map<string, StoredJob>();
  const adds: { data: ImportJobData; options: ImportQueueAddOptions }[] = [];

  const read = (id: string, job: StoredJob) => ({
    id,
    data: job.data,
    progress: job.progress,
    returnvalue: job.returnvalue,
    failedReason: job.failedReason,
    getState: async () => job.state,
    remove: async () => {
      jobs.delete(id);
    },
  });

  const queue: ImportQueue = {
    async add(_name, data, options) {
      adds.push({ data, options });
      jobs.set(options.jobId, {
        data,
        state: 'waiting',
        progress: 0,
        returnvalue: null,
        failedReason: '',
      });
      return read(options.jobId, jobs.get(options.jobId) as StoredJob);
    },
    async getJob(id) {
      const job = jobs.get(id);
      return job ? read(id, job) : undefined;
    },
    async close() {},
  };

  return { queue, jobs, adds };
}
