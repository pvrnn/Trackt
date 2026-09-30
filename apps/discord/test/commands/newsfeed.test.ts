import { describe, expect, it } from 'vitest';
import { kindsFromSelection } from '../../src/commands/newsfeed.js';

describe('kindsFromSelection', () => {
  it('keeps a partial selection in canonical order', () => {
    expect(kindsFromSelection(['manga', 'anime'])).toEqual(['anime', 'manga']);
  });

  it('stores "all" and a full selection as the empty filter', () => {
    expect(kindsFromSelection(['all', 'movie'])).toEqual([]);
    expect(kindsFromSelection(['movie', 'series', 'anime', 'manga', 'webtoon'])).toEqual([]);
  });
});
