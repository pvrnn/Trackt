import { describe, expect, it } from 'vitest';
import {
  DERIVATIVE_FORMATS,
  SEARCH_RANK_WEIGHTS,
  UNKNOWN_POPULARITY,
  compareSearchHits,
  type SortableSearchHit,
} from '../src/index.js';

/**
 * The search rank is built in SQL in two services (ADR-0010), so these are the
 * invariants the SQL cannot check for itself: a weight sum that reaches 1 would
 * let an in-tier row tie the next tier up, and a vocabulary spelled with
 * underscores would match nothing — which is exactly how the previous format
 * bonus silently stopped applying.
 */
describe('search rank', () => {
  it('keeps the sub-tier weights inside one tier', () => {
    const sum = Object.values(SEARCH_RANK_WEIGHTS).reduce((total, weight) => total + weight, 0);
    expect(sum).toBeLessThan(1);
    // The tier is the integer part, so the rest has to stay below it — and the
    // documented slack is the difference, not an accident of the numbers.
    expect(sum).toBeCloseTo(0.95, 10);
  });

  it('uses the provider vocabulary verbatim, with spaces rather than underscores', () => {
    const formats = Object.values(DERIVATIVE_FORMATS).flat();
    expect(formats.length).toBeGreaterThan(0);
    for (const format of formats) {
      expect(format).toBe(format.toLowerCase());
      expect(format).not.toContain('_');
    }
  });

  it('treats an unscored row as neutral rather than worthless', () => {
    expect(UNKNOWN_POPULARITY).toBeGreaterThan(0);
    expect(UNKNOWN_POPULARITY).toBeLessThan(1);
  });
});

const hits: SortableSearchHit[] = [
  { id: 'a', title: 'the Matrix', year: 1999, rank: 5.5 },
  { id: 'b', title: 'Matrix Reloaded', year: 2003, rank: 4.4 },
  { id: 'c', title: 'Animatrix', year: null, rank: 3.2 },
  { id: 'd', title: 'Matrix Resurrections', year: 2021, rank: 4.3 },
];
const order = (sort: Parameters<typeof compareSearchHits>[0]) =>
  [...hits].sort(compareSearchHits(sort)).map((hit) => hit.id);

describe('compareSearchHits', () => {
  it('keeps relevance as rank order', () => {
    expect(order('relevance')).toEqual(['a', 'b', 'd', 'c']);
  });

  it('puts the newest first and an unknown year last', () => {
    expect(order('newest')).toEqual(['d', 'b', 'a', 'c']);
  });

  it('sorts A–Z ignoring case', () => {
    expect(order('az')).toEqual(['c', 'b', 'd', 'a']);
  });
});
