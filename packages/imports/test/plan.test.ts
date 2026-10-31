import { describe, expect, it } from 'vitest';
import { buildImportPlan } from '../src/plan.js';
import { entryKey, type ImportTarget } from '../src/resolve.js';
import { warning, type ImportEntry } from '../src/types.js';

const bebop: ImportTarget = {
  id: '00000000-0000-0000-0000-00000000beb0',
  kind: 'anime',
  title: 'Cowboy Bebop',
  partCount: 26,
  seasonNumber: 1,
  matchedBy: 'external-id',
};
const berserk: ImportTarget = {
  id: '00000000-0000-0000-0000-00000000be15',
  kind: 'manga',
  title: 'Berserk',
  partCount: null,
  seasonNumber: null,
  matchedBy: 'external-id',
};

function entry(overrides: Partial<ImportEntry> = {}): ImportEntry {
  return {
    source: 'mal',
    kind: 'anime',
    externalId: '1',
    title: 'Cowboy Bebop',
    year: null,
    seasonNumber: null,
    status: 'in_progress',
    score: null,
    progress: 12,
    repeats: 0,
    startedAt: null,
    finishedAt: null,
    notes: null,
    favourite: false,
    externalIds: { mal: 1 },
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
    const found = entry();
    const missing = entry({ externalId: '999999', title: 'Lost Media' });
    const result = plan([found, missing], [[entryKey(found), bebop]]);
    expect(result.summary).toMatchObject({ total: 2, matched: 1, unmatched: 1, pending: 1 });
    expect(result.rows[1]?.target).toBeNull();
    expect(result.rows[1]?.matchedBy).toBeNull();
  });

  it('records how the entry found its row', () => {
    const found = entry();
    const byTitle = entry({
      externalId: '2',
      title: 'Bebop',
      year: 1998,
      externalIds: { anilist: 2 },
    });
    const result = plan(
      [found, byTitle],
      [
        [entryKey(found), bebop],
        [entryKey(byTitle), { ...bebop, matchedBy: 'title' }],
      ],
    );
    expect(result.rows.map((row) => row.matchedBy)).toEqual(['external-id', 'title']);
    expect(result.summary.matched).toBe(2);
  });

  it('does not treat an already-logged work as pending', () => {
    const found = entry();
    const result = plan([found], [[entryKey(found), bebop]], [bebop.id]);
    expect(result.summary).toMatchObject({ matched: 1, existing: 1, pending: 0 });
  });

  it('keeps a per-season key apart from the show-wide one', () => {
    const seasonOne = entry({ kind: 'series', externalId: '1396', seasonNumber: 1 });
    const seasonTwo = entry({ kind: 'series', externalId: '1396', seasonNumber: 2 });
    const result = plan(
      [seasonOne, seasonTwo],
      [[entryKey(seasonOne), { ...bebop, kind: 'series', seasonNumber: 1 }]],
    );
    expect(result.rows[0]?.target).not.toBeNull();
    expect(result.rows[0]?.target?.seasonNumber).toBe(1);
    expect(result.rows[1]?.target).toBeNull();
  });

  it('writes the catalog total for a completed work, not the provider count', () => {
    const found = entry({ status: 'completed', progress: 25 });
    const result = plan([found], [[entryKey(found), bebop]]);
    expect(result.rows[0]?.upTo).toBe(26);
    expect(result.rows[0]?.warnings).toEqual([]);
  });

  it('clamps progress above the catalog total and says so', () => {
    const found = entry({ progress: 40 });
    const result = plan([found], [[entryKey(found), bebop]]);
    expect(result.rows[0]?.upTo).toBe(26);
    expect(result.warnings.map((w) => w.code)).toEqual(['progress-clamped']);
  });

  it('keeps the provider count for a work with no stated total', () => {
    const found = entry({ kind: 'manga', externalId: '2', title: 'Berserk', progress: 380 });
    const result = plan([found], [[entryKey(found), berserk]]);
    expect(result.rows[0]?.upTo).toBe(380);
  });

  it('writes no progress for a planned work', () => {
    const found = entry({ status: 'planned', progress: 3 });
    const result = plan([found], [[entryKey(found), bebop]]);
    expect(result.rows[0]?.upTo).toBe(0);
  });

  it('keeps mapper warnings attached to their row and in the total', () => {
    const found = entry();
    const result = buildImportPlan({
      source: 'mal',
      profile: 'Kyoma__',
      entries: [found],
      targets: new Map([[entryKey(found), bebop]]),
      loggedMediaIds: new Set(),
      entryWarnings: new Map([
        [entryKey(found), [warning('partial-date', { externalId: '1', title: 'x' }, 'partial')]],
      ]),
    });
    expect(result.rows[0]?.warnings).toHaveLength(1);
    expect(result.summary.warnings).toBe(1);
  });

  it('counts a row warning once in the plan total', () => {
    const found = entry({ progress: 40 });
    const result = plan([found], [[entryKey(found), bebop]]);
    expect(result.rows[0]?.warnings).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });
});
