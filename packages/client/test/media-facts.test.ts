import { describe, expect, it } from 'vitest';
import type { MediaDetail } from '@trackt/shared';
import { mediaFacts } from '../src/media.js';

const work = (overrides: Partial<MediaDetail>) =>
  ({
    status: null,
    releaseDate: null,
    year: null,
    genres: [],
    synonyms: [],
    metadata: {},
    ...overrides,
  }) as MediaDetail;

describe('mediaFacts', () => {
  it('states nothing for a work the catalog says nothing about', () => {
    expect(mediaFacts(work({}))).toEqual([]);
  });

  it('lists what the payload carries, in strip order', () => {
    const facts = mediaFacts(
      work({
        status: 'ended',
        releaseDate: '2024-02-02',
        genres: ['Drama'],
        synonyms: ['NH'],
        metadata: {
          endDate: '2025-03-01',
          studios: ['A', 'B', 'C'],
          credits: [{ name: 'L. Okafor' }, { name: 'L. Okafor' }, { name: 'D. Marsh' }],
          duration: 43,
          volumes: 12,
        },
      }),
    );
    expect(facts.map((fact) => fact.key)).toEqual([
      'status',
      'released',
      'ended',
      'studio',
      'createdBy',
      'runtime',
      'volumes',
      'genres',
      'alsoKnownAs',
    ]);
    expect(facts.find((fact) => fact.key === 'studio')?.value).toEqual(['A', 'B']);
    expect(facts.find((fact) => fact.key === 'createdBy')?.value).toEqual([
      'L. Okafor',
      'D. Marsh',
    ]);
  });

  it('marks a running work and falls back to the year for release', () => {
    const facts = mediaFacts(work({ status: 'airing', year: 2024 }));
    expect(facts).toEqual([
      { key: 'status', value: 'AIRING', airing: true },
      { key: 'released', value: '2024' },
    ]);
  });

  it('leaves out an end date on a work that has not ended', () => {
    const facts = mediaFacts(work({ status: 'airing', metadata: { endDate: '2025-03-01' } }));
    expect(facts.some((fact) => fact.key === 'ended')).toBe(false);
  });
});
