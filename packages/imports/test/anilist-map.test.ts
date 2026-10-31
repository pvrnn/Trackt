import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapAniListEntry } from '../src/anilist/map.js';
import type { AniListListEntry } from '../src/anilist/schemas.js';
import type { ImportKind } from '../src/types.js';

const NOW = new Date('2026-10-30T12:00:00Z');

function load(name: string): AniListListEntry[] {
  const body = JSON.parse(
    readFileSync(new URL(`./fixtures/anilist/${name}`, import.meta.url), 'utf8'),
  ) as {
    data: { MediaListCollection: { lists: { entries: AniListListEntry[] }[] } };
  };
  return body.data.MediaListCollection.lists.flatMap((list) => list.entries);
}

/** A captured row, by AniList media id — the fixture is real data, not invented shapes. */
function row(mediaId: number, kind: ImportKind = 'anime'): AniListListEntry {
  const found = load(`media-list-${kind}.json`).find((entry) => entry.mediaId === mediaId);
  if (!found) throw new Error(`fixture has no media ${mediaId}`);
  return found;
}

describe('mapAniListEntry (anime)', () => {
  it('maps a completed entry onto the log vocabulary', () => {
    const { entry, warnings } = mapAniListEntry('anime', row(1575), { now: NOW });
    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'anilist',
      kind: 'anime',
      externalId: '1575',
      title: 'Code Geass: Lelouch of the Rebellion',
      year: 2006,
      seasonNumber: null,
      status: 'completed',
      progress: 25,
      repeats: 10,
      startedAt: '2009-01-01',
      finishedAt: '2009-01-01',
      notes: null,
      externalIds: { anilist: 1575, mal: 1575 },
    });
  });

  it('converts the 0–100 score onto Trackt’s 0–10 and treats 0 as unscored', () => {
    expect(mapAniListEntry('anime', row(1575), { now: NOW }).entry?.score).toBe(10);
    expect(mapAniListEntry('anime', row(4654), { now: NOW }).entry?.score).toBeNull();
    expect(mapAniListEntry('anime', row(19815), { now: NOW }).entry?.score).toBe(4);
    expect(mapAniListEntry('anime', row(6746), { now: NOW }).entry?.score).toBe(10);
  });

  it('maps every status the fixture carries, and REPEATING as an in-progress rewatch', () => {
    const statuses = new Map(
      load('media-list-anime.json').map((raw) => [
        raw.status,
        mapAniListEntry('anime', raw, { now: NOW }),
      ]),
    );
    expect(statuses.get('CURRENT')?.entry?.status).toBe('in_progress');
    expect(statuses.get('COMPLETED')?.entry?.status).toBe('completed');
    expect(statuses.get('PLANNING')?.entry?.status).toBe('planned');
    expect(statuses.get('DROPPED')?.entry?.status).toBe('dropped');
    expect(statuses.get('PAUSED')?.entry?.status).toBe('paused');
    expect(statuses.get('REPEATING')?.entry?.status).toBe('in_progress');
    // `repeat` counts the passes already finished; the one in progress is the status.
    expect(statuses.get('REPEATING')?.entry?.repeats).toBe(2);
    for (const mapped of statuses.values()) {
      expect(mapped.warnings.map((w) => w.code)).not.toContain('unknown-status');
    }
  });

  it('skips a status it does not know rather than guessing a bucket', () => {
    const raw = { ...row(1575), status: 'HIATUS' };
    const { entry, warnings } = mapAniListEntry('anime', raw, { now: NOW });
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('unknown-status');
  });

  it('never invents a day for a partial date', () => {
    const { entry, warnings } = mapAniListEntry('anime', row(6746), { now: NOW });
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.filter((w) => w.code === 'partial-date')).toHaveLength(2);
    // The warning quotes what AniList stated, not a placeholder for the gaps.
    expect(warnings[0]?.message).toContain('"2010"');
  });

  it('drops a finish date that precedes the start', () => {
    const raw = row(1575);
    const { entry, warnings } = mapAniListEntry(
      'anime',
      { ...raw, completedAt: { year: 2008, month: 12, day: 31 } },
      { now: NOW },
    );
    expect(entry?.startedAt).toBe('2009-01-01');
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.map((w) => w.code)).toContain('finish-before-start');
  });

  it('drops future dates', () => {
    const raw = row(1575);
    const { entry, warnings } = mapAniListEntry(
      'anime',
      {
        ...raw,
        startedAt: { year: 2027, month: 1, day: 1 },
        completedAt: { year: 2027, month: 2, day: 1 },
      },
      { now: NOW },
    );
    expect(entry?.startedAt).toBeNull();
    expect(entry?.finishedAt).toBeNull();
    expect(warnings.filter((w) => w.code === 'future-date')).toHaveLength(2);
  });

  it('carries notes through, trimmed', () => {
    const { entry } = mapAniListEntry('anime', row(19815), { now: NOW });
    expect(entry?.notes).toMatch(/^Didn't seem particularly good/);
    expect(mapAniListEntry('anime', row(1575), { now: NOW }).entry?.notes).toBeNull();
  });

  it('falls back to the romaji title, and carries no mal id when AniList has none', () => {
    const { entry } = mapAniListEntry('anime', row(21014), { now: NOW });
    expect(entry).toMatchObject({
      title: 'Dera-chan of the Southern Island',
      externalIds: { anilist: 21014 },
    });
  });

  it('skips a row whose work AniList no longer names', () => {
    const { entry, warnings } = mapAniListEntry(
      'anime',
      { ...row(1575), media: null },
      { now: NOW },
    );
    expect(entry).toBeNull();
    expect(warnings[0]?.code).toBe('malformed-row');
  });
});

describe('mapAniListEntry (manga)', () => {
  it('reads chapters as progress', () => {
    const { entry } = mapAniListEntry('manga', row(30025, 'manga'), { now: NOW });
    expect(entry).toMatchObject({
      kind: 'manga',
      externalId: '30025',
      title: 'Fullmetal Alchemist',
      status: 'completed',
      progress: 116,
      externalIds: { anilist: 30025, mal: 25 },
    });
  });

  it('keeps a score of 1 rather than rounding down to unscored', () => {
    const raw = { ...row(30025, 'manga'), score: 1 };
    expect(mapAniListEntry('manga', raw, { now: NOW }).entry?.score).toBe(1);
  });

  it('drops a score outside the provider’s range with a warning', () => {
    const raw = { ...row(30025, 'manga'), score: 150 };
    const { entry, warnings } = mapAniListEntry('manga', raw, { now: NOW });
    expect(entry?.score).toBeNull();
    expect(warnings.map((w) => w.code)).toEqual(['score-invalid']);
  });
});
