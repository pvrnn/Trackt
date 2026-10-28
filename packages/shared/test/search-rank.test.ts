import { describe, expect, it } from 'vitest';
import { DERIVATIVE_FORMATS, SEARCH_RANK_WEIGHTS, UNKNOWN_POPULARITY } from '../src/index.js';

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
