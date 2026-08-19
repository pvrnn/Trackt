import { describe, expect, it } from 'vitest';
import { dateToIso, isoToDate } from '../../src/lib/dates';

/**
 * The log-date picker's two conversions (ADR-0007). Both guard an off-by-one
 * day that only shows up in a timezone away from UTC, which is exactly the kind
 * of bug a manual pass on a device in one timezone never finds.
 */
describe('isoToDate', () => {
  it('lands on the same calendar day, at noon', () => {
    const date = isoToDate('2026-02-11');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(1);
    expect(date.getDate()).toBe(11);
    expect(date.getHours()).toBe(12);
  });

  it('round-trips every date back to itself', () => {
    for (const iso of ['1900-01-01', '2026-02-11', '2024-02-29', '2026-12-31']) {
      expect(dateToIso(isoToDate(iso))).toBe(iso);
    }
  });
});

describe('dateToIso', () => {
  it('reads the local fields, not the UTC ones', () => {
    // 23:30 local on the 11th is the 12th in UTC anywhere east of UTC+1.
    expect(dateToIso(new Date(2026, 1, 11, 23, 30))).toBe('2026-02-11');
  });

  it('zero-pads month and day', () => {
    expect(dateToIso(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });
});
