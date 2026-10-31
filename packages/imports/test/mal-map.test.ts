import { describe, expect, it } from 'vitest';
import { mapMalEntry } from '../src/mal/map.js';
import type { MalListEntry } from '../src/mal/schemas.js';

const NOW = new Date('2026-10-30T12:00:00Z');

function raw(overrides: Partial<MalListEntry['list_status']> = {}): MalListEntry {
  return {
    node: { id: 1, title: 'Cowboy Bebop' },
    list_status: {
      status: 'watching',
      score: 0,
      num_episodes_watched: 12,
      start_date: '2019-04-01',
      finish_date: null,
      comments: null,
      num_times_rewatched: 0,
      ...overrides,
    },
  };
}

describe('mapMalEntry (anime)', () => {
  it('maps a watching entry onto the log vocabulary', () => {
    const { entry, warnings } = mapMalEntry('anime', raw(), { now: NOW });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'mal',
      kind: 'anime',
      externalId: 1,
      title: 'Cowboy Bebop',
      status: 'in_progress',
      score: null,
      progress: 12,
      startedAt: '2019-04-01',
      finishedAt: null,
      notes: null,
    });
  });

  it('treats MAL score 0 as unscored rather than a zero rating', () => {
    expect(mapMalEntry('anime', raw({ score: 0 }), { now: NOW }).entry?.score).toBeNull();
    expect(mapMalEntry('anime', raw({ score: 8 }), { now: NOW }).entry?.score).toBe(8);
  });

  it('drops a score outside 0–10 with a warning', () => {
    const { entry, warnings } = mapMalEntry('anime', raw({ score: 12 }), { now: NOW });
    expect(entry?.score).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['score-invalid']);
  });

  it('skips a row whose status it cannot read, instead of guessing a bucket', () => {
    const { entry, warnings } = mapMalEntry('anime', raw({ status: 'rewatching' }), { now: NOW });
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('unknown-status');
  });

  it('never invents a day for a partial date', () => {
    const { entry, warnings } = mapMalEntry('anime', raw({ start_date: '2019-04' }), { now: NOW });
    expect(entry?.startedAt).toBeNull();
    expect(warnings.map((w) => w.code)).toContain('partial-date');
  });

  it('drops future dates', () => {
    const { entry, warnings } = mapMalEntry(
      'anime',
      raw({ start_date: '2027-01-01', finish_date: '2027-02-01' }),
      { now: NOW },
    );
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.filter((w) => w.code === 'future-date')).toHaveLength(2);
  });

  it('drops a finish date that precedes the start', () => {
    const { entry, warnings } = mapMalEntry(
      'anime',
      raw({ start_date: '2019-04-01', finish_date: '2019-03-01' }),
      { now: NOW },
    );
    expect(entry?.startedAt).toBe('2019-04-01');
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.map((w) => w.code)).toContain('finish-before-start');
  });

  it('carries rewatch counts and comments', () => {
    const { entry } = mapMalEntry(
      'anime',
      raw({ num_times_rewatched: 2, comments: '  the movie was better  ' }),
      { now: NOW },
    );
    expect(entry?.repeats).toBe(2);
    expect(entry?.notes).toBe('the movie was better');
  });

  it('ignores a score of 0 on a plan-to-watch row', () => {
    const { entry } = mapMalEntry('anime', raw({ status: 'plan_to_watch', score: 0 }), {
      now: NOW,
    });
    expect(entry).toMatchObject({ status: 'planned', score: null });
  });
});

describe('mapMalEntry (manga)', () => {
  function manga(overrides: Partial<MalListEntry['list_status']> = {}): MalListEntry {
    return {
      node: { id: 25, title: 'Fullmetal Alchemist' },
      list_status: {
        status: 'reading',
        num_chapters_read: 10,
        num_volumes_read: 1,
        ...overrides,
      },
    };
  }

  it('reads chapters, not volumes, as progress', () => {
    const { entry } = mapMalEntry('manga', manga(), { now: NOW });
    expect(entry).toMatchObject({ kind: 'manga', status: 'in_progress', progress: 10 });
  });

  it('flags volume-only tracking instead of fabricating chapters', () => {
    const { entry, warnings } = mapMalEntry(
      'manga',
      manga({ num_chapters_read: 0, num_volumes_read: 3 }),
      { now: NOW },
    );
    expect(entry?.progress).toBe(0);
    expect(warnings.map((w) => w.code)).toEqual(['volume-only-progress']);
  });

  it('maps plan_to_read onto planned', () => {
    const { entry } = mapMalEntry('manga', manga({ status: 'plan_to_read' }), { now: NOW });
    expect(entry?.status).toBe('planned');
  });
});
