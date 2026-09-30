import { describe, expect, it } from 'vitest';
import { elapsedMs, formatDuration, progressBar } from '../../src/watch-party/clock.js';

const start = new Date('2026-09-30T20:00:00Z');
const at = (iso: string) => new Date(iso);

describe('elapsedMs', () => {
  it('is zero before the party starts', () => {
    expect(elapsedMs({ itemStartedAt: null, pausedAt: null, pausedMs: 0 }, start)).toBe(0);
  });

  it('counts from the start, minus pauses', () => {
    const clock = { itemStartedAt: start, pausedAt: null, pausedMs: 5 * 60_000 };
    expect(elapsedMs(clock, at('2026-09-30T20:30:00Z'))).toBe(25 * 60_000);
  });

  it('stands still while paused', () => {
    const clock = { itemStartedAt: start, pausedAt: at('2026-09-30T20:10:00Z'), pausedMs: 0 };
    expect(elapsedMs(clock, at('2026-09-30T23:00:00Z'))).toBe(10 * 60_000);
  });
});

describe('formatDuration', () => {
  it('reads like a player', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration((42 * 60 + 10) * 1000)).toBe('42:10');
    expect(formatDuration(112 * 60 * 1000)).toBe('1:52:00');
  });
});

describe('progressBar', () => {
  it('fills in proportion and clamps', () => {
    expect(progressBar(0, 4)).toBe('▱▱▱▱');
    expect(progressBar(0.5, 4)).toBe('▰▰▱▱');
    expect(progressBar(3, 4)).toBe('▰▰▰▰');
  });
});
