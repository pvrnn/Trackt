import { describe, expect, it } from 'vitest';
import { MEDIA_KINDS } from '@trackt/shared';
import { avatarGradient, coverGradient, hashString } from '../../src/lib/cover';

/**
 * These are rendered during SSR *and* during hydration, so "same inputs, same
 * output" is a correctness requirement, not a nicety — a drifting gradient is a
 * hydration mismatch.
 */
describe('hashString', () => {
  it('is deterministic and unsigned', () => {
    expect(hashString('Neon Harbor')).toBe(hashString('Neon Harbor'));
    for (const input of ['', 'a', 'Attack on Titan', '進撃の巨人', '🎬']) {
      const hash = hashString(input);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(hash)).toBe(true);
    }
  });

  it('separates inputs that differ only by one character', () => {
    expect(hashString('Neon Harbor')).not.toBe(hashString('Neon Harbour'));
  });
});

describe('coverGradient', () => {
  it('is stable for the same kind and title', () => {
    expect(coverGradient('anime', 'Ashfall Chronicle')).toBe(
      coverGradient('anime', 'Ashfall Chronicle'),
    );
  });

  it('keys on the kind as well as the title', () => {
    expect(coverGradient('anime', 'Paper Cities')).not.toBe(coverGradient('manga', 'Paper Cities'));
  });

  it('stays inside its kind hue family for every kind', () => {
    const ranges: Record<(typeof MEDIA_KINDS)[number], [number, number]> = {
      movie: [248, 272],
      series: [218, 242],
      anime: [32, 46],
      manga: [22, 36],
      webtoon: [308, 330],
    };
    for (const kind of MEDIA_KINDS) {
      for (const title of ['A', 'Neon Harbor', 'The Ferry Years', '진격의 거인']) {
        const hue = Number(/hsl\((\d+) /.exec(coverGradient(kind, title))?.[1]);
        const [min, max] = ranges[kind];
        expect(hue).toBeGreaterThanOrEqual(min);
        expect(hue).toBeLessThanOrEqual(max);
      }
    }
  });
});

describe('avatarGradient', () => {
  it('always resolves to a real gradient', () => {
    for (const name of ['', 'paulv', 'Ada', '🎬']) {
      const gradient = avatarGradient(name);
      expect(gradient.background).toMatch(/^linear-gradient/);
      expect(gradient.color).toMatch(/^#/);
    }
  });

  it('is stable per name', () => {
    expect(avatarGradient('paulv')).toBe(avatarGradient('paulv'));
  });
});
