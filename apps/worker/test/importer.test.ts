import { describe, expect, it } from 'vitest';
import type { Db } from '@trackt/db';
import {
  ImportError,
  type ImportEntry,
  type ImportJobProgress,
  type ImportPlan,
  type ImportReport,
  type RunImportOptions,
} from '@trackt/imports';
import { createImportProcessor, type ImportJobLike, type RunImportFn } from '../src/importer.js';

/**
 * The queue wiring, without Redis or a provider: a fake job, a stubbed pipeline.
 * What is worth asserting here is the contract between the two — the payload is
 * validated, credentials come from env, progress is reported, and a failure keeps
 * the importer's kind where the API can read it.
 */

// The processor only passes this through to the pipeline, which the stub replaces.
const db = {} as Db;

const entry = (externalId: string): ImportEntry => ({
  source: 'anilist',
  kind: 'anime',
  externalId,
  title: `Title ${externalId}`,
  year: 1998,
  seasonNumber: null,
  status: 'completed',
  score: null,
  progress: 0,
  repeats: 0,
  startedAt: null,
  finishedAt: null,
  notes: null,
  favourite: false,
  externalIds: {},
});

const plan: ImportPlan = {
  source: 'anilist',
  profile: 'alice',
  rows: [
    {
      entry: entry('1'),
      target: {
        id: 'media-1',
        kind: 'anime',
        title: 'Title 1',
        partCount: 26,
        seasonNumber: null,
        matchedBy: 'external-id',
        matchScore: null,
      },
      matchedBy: 'external-id',
      matchScore: null,
      uncertain: null,
      existing: false,
      upTo: 26,
      warnings: [],
    },
    {
      entry: entry('2'),
      target: null,
      matchedBy: null,
      matchScore: null,
      uncertain: null,
      existing: false,
      upTo: 0,
      warnings: [],
    },
    {
      entry: entry('3'),
      target: {
        id: 'media-3',
        kind: 'anime',
        title: 'Title 3',
        partCount: 12,
        seasonNumber: null,
        matchedBy: 'title',
        matchScore: 1,
      },
      matchedBy: 'title',
      matchScore: 1,
      uncertain: null,
      existing: false,
      upTo: 12,
      warnings: [],
    },
  ],
  warnings: [],
  summary: {
    total: 3,
    matched: 2,
    unmatched: 1,
    existing: 0,
    pending: 2,
    fromCatalog: 0,
    favourites: 0,
    warnings: 0,
  },
};

const report: ImportReport = {
  source: 'anilist',
  profile: 'alice',
  created: 2,
  updated: 0,
  skippedExisting: 0,
  withProgress: 2,
  ratings: 0,
  favourites: 0,
  uncertain: 0,
  warnings: [],
  unmatched: [{ externalId: '2', title: 'Title 2' }],
};

interface FakeJob extends ImportJobLike {
  updates: ImportJobProgress[];
}

function fakeJob(data: unknown): FakeJob {
  const updates: ImportJobProgress[] = [];
  return {
    id: 'job-1',
    data,
    updates,
    async updateProgress(progress) {
      updates.push(progress);
    },
  };
}

/** A pipeline stub that reports two rows and returns the fixture plan. */
function stubRun(): { runImport: RunImportFn; seen: (RunImportOptions & { dryRun?: boolean })[] } {
  const seen: (RunImportOptions & { dryRun?: boolean })[] = [];
  const runImport: RunImportFn = async (_db, options) => {
    seen.push(options);
    options.onProgress?.(1, plan.rows.length);
    options.onProgress?.(plan.rows.length, plan.rows.length);
    return { plan, report: options.dryRun ? null : report };
  };
  return { runImport, seen };
}

const validJob = {
  userId: 'user-1',
  source: 'anilist',
  profile: 'alice',
};

describe('createImportProcessor', () => {
  it('runs the import and returns a JSON-sized summary', async () => {
    const { runImport } = stubRun();
    const processor = createImportProcessor({ db, env: {}, runImport });
    const job = fakeJob(validJob);

    const result = await processor(job);

    expect(result.plan).toMatchObject({
      source: 'anilist',
      profile: 'alice',
      total: 3,
      matched: 2,
      unmatched: 1,
      pending: 2,
      matchedByTitle: 1,
    });
    expect(result.report?.created).toBe(2);
    expect(result.unmatched).toEqual({
      entries: [{ externalId: '2', title: 'Title 2' }],
      truncated: false,
    });
  });

  it('reports progress as rows are applied, and finishes at the total', async () => {
    const { runImport } = stubRun();
    const processor = createImportProcessor({ db, env: {}, runImport });
    const job = fakeJob(validJob);

    await processor(job);

    expect(job.updates).toContainEqual({ done: 1, total: 3 });
    expect(job.updates.at(-1)).toEqual({ done: 3, total: 3 });
  });

  it('fails a credential-less source with the credential kind, naming the variable', async () => {
    const { runImport, seen } = stubRun();
    const processor = createImportProcessor({ db, env: {}, runImport });
    const job = fakeJob({ ...validJob, source: 'trakt' });

    const error = await processor(job).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).kind).toBe('credential');
    expect((error as ImportError).message).toContain('TRAKT_CLIENT_ID');
    // The API reports the kind from the job's progress; the pipeline never ran.
    expect(job.updates.at(-1)).toMatchObject({ errorKind: 'credential' });
    expect(seen).toHaveLength(0);
  });

  it('passes the credential the source needs', async () => {
    const { runImport, seen } = stubRun();
    const processor = createImportProcessor({
      db,
      env: { TRAKT_CLIENT_ID: 'trakt-client' },
      runImport,
    });

    await processor(fakeJob({ ...validJob, source: 'trakt' }));

    expect(seen[0]?.credentials).toEqual({ traktClientId: 'trakt-client' });
  });

  it('runs a source that needs no credential at all', async () => {
    const { runImport, seen } = stubRun();
    const processor = createImportProcessor({ db, env: {}, runImport });

    await processor(fakeJob({ ...validJob, source: 'mal' }));

    expect(seen[0]?.credentials).toEqual({});
  });

  it('rejects a job with an unknown source', async () => {
    const { runImport, seen } = stubRun();
    const processor = createImportProcessor({ db, env: {}, runImport });

    const error = await processor(fakeJob({ ...validJob, source: 'myspace' })).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).kind).toBe('malformed');
    expect(seen).toHaveLength(0);
  });

  it('forwards overwrite and dryRun', async () => {
    const { runImport, seen } = stubRun();
    const processor = createImportProcessor({ db, env: {}, runImport });

    const result = await processor(fakeJob({ ...validJob, overwrite: true, dryRun: true }));

    expect(seen[0]).toMatchObject({ overwrite: true, dryRun: true });
    // A dry run writes nothing, so there is no report to show.
    expect(result.report).toBeNull();
  });
});
