import { ImportError } from '../errors.js';
import type { FetchLike } from '../http/fetch.js';
import { IMPORT_SOURCES } from '../sources.js';
import { SteamOwnedGamesSchema, SteamResolveVanitySchema, type SteamOwnedGame } from './schemas.js';

/**
 * Steam's Web API. One operator key reads any profile whose game details are
 * public — a key belongs to the instance, not to the viewer, so an import needs
 * nothing from the person running it but their profile name.
 *
 * This is a keyed API and not a scrape because it has to be: Steam's community
 * game list (`/profiles/<id>/games`) now redirects every anonymous request to
 * `/login`, so there is no public page left to read.
 */

const DEFAULT_BASE_URL = 'https://api.steampowered.com';
/** A hundred thousand calls a day are allowed; an import spends two. */
const DEFAULT_SPACING_MS = 250;

/** An individual account's 64-bit id: `7656119` + ten digits of account id. */
const STEAM_ID64 = /^7656119\d{10}$/;
/** A vanity name, as it appears in `steamcommunity.com/id/<name>`. */
const VANITY = /^[A-Za-z0-9_-]{1,64}$/;
/** A pasted profile URL, with or without scheme, and with any page tail. */
const PROFILE_URL = /steamcommunity\.com\/(profiles|id)\/([^/?#\s]+)/i;

export type SteamProfileRef = { steamId: string } | { vanity: string };

/**
 * What the viewer typed, read as one of the three things Steam accepts: a
 * SteamID64, a profile URL, or a vanity name. Null when it is none of them.
 */
export function readSteamProfile(profile: string): SteamProfileRef | null {
  const text = profile.trim();
  if (STEAM_ID64.test(text)) return { steamId: text };

  const url = PROFILE_URL.exec(text);
  if (url) {
    const kind = url[1]!.toLowerCase();
    const value = url[2]!;
    if (kind === 'profiles') return STEAM_ID64.test(value) ? { steamId: value } : null;
    return VANITY.test(value) ? { vanity: value } : null;
  }

  return VANITY.test(text) ? { vanity: text } : null;
}

export interface SteamClientOptions {
  /** A key from https://steamcommunity.com/dev/apikey; see `STEAM_API_KEY`. */
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
  requestSpacingMs?: number;
}

export interface SteamClient {
  /** A SteamID64 for whatever the viewer typed — a vanity costs one request. */
  resolveSteamId(profile: string): Promise<string>;
  fetchOwnedGames(steamId: string): Promise<SteamOwnedGame[]>;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function missingCredential(): ImportError {
  const hint = IMPORT_SOURCES.steam.credential?.hint ?? 'export a Steam Web API key';
  return new ImportError(
    `a Steam Web API key is required (STEAM_API_KEY) — ${hint}`,
    'credential',
    null,
  );
}

function errorForStatus(status: number, what: string): ImportError {
  // 401 and 403 both mean the key: Steam answers 403 when it does not know it.
  if (status === 401 || status === 403) {
    return new ImportError(
      `Steam rejected the API key (${status}) — check STEAM_API_KEY is a key from ` +
        'https://steamcommunity.com/dev/apikey',
      'auth',
      status,
    );
  }
  if (status === 429) {
    return new ImportError(
      'Steam is rate-limiting this instance (429) — the import was stopped, retry later',
      'http',
      status,
    );
  }
  return new ImportError(`Steam answered ${status} for ${what}`, 'http', status);
}

export function createSteamClient(options: SteamClientOptions): SteamClient {
  if (!options.apiKey) throw missingCredential();

  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const spacing = options.requestSpacingMs ?? DEFAULT_SPACING_MS;
  const { fetch: fetchImpl = globalThis.fetch as unknown as FetchLike } = options;

  async function get(path: string, what: string): Promise<unknown> {
    const response = await fetchImpl(`${base}/${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw errorForStatus(response.status, what);
    return response.json();
  }

  return {
    async resolveSteamId(profile) {
      const ref = readSteamProfile(profile);
      if (!ref) {
        throw new ImportError(
          `"${profile.trim()}" is not a SteamID64, a profile URL or a vanity name`,
          'not-found',
          null,
        );
      }
      if ('steamId' in ref) return ref.steamId;

      const params = new URLSearchParams({ key: options.apiKey, vanityurl: ref.vanity });
      const raw = await get(`ISteamUser/ResolveVanityURL/v1/?${params}`, 'ResolveVanityURL');
      const parsed = SteamResolveVanitySchema.safeParse(raw);
      if (!parsed.success) {
        throw new ImportError('Steam answered ResolveVanityURL in an unknown shape', 'malformed');
      }
      const { steamid, success } = parsed.data.response;
      if (success !== 1 || !steamid) {
        throw new ImportError(`Steam has no profile called "${ref.vanity}"`, 'not-found', null);
      }
      await sleep(spacing);
      return steamid;
    },

    async fetchOwnedGames(steamId) {
      const params = new URLSearchParams({
        key: options.apiKey,
        steamid: steamId,
        include_appinfo: '1',
        include_played_free_games: '1',
        format: 'json',
      });
      const raw = await get(`IPlayerService/GetOwnedGames/v1/?${params}`, 'GetOwnedGames');
      const parsed = SteamOwnedGamesSchema.safeParse(raw);
      if (!parsed.success) {
        throw new ImportError('Steam answered GetOwnedGames in an unknown shape', 'malformed');
      }
      const { games, game_count: count } = parsed.data.response;
      if (games) return games;
      // Steam answers an empty object, not an error, when game details are not
      // public — the one failure a viewer can fix themselves. A stated count of
      // zero is a real empty library, not a hidden one.
      if (count === 0) return [];
      throw new ImportError(
        `Steam keeps this profile's game details private — set "Game details" to Public at ` +
          'https://steamcommunity.com/my/edit/settings and retry',
        'private',
        null,
      );
    },
  };
}
