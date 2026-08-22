import { describe, expect, it } from 'vitest';
import { LOG_DATE_FLOOR, type UpNextEntry } from '@trackt/shared';
import { upNextPartKey } from '../src/home.js';
import {
  PART_BLOCK_SIZE,
  PROGRESS_SLIDER_MIN_PARTS,
  firstUnwatched,
  partBlocks,
  partWindow,
  partsUpTo,
  progressUpTo,
  stampedDates,
  usesProgressSlider,
  validateLogDates,
} from '../src/media.js';

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

describe('progressUpTo', () => {
  it('is zero when nothing is watched', () => {
    expect(progressUpTo(new Set())).toBe(0);
  });

  it('counts the unbroken run from part 1', () => {
    expect(progressUpTo(new Set([1, 2, 3]))).toBe(3);
  });

  it('stops at the first gap rather than counting what is ticked', () => {
    // The distinction the slider exists for: three parts seen, position two —
    // showing three would claim part 3 had been watched.
    expect(progressUpTo(new Set([1, 2, 9]))).toBe(2);
  });

  it('is zero when part 1 is missing, however much else is ticked', () => {
    expect(progressUpTo(new Set([2, 3, 4]))).toBe(0);
  });
});

describe('partsUpTo', () => {
  it('is the 1-based range a position implies', () => {
    expect(partsUpTo(4)).toEqual([1, 2, 3, 4]);
  });

  it('is empty at zero — and at a negative, which no caller should send', () => {
    expect(partsUpTo(0)).toEqual([]);
    expect(partsUpTo(-3)).toEqual([]);
  });
});

describe('partBlocks', () => {
  it('leaves a season alone — 26 rows is a list, not a wall', () => {
    expect(partBlocks(26, 4)).toEqual([]);
    expect(partBlocks(PART_BLOCK_SIZE, 0)).toEqual([]);
  });

  it('chops a long work into blocks of 40, the last one short', () => {
    const blocks = partBlocks(312, 112);
    expect(blocks).toHaveLength(8);
    expect(blocks[0]).toMatchObject({ index: 1, from: 1, to: 40, size: 40 });
    expect(blocks[7]).toMatchObject({ index: 8, from: 281, to: 312, size: 32 });
  });

  it('folds the position into each block: done, complete, partial', () => {
    const blocks = partBlocks(312, 112);
    // 112 read: volumes 1-2 finished, volume 3 part-way, the rest untouched.
    expect(blocks[1]).toMatchObject({ done: 40, complete: true, partial: false });
    expect(blocks[2]).toMatchObject({ done: 32, complete: false, partial: true });
    expect(blocks[3]).toMatchObject({ done: 0, complete: false, partial: false });
  });

  it('is all-empty at position zero and all-complete at the end', () => {
    expect(partBlocks(312, 0).every((block) => block.done === 0)).toBe(true);
    expect(partBlocks(312, 312).every((block) => block.complete)).toBe(true);
  });
});

describe('partWindow', () => {
  it('puts two behind the position and three ahead', () => {
    expect(partWindow(81, 120, 112)).toEqual([110, 111, 112, 113, 114, 115]);
  });

  it('starts at the block when the position is outside it', () => {
    expect(partWindow(121, 160, 112)).toEqual([121, 122, 123, 124, 125, 126]);
  });

  it('does not run past the end of a short last block', () => {
    expect(partWindow(281, 312, 311)).toEqual([309, 310, 311, 312]);
  });

  it('clamps to the block start rather than showing parts before it', () => {
    expect(partWindow(1, 40, 1)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('usesProgressSlider', () => {
  it('leaves a two-cour season on the checklist', () => {
    expect(usesProgressSlider(24)).toBe(false);
  });

  it('takes over at the threshold and above', () => {
    expect(usesProgressSlider(PROGRESS_SLIDER_MIN_PARTS)).toBe(true);
    expect(usesProgressSlider(900)).toBe(true);
  });

  it('says no when the count is unknown — an airing season has no scale to drag', () => {
    expect(usesProgressSlider(null)).toBe(false);
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

/**
 * The log-date form's checks, shared because both clients now have one: web's
 * two typed `YYYY-MM-DD` fields and the app's native pickers can produce
 * different mistakes, and neither may accept what the other rejects.
 */
describe('validateLogDates', () => {
  const TODAY = '2026-08-15';

  it('accepts a sound pair, a half-open log, and no dates at all', () => {
    expect(
      validateLogDates({ startedAt: '2026-01-04', finishedAt: '2026-02-11' }, TODAY),
    ).toBeNull();
    expect(validateLogDates({ startedAt: '2026-01-04', finishedAt: null }, TODAY)).toBeNull();
    expect(validateLogDates({ startedAt: null, finishedAt: null }, TODAY)).toBeNull();
  });

  it('accepts the boundaries themselves — today, and the floor', () => {
    expect(validateLogDates({ startedAt: TODAY, finishedAt: TODAY }, TODAY)).toBeNull();
    expect(validateLogDates({ startedAt: LOG_DATE_FLOOR, finishedAt: null }, TODAY)).toBeNull();
  });

  it('rejects a date in the future, on either field', () => {
    expect(validateLogDates({ startedAt: '2026-08-16', finishedAt: null }, TODAY)).toMatch(
      /future/,
    );
    expect(validateLogDates({ startedAt: null, finishedAt: '2027-01-01' }, TODAY)).toMatch(
      /future/,
    );
  });

  it('rejects a year below the floor — the two-digit-year typo', () => {
    expect(validateLogDates({ startedAt: '0026-01-04', finishedAt: null }, TODAY)).toMatch(
      /1900-01-01/,
    );
  });

  it('rejects a finish date before its start', () => {
    expect(validateLogDates({ startedAt: '2026-02-11', finishedAt: '2026-01-04' }, TODAY)).toMatch(
      /before/,
    );
  });
});
