import { describe, expect, it } from 'vitest';
import { isTimeZone, parseStartTime, zonedTimeToUtc } from '../../src/watch-party/start-time.js';

const now = new Date('2026-09-30T18:15:00Z');

function at(input: string, zone = 'UTC', from = now): string {
  const result = parseStartTime(input, zone, from);
  if (!result.ok) throw new Error(result.error);
  return result.at.toISOString();
}

describe('parseStartTime', () => {
  it('takes now', () => {
    expect(at('now')).toBe(now.toISOString());
  });

  it('takes delays', () => {
    expect(at('in 45m')).toBe('2026-09-30T19:00:00.000Z');
    expect(at('2h')).toBe('2026-09-30T20:15:00.000Z');
    expect(at('1h30m')).toBe('2026-09-30T19:45:00.000Z');
    expect(at('in 90 min')).toBe('2026-09-30T19:45:00.000Z');
  });

  it('reads a time of day in the guild zone, rolling over to tomorrow once past', () => {
    expect(at('20:30')).toBe('2026-09-30T20:30:00.000Z');
    expect(at('20:30', 'Europe/Paris')).toBe('2026-09-30T18:30:00.000Z');
    expect(at('08:00', 'Europe/Paris')).toBe('2026-10-01T06:00:00.000Z');
  });

  it('reads a date and time in the guild zone', () => {
    expect(at('2026-10-02 21:00', 'America/New_York')).toBe('2026-10-03T01:00:00.000Z');
  });

  it('gets the offset right across a DST change', () => {
    // Paris leaves summer time on 25 October 2026.
    expect(at('2026-10-24 20:00', 'Europe/Paris')).toBe('2026-10-24T18:00:00.000Z');
    expect(at('2026-10-26 20:00', 'Europe/Paris')).toBe('2026-10-26T19:00:00.000Z');
  });

  it('rejects the past, impossible dates and nonsense', () => {
    expect(parseStartTime('2026-09-29 20:00', 'UTC', now).ok).toBe(false);
    expect(parseStartTime('2026-02-30 20:00', 'UTC', now).ok).toBe(false);
    expect(parseStartTime('25:00', 'UTC', now).ok).toBe(false);
    expect(parseStartTime('tomorrow-ish', 'UTC', now).ok).toBe(false);
    expect(parseStartTime('in', 'UTC', now).ok).toBe(false);
  });
});

describe('zonedTimeToUtc', () => {
  it('moves a time skipped by spring-forward an hour later', () => {
    // 02:30 does not exist in Paris on 29 March 2026.
    const result = zonedTimeToUtc(
      { year: 2026, month: 3, day: 29, hour: 2, minute: 30 },
      'Europe/Paris',
    );
    expect(result.toISOString()).toBe('2026-03-29T01:30:00.000Z');
  });
});

describe('isTimeZone', () => {
  it('knows IANA zones', () => {
    expect(isTimeZone('Europe/Paris')).toBe(true);
    expect(isTimeZone('Mars/Olympus')).toBe(false);
  });
});
