import { describe, expect, it } from 'vitest';
import { MEDIA_KINDS, TRACKING_VERB_BY_MEDIA, trackingVerbLabel } from '../src/index.js';

/**
 * The kind → verb mapping behind every user-facing check-in string. The
 * exhaustive Record is compile-time-checked, but its *content* is not — a
 * wrong entry would have the UI telling people they "watched" a manga.
 */
describe('tracking verb', () => {
  it('watches video and reads print', () => {
    expect(TRACKING_VERB_BY_MEDIA).toEqual({
      movie: 'watch',
      series: 'watch',
      anime: 'watch',
      manga: 'read',
      webtoon: 'read',
    });
  });

  it('covers every media kind', () => {
    expect(Object.keys(TRACKING_VERB_BY_MEDIA).sort()).toEqual([...MEDIA_KINDS].sort());
  });

  it('labels each kind in past tense by default', () => {
    expect(trackingVerbLabel('movie')).toBe('Watched');
    expect(trackingVerbLabel('series')).toBe('Watched');
    expect(trackingVerbLabel('anime')).toBe('Watched');
    expect(trackingVerbLabel('manga')).toBe('Read');
    expect(trackingVerbLabel('webtoon')).toBe('Read');
  });

  it('labels each kind in present tense on request', () => {
    expect(trackingVerbLabel('movie', 'present')).toBe('Watch');
    expect(trackingVerbLabel('series', 'present')).toBe('Watch');
    expect(trackingVerbLabel('anime', 'present')).toBe('Watch');
    expect(trackingVerbLabel('manga', 'present')).toBe('Read');
    expect(trackingVerbLabel('webtoon', 'present')).toBe('Read');
  });

  it('returns a capitalised word for every kind, in both tenses', () => {
    for (const kind of MEDIA_KINDS) {
      for (const tense of ['present', 'past'] as const) {
        expect(trackingVerbLabel(kind, tense)).toMatch(/^[A-Z][a-z]+$/);
      }
    }
  });
});
