import { describe, expect, it } from 'vitest';
import { mapMalEntry } from '../src/mal/map.js';
import type { MalListRow } from '../src/mal/schemas.js';

const NOW = new Date('2026-10-30T12:00:00Z');

function row(overrides: Partial<MalListRow> = {}): MalListRow {
  return {
    kind: 'anime',
    externalId: '1',
    title: 'Cowboy Bebop',
    status: 1,
    score: 0,
    progress: 12,
    volumesRead: 0,
    repeating: false,
    notes: null,
    startedOn: null,
    finishedOn: null,
    releasedOn: '03-04-98',
    ...overrides,
  };
}

describe('mapMalEntry (anime)', () => {
  it('maps a watching row onto the log vocabulary, year and all', () => {
    const { entry, warnings } = mapMalEntry(row({ startedOn: '01-04-19', notes: '  rewatch  ' }), {
      now: NOW,
    });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'mal',
      kind: 'anime',
      externalId: '1',
      title: 'Cowboy Bebop',
      // The work's own start date, not the viewer's.
      year: 1998,
      seasonNumber: null,
      status: 'in_progress',
      score: null,
      progress: 12,
      startedAt: '2019-04-01',
      finishedAt: null,
      notes: 'rewatch',
      favourite: false,
      externalIds: { mal: 1 },
    });
  });

  it('turns MAL’s DD-MM-YY into a log day', () => {
    const dates = mapMalEntry(row({ startedOn: '05-04-18', finishedOn: '17-04-18' }), {
      now: NOW,
    }).entry;
    expect(dates?.startedAt).toBe('2018-04-05');
    expect(dates?.finishedAt).toBe('2018-04-17');
  });

  it('reads a last-century date as last century, not as 20xx', () => {
    const { entry } = mapMalEntry(row({ startedOn: '31-12-99', releasedOn: '03-04-98' }), {
      now: NOW,
    });
    expect(entry?.startedAt).toBe('1999-12-31');
    expect(entry?.year).toBe(1998);
  });

  it('treats MAL score 0 as unscored rather than a zero rating', () => {
    expect(mapMalEntry(row({ score: 0 }), { now: NOW }).entry?.score).toBeNull();
    expect(mapMalEntry(row({ score: 8 }), { now: NOW }).entry?.score).toBe(8);
  });

  it('drops a score outside 0–10 with a warning', () => {
    const { entry, warnings } = mapMalEntry(row({ score: 12 }), { now: NOW });
    expect(entry?.score).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['score-invalid']);
  });

  it('skips a row whose status it cannot read, instead of guessing a bucket', () => {
    const { entry, warnings } = mapMalEntry(row({ status: 5 }), { now: NOW });
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('unknown-status');
  });

  it('never invents a day for a date it cannot read', () => {
    const { entry, warnings } = mapMalEntry(row({ startedOn: '2019-04-01' }), { now: NOW });
    expect(entry?.startedAt).toBeNull();
    expect(warnings.map((w) => w.code)).toContain('partial-date');
  });

  it('drops future dates', () => {
    const { entry, warnings } = mapMalEntry(
      row({ startedOn: '01-01-30', finishedOn: '01-02-30' }),
      { now: NOW },
    );
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.filter((w) => w.code === 'future-date')).toHaveLength(2);
  });

  it('drops a finish date that precedes the start', () => {
    const { entry, warnings } = mapMalEntry(
      row({ startedOn: '01-04-19', finishedOn: '01-03-19' }),
      { now: NOW },
    );
    expect(entry?.startedAt).toBe('2019-04-01');
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.map((w) => w.code)).toContain('finish-before-start');
  });

  it('reads the rewatching flag as one completed run', () => {
    expect(mapMalEntry(row({ repeating: true }), { now: NOW }).entry?.repeats).toBe(1);
    expect(mapMalEntry(row({ repeating: false }), { now: NOW }).entry?.repeats).toBe(0);
  });

  it('ignores a score of 0 on a plan-to-watch row', () => {
    const { entry } = mapMalEntry(row({ status: 6, score: 0 }), { now: NOW });
    expect(entry).toMatchObject({ status: 'planned', score: null });
  });

  it('carries the profile’s favourite flag', () => {
    expect(mapMalEntry(row(), { now: NOW, favourite: true }).entry?.favourite).toBe(true);
  });

  it('states no year when the work’s start date is missing or unreadable', () => {
    expect(mapMalEntry(row({ releasedOn: null }), { now: NOW }).entry?.year).toBeNull();
    expect(mapMalEntry(row({ releasedOn: '21-03-2003' }), { now: NOW }).entry?.year).toBeNull();
  });
});

describe('mapMalEntry (manga)', () => {
  function manga(overrides: Partial<MalListRow> = {}): MalListRow {
    return row({
      kind: 'manga',
      externalId: '25',
      title: 'Fullmetal Alchemist',
      status: 1,
      progress: 10,
      volumesRead: 1,
      releasedOn: '06-07-01',
      ...overrides,
    });
  }

  it('reads chapters, not volumes, as progress', () => {
    const { entry } = mapMalEntry(manga(), { now: NOW });
    expect(entry).toMatchObject({ kind: 'manga', status: 'in_progress', progress: 10, year: 2001 });
  });

  it('flags volume-only tracking instead of fabricating chapters', () => {
    const { entry, warnings } = mapMalEntry(manga({ progress: 0, volumesRead: 3 }), {
      now: NOW,
    });
    expect(entry?.progress).toBe(0);
    expect(warnings.map((w) => w.code)).toEqual(['volume-only-progress']);
  });

  it('maps the plan-to-read status onto planned', () => {
    expect(mapMalEntry(manga({ status: 6 }), { now: NOW }).entry?.status).toBe('planned');
  });
});
