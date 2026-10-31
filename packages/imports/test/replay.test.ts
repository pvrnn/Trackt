import { describe, expect, it } from 'vitest';
import { entryFromReportRow } from '../src/replay.js';
import type { PlanReportRow } from '../src/report.js';

/**
 * A report is what an import remembers, so replaying one must reconstruct the
 * entry it was made from — an instance that materializes a title later is how
 * most of these rows ever find a target.
 */

const row: PlanReportRow = {
  externalId: 'donkey-skin',
  title: 'Donkey Skin',
  year: 1970,
  seasonNumber: null,
  kind: 'movie',
  status: 'completed',
  score: 7,
  progress: 0,
  repeats: 1,
  startedAt: '2026-01-02',
  finishedAt: '2026-01-02',
  notes: 'never again',
  favourite: true,
  matched: false,
  matchedBy: null,
  mediaTitle: null,
  warnings: [{ code: 'partial-date', message: 'start date "1970" is not a full day' }],
};

describe('replaying a saved report', () => {
  it('rebuilds the entry, minus the ids it never had', () => {
    expect(entryFromReportRow(row, 'letterboxd')).toMatchObject({
      source: 'letterboxd',
      kind: 'movie',
      externalId: 'donkey-skin',
      title: 'Donkey Skin',
      year: 1970,
      status: 'completed',
      score: 7,
      repeats: 1,
      startedAt: '2026-01-02',
      notes: 'never again',
      externalIds: {},
    });
  });

  it('keeps a season row a season row', () => {
    expect(entryFromReportRow({ ...row, kind: 'series', seasonNumber: 2 }, 'trakt')).toMatchObject({
      kind: 'series',
      seasonNumber: 2,
    });
  });
});
