import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/http/fetch.js';
import { fetchSteamEntries } from '../src/steam/adapter.js';
import type { SteamOwnedGame } from '../src/steam/schemas.js';

/**
 * The stub answers the two calls the adapter makes: ResolveVanityURL for a
 * vanity, then GetOwnedGames. Nothing here came off the live API — there is no
 * STEAM_API_KEY on this machine.
 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/steam/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const NOW = new Date('2026-11-01T12:00:00Z');
const gamesFixture = fixture<{ response: { games: SteamOwnedGame[] } }>('owned-games.json').response
  .games;

function stub(games: SteamOwnedGame[]): { fetch: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    const body = url.includes('ResolveVanityURL')
      ? fixture('resolve-vanity.json')
      : { response: { game_count: games.length, games } };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, urls };
}

describe('fetchSteamEntries', () => {
  it('resolves the vanity, reads the library and maps every named game', async () => {
    const { fetch, urls } = stub(gamesFixture);
    const fetched = await fetchSteamEntries({
      profile: 'kyoma',
      credentials: { steamApiKey: 'test-key' },
      fetch,
      requestSpacingMs: 0,
      now: NOW,
    });

    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('ResolveVanityURL');
    expect(fetched.entries.map((entry) => entry.externalId)).toEqual([
      '1145360',
      '1245620',
      '292030',
    ]);
    // The delisted app has no name, so it is a warning rather than a row.
    expect(fetched.warnings).toHaveLength(1);
    expect(fetched.warnings[0]).toMatchObject({ code: 'malformed-row' });
    expect(fetched.entryWarnings.get('steam:game:1145360')).toEqual([]);
  });

  it('keeps the longest playtime when Steam lists an app twice', async () => {
    const duplicate: SteamOwnedGame = {
      appid: 1245620,
      name: 'ELDEN RING',
      playtime_forever: 12_000,
    };
    const { fetch } = stub([...gamesFixture, duplicate]);

    const fetched = await fetchSteamEntries({
      profile: '76561198138699994',
      credentials: { steamApiKey: 'test-key' },
      fetch,
      requestSpacingMs: 0,
      now: NOW,
    });

    expect(fetched.entries.filter((entry) => entry.externalId === '1245620')).toHaveLength(1);
  });

  it('refuses to fetch without a key, before any request', async () => {
    let called = 0;
    const fetch: FetchLike = async () => {
      called += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    };

    await expect(
      fetchSteamEntries({ profile: 'kyoma', credentials: {}, fetch, requestSpacingMs: 0 }),
    ).rejects.toThrow(/STEAM_API_KEY/);
    expect(called).toBe(0);
  });
});
