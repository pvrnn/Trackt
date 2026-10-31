import { describe, expect, it } from 'vitest';
import { mapLetterboxdEntry, type LetterboxdRawEntry } from '../src/letterboxd/map.js';

const NOW = new Date('2026-10-30T12:00:00Z');

function raw(overrides: Partial<LetterboxdRawEntry> = {}): LetterboxdRawEntry {
  return {
    slug: 'wildwood-2026',
    title: 'Wildwood',
    year: 2026,
    list: 'films',
    rating: 8,
    liked: false,
    ...overrides,
  };
}

describe('mapLetterboxdEntry', () => {
  it('maps the watched grid onto a completed film with no dates', () => {
    const { entry, warnings } = mapLetterboxdEntry(raw(), { now: NOW });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'letterboxd',
      kind: 'movie',
      externalId: 'wildwood-2026',
      title: 'Wildwood',
      year: 2026,
      seasonNumber: null,
      status: 'completed',
      progress: 0,
      repeats: 0,
      startedAt: null,
      finishedAt: null,
      notes: null,
      externalIds: {},
    });
  });

  it('keeps Letterboxd’s 0–10 rating as Trackt’s score, half stars included', () => {
    // rated-8 is ★★★★, i.e. 4 stars — 8 on Trackt's scale.
    expect(mapLetterboxdEntry(raw({ rating: 8 }), { now: NOW }).entry?.score).toBe(8);
    expect(mapLetterboxdEntry(raw({ rating: 9 }), { now: NOW }).entry?.score).toBe(9);
    expect(mapLetterboxdEntry(raw({ rating: 1 }), { now: NOW }).entry?.score).toBe(1);
    expect(mapLetterboxdEntry(raw({ rating: null }), { now: NOW }).entry?.score).toBeNull();
  });

  it('drops a rating outside the scale with a warning', () => {
    const { entry, warnings } = mapLetterboxdEntry(raw({ rating: 12 }), { now: NOW });
    expect(entry?.score).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['score-invalid']);
  });

  it('maps the watchlist onto planned, with no score', () => {
    const { entry } = mapLetterboxdEntry(raw({ list: 'watchlist', rating: null }), { now: NOW });
    expect(entry).toMatchObject({ status: 'planned', score: null, progress: 0, repeats: 0 });
  });

  it('takes the last viewing’s day as both start and finish, and counts the rest as repeats', () => {
    const { entry } = mapLetterboxdEntry(
      raw({
        viewings: [
          { watchedOn: '2024-02-01', rating: 7, rewatch: false },
          { watchedOn: '2026-07-08', rating: 8, rewatch: true },
          { watchedOn: '2026-07-09', rating: 9, rewatch: true },
        ],
      }),
      { now: NOW },
    );
    expect(entry).toMatchObject({
      status: 'completed',
      repeats: 2,
      startedAt: '2026-07-09',
      finishedAt: '2026-07-09',
    });
    // The grid's rating is the film's current one; the diary does not override it.
    expect(entry?.score).toBe(8);
  });

  it('falls back to the diary’s rating for a film the grid does not rate', () => {
    const { entry } = mapLetterboxdEntry(
      raw({ rating: null, viewings: [{ watchedOn: '2026-06-16', rating: 7, rewatch: false }] }),
      { now: NOW },
    );
    expect(entry?.score).toBe(7);
  });

  it('drops a viewing dated in the future', () => {
    const { entry, warnings } = mapLetterboxdEntry(
      raw({ viewings: [{ watchedOn: '2027-01-01', rating: 8, rewatch: false }] }),
      { now: NOW },
    );
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.filter((w) => w.code === 'future-date')).toHaveLength(2);
  });

  it('carries the enriched provider ids when the film page was read', () => {
    const { entry } = mapLetterboxdEntry(raw({ tmdb: '791523', imdb: 'tt2056785' }), {
      now: NOW,
    });
    expect(entry?.externalIds).toEqual({ tmdb: '791523', imdb: 'tt2056785' });
  });

  it('skips a row that names no film', () => {
    const { entry, warnings } = mapLetterboxdEntry(raw({ title: '   ' }), { now: NOW });
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('malformed-row');
  });

  it("carries Letterboxd's like as a favourite", () => {
    const { entry } = mapLetterboxdEntry(raw({ liked: true }), { now: NOW });
    expect(entry?.favourite).toBe(true);
    expect(mapLetterboxdEntry(raw(), { now: NOW }).entry?.favourite).toBe(false);
  });

  it('gives a film one day for both dates, from its latest viewing', () => {
    const viewings = [
      { watchedOn: '2024-03-01', rating: 6, rewatch: false },
      { watchedOn: '2026-05-09', rating: 9, rewatch: true },
    ];
    // No grid rating: the diary's latest viewing is then the score.
    const { entry } = mapLetterboxdEntry(raw({ rating: null, viewings }), { now: NOW });
    expect(entry).toMatchObject({
      startedAt: '2026-05-09',
      finishedAt: '2026-05-09',
      repeats: 1,
      score: 9,
    });
  });
});
