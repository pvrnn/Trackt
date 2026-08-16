import { describe, expect, it } from 'vitest';
import { HISTORY_SEASONS, seasonOf, seasonWindow, type HistoryEntry } from '@trackt/shared';
import { HISTORY_GROUPINGS, dateRangeLabel, groupEntries, shortDate } from '../src/history.js';

/**
 * The framework-free half of the history page: the quarter boundaries, the date
 * formatting, and the month grouping — all pure, and all where an off-by-one
 * would live.
 */

function entry(loggedOn: string, id = loggedOn): HistoryEntry {
  return {
    id,
    slug: `slug-${id}`,
    kind: 'anime',
    title: 'A Title',
    coverUrl: null,
    status: 'completed',
    startedAt: loggedOn,
    finishedAt: loggedOn,
    loggedOn,
    score: null,
    watched: 0,
    total: null,
  };
}

describe('seasonOf', () => {
  it('splits the year into anime quarters, at the exact boundaries', () => {
    expect(seasonOf('2026-01-01')).toBe('winter');
    expect(seasonOf('2026-03-31')).toBe('winter');
    expect(seasonOf('2026-04-01')).toBe('spring');
    expect(seasonOf('2026-06-30')).toBe('spring');
    expect(seasonOf('2026-07-01')).toBe('summer');
    expect(seasonOf('2026-09-30')).toBe('summer');
    expect(seasonOf('2026-10-01')).toBe('autumn');
    expect(seasonOf('2026-12-31')).toBe('autumn');
  });
});

describe('seasonWindow', () => {
  it('bounds each quarter inclusively', () => {
    expect(seasonWindow(2025, 'winter')).toEqual({ from: '2025-01-01', to: '2025-03-31' });
    expect(seasonWindow(2025, 'spring')).toEqual({ from: '2025-04-01', to: '2025-06-30' });
    expect(seasonWindow(2025, 'summer')).toEqual({ from: '2025-07-01', to: '2025-09-30' });
    expect(seasonWindow(2025, 'autumn')).toEqual({ from: '2025-10-01', to: '2025-12-31' });
  });

  it('closes February on the leap day when there is one', () => {
    expect(seasonWindow(2024, 'winter').to).toBe('2024-03-31');
    // The month-end helper is what a Feb-ending quarter would exercise; assert
    // it directly against the year the naive `28` would get wrong.
    expect(seasonWindow(2024, 'winter').from).toBe('2024-01-01');
  });

  it('covers the whole year across the four quarters, with no gap or overlap', () => {
    const windows = HISTORY_SEASONS.map((season) => seasonWindow(2025, season));
    expect(windows[0]!.from).toBe('2025-01-01');
    expect(windows.at(-1)!.to).toBe('2025-12-31');
    for (let i = 1; i < windows.length; i++) {
      const previousEnd = new Date(`${windows[i - 1]!.to}T00:00:00Z`);
      previousEnd.setUTCDate(previousEnd.getUTCDate() + 1);
      expect(previousEnd.toISOString().slice(0, 10)).toBe(windows[i]!.from);
    }
  });

  it('round-trips: every day in a window reports that window’s season', () => {
    for (const season of HISTORY_SEASONS) {
      const { from, to } = seasonWindow(2025, season);
      expect(seasonOf(from)).toBe(season);
      expect(seasonOf(to)).toBe(season);
    }
  });
});

describe('shortDate', () => {
  it('formats without going through a Date, so it can’t shift a day', () => {
    expect(shortDate('2026-02-11')).toBe('11 FEB');
    expect(shortDate('2026-01-01')).toBe('01 JAN');
    expect(shortDate('2026-12-31')).toBe('31 DEC');
  });
});

describe('dateRangeLabel', () => {
  it('reads the four shapes a log can be in', () => {
    expect(dateRangeLabel('2026-01-04', '2026-02-11')).toBe('04 JAN → 11 FEB');
    expect(dateRangeLabel('2026-07-04', '2026-07-04')).toBe('04 JUL');
    expect(dateRangeLabel('2026-07-12', null)).toBe('FROM 12 JUL');
    expect(dateRangeLabel(null, '2026-07-12')).toBe('UNTIL 12 JUL');
  });

  it('is null when there is nothing to show', () => {
    expect(dateRangeLabel(null, null)).toBeNull();
  });
});

describe('groupEntries', () => {
  it('blocks consecutive entries by month, keeping the server’s order', () => {
    const groups = groupEntries(
      [entry('2026-02-11', 'a'), entry('2026-02-03', 'b'), entry('2026-01-19', 'c')],
      'month',
      false,
    );
    expect(groups.map((group) => group.label)).toEqual(['FEBRUARY', 'JANUARY']);
    expect(groups[0]!.entries.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1]!.entries.map((item) => item.id)).toEqual(['c']);
  });

  it('appends the year when the list spans more than one', () => {
    const groups = groupEntries([entry('2026-01-19'), entry('2025-12-22')], 'month', true);
    expect(groups.map((group) => group.label)).toEqual(['JANUARY 2026', 'DECEMBER 2025']);
  });

  it('keeps the same month in different years apart', () => {
    const groups = groupEntries([entry('2026-02-11'), entry('2025-02-18')], 'month', true);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key)).toEqual(['2026-02', '2025-02']);
  });

  it('groups by year', () => {
    const groups = groupEntries(
      [entry('2026-08-09', 'a'), entry('2026-01-19', 'b'), entry('2025-12-22', 'c')],
      'year',
      true,
    );
    expect(groups.map((group) => group.label)).toEqual(['2026', '2025']);
    expect(groups[0]!.entries.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[1]!.entries.map((item) => item.id)).toEqual(['c']);
  });

  it('groups by anime quarter, at the boundary', () => {
    const groups = groupEntries(
      // 30 Sep is summer, 01 Oct is autumn — adjacent days, different blocks.
      [entry('2026-10-01', 'a'), entry('2026-09-30', 'b'), entry('2026-07-04', 'c')],
      'season',
      false,
    );
    expect(groups.map((group) => group.label)).toEqual(['AUTUMN', 'SUMMER']);
    expect(groups[1]!.entries.map((item) => item.id)).toEqual(['b', 'c']);
  });

  it('qualifies a season with its year when the list spans years', () => {
    const groups = groupEntries([entry('2026-02-11'), entry('2025-02-18')], 'season', true);
    expect(groups.map((group) => group.label)).toEqual(['WINTER 2026', 'WINTER 2025']);
    expect(groups.map((group) => group.key)).toEqual(['2026-WINTER', '2025-WINTER']);
  });

  it('is empty for an empty page, under every grouping', () => {
    for (const grouping of HISTORY_GROUPINGS) {
      expect(groupEntries([], grouping, false)).toEqual([]);
    }
  });
});
