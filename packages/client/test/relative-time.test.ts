import { describe, expect, it } from 'vitest';
import { activityVerbLabel, relativeTime } from '../src/home.js';
import { updatedLabel, visibilityLabel } from '../src/lists.js';

/** A fixed "now" so these never depend on when the suite runs. */
const NOW = Date.parse('2026-08-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('steps through minutes, hours, days and weeks', () => {
    expect(relativeTime(ago(0), NOW)).toBe('0M');
    expect(relativeTime(ago(5 * MINUTE), NOW)).toBe('5M');
    expect(relativeTime(ago(2 * HOUR), NOW)).toBe('2H');
    expect(relativeTime(ago(3 * DAY), NOW)).toBe('3D');
    expect(relativeTime(ago(21 * DAY), NOW)).toBe('3W');
  });

  it('never reports a negative age for a clock-skewed future timestamp', () => {
    expect(relativeTime(new Date(NOW + HOUR).toISOString(), NOW)).toBe('0M');
  });
});

describe('activityVerbLabel', () => {
  const entry = (verb: 'checked_in' | 'rated' | 'status', kind: 'anime' | 'manga') =>
    ({ verb, kind, slug: 's', title: 't', detail: 'd', at: ago(0) }) as Parameters<
      typeof activityVerbLabel
    >[0];

  it('reads a check-in per kind, and the rest kind-neutrally', () => {
    expect(activityVerbLabel(entry('checked_in', 'anime'))).toBe('Watched');
    expect(activityVerbLabel(entry('checked_in', 'manga'))).toBe('Read');
    expect(activityVerbLabel(entry('rated', 'anime'))).toBe('Rated');
    expect(activityVerbLabel(entry('status', 'manga'))).toBe('Marked');
  });
});

describe('updatedLabel', () => {
  it('reads as a sentence rather than a feed tick', () => {
    expect(updatedLabel(ago(10 * MINUTE), NOW)).toBe('JUST NOW');
    expect(updatedLabel(ago(5 * HOUR), NOW)).toBe('TODAY');
    expect(updatedLabel(ago(DAY), NOW)).toBe('YESTERDAY');
    expect(updatedLabel(ago(4 * DAY), NOW)).toBe('4D AGO');
    expect(updatedLabel(ago(14 * DAY), NOW)).toBe('2W AGO');
    expect(updatedLabel(ago(120 * DAY), NOW)).toBe('4MO AGO');
  });
});

describe('visibilityLabel', () => {
  it('uppercases the stored value', () => {
    expect(visibilityLabel('public')).toBe('PUBLIC');
    expect(visibilityLabel('followers')).toBe('FOLLOWERS');
    expect(visibilityLabel('private')).toBe('PRIVATE');
  });
});
