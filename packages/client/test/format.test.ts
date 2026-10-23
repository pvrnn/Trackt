import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@trackt/shared';
import { formatScore } from '../src/format.js';
import { dateRangeLabel, groupEntries, shortDate } from '../src/history.js';
import { updatedLabel } from '../src/lists.js';
import { formatNewsDate } from '../src/news.js';

/**
 * The shared helpers stay shared because the locale is a parameter, not a fork.
 * These are the assertions that let `en-GB` stay the mobile default while web
 * asks for French punctuation and French month names.
 */

describe('formatScore', () => {
  it('uses a decimal comma in French and a point in English', () => {
    expect(formatScore(8.5, 'fr-FR')).toBe('8,5');
    expect(formatScore(8.5, 'en-GB')).toBe('8.5');
  });

  it('keeps one decimal place', () => {
    expect(formatScore(9, 'fr-FR')).toBe('9,0');
  });

  it('defaults to en-GB, so mobile is unchanged', () => {
    expect(formatScore(7.25)).toBe('7.3');
  });
});

describe('French dates', () => {
  it('formats a short date with the French abbreviated month', () => {
    expect(shortDate('2026-02-04', 'fr-FR')).toBe('04 FÉVR.');
    expect(shortDate('2026-01-04', 'fr-FR')).toBe('04 JANV.');
  });

  it('keeps the English copy when no locale is given', () => {
    expect(shortDate('2026-02-04')).toBe('04 FEB');
    expect(dateRangeLabel('2026-01-04', '2026-02-11')).toBe('04 JAN → 11 FEB');
  });

  it('formats a news stamp in the requested locale', () => {
    expect(formatNewsDate('2026-07-02T12:00:00Z', 'fr-FR')).toBe('2 JUIL.');
    expect(formatNewsDate('2026-07-02T12:00:00Z')).toBe('2 JUL');
  });
});

describe('locale-aware history grouping', () => {
  function entry(loggedOn: string): HistoryEntry {
    return {
      id: loggedOn,
      slug: loggedOn,
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

  it('uses translated month names', () => {
    const groups = groupEntries(
      [entry('2026-02-11'), entry('2026-01-19')],
      'month',
      false,
      'fr-FR',
    );
    expect(groups.map((group) => group.label)).toEqual(['FÉVRIER', 'JANVIER']);
  });

  it('uses the supplied season labels', () => {
    const groups = groupEntries([entry('2026-01-19')], 'season', false, 'fr-FR', {
      winter: 'HIVER',
      spring: 'PRINTEMPS',
      summer: 'ÉTÉ',
      autumn: 'AUTOMNE',
    });
    expect(groups[0]!.label).toBe('HIVER');
  });
});

describe('updatedLabel copy', () => {
  const NOW = Date.parse('2026-02-11T12:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const DAY = 86_400_000;

  it('accepts translated words without changing the buckets', () => {
    const copy = {
      justNow: 'À L’INSTANT',
      today: 'AUJOURD’HUI',
      yesterday: 'HIER',
      daysAgo: (days: number) => `IL Y A ${days} J`,
      weeksAgo: (weeks: number) => `IL Y A ${weeks} SEM.`,
      monthsAgo: (months: number) => `IL Y A ${months} MOIS`,
    };
    expect(updatedLabel(ago(5 * DAY), NOW, copy)).toBe('IL Y A 5 J');
    expect(updatedLabel(ago(14 * DAY), NOW, copy)).toBe('IL Y A 2 SEM.');
  });
});
