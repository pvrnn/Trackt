import { describe, expect, it } from 'vitest';
import type { UpNextEntry } from '@trackt/shared';
import { upNextPartKey } from '../../src/lib/home';
import { firstUnwatched } from '../../src/lib/media';

describe('firstUnwatched', () => {
  it('offers part 1 when nothing is watched', () => {
    expect(firstUnwatched(new Set(), 12)).toBe(1);
  });

  it('offers the first gap, not the highest watched plus one', () => {
    expect(firstUnwatched(new Set([1, 2, 4, 5]), 12)).toBe(3);
  });

  it('stops at the known part count so it never offers E13 of 12', () => {
    // The server rejects a check-in past the count; the button must not offer it.
    expect(firstUnwatched(new Set([1, 2, 3]), 3)).toBeNull();
  });

  it('may extend one past the highest watched part when the total is unknown', () => {
    // The media page passes `listLength + 1` in that case.
    expect(firstUnwatched(new Set([1, 2, 3]), 4)).toBe(4);
  });

  it('handles an empty range', () => {
    expect(firstUnwatched(new Set(), 0)).toBeNull();
  });
});

describe('upNextPartKey', () => {
  const entry = (id: string, next: number) =>
    ({
      id,
      slug: 'neon-harbor',
      kind: 'series',
      title: 'Neon Harbor',
      coverUrl: null,
      next,
      total: 24,
      partKind: 'episode',
    }) as UpNextEntry;

  it('changes once the same title advances to its next part', () => {
    // The regression this exists for: keyed on the id alone, the card stayed
    // marked done after the summary refetched and could never be tapped again.
    expect(upNextPartKey(entry('m1', 18))).not.toBe(upNextPartKey(entry('m1', 19)));
  });

  it('separates two titles sitting on the same part number', () => {
    expect(upNextPartKey(entry('m1', 3))).not.toBe(upNextPartKey(entry('m2', 3)));
  });

  it('is stable for the same title and part', () => {
    expect(upNextPartKey(entry('m1', 18))).toBe(upNextPartKey(entry('m1', 18)));
  });
});
