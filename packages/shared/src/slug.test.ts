import { describe, expect, it } from 'vitest';
import { mediaSlug } from './slug.js';

describe('mediaSlug', () => {
  it('lowercases and hyphenates', () => {
    expect(mediaSlug('The Matrix', 1999)).toBe('the-matrix-1999');
  });

  it('drops apostrophes instead of hyphenating them', () => {
    expect(mediaSlug('Frieren: Beyond Journey’s End', 2023)).toBe(
      'frieren-beyond-journeys-end-2023',
    );
  });

  it('strips diacritics', () => {
    expect(mediaSlug('Amélie', 2001)).toBe('amelie-2001');
  });

  it('collapses consecutive separators and trims edges', () => {
    expect(mediaSlug('  Spy × Family!! ', 2022)).toBe('spy-family-2022');
  });

  it('omits the year suffix when year is unknown', () => {
    expect(mediaSlug('Berserk')).toBe('berserk');
    expect(mediaSlug('Berserk', null)).toBe('berserk');
  });

  it('falls back to a neutral stem for non-latin titles', () => {
    expect(mediaSlug('葬送のフリーレン', 2023)).toBe('media-2023');
  });
});
