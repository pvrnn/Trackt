import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@trackt/shared';
import { layoutTimeline } from '../src/timeline.js';

function entry(patch: Partial<HistoryEntry> & { id: string }): HistoryEntry {
  return {
    slug: patch.id,
    kind: 'series',
    title: patch.id,
    coverUrl: null,
    status: 'completed',
    startedAt: null,
    finishedAt: null,
    loggedOn: patch.finishedAt ?? patch.startedAt ?? '2026-01-01',
    score: null,
    watched: 0,
    total: null,
    sessions: [],
    ...patch,
  };
}

const options = {
  today: '2026-03-31',
  pxPerDay: 2,
  padStart: 10,
  padEnd: 50,
  labelWidth: () => 20,
};

describe('layoutTimeline', () => {
  it('starts the axis on the first of the earliest month', () => {
    const layout = layoutTimeline(
      [entry({ id: 'a', startedAt: '2026-01-15', finishedAt: '2026-01-20' })],
      options,
    );
    expect(layout.ticks.map((tick) => tick.month)).toEqual([0, 1, 2]);
    expect(layout.ticks[0]!.x).toBe(10);
    // 14 days into January, at 2px a day.
    expect(layout.items[0]!.x).toBe(10 + 14 * 2);
  });

  it('packs into the first lane with room, otherwise opens a new one', () => {
    const layout = layoutTimeline(
      [
        entry({ id: 'a', startedAt: '2026-01-01', finishedAt: '2026-01-31' }),
        entry({ id: 'b', startedAt: '2026-01-10', finishedAt: '2026-01-12' }),
        entry({ id: 'c', startedAt: '2026-03-01', finishedAt: '2026-03-05' }),
      ],
      options,
    );
    const lanes = Object.fromEntries(layout.items.map((item) => [item.entry.id, item.lane]));
    expect(lanes).toEqual({ a: 0, b: 1, c: 0 });
    expect(layout.lanes).toBe(2);
  });

  it('gives titles still going the lanes nearest the arrow, latest start first', () => {
    const layout = layoutTimeline(
      [
        entry({ id: 'early', status: 'in_progress', startedAt: '2026-02-01' }),
        entry({ id: 'late', status: 'in_progress', startedAt: '2026-03-01' }),
        entry({ id: 'done', startedAt: '2026-01-01', finishedAt: '2026-01-05' }),
      ],
      options,
    );
    const lanes = Object.fromEntries(layout.items.map((item) => [item.entry.id, item.lane]));
    expect(lanes).toEqual({ late: 0, early: 1, done: 0 });
    expect(layout.items.map((item) => item.entry.id)).toEqual(['done', 'early', 'late']);
  });

  it('fills the gaps before an ongoing bar, keeping the gap on both sides', () => {
    const layout = layoutTimeline(
      [
        entry({ id: 'open', status: 'in_progress', startedAt: '2026-03-01' }),
        // x 10–30, then 48–68: 18px clear of each other and of `open` at 128.
        entry({ id: 'a', startedAt: '2026-01-01', finishedAt: '2026-01-05' }),
        entry({ id: 'b', startedAt: '2026-01-20', finishedAt: '2026-01-25' }),
        // x 110–130 runs into `open`.
        entry({ id: 'c', startedAt: '2026-02-20', finishedAt: '2026-02-22' }),
      ],
      options,
    );
    const lanes = Object.fromEntries(layout.items.map((item) => [item.entry.id, item.lane]));
    expect(lanes).toEqual({ open: 0, a: 0, b: 0, c: 1 });
    expect(layout.lanes).toBe(2);
  });

  it('runs an in-progress title to today, and a single sitting is a point', () => {
    const layout = layoutTimeline(
      [
        entry({ id: 'open', status: 'in_progress', startedAt: '2026-03-01' }),
        entry({ id: 'film', kind: 'movie', startedAt: '2026-02-02', finishedAt: '2026-02-02' }),
      ],
      options,
    );
    const open = layout.items.find((item) => item.entry.id === 'open')!;
    expect(open).toMatchObject({ ongoing: true, single: false, end: '2026-03-31', days: 31 });
    const film = layout.items.find((item) => item.entry.id === 'film')!;
    expect(film).toMatchObject({ single: true, segments: [] });
  });

  it('ends a dropped title without a finish at its last check-in', () => {
    const [item] = layoutTimeline(
      [
        entry({
          id: 'd',
          status: 'dropped',
          startedAt: '2026-01-01',
          sessions: [{ from: '2026-01-01', to: '2026-01-04' }],
        }),
      ],
      options,
    ).items;
    expect(item).toMatchObject({ ongoing: false, end: '2026-01-04', days: 4 });
  });

  it('clips sessions to the dated span, and fills the span when none remain', () => {
    const [clipped, filled] = layoutTimeline(
      [
        entry({
          id: 'a',
          startedAt: '2026-01-01',
          finishedAt: '2026-01-10',
          sessions: [
            { from: '2026-01-01', to: '2026-01-02' },
            { from: '2026-03-01', to: '2026-03-01' },
          ],
        }),
        entry({
          id: 'b',
          startedAt: '2026-02-01',
          finishedAt: '2026-02-05',
          sessions: [{ from: '2026-03-20', to: '2026-03-20' }],
        }),
      ],
      options,
    ).items;
    expect(clipped!.segments).toEqual([{ x: 0, width: 4 }]);
    expect(filled!.segments).toEqual([{ x: 0, width: 10 }]);
  });

  it('places a year jump on 1 January', () => {
    const layout = layoutTimeline(
      [entry({ id: 'a', startedAt: '2025-11-01', finishedAt: '2025-11-02' })],
      options,
    );
    expect(layout.xOfYear(2026)).toBe(10 + 61 * 2);
    expect(layout.years.map((year) => year.year)).toEqual([2025, 2026]);
  });
});
