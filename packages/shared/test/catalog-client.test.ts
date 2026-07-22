import { describe, expect, it } from 'vitest';
import { fetchCatalogSearch } from '../src/catalog-client.js';

/**
 * Wire-contract tests for the federated-search client: hard failures (non-2xx,
 * malformed envelope) throw so the caller can degrade to local-only, while
 * individual hits with unknown enum values (a newer central catalog) are
 * skipped without dropping the rest of the page.
 */

const validHit = {
  id: '2e1c929b-ab13-5b76-9706-c68e438b6a03',
  kind: 'movie',
  title: 'The Matrix',
  synonyms: ['Matrix'],
  year: 1999,
  status: 'ended',
  genres: ['action'],
  partCount: null,
  seasonNumber: null,
  externalIds: { tmdb: 603 },
  description: null,
  coverUrl: null,
  rank: 0.9,
};

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

const OPTIONS = { timeoutMs: 1000 };

describe('fetchCatalogSearch', () => {
  it('throws on a non-2xx catalog response', async () => {
    await expect(
      fetchCatalogSearch('http://catalog.test', 'matrix', {
        ...OPTIONS,
        fetchImpl: fetchReturning({}, 503),
      }),
    ).rejects.toThrow(/503/);
  });

  it('throws on a malformed envelope', async () => {
    await expect(
      fetchCatalogSearch('http://catalog.test', 'matrix', {
        ...OPTIONS,
        fetchImpl: fetchReturning({ nope: true }),
      }),
    ).rejects.toThrow();
  });

  it('parses a fully valid page', async () => {
    const result = await fetchCatalogSearch('http://catalog.test', 'matrix', {
      ...OPTIONS,
      fetchImpl: fetchReturning({ results: [validHit] }),
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.title).toBe('The Matrix');
    expect(result.skipped).toHaveLength(0);
  });

  it('skips hits with unknown enum values but keeps the rest', async () => {
    const unknownKind = {
      ...validHit,
      id: '3e1c929b-ab13-5b76-9706-c68e438b6a04',
      kind: 'podcast',
    };
    const unknownStatus = {
      ...validHit,
      id: '4e1c929b-ab13-5b76-9706-c68e438b6a05',
      status: 'hiatus',
    };
    const result = await fetchCatalogSearch('http://catalog.test', 'matrix', {
      ...OPTIONS,
      fetchImpl: fetchReturning({ results: [unknownKind, validHit, unknownStatus] }),
    });
    expect(result.results.map((hit) => hit.id)).toEqual([validHit.id]);
    expect(result.skipped.map((entry) => entry.id)).toEqual([unknownKind.id, unknownStatus.id]);
    expect(result.skipped[0]!.reason).toMatch(/kind/);
    expect(result.skipped[1]!.reason).toMatch(/status/);
  });

  it('reports a null id for skipped hits without a usable id', async () => {
    const result = await fetchCatalogSearch('http://catalog.test', 'matrix', {
      ...OPTIONS,
      fetchImpl: fetchReturning({ results: [{ garbage: true }] }),
    });
    expect(result.results).toHaveLength(0);
    expect(result.skipped).toEqual([{ id: null, reason: expect.any(String) }]);
  });
});
