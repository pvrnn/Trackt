import { describe, expect, it } from 'vitest';
import { SEARCH_YEAR_FLOOR, SELECTABLE_YEARS, isSelectableYear } from '../src/search.js';

/**
 * The year pill is drawn by two screens in two clients from these constants, so
 * the list's shape is the thing worth pinning: newest first, no gap, and a floor
 * the query-string parser can share.
 */

describe('Discover year options', () => {
  it('starts next year and runs down to the floor, newest first', () => {
    const newest = SELECTABLE_YEARS[0]!;
    expect(newest).toBe(new Date().getUTCFullYear() + 1);
    expect(SELECTABLE_YEARS[SELECTABLE_YEARS.length - 1]).toBe(SEARCH_YEAR_FLOOR);
    expect(SELECTABLE_YEARS).toHaveLength(newest - SEARCH_YEAR_FLOOR + 1);
    expect(
      SELECTABLE_YEARS.every(
        (year, index) => index === 0 || SELECTABLE_YEARS[index - 1]! - year === 1,
      ),
    ).toBe(true);
  });

  it('accepts only whole years the picker offers', () => {
    expect(isSelectableYear(SELECTABLE_YEARS[0]!)).toBe(true);
    expect(isSelectableYear(SEARCH_YEAR_FLOOR)).toBe(true);
    expect(isSelectableYear(SEARCH_YEAR_FLOOR - 1)).toBe(false);
    expect(isSelectableYear(SELECTABLE_YEARS[0]! + 1)).toBe(false);
    expect(isSelectableYear(2024.5)).toBe(false);
    expect(isSelectableYear(Number.NaN)).toBe(false);
  });
});
