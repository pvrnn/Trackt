import { describe, expect, it } from 'vitest';
import { findCatalogMatches } from '../src/catalog.js';
import type { ImportEntry } from '../src/types.js';

/**
 * The catalog lookup, without a database or a network. What matters here is
 * politeness (the catalog allows 300 requests a minute) and honesty (a 429 is
 * waited out, never turned into "not in catalog").
 */

const hit = (overrides: Record<string, unknown> = {}) => ({
  id: '3f7e1d3a-1a1f-5a0e-9a06-000000000042',
  kind: 'movie',
  title: 'Donkey Skin',
  synonyms: ["Peau d'âne"],
  year: 1970,
  status: 'ended',
  genres: [],
  partCount: null,
  seasonNumber: null,
  externalIds: {},
  metadata: {},
  description: null,
  coverUrl: null,
  bannerUrl: null,
  rank: 1,
  ...overrides,
});

const entry = (overrides: Partial<ImportEntry> = {}): ImportEntry => ({
  source: 'letterboxd',
  kind: 'movie',
  externalId: 'donkey-skin',
  title: 'Donkey Skin',
  year: 1970,
  seasonNumber: null,
  status: 'completed',
  score: 7,
  progress: 0,
  repeats: 0,
  startedAt: null,
  finishedAt: null,
  notes: null,
  favourite: false,
  externalIds: {},
  ...overrides,
});

function stub(routes: ((title: string) => Response | Error)[]) {
  let call = 0;
  return (async (url: URL) => {
    const title = url.searchParams.get('q') ?? '';
    const route = routes[Math.min(call++, routes.length - 1)];
    const answer = route?.(title) ?? new Response('{}');
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;
}

const ok = (results: unknown[]) =>
  new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

describe('central catalog lookup', () => {
  it('matches a title and year the instance does not carry', async () => {
    const outcome = await findCatalogMatches([entry()], {
      catalogUrl: 'http://catalog.test',
      fetchImpl: stub([() => ok([hit(), hit({ id: 'other', title: 'Skin', year: 2019 })])]),
      spacingMs: 0,
    });
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.matches[0]?.hit.title).toBe('Donkey Skin');
  });

  it('waits out a 429 instead of calling the work absent', async () => {
    const outcome = await findCatalogMatches([entry()], {
      catalogUrl: 'http://catalog.test',
      fetchImpl: stub([
        () => new Response('{}', { status: 429, statusText: 'Too Many Requests' }),
        () => ok([hit()]),
      ]),
      spacingMs: 0,
    });
    expect(outcome.matches).toHaveLength(1);
    expect(outcome.failed).toBe(0);
  });

  it('reports the lookups it gave up on, because "not in catalog" would be a lie', async () => {
    const permanent = () => new Response('{}', { status: 429, statusText: 'Too Many Requests' });
    const outcome = await findCatalogMatches([entry()], {
      catalogUrl: 'http://catalog.test',
      fetchImpl: stub([permanent]),
      spacingMs: 0,
      maxAttempts: 2,
    });
    expect(outcome.failed).toBe(1);
    expect(outcome.warnings.map((w) => w.code)).toContain('partial-source');
    expect(outcome.warnings[0]?.message).toContain('re-run');
  });

  it('refuses two catalog works with one title and year', async () => {
    const outcome = await findCatalogMatches([entry()], {
      catalogUrl: 'http://catalog.test',
      fetchImpl: stub([() => ok([hit(), hit({ id: '3f7e1d3a-1a1f-5a0e-9a06-000000000099' })])]),
      spacingMs: 0,
    });
    expect(outcome.matches).toHaveLength(0);
    expect(outcome.warnings.map((w) => w.code)).toContain('ambiguous-title-match');
  });

  it('never asks about a row with no year to pin it', async () => {
    let asked = 0;
    const counting = (async () => {
      asked += 1;
      return ok([]);
    }) as unknown as typeof fetch;
    const outcome = await findCatalogMatches([entry({ year: null })], {
      catalogUrl: 'http://catalog.test',
      fetchImpl: counting,
      spacingMs: 0,
    });
    expect(outcome.looked).toBe(0);
    expect(asked).toBe(0);
  });
});
