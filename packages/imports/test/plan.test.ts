import { describe, expect, it } from 'vitest';
import { buildImportPlan } from '../src/plan.js';
import { importKey, type ImportTarget } from '../src/resolve.js';
import { warning, type ImportEntry } from '../src/types.js';

const bebop: ImportTarget = {
  id: '00000000-0000-0000-0000-00000000beb0',
  kind: 'anime',
  title: 'Cowboy Bebop',
  partCount: 26,
};
const berserk: ImportTarget = {
  id: '00000000-0000-0000-0000-00000000be15',
  kind: 'manga',
  title: 'Berserk',
  partCount: null,
};

function entry(overrides: Partial<ImportEntry> = {}): ImportEntry {
  return {
    source: 'mal',
    kind: 'anime',
    externalId: 1,
    title: 'Cowboy Bebop',
    status: 'in_progress',
    score: null,
    progress: 12,
    repeats: 0,
    startedAt: null,
    finishedAt: null,
    notes: null,
    ...overrides,
  };
}

function plan(entries: ImportEntry[], targets: [string, ImportTarget][], logged: string[] = []) {
  return buildImportPlan({
    source: 'mal',
    profile: 'Kyoma__',
    entries,
    targets: new Map(targets),
    loggedMediaIds: new Set(logged),
  });
}

describe('buildImportPlan', () => {
  it('counts what it can and cannot map onto the instance', () => {
    const result = plan(
      [entry(), entry({ externalId: 999_999, title: 'Lost Media' })],
      [[importKey('anime', 1), bebop]],
    );
    expect(result.summary).toMatchObject({ total: 2, matched: 1, unmatched: 1, pending: 1 });
    expect(result.rows[1]?.target).toBeNull();
  });

  it('does not treat an already-logged work as pending', () => {
    const result = plan([entry()], [[importKey('anime', 1), bebop]], [bebop.id]);
    expect(result.summary).toMatchObject({ matched: 1, existing: 1, pending: 0 });
  });

  it('writes the catalog total for a completed work, not the provider count', () => {
    const result = plan(
      [entry({ status: 'completed', progress: 25 })],
      [[importKey('anime', 1), bebop]],
    );
    expect(result.rows[0]?.upTo).toBe(26);
    expect(result.rows[0]?.warnings).toEqual([]);
  });

  it('clamps progress above the catalog total and says so', () => {
    const result = plan([entry({ progress: 40 })], [[importKey('anime', 1), bebop]]);
    expect(result.rows[0]?.upTo).toBe(26);
    expect(result.warnings.map((w) => w.code)).toEqual(['progress-clamped']);
  });

  it('keeps the provider count for a work with no stated total', () => {
    const result = plan(
      [entry({ kind: 'manga', externalId: 2, title: 'Berserk', progress: 380 })],
      [[importKey('manga', 2), berserk]],
    );
    expect(result.rows[0]?.upTo).toBe(380);
  });

  it('writes no progress for a planned work', () => {
    const result = plan(
      [entry({ status: 'planned', progress: 3 })],
      [[importKey('anime', 1), bebop]],
    );
    expect(result.rows[0]?.upTo).toBe(0);
  });

  it('keeps mapper warnings attached to their row and in the total', () => {
    const result = buildImportPlan({
      source: 'mal',
      profile: 'Kyoma__',
      entries: [entry()],
      targets: new Map([[importKey('anime', 1), bebop]]),
      loggedMediaIds: new Set(),
      entryWarnings: new Map([
        [
          importKey('anime', 1),
          [warning('partial-date', { externalId: 1, title: 'Cowboy Bebop' }, 'partial')],
        ],
      ]),
    });
    expect(result.rows[0]?.warnings).toHaveLength(1);
    expect(result.summary.warnings).toBe(1);
  });

  it('counts a row warning once in the plan total', () => {
    const result = plan([entry({ progress: 40 })], [[importKey('anime', 1), bebop]]);
    expect(result.rows[0]?.warnings).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});
