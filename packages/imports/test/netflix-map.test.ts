import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import { fetchNetflixEntries } from '../src/netflix/adapter.js';
import { mapNetflixMovie, mapNetflixSeason } from '../src/netflix/map.js';
import type { NetflixExport, NetflixSeason } from '../src/netflix/schemas.js';
import { buildImportPlan } from '../src/plan.js';
import { entryKey, type ImportTarget } from '../src/resolve.js';

const now = new Date('2026-11-28T12:00:00Z');

const SEASON: NetflixSeason = {
  show: 'Better Call Saul',
  number: 1,
  episodes: 10,
  firstWatchedAt: '2022-08-06',
  lastWatchedAt: '2022-08-14',
  assumed: false,
};

describe('mapNetflixMovie', () => {
  it('completes a film over the days it was played, keyed on its title', () => {
    const { entry, warnings } = mapNetflixMovie(
      { title: 'Mad Max: Fury Road', firstWatchedAt: '2019-10-06', lastWatchedAt: '2019-10-07' },
      { now },
    );
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'netflix',
      kind: 'movie',
      externalId: 'mad max fury road',
      year: null,
      status: 'completed',
      startedAt: '2019-10-06',
      finishedAt: '2019-10-07',
      fallbackKind: 'anime',
    });
  });
});

describe('mapNetflixSeason', () => {
  it('logs a season in progress, to complete once the catalog’s count is reached', () => {
    const { entry } = mapNetflixSeason(SEASON, { now });
    expect(entry).toMatchObject({
      kind: 'series',
      externalId: 'better call saul',
      seasonNumber: 1,
      status: 'in_progress',
      progress: 10,
      startedAt: '2022-08-06',
      finishedAt: null,
      completesAtPartCount: { finishedAt: '2022-08-14' },
      fallbackKind: 'anime',
    });
    expect(mapNetflixSeason({ ...SEASON, number: 2 }, { now }).entry.fallbackKind).toBeUndefined();
  });
});

describe('a Netflix season in the plan', () => {
  const target = (partCount: number | null): ImportTarget => ({
    id: '00000000-0000-0000-0000-0000000000b1',
    kind: 'series',
    title: 'Better Call Saul',
    partCount,
    seasonNumber: 1,
    matchedBy: 'catalog',
    matchScore: 1,
  });
  const planFor = (partCount: number | null) => {
    const { entry } = mapNetflixSeason(SEASON, { now });
    return buildImportPlan({
      source: 'netflix',
      profile: 'history to 2022-08-14',
      entries: [entry],
      targets: new Map([[entryKey(entry), target(partCount)]]),
      loggedMediaIds: new Set(),
    }).rows[0]!;
  };

  it('is completed on its last day when every episode the catalog lists was seen', () => {
    const row = planFor(10);
    expect(row.entry).toMatchObject({ status: 'completed', finishedAt: '2022-08-14' });
    expect(row.upTo).toBe(10);
  });

  it('stays in progress short of the total, or when the catalog states none', () => {
    expect(planFor(13).entry).toMatchObject({ status: 'in_progress', finishedAt: null });
    expect(planFor(null).entry.status).toBe('in_progress');
  });
});

describe('fetchNetflixEntries', () => {
  const upload: NetflixExport = {
    movies: [{ title: 'Oppenheimer', firstWatchedAt: '2024-12-22', lastWatchedAt: '2024-12-22' }],
    seasons: [
      { ...SEASON, show: 'Sherlock', number: 1, episodes: 3, assumed: true },
      { ...SEASON, show: 'Sherlock', number: 2, episodes: 3 },
      { ...SEASON, show: 'Frieren', number: 1, episodes: 4, assumed: true },
    ],
    unplaced: [{ show: 'Beastars', label: 'Final Season', episodes: 5 }],
    skipped: 2,
  };

  it('maps every work and says what it could not place', async () => {
    const fetched = await fetchNetflixEntries({ profile: 'history', credentials: {}, upload, now });
    expect(fetched.entries.map((entry) => [entry.title, entry.seasonNumber])).toEqual([
      ['Oppenheimer', null],
      ['Sherlock', 1],
      ['Sherlock', 2],
      ['Frieren', 1],
    ]);
    expect(fetched.warnings.map((entry) => entry.code)).toEqual([
      'partial-source',
      'malformed-row',
    ]);

    // Only a show that numbers its other seasons makes "season 1" a guess worth flagging.
    const assumed = (title: string) =>
      fetched.entryWarnings.get(
        entryKey(
          fetched.entries.find((entry) => entry.title === title && entry.seasonNumber === 1)!,
        ),
      );
    expect(assumed('Sherlock')?.map((entry) => entry.message)).toEqual([
      '3 episodes of "Sherlock" name no season — logged as season 1',
    ]);
    expect(assumed('Frieren')).toEqual([]);
  });

  it('fails as malformed when nothing is attached', async () => {
    await expect(fetchNetflixEntries({ profile: 'history', credentials: {} })).rejects.toThrow(
      ImportError,
    );
  });
});
