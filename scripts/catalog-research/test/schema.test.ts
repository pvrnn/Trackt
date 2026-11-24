import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateEdit, validateResult } from '../schema.mjs';

const movie = { id: 'movie-1', kind: 'movie' };
const anime = { id: 'anime-1', kind: 'anime' };
const series = { id: 'series-1', kind: 'series' };

const batch = [
  {
    n: 1,
    pairKey: 'anime-1|movie-1',
    left: { id: 'anime-1', kind: 'anime' },
    right: { id: 'movie-1', kind: 'movie' },
  },
];

const verdict = (overrides) => ({
  n: 1,
  pairKey: 'anime-1|movie-1',
  verdict: 'linked',
  reason: 'adapts the 2006 film',
  evidence: ['https://example.com/source'],
  link: {
    fromId: 'movie-1',
    toId: 'anime-1',
    type: 'adaptation',
    confidence: 'high',
    source: 'https://example.com/source',
  },
  ...overrides,
});

describe('validateEdit', () => {
  it('refuses identity-bearing fields', () => {
    assert.match(validateEdit(anime, 'id', 'x'), /identity/);
    assert.match(validateEdit(anime, 'kind', 'manga'), /identity/);
    assert.match(validateEdit(series, 'seasonNumber', 2), /identity/);
    assert.match(validateEdit(anime, 'title', 'Other'), /never edited/);
  });

  it('refuses the row’s own identity provider but allows the others', () => {
    assert.match(validateEdit(movie, 'externalIds.tmdb', 42), /defines movie identity/);
    assert.match(validateEdit(anime, 'externalIds.anilist', 42), /defines anime identity/);
    assert.equal(validateEdit(movie, 'externalIds.imdb', 'tt1'), null);
    assert.equal(validateEdit(anime, 'externalIds.tmdb', 157336), null);
  });

  it('bounds the values a research pass may write', () => {
    assert.match(validateEdit(anime, 'year', 1200), /1870-2035/);
    assert.equal(validateEdit(anime, 'year', 2006), null);
    assert.match(validateEdit(anime, 'genres', ['Sci-Fi']), /lowercase/);
    assert.equal(validateEdit(anime, 'genres', ['science fiction']), null);
    assert.match(validateEdit(anime, 'synonyms', ['a', 'b', 'c', 'd', 'e', 'f', 'g']), /six/);
    assert.match(validateEdit(anime, 'metadata.providerScore', 101), /0-100/);
    assert.equal(validateEdit(anime, 'metadata.runtime', 169), null);
  });

  it('keeps metadata.tmdb out of reach — dedup owns that block', () => {
    assert.match(validateEdit(anime, 'metadata.tmdb', { id: 1 }), /not an editable key/);
  });
});

describe('validateResult', () => {
  it('accepts a complete, well-formed answer', () => {
    assert.deepEqual(validateResult(batch, { batch: 'b', verdicts: [verdict()] }), []);
  });

  it('refuses a partial answer', () => {
    assert.match(validateResult(batch, { batch: 'b', verdicts: [] }).join(), /unanswered/);
  });

  it('refuses an edge that does not join the candidate’s two rows', () => {
    const bad = verdict({ link: { ...verdict().link, toId: 'movie-1' } });
    assert.match(validateResult(batch, { batch: 'b', verdicts: [bad] }).join(), /self edge/);
    const stranger = verdict({ link: { ...verdict().link, toId: 'other' } });
    assert.match(validateResult(batch, { batch: 'b', verdicts: [stranger] }).join(), /endpoints/);
  });

  it('requires evidence for a published edge, and a source on every edit', () => {
    const noEvidence = verdict({ evidence: [] });
    assert.match(validateResult(batch, { batch: 'b', verdicts: [noEvidence] }).join(), /evidence/);
    const edit = verdict({
      metadata: [{ id: 'anime-1', path: 'year', to: 2006, source: 'not-a-url' }],
    });
    assert.match(validateResult(batch, { batch: 'b', verdicts: [edit] }).join(), /source/);
  });

  it('only reports a duplicate on a rejection, with both ids in the pair', () => {
    const onLink = verdict({
      duplicate: { keepId: 'anime-1', dropId: 'movie-1', note: 'n', source: 'https://x.test' },
    });
    assert.match(
      validateResult(batch, { batch: 'b', verdicts: [onLink] }).join(),
      /duplicate only on a rejection/,
    );
    const rejected = {
      n: 1,
      pairKey: 'anime-1|movie-1',
      verdict: 'rejected',
      reason: 'same work twice',
      duplicate: {
        keepId: 'anime-1',
        dropId: 'movie-1',
        note: 'one season',
        source: 'https://x.test',
      },
    };
    assert.deepEqual(validateResult(batch, { batch: 'b', verdicts: [rejected] }), []);
  });

  it('refuses an unknown confidence level', () => {
    const bad = verdict({ link: { ...verdict().link, confidence: 'certain' } });
    assert.match(validateResult(batch, { batch: 'b', verdicts: [bad] }).join(), /confidence/);
  });
});
