import { describe, expect, it } from 'vitest';
import {
  MATCH_THRESHOLD,
  chooseMatch,
  closestMatch,
  countryMatches,
  scoreMatch,
  titleSimilarity,
} from '../src/match.js';

/**
 * The matching rule an import applies when the provider ids have failed. It is
 * the one place a wrong call writes someone's history onto the wrong work, so
 * the cases below are the real ones: the two 2023 films called *Cobweb*, a
 * title with its article, a sequel numbered in the title, a synonym doing the
 * work an exact title cannot.
 */

const candidate = (
  title: string,
  extra: Partial<{ synonyms: string[]; originCountry: string[]; year: number }> = {},
) => ({
  title,
  synonyms: extra.synonyms ?? [],
  originCountry: extra.originCountry ?? null,
  ...(extra.year !== undefined ? { year: extra.year } : {}),
});

describe('titleSimilarity', () => {
  it('is 1 for a title that normalises to the same thing', () => {
    expect(titleSimilarity('Amélie', 'amelie')).toBe(1);
    expect(titleSimilarity('Spider-Man', 'Spider Man')).toBe(1);
    expect(titleSimilarity('Léon: The Professional', 'leon the professional')).toBe(1);
  });

  it('separates an article, a sequel number and a subtitle from the title', () => {
    expect(titleSimilarity('The Matrix', 'Matrix')).toBeLessThan(MATCH_THRESHOLD);
    expect(titleSimilarity('Blade Runner', 'Blade Runner 2049')).toBeLessThan(MATCH_THRESHOLD);
    expect(titleSimilarity('Dune', 'Dune Part Two')).toBeLessThan(MATCH_THRESHOLD);
    expect(titleSimilarity('Scream', 'Scream 2')).toBeLessThan(MATCH_THRESHOLD);
  });

  it('accepts one edit, refuses two — which is what the threshold is for', () => {
    expect(titleSimilarity('Solaris', 'Solyaris')).toBeGreaterThan(MATCH_THRESHOLD);
    expect(titleSimilarity('Blade Runner', 'Blader Runner')).toBeGreaterThan(MATCH_THRESHOLD);
    // Two edits in a six-letter title is a different spelling, not a slip.
    expect(titleSimilarity('Amelie', 'Amely')).toBeLessThan(MATCH_THRESHOLD);
  });

  it('refuses two different words one letter apart', () => {
    // Real data: "The Grey" (2011) was matched to the catalog's "The Prey" at
    // 88% by edit distance alone, which is one substitution in two short words.
    expect(titleSimilarity('The Grey', 'The Prey')).toBeLessThan(MATCH_THRESHOLD);
    expect(titleSimilarity('The Grey', 'The Prey')).toBeLessThan(0.6);
  });

  it('keeps spelling variants of the same word', () => {
    expect(titleSimilarity('Three Colours: Blue', 'Three Colors: Blue')).toBeGreaterThan(
      MATCH_THRESHOLD,
    );
    expect(
      titleSimilarity('Godzilla × Kong: The New Empire', 'Godzilla x Kong: The New Empire'),
    ).toBeGreaterThan(MATCH_THRESHOLD);
  });

  it('scores unrelated titles far below the threshold', () => {
    expect(titleSimilarity('Cobweb', 'Whalefall')).toBeLessThan(MATCH_THRESHOLD);
    expect(titleSimilarity('Cobweb', 'XYZ')).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('scoreMatch', () => {
  it('matches on a synonym when the title itself does not', () => {
    const scored = scoreMatch(
      { title: 'Amélie' },
      candidate('Le Fabuleux Destin d’Amélie Poulain', { synonyms: ['Amélie'] }),
    );
    expect(scored.title).toBe(1);
    expect(scored.score).toBe(1);
  });

  it('drops the country term when either side is silent', () => {
    expect(scoreMatch({ title: 'Cobweb' }, candidate('Cobweb')).country).toBeNull();
    expect(
      scoreMatch({ title: 'Cobweb', originCountry: ['KR'] }, candidate('Cobweb')).country,
    ).toBeNull();
  });

  it('lets an agreeing country only help, and a differing one cost weight', () => {
    const subject = { title: 'Cobweb', originCountry: ['KR'] };
    expect(scoreMatch(subject, candidate('Cobweb', { originCountry: ['KR'] })).score).toBe(1);
    expect(scoreMatch(subject, candidate('Cobweb', { originCountry: ['US'] })).score).toBeLessThan(
      1,
    );
  });
});

describe('the year ladder', () => {
  const subject = { title: 'Good Manners', year: 2017 };

  it('is 100% on the same year', () => {
    expect(scoreMatch(subject, candidate('Good Manners', { year: 2017 })).score).toBe(1);
  });

  // Providers date a film by their own release: Letterboxd says 2017 for Good
  // Manners, TMDB 2018. That has to stay a match.
  it('stays above the threshold one year out', () => {
    for (const year of [2016, 2018]) {
      const score = scoreMatch(subject, candidate('Good Manners', { year })).score;
      expect(score).toBeGreaterThan(MATCH_THRESHOLD);
      expect(score).toBeLessThan(0.9);
    }
  });

  it('lands in the 60–79% band two years out, which is a refusal', () => {
    for (const year of [2015, 2019]) {
      const score = scoreMatch(subject, candidate('Good Manners', { year })).score;
      expect(score).toBeGreaterThan(0.6);
      expect(score).toBeLessThan(MATCH_THRESHOLD);
    }
  });

  it('keeps the nearest year when the title is not perfect', () => {
    const exact = scoreMatch(subject, candidate('Good Manners!', { year: 2017 })).score;
    const oneOff = scoreMatch(subject, candidate('Good Manners!', { year: 2018 })).score;
    expect(exact).toBeGreaterThan(oneOff);
  });
});

describe('countryMatches', () => {
  it('reconciles a provider name with the catalog’s ISO code', () => {
    expect(countryMatches(['South Korea'], ['KR'])).toBe(true);
    expect(countryMatches(['Japan'], ['JP'])).toBe(true);
    expect(countryMatches(['KR'], ['KR'])).toBe(true);
  });

  it('knows the spellings CLDR and Letterboxd disagree on', () => {
    expect(countryMatches(['Hong Kong'], ['HK'])).toBe(true);
    expect(countryMatches(['Ivory Coast'], ['CI'])).toBe(true);
    expect(countryMatches(['Czech Republic'], ['CZ'])).toBe(true);
  });

  it('says nothing rather than "no" when a side is empty', () => {
    expect(countryMatches(null, ['KR'])).toBeNull();
    expect(countryMatches(['KR'], [])).toBeNull();
  });

  it('is false for two places', () => {
    expect(countryMatches(['South Korea'], ['US'])).toBe(false);
  });
});

describe('chooseMatch', () => {
  it('takes the only row above the threshold, and nothing below it', () => {
    expect(chooseMatch({ title: 'Amélie' }, [candidate('Amélie')])?.best.candidate.title).toBe(
      'Amélie',
    );
    expect(chooseMatch({ title: 'Amélie' }, [candidate('Amely')])).toBeNull();
  });

  /**
   * The bug this rule was written for: `/media/cobweb-2023` (Kim Jee-woon, KR)
   * and `/media/cobweb-2023-7e1cef02` (Samuel Bodin, US) are both "Cobweb",
   * 2023. With no country the call is a coin flip and must stay unmade; with
   * one, the score separates them instead of the order the rows came back in.
   */
  it('refuses the two Cobwebs when the provider states no country', () => {
    const decided = chooseMatch({ title: 'Cobweb' }, [
      candidate('Cobweb', { originCountry: ['KR'] }),
      candidate('Cobweb', { originCountry: ['US'] }),
    ]);
    expect(decided?.ambiguous).toBe(true);
  });

  it('picks the Cobweb the provider’s country names', () => {
    const decided = chooseMatch({ title: 'Cobweb', originCountry: ['South Korea'] }, [
      candidate('Cobweb', { originCountry: ['US'] }),
      candidate('Cobweb', { originCountry: ['KR'] }),
    ]);
    expect(decided?.ambiguous).toBe(false);
    expect(decided?.best.candidate.originCountry).toEqual(['KR']);
  });

  it('prefers a clearly better title over a merely similar one', () => {
    const decided = chooseMatch({ title: 'Cobweb' }, [candidate('Cobweb 2'), candidate('Cobweb')]);
    expect(decided?.ambiguous).toBe(false);
    expect(decided?.best.candidate.title).toBe('Cobweb');
  });

  it('keeps how close a rejection came, for a report that has to explain itself', () => {
    expect(closestMatch({ title: 'The Grey' }, [candidate('The Prey')])).toMatchObject({
      title: 'The Prey',
    });
    expect(closestMatch({ title: 'The Grey' }, [candidate('The Prey')])?.score).toBeLessThan(
      MATCH_THRESHOLD,
    );
    expect(closestMatch({ title: 'Cobweb' }, [])).toBeNull();
  });

  it('reports every row above the threshold, best first', () => {
    const decided = chooseMatch({ title: 'Cobweb' }, [
      candidate('Cobweb'),
      candidate('Cobwebs'),
      candidate('Unrelated Film'),
    ]);
    expect(decided?.ranked.map((entry) => entry.candidate.title)).toEqual(['Cobweb', 'Cobwebs']);
  });
});
