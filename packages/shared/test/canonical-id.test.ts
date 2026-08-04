import { describe, expect, it } from 'vitest';
import {
  TRACKT_CATALOG_NAMESPACE,
  canonicalMediaId,
  canonicalMediaKey,
  canonicalSeriesSeasonId,
  normalizeCanonicalTitle,
  uuidv5,
} from '../src/canonical-id.js';

const DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('uuidv5', () => {
  it('matches the RFC 4122 reference vector', () => {
    expect(uuidv5(DNS_NAMESPACE, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('derives the frozen Trackt catalog namespace', () => {
    expect(uuidv5(DNS_NAMESPACE, 'catalog.trackt.app')).toBe(TRACKT_CATALOG_NAMESPACE);
  });

  it('sets the version and variant nibbles', () => {
    const id = uuidv5(TRACKT_CATALOG_NAMESPACE, 'anything');
    expect(id[14]).toBe('5');
    expect('89ab').toContain(id[19]!);
  });

  it('rejects malformed namespaces', () => {
    expect(() => uuidv5('not-a-uuid', 'x')).toThrow(/namespace/i);
  });
});

describe('normalizeCanonicalTitle', () => {
  it('folds case, punctuation, and whitespace', () => {
    expect(normalizeCanonicalTitle('  The   Matrix!! ')).toBe('the matrix');
    expect(normalizeCanonicalTitle('Spider-Man: No Way Home')).toBe('spider man no way home');
  });

  it('folds apostrophe variants together', () => {
    const forms = ["Howl's Moving Castle", 'Howl’s Moving Castle', 'Howls Moving Castle'];
    expect(new Set(forms.map(normalizeCanonicalTitle)).size).toBe(1);
  });

  it('applies NFKC so full-width and ligature forms match', () => {
    expect(normalizeCanonicalTitle('ＡＫＩＲＡ')).toBe(normalizeCanonicalTitle('AKIRA'));
  });

  it('preserves non-latin titles instead of collapsing them (unlike mediaSlug)', () => {
    // mediaSlug reduces both of these to a bare stem; identity must not.
    expect(normalizeCanonicalTitle('葬送のフリーレン')).toBe('葬送のフリーレン');
    expect(normalizeCanonicalTitle('鬼滅の刃')).toBe('鬼滅の刃');
    expect(normalizeCanonicalTitle('葬送のフリーレン')).not.toBe(
      normalizeCanonicalTitle('鬼滅の刃'),
    );
  });

  it('is locale-independent for dotted/dotless I', () => {
    // toLocaleLowerCase under a Turkish locale would fold 'I' to 'ı' and mint a
    // different id on that host; toLowerCase must not.
    expect(normalizeCanonicalTitle('IT')).toBe('it');
  });

  it('rejects titles that normalize to nothing', () => {
    expect(() => normalizeCanonicalTitle('!!!')).toThrow(/cannot identify/);
  });
});

describe('canonicalMediaKey', () => {
  it('keys a work on kind, title, and year — never a provider', () => {
    expect(canonicalMediaKey({ kind: 'movie', title: 'The Matrix', year: 1999 })).toBe(
      'movie:the matrix:1999',
    );
  });

  it('spells an unknown year as an empty segment, distinct from any real year', () => {
    const unknown = canonicalMediaKey({ kind: 'manga', title: 'Berserk', year: null });
    expect(unknown).toBe('manga:berserk:');
    expect(unknown).not.toBe(canonicalMediaKey({ kind: 'manga', title: 'Berserk', year: 0 }));
  });

  it('folds in the season number and the discriminator when present', () => {
    expect(
      canonicalMediaKey({ kind: 'series', title: 'Breaking Bad', year: 2008, seasonNumber: 2 }),
    ).toBe('series:breaking bad:2008:s2');
    expect(
      canonicalMediaKey({ kind: 'movie', title: 'Alone', year: 2020, discriminator: 'Swedish' }),
    ).toBe('movie:alone:2020:#swedish');
  });

  it('treats season 0 (specials) as a real season, not a missing one', () => {
    expect(
      canonicalMediaKey({ kind: 'series', title: 'Breaking Bad', year: 2008, seasonNumber: 0 }),
    ).toBe('series:breaking bad:2008:s0');
  });
});

describe('canonicalMediaId', () => {
  it('matches the frozen reference vectors', () => {
    // These IDs are shared by every Trackt instance in existence — never update them.
    expect(canonicalMediaId({ kind: 'movie', title: 'The Matrix', year: 1999 })).toBe(
      '99f6d720-8808-5dbb-b7e6-711b6c586106',
    );
    expect(canonicalSeriesSeasonId('Breaking Bad', 2008, 1)).toBe(
      '0e3225eb-e36c-561d-9aa1-6f3370dd8783',
    );
  });

  it('is stable across cosmetic title differences', () => {
    const a = canonicalMediaId({ kind: 'movie', title: 'The Matrix', year: 1999 });
    const b = canonicalMediaId({ kind: 'movie', title: '  the  MATRIX ', year: 1999 });
    expect(a).toBe(b);
  });

  it('separates works that differ in any identity attribute', () => {
    const ids = [
      canonicalMediaId({ kind: 'movie', title: 'Alone', year: 2020 }),
      canonicalMediaId({ kind: 'movie', title: 'Alone', year: 2021 }),
      canonicalMediaId({ kind: 'manga', title: 'Alone', year: 2020 }),
      canonicalMediaId({ kind: 'movie', title: 'Alone', year: 2020, discriminator: 'Swedish' }),
      canonicalMediaId({ kind: 'movie', title: 'Alone', year: 2020, discriminator: 'Korean' }),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('needs no provider — a work with no external ids still has an identity', () => {
    expect(canonicalMediaId({ kind: 'webtoon', title: 'Tower of God', year: 2010 })).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it('is independent of a work being renamed later (callers must freeze it)', () => {
    // Documents the contract rather than enforcing it: a rename DOES derive a new
    // id, which is exactly why the derived value is stored once and never recomputed.
    const before = canonicalMediaId({ kind: 'anime', title: 'Frieren', year: 2023 });
    const after = canonicalMediaId({
      kind: 'anime',
      title: 'Frieren: Beyond Journey’s End',
      year: 2023,
    });
    expect(before).not.toBe(after);
  });
});

describe('canonicalSeriesSeasonId', () => {
  it('keys a season on the show title, the row year, and the season number (ADR-0003)', () => {
    expect(canonicalSeriesSeasonId('Breaking Bad', 2008, 1)).toBe(
      uuidv5(
        TRACKT_CATALOG_NAMESPACE,
        canonicalMediaKey({ kind: 'series', title: 'Breaking Bad', year: 2008, seasonNumber: 1 }),
      ),
    );
  });

  it('gives each season of a show a distinct id', () => {
    const seasons = [0, 1, 2, 3, 4, 5].map((n) => canonicalSeriesSeasonId('Breaking Bad', 2008, n));
    expect(new Set(seasons).size).toBe(seasons.length);
  });

  it('separates same-titled shows by their show year', () => {
    expect(canonicalSeriesSeasonId('The Office', 2005, 1)).not.toBe(
      canonicalSeriesSeasonId('The Office', 2001, 1),
    );
  });
});
