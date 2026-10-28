import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  edgeFor,
  normaliseTitle,
  unlinkedPairs,
  withEdges,
  type SeedFile,
  type SeedRelation,
  type SeedRow,
} from '../link-adaptations.ts';

const row = (over: Partial<SeedRow>): SeedRow => ({
  id: over.id ?? 'id',
  kind: over.kind ?? 'anime',
  title: over.title ?? 'Some Work',
  year: over.year ?? 2005,
  externalIds: over.externalIds ?? { anilist: 1 },
});

const anime = (over: Partial<SeedRow> = {}) => row({ id: 'anime-1', kind: 'anime', ...over });
const manga = (over: Partial<SeedRow> = {}) =>
  row({ id: 'manga-1', kind: 'manga', externalIds: { anilist: 2 }, ...over });

describe('the title match', () => {
  it('ignores case, accents, apostrophes and punctuation', () => {
    assert.equal(normaliseTitle('Shakugan no Shana'), normaliseTitle('shakugan no shana'));
    assert.equal(normaliseTitle("Chang'An"), normaliseTitle('Changan'));
    assert.equal(normaliseTitle('Steins;Gate!'), 'steins gate');
  });
});

describe('the pairs the seeds leave unlinked', () => {
  it('pairs an anime with the manga of the same title and year', () => {
    assert.deepEqual(
      unlinkedPairs([anime({ title: 'Shana' }), manga({ title: 'shana!' })], []).length,
      1,
    );
  });

  it('ignores a pair that already has an edge, in either direction', () => {
    const rows = [anime({ title: 'X' }), manga({ title: 'X' })];
    assert.deepEqual(
      unlinkedPairs(rows, [{ fromId: 'anime-1', toId: 'manga-1', type: 'adaptation' }]),
      [],
    );
    assert.deepEqual(
      unlinkedPairs(rows, [{ fromId: 'manga-1', toId: 'anime-1', type: 'related' }]),
      [],
    );
  });

  it('ignores a different year, and two rows of the same kind', () => {
    assert.deepEqual(
      unlinkedPairs([anime({ title: 'X', year: 2001 }), manga({ title: 'X', year: 2005 })], []),
      [],
    );
    assert.deepEqual(
      unlinkedPairs([anime({ id: 'a1', title: 'X' }), anime({ id: 'a2', title: 'X' })], []),
      [],
    );
  });
});

describe('the edge a pair earns', () => {
  const pair = { anime: anime(), manga: manga() };

  it('stores a declared adaptation print → screen, so the anime page reads "source"', () => {
    const { edge, basis } = edgeFor(pair, { type: 'ADAPTATION' });
    assert.deepEqual(edge, { fromId: 'manga-1', toId: 'anime-1', type: 'adaptation' });
    assert.match(basis, /ADAPTATION/);
  });

  it('never claims a source the provider did not name', () => {
    for (const declared of [
      { type: 'ALTERNATIVE' },
      { type: 'CHARACTER' },
      { otherManga: { id: 80145, relationType: 'ADAPTATION' } },
      {},
    ]) {
      const { edge, basis } = edgeFor(pair, declared);
      assert.deepEqual(edge, { fromId: 'anime-1', toId: 'manga-1', type: 'related' });
      assert.ok(basis.length > 0);
    }
  });

  it('says which manga AniList pointed at instead', () => {
    const { basis } = edgeFor(pair, { otherManga: { id: 80145, relationType: 'ADAPTATION' } });
    assert.match(basis, /80145/);
  });
});

describe('writing the edges', () => {
  const file: SeedFile = {
    catalog_media: [anime(), manga()],
    catalog_media_relation: [{ fromId: 'anime-1', toId: 'manga-1', type: 'related' }],
  };

  it('adds only what is missing, and only between rows the file holds', () => {
    const edges: SeedRelation[] = [
      { fromId: 'anime-1', toId: 'manga-1', type: 'related' },
      { fromId: 'manga-1', toId: 'anime-1', type: 'adaptation' },
      { fromId: 'anime-1', toId: 'absent', type: 'related' },
    ];
    const next = withEdges(file, edges);
    assert.equal(next.catalog_media_relation.length, 2);
    assert.deepEqual(next.catalog_media_relation[1], {
      fromId: 'manga-1',
      toId: 'anime-1',
      type: 'adaptation',
    });
  });

  it('carries an edge to a row the earlier seed loads, when it is the last file', () => {
    // The seeder resolves endpoints against the database, not the batch.
    const split = withEdges(file, [{ fromId: 'absent', toId: 'anime-1', type: 'related' }], {
      requireEndpoints: false,
    });
    assert.equal(split.catalog_media_relation.length, 2);
    assert.deepEqual(split.catalog_media_relation[1], {
      fromId: 'absent',
      toId: 'anime-1',
      type: 'related',
    });
  });

  it('returns the file untouched when it already carries every edge', () => {
    assert.equal(withEdges(file, [{ fromId: 'anime-1', toId: 'manga-1', type: 'related' }]), file);
  });
});
