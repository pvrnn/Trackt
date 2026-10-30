import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_POLICY,
  isKept,
  pruneSeeds,
  type Policy,
  type SeedFile,
  type SeedRow,
} from '../prune-seeds.ts';

const row = (over: Partial<SeedRow>): SeedRow => ({
  id: over.id ?? 'id',
  kind: over.kind ?? 'manga',
  title: over.title ?? 'Some Work',
  year: over.year ?? 2020,
  externalIds: over.externalIds ?? { anilist: 1, mal: 2 },
  metadata: over.metadata ?? { format: 'manga' },
});

const oneShot = (over: Partial<SeedRow> = {}) => row({ metadata: { format: 'one shot' }, ...over });

const seed = (rows: SeedRow[], edges: SeedFile['catalog_media_relation'] = []): SeedFile => ({
  catalog_media: rows,
  catalog_media_relation: edges,
  urls: Object.fromEntries(rows.map((entry) => [entry.id, `https://anilist.co/${entry.id}`])),
});

describe('what the evidence floor keeps', () => {
  it('drops a manga with no MAL id, and keeps one that names it', () => {
    assert.equal(isKept(row({ externalIds: { anilist: 1 } }), DEFAULT_POLICY), false);
    assert.equal(isKept(row({ externalIds: { anilist: 1, mal: 2 } }), DEFAULT_POLICY), true);
  });

  it('never touches an anime row, which the rules do not describe', () => {
    assert.equal(isKept(row({ kind: 'anime', externalIds: { anilist: 3 } }), DEFAULT_POLICY), true);
  });

  it('keeps a one-shot at or above the floor, drops one below it or unscored', () => {
    const kept = oneShot({ metadata: { format: 'one shot', providerScore: 70 } });
    const below = oneShot({ metadata: { format: 'one shot', providerScore: 40 } });
    const unscored = oneShot({ metadata: { format: 'one shot' } });
    assert.equal(isKept(kept, DEFAULT_POLICY), true);
    assert.equal(isKept(below, DEFAULT_POLICY), false);
    assert.equal(isKept(unscored, DEFAULT_POLICY), false, 'no score is no evidence');
  });

  it('leaves a serialised manga alone whatever its score', () => {
    const weak = row({ metadata: { format: 'manga', providerScore: 12 } });
    assert.equal(isKept(weak, DEFAULT_POLICY), true, 'a chapter count is not evidence of quality');
  });

  it('honours a moved threshold and a policy that keeps everything', () => {
    const weak = oneShot({ metadata: { format: 'one shot', providerScore: 40 } });
    assert.equal(isKept(weak, { ...DEFAULT_POLICY, oneShotMinScore: 30 }), true);
    assert.equal(isKept(weak, { ...DEFAULT_POLICY, oneShotMinScore: null }), true);
    const noMal = row({ externalIds: { anilist: 1 } });
    assert.equal(isKept(noMal, { ...DEFAULT_POLICY, requireMalId: false }), true);
  });
});

describe('pruning across the two seeds', () => {
  const policy: Policy = DEFAULT_POLICY;

  it('removes rows, their urls, and the edges they leave dangling', () => {
    const anime = seed(
      [row({ id: 'a1', kind: 'anime', externalIds: { anilist: 10 } })],
      [
        { fromId: 'a1', toId: 'm-keep', type: 'adaptation' },
        { fromId: 'a1', toId: 'm-drop', type: 'adaptation' },
      ],
    );
    const manga = seed([
      row({ id: 'm-keep' }),
      row({ id: 'm-drop', externalIds: { anilist: 11 } }),
    ]);

    const { seeds, report } = pruneSeeds(
      [
        { file: 'anime.json', seed: anime },
        { file: 'manga.json', seed: manga },
      ],
      policy,
    );

    assert.equal(report[0]!.after, 1);
    assert.equal(report[0]!.edgesDropped, 1, 'the edge into the dropped row goes');
    assert.deepEqual(
      seeds[0]!.seed.catalog_media_relation!.map((edge) => edge.toId),
      ['m-keep'],
    );
    assert.equal(report[1]!.before, 2);
    assert.equal(report[1]!.after, 1);
    assert.equal(seeds[1]!.seed.urls!['m-drop'], undefined);
  });

  it('keeps an edge whose target merely lives in the other file', () => {
    // A manga row the anime seed points at but does not carry itself.
    const anime = seed(
      [row({ id: 'a1', kind: 'anime' })],
      [{ fromId: 'a1', toId: 'm-elsewhere', type: 'adaptation' }],
    );
    const manga = seed([row({ id: 'm-elsewhere' })]);
    const { seeds } = pruneSeeds(
      [
        { file: 'anime.json', seed: anime },
        { file: 'manga.json', seed: manga },
      ],
      policy,
    );
    assert.equal(seeds[0]!.seed.catalog_media_relation!.length, 1);
  });

  it('records the policy it applied', () => {
    const { seeds } = pruneSeeds([{ file: 'manga.json', seed: seed([row({})]) }], policy);
    assert.deepEqual((seeds[0]!.seed.report as { pruned: unknown }).pruned, {
      policy,
      removed: 0,
      edges: 0,
    });
  });
});
