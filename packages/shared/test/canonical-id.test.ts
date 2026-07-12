import { describe, expect, it } from 'vitest';
import {
  IDENTITY_PROVIDER_BY_KIND,
  TRACKT_CATALOG_NAMESPACE,
  canonicalMediaId,
  canonicalMediaKey,
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

describe('canonicalMediaId', () => {
  it('is deterministic', () => {
    expect(canonicalMediaId('movie', 603)).toBe(canonicalMediaId('movie', '603'));
  });

  it('matches the frozen reference vectors', () => {
    // These IDs are shared by every Trackt instance in existence — never update them.
    expect(canonicalMediaId('movie', 603)).toBe('2e1c929b-ab13-5b76-9706-c68e438b6a03');
    expect(canonicalMediaId('anime', 1)).toBe('ab89c239-b251-51e5-b339-3c8c3904f52b');
  });

  it('uses the identity provider of each kind', () => {
    expect(canonicalMediaId('series', 1396)).toBe(
      uuidv5(TRACKT_CATALOG_NAMESPACE, canonicalMediaKey('tmdb', 'series', 1396)),
    );
    expect(canonicalMediaId('manga', 30002)).toBe(
      uuidv5(TRACKT_CATALOG_NAMESPACE, canonicalMediaKey('anilist', 'manga', 30002)),
    );
  });

  it('distinguishes kinds and providers for the same external id', () => {
    const ids = [
      canonicalMediaId('movie', 1),
      canonicalMediaId('series', 1),
      canonicalMediaId('anime', 1),
      canonicalMediaId('manga', 1),
      canonicalMediaId('anime', 1, 'mal'),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('throws for webtoons unless a provider is given explicitly', () => {
    expect(IDENTITY_PROVIDER_BY_KIND.webtoon).toBeNull();
    expect(() => canonicalMediaId('webtoon', 1)).toThrow(/identity provider/);
    expect(canonicalMediaId('webtoon', 1, 'mangaupdates')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
