import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ImportError } from '../src/errors.js';
import type { FetchLike } from '../src/http/fetch.js';
import { createSteamClient, readSteamProfile } from '../src/steam/client.js';

/**
 * The fixtures are hand-written from Steam's documented response shapes (they
 * are not captures): no STEAM_API_KEY was available while building this client,
 * so the live API was never called. They pin the client's decisions, not the
 * shapes.
 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/steam/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

interface StubResponse {
  body: unknown;
  status?: number;
}

function stub(respond: (url: string) => StubResponse): {
  fetch: FetchLike;
  calls: URL[];
} {
  const calls: URL[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(new URL(url));
    const { body, status = 200 } = respond(url);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

const STEAM_ID = '76561198138699994';

function client(fetch: FetchLike) {
  return createSteamClient({ apiKey: 'test-key', fetch, requestSpacingMs: 0 });
}

async function failure(run: () => Promise<unknown>): Promise<unknown> {
  return run().catch((caught: unknown) => caught);
}

describe('readSteamProfile', () => {
  it('reads a SteamID64', () => {
    expect(readSteamProfile(STEAM_ID)).toEqual({ steamId: STEAM_ID });
    expect(readSteamProfile(`  ${STEAM_ID}  `)).toEqual({ steamId: STEAM_ID });
  });

  it('reads a pasted profile URL, with or without a scheme and page tail', () => {
    expect(readSteamProfile(`https://steamcommunity.com/profiles/${STEAM_ID}/`)).toEqual({
      steamId: STEAM_ID,
    });
    expect(readSteamProfile(`steamcommunity.com/profiles/${STEAM_ID}/games/?tab=all`)).toEqual({
      steamId: STEAM_ID,
    });
    expect(readSteamProfile('https://steamcommunity.com/id/Kyoma/')).toEqual({ vanity: 'Kyoma' });
  });

  it('reads a bare vanity name', () => {
    expect(readSteamProfile('kyoma')).toEqual({ vanity: 'kyoma' });
    expect(readSteamProfile('Kyoma_95')).toEqual({ vanity: 'Kyoma_95' });
  });

  it('refuses anything that is none of the three', () => {
    expect(readSteamProfile('not a name')).toBeNull();
    expect(readSteamProfile('')).toBeNull();
    // A profiles URL names a SteamID64; anything else there is not a vanity.
    expect(readSteamProfile('https://steamcommunity.com/profiles/kyoma')).toBeNull();
  });
});

describe('createSteamClient', () => {
  it('resolves a SteamID64 without a request', async () => {
    const { fetch, calls } = stub(() => ({ body: fixture('owned-games.json') }));
    const steamId = await client(fetch).resolveSteamId(STEAM_ID);

    expect(steamId).toBe(STEAM_ID);
    expect(calls).toHaveLength(0);
  });

  it('resolves a vanity through ResolveVanityURL with the key', async () => {
    const { fetch, calls } = stub(() => ({ body: fixture('resolve-vanity.json') }));
    const steamId = await client(fetch).resolveSteamId('kyoma');

    expect(steamId).toBe(STEAM_ID);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/ISteamUser/ResolveVanityURL/v1/');
    expect(calls[0]?.searchParams.get('vanityurl')).toBe('kyoma');
    expect(calls[0]?.searchParams.get('key')).toBe('test-key');
  });

  it('reports a vanity Steam does not know as not found', async () => {
    const { fetch } = stub(() => ({
      body: { response: { success: 42, message: 'No match' } },
    }));
    const error = await failure(() => client(fetch).resolveSteamId('nobody'));

    expect(error).toBeInstanceOf(ImportError);
    expect((error as ImportError).kind).toBe('not-found');
  });

  it('asks for app info and free games, and returns the library', async () => {
    const { fetch, calls } = stub(() => ({ body: fixture('owned-games.json') }));
    const games = await client(fetch).fetchOwnedGames(STEAM_ID);

    expect(games.map((game) => game.appid)).toEqual([1145360, 1245620, 292030, 632470]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.pathname).toBe('/IPlayerService/GetOwnedGames/v1/');
    const params = calls[0]!.searchParams;
    expect(params.get('steamid')).toBe(STEAM_ID);
    expect(params.get('include_appinfo')).toBe('1');
    expect(params.get('include_played_free_games')).toBe('1');
  });

  it('reads an empty response as private game details, which the viewer can fix', async () => {
    const { fetch } = stub(() => ({ body: fixture('owned-games-private.json') }));
    const error = await failure(() => client(fetch).fetchOwnedGames(STEAM_ID));

    expect((error as ImportError).kind).toBe('private');
    expect((error as Error).message).toContain('Game details');
  });

  it('reads a stated count of zero as an empty library, not a hidden one', async () => {
    const { fetch } = stub(() => ({ body: { response: { game_count: 0 } } }));
    await expect(client(fetch).fetchOwnedGames(STEAM_ID)).resolves.toEqual([]);
  });

  it('reports a rejected key as an auth failure, never echoing it', async () => {
    const { fetch } = stub(() => ({ body: null, status: 403 }));
    const error = await failure(() => client(fetch).fetchOwnedGames(STEAM_ID));

    expect((error as ImportError).kind).toBe('auth');
    expect((error as Error).message).toContain('STEAM_API_KEY');
    expect((error as Error).message).not.toContain('test-key');
  });

  it('reports rate limiting as an http failure', async () => {
    const { fetch } = stub(() => ({ body: null, status: 429 }));
    const error = await failure(() => client(fetch).fetchOwnedGames(STEAM_ID));
    expect((error as ImportError).kind).toBe('http');
  });

  it('refuses to run without a key, naming the variable', async () => {
    expect(() => createSteamClient({ apiKey: '', requestSpacingMs: 0 })).toThrow(/STEAM_API_KEY/);
  });
});
