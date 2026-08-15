import { describe, expect, it } from 'vitest';
import type { UpNextEntry } from '@trackt/shared';
import { upNextPartKey } from '../../src/lib/home';
import { firstUnwatched, stampedDates } from '../../src/lib/media';

describe('firstUnwatched', () => {
  it('offers part 1 when nothing is watched', () => {
    expect(firstUnwatched(new Set(), 12)).toBe(1);
  });

  it('offers the first gap, not the highest watched plus one', () => {
    expect(firstUnwatched(new Set([1, 2, 4, 5]), 12)).toBe(3);
  });

  it('stops at the known part count so it never offers E13 of 12', () => {
    // The server rejects a check-in past the count; the button must not offer it.
    expect(firstUnwatched(new Set([1, 2, 3]), 3)).toBeNull();
  });

  it('may extend one past the highest watched part when the total is unknown', () => {
    // The media page passes `listLength + 1` in that case.
    expect(firstUnwatched(new Set([1, 2, 3]), 4)).toBe(4);
  });

  it('handles an empty range', () => {
    expect(firstUnwatched(new Set(), 0)).toBeNull();
  });
});

describe('upNextPartKey', () => {
  const entry = (id: string, next: number) =>
    ({
      id,
      slug: 'neon-harbor',
      kind: 'series',
      title: 'Neon Harbor',
      coverUrl: null,
      next,
      total: 24,
      partKind: 'episode',
    }) as UpNextEntry;

  it('changes once the same title advances to its next part', () => {
    // The regression this exists for: keyed on the id alone, the card stayed
    // marked done after the summary refetched and could never be tapped again.
    expect(upNextPartKey(entry('m1', 18))).not.toBe(upNextPartKey(entry('m1', 19)));
  });

  it('separates two titles sitting on the same part number', () => {
    expect(upNextPartKey(entry('m1', 3))).not.toBe(upNextPartKey(entry('m2', 3)));
  });

  it('is stable for the same title and part', () => {
    expect(upNextPartKey(entry('m1', 18))).toBe(upNextPartKey(entry('m1', 18)));
  });
});

/**
 * The client mirror of the server's date rules (ADR-0007). It feeds the
 * optimistic patch, so a divergence shows as a value that flickers to something
 * else the moment the invalidation lands.
 */
describe('stampedDates', () => {
  const TODAY = '2026-08-15';
  const none = { startedAt: null, finishedAt: null };

  it('starts an untouched log on today', () => {
    expect(stampedDates('in_progress', none, TODAY)).toEqual({
      startedAt: TODAY,
      finishedAt: null,
    });
  });

  it('never overwrites a start date that is already there', () => {
    const existing = { startedAt: '2026-01-04', finishedAt: null };
    expect(stampedDates('completed', existing, TODAY)).toEqual({
      startedAt: '2026-01-04',
      finishedAt: TODAY,
    });
  });

  it('clears the finish date when a completed log re-opens', () => {
    const done = { startedAt: '2026-01-04', finishedAt: '2026-02-11' };
    expect(stampedDates('in_progress', done, TODAY)).toEqual({
      startedAt: '2026-01-04',
      finishedAt: null,
    });
  });

  it('leaves the finish date alone for paused and dropped', () => {
    const done = { startedAt: '2026-01-04', finishedAt: '2026-02-11' };
    for (const status of ['paused', 'dropped'] as const) {
      expect(stampedDates(status, done, TODAY)).toEqual(done);
    }
  });

  it('stamps a start date for dropped, but never a finish one', () => {
    expect(stampedDates('dropped', none, TODAY)).toEqual({ startedAt: TODAY, finishedAt: null });
  });

  it('clears both for planned and for a removed log', () => {
    const done = { startedAt: '2026-01-04', finishedAt: '2026-02-11' };
    expect(stampedDates('planned', done, TODAY)).toEqual(none);
    expect(stampedDates(null, done, TODAY)).toEqual(none);
  });
});
