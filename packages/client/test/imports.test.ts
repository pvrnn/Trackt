import { describe, expect, it } from 'vitest';
import {
  ImportJobStatusSchema,
  ImportMatchSchema,
  ImportRunSchema,
  ImportSourcesSchema,
  importJobPhase,
  importProgressPercent,
  isImportJobTerminal,
  latestRunPerSource,
  type ImportJobState,
} from '../src/imports.js';

/**
 * The framework-free half of the import wizard: how a queue state reads on
 * screen, the progress percentage (and its deliberate absence), and how much a
 * response shape from an older instance is allowed to omit.
 */

const STATES: ImportJobState[] = ['waiting', 'active', 'delayed', 'completed', 'failed', 'unknown'];

describe('importProgressPercent', () => {
  it('is null until the job reports a total', () => {
    expect(importProgressPercent({ done: 0, total: 0 })).toBeNull();
  });

  it('rounds to whole percent', () => {
    expect(importProgressPercent({ done: 0, total: 10 })).toBe(0);
    expect(importProgressPercent({ done: 1, total: 3 })).toBe(33);
    expect(importProgressPercent({ done: 10, total: 10 })).toBe(100);
  });

  it('stays inside 0–100 even if the queue reports nonsense', () => {
    expect(importProgressPercent({ done: -4, total: 10 })).toBe(0);
    expect(importProgressPercent({ done: 40, total: 10 })).toBe(100);
  });
});

describe('importJobPhase', () => {
  it('folds the queue states into the four a screen branches on', () => {
    expect(importJobPhase('waiting')).toBe('queued');
    expect(importJobPhase('delayed')).toBe('queued');
    expect(importJobPhase('active')).toBe('running');
    expect(importJobPhase('completed')).toBe('done');
    expect(importJobPhase('failed')).toBe('failed');
    expect(importJobPhase('unknown')).toBe('unknown');
  });
});

describe('isImportJobTerminal', () => {
  it('stops polling only on an answer that cannot change', () => {
    expect(STATES.filter(isImportJobTerminal)).toEqual(['completed', 'failed', 'unknown']);
  });
});

describe('ImportSourcesSchema', () => {
  it('fills in what an older instance omits, instead of failing the screen', () => {
    const parsed = ImportSourcesSchema.parse({
      sources: [{ id: 'anilist', label: 'AniList', available: true }],
    });
    expect(parsed.sources[0]).toEqual({
      id: 'anilist',
      label: 'AniList',
      kinds: [],
      access: 'api',
      requiresBrowser: false,
      available: true,
    });
  });

  it('keeps the reason a source is unavailable', () => {
    const parsed = ImportSourcesSchema.parse({
      sources: [
        {
          id: 'mal',
          label: 'MyAnimeList',
          kinds: ['anime', 'manga'],
          access: 'api',
          requiresBrowser: false,
          available: false,
          reason: 'TRAKT_CLIENT_ID is not set on this instance',
        },
      ],
    });
    expect(parsed.sources[0]?.available).toBe(false);
    expect(parsed.sources[0]?.reason).toContain('TRAKT_CLIENT_ID');
  });

  it('reads the empty list the 404 degrades to', () => {
    expect(ImportSourcesSchema.parse({ sources: [] }).sources).toEqual([]);
  });

  it('rejects the 404 body, which is why the fetch helper maps it explicitly', () => {
    expect(ImportSourcesSchema.safeParse({ error: 'not found' }).success).toBe(false);
  });
});

const jobResult = {
  report: {
    source: 'anilist',
    profile: 'alice',
    created: 12,
    updated: 1,
    skippedExisting: 3,
    withProgress: 9,
    ratings: 7,
    warnings: [],
    unmatched: [],
  },
  plan: {
    source: 'anilist',
    profile: 'alice',
    total: 16,
    matched: 14,
    unmatched: 2,
    existing: 3,
    pending: 11,
    warnings: 0,
    matchedByTitle: 0,
  },
  unmatched: { entries: [{ externalId: '1', title: 'A Work' }], truncated: false },
};

describe('ImportJobStatusSchema', () => {
  it('parses a completed job, result and all', () => {
    const parsed = ImportJobStatusSchema.parse({
      jobId: 'job',
      state: 'completed',
      progress: { done: 16, total: 16 },
      result: jobResult,
      failedReason: null,
      errorKind: null,
    });
    expect(parsed.result?.plan.total).toBe(16);
    expect(parsed.result?.report?.created).toBe(12);
    expect(isImportJobTerminal(parsed.state)).toBe(true);
  });

  it('defaults a job that has not reported progress yet', () => {
    const parsed = ImportJobStatusSchema.parse({ jobId: 'job', state: 'waiting' });
    expect(parsed.progress).toEqual({ done: 0, total: 0 });
    expect(parsed.result).toBeNull();
    expect(parsed.failedReason).toBeNull();
    expect(parsed.errorKind).toBeNull();
  });

  it('reports a failed job’s kind, and keeps an unknown state pollable-safe', () => {
    const parsed = ImportJobStatusSchema.parse({
      jobId: 'job',
      state: 'failed',
      progress: { done: 2, total: 16 },
      result: null,
      failedReason: 'that profile is private',
      errorKind: 'private',
    });
    expect(parsed.errorKind).toBe('private');
    expect(importJobPhase(parsed.state)).toBe('failed');

    const weird = ImportJobStatusSchema.parse({ jobId: 'job', state: 'reaped' });
    expect(weird.state).toBe('unknown');
    expect(isImportJobTerminal(weird.state)).toBe(true);
  });

  it('drops a result whose shape is not the pipeline’s', () => {
    const parsed = ImportJobStatusSchema.parse({
      jobId: 'job',
      state: 'completed',
      result: { error: 'something else entirely' },
    });
    expect(parsed.result).toBeNull();
  });

  it('rejects a body that is not a job, such as the 404', () => {
    expect(ImportJobStatusSchema.safeParse({ error: 'import job not found' }).success).toBe(false);
  });
});

describe('latestRunPerSource', () => {
  const run = (source: string, createdAt: string, state = 'completed') =>
    ImportRunSchema.parse({ id: `${source}-${createdAt}`, source, profile: 'p', state, createdAt });

  it('keeps the newest run of each source, newest first', () => {
    const runs = [
      run('netflix', '2026-11-01T10:00:00Z'),
      run('mal', '2026-11-20T10:00:00Z'),
      run('netflix', '2026-11-28T10:00:00Z', 'running'),
    ];
    expect(latestRunPerSource(runs).map((entry) => entry.id)).toEqual([
      'netflix-2026-11-28T10:00:00Z',
      'mal-2026-11-20T10:00:00Z',
    ]);
  });
});

describe('ImportMatchSchema', () => {
  it('reads a match from an instance that served no candidate details', () => {
    const match = ImportMatchSchema.parse({
      id: 'm1',
      source: 'netflix',
      externalId: 'shaft',
      kind: 'movie',
      title: 'Shaft',
      status: 'completed',
      outcome: 'tie',
      bestScore: 1,
      candidates: [{ id: 'a', title: 'Shaft', year: 2019, score: 1 }],
      createdAt: '2026-11-28T10:00:00Z',
    });
    expect(match.progress).toBe(0);
    expect(match.candidates[0]).toMatchObject({ kind: null, coverUrl: null, inLog: false });
  });
});
