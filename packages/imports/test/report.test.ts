import { describe, expect, it } from 'vitest';
import { buildPlanReport, planReportCsv } from '../src/report.js';
import { buildImportPlan } from '../src/plan.js';
import type { ImportEntry } from '../src/types.js';
import type { ImportTarget } from '../src/resolve.js';

/**
 * A run's unmatched rows exist nowhere but its report: nothing is written for
 * them, and the console stops at thirty. These are the two properties that
 * matter — every row survives, and a CSV cell cannot break the columns.
 */

const NOW = new Date('2026-10-30T12:00:00Z');

function entry(overrides: Partial<ImportEntry> = {}): ImportEntry {
  return {
    source: 'letterboxd',
    kind: 'movie',
    externalId: 'solaris-1972',
    title: 'Solaris',
    year: 1972,
    seasonNumber: null,
    status: 'completed',
    score: 9,
    progress: 0,
    repeats: 1,
    startedAt: '2026-01-02',
    finishedAt: '2026-01-02',
    notes: null,
    favourite: false,
    externalIds: {},
    ...overrides,
  };
}

const target: ImportTarget = {
  id: '00000000-0000-0000-0000-000000000001',
  kind: 'movie',
  title: 'Solaris',
  partCount: null,
  seasonNumber: null,
  matchedBy: 'title',
};

function plan() {
  return buildImportPlan({
    source: 'letterboxd',
    profile: 'someone',
    entries: [
      entry(),
      entry({ externalId: 'a-film, "quoted"', title: 'A Film, "Quoted"', year: 2001 }),
    ],
    targets: new Map([['letterboxd:movie:solaris-1972', target]]),
    loggedMediaIds: new Set(),
  });
}

describe('plan report', () => {
  it('keeps every row, matched or not', () => {
    const report = buildPlanReport(plan(), { now: NOW, applied: false });
    expect(report.rows).toHaveLength(2);
    expect(report.summary.unmatched).toBe(1);
    expect(report.rows[0]).toMatchObject({
      matched: true,
      matchedBy: 'title',
      mediaTitle: 'Solaris',
    });
    expect(report.rows[1]).toMatchObject({ matched: false, matchedBy: null, mediaTitle: null });
    expect(report).toMatchObject({ source: 'letterboxd', profile: 'someone', applied: false });
  });

  it('writes a CSV whose commas and quotes stay inside their cell', () => {
    const csv = planReportCsv(buildPlanReport(plan(), { now: NOW }));
    const [header, first, second] = csv.trimEnd().split('\n');
    expect(header).toContain('external_id,title,year,kind,status');
    expect(first).toContain('solaris-1972,Solaris,1972,movie,completed,9');
    expect(second).toContain('"a-film, ""quoted"""');
    // One line per row whatever the title contains.
    expect(csv.trimEnd().split('\n')).toHaveLength(3);
  });
});
