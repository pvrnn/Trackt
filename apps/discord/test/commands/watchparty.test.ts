import type { SearchResult } from '@trackt/shared';
import { describe, expect, it } from 'vitest';
import { choiceLabel } from '../../src/commands/watchparty.js';

const base: SearchResult = {
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'x',
  kind: 'movie',
  title: 'The Matrix',
  year: 1999,
  status: 'ended',
  seasonNumber: null,
  coverUrl: null,
  description: null,
};

describe('choiceLabel', () => {
  it('says what kind of thing each choice is', () => {
    expect(choiceLabel(base)).toBe('The Matrix (1999) · Movie');
    expect(
      choiceLabel({ ...base, kind: 'series', title: 'Breaking Bad', year: 2009, seasonNumber: 2 }),
    ).toBe('Breaking Bad (2009) · Season 2');
    expect(choiceLabel({ ...base, kind: 'anime', year: null })).toBe('The Matrix · Anime');
  });

  it("fits Discord's 100-character limit", () => {
    expect(choiceLabel({ ...base, title: 'x'.repeat(200) })).toHaveLength(100);
  });
});
