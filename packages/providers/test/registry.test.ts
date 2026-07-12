import { describe, expect, it, vi } from 'vitest';
import type { MediaKind } from '@trackt/shared';
import { createDefaultRegistry, ProviderRegistry } from '../src/registry.js';
import type { MetadataProvider, ProviderSearchResult } from '../src/types.js';

function fakeProvider(
  name: string,
  kinds: MediaKind[],
  results: ProviderSearchResult[],
): MetadataProvider {
  return {
    name,
    kinds,
    search: async () => results,
    getDetails: async () => {
      throw new Error('not implemented');
    },
    getStructure: async () => [],
  };
}

const hit = (provider: string): ProviderSearchResult => ({
  provider,
  externalId: '1',
  kind: 'series',
  title: 'Test Show',
});

describe('ProviderRegistry', () => {
  it('routes kinds to providers in priority order', async () => {
    const primary = fakeProvider('primary', ['series'], [hit('primary')]);
    const fallback = fakeProvider('fallback', ['series'], [hit('fallback')]);
    const registry = new ProviderRegistry([primary, fallback]);

    const results = await registry.search('test', 'series');
    expect(results[0]?.provider).toBe('primary');
  });

  it('falls back to the next provider when the first fails', async () => {
    const failing: MetadataProvider = {
      ...fakeProvider('failing', ['series'], []),
      search: async () => {
        throw new Error('boom');
      },
    };
    const fallback = fakeProvider('fallback', ['series'], [hit('fallback')]);
    const registry = new ProviderRegistry([failing, fallback], { warn: vi.fn() });

    const results = await registry.search('test', 'series');
    expect(results[0]?.provider).toBe('fallback');
  });

  it('returns no results for webtoons (user-created entities only)', async () => {
    const registry = createDefaultRegistry({ logger: { warn: vi.fn() } });
    expect(registry.providersFor('webtoon')).toHaveLength(0);
    await expect(registry.search('tower of god', 'webtoon')).resolves.toEqual([]);
  });

  it('warns and skips TMDB when no API key is configured', () => {
    const warn = vi.fn();
    const registry = createDefaultRegistry({ logger: { warn } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('TMDB_API_KEY'));
    expect(registry.providersFor('movie')).toHaveLength(0);
    // series still served by the keyless fallback
    expect(registry.providersFor('series').map((p) => p.name)).toEqual(['tvmaze']);
  });

  it('registers TMDB first for series when a key is present', () => {
    const registry = createDefaultRegistry({ tmdbApiKey: 'test-key' });
    expect(registry.providersFor('series').map((p) => p.name)).toEqual(['tmdb', 'tvmaze']);
    expect(registry.providersFor('movie').map((p) => p.name)).toEqual(['tmdb']);
    expect(registry.providersFor('anime').map((p) => p.name)).toEqual(['anilist']);
    expect(registry.providersFor('manga').map((p) => p.name)).toEqual(['anilist']);
  });
});
