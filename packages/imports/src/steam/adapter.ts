import { entryKey } from '../resolve.js';
import type { FetchedEntries, FetchEntriesOptions, ImportEntry, ImportWarning } from '../types.js';
import { createSteamClient } from './client.js';
import { mapSteamGame } from './map.js';
import type { SteamOwnedGame } from './schemas.js';

/**
 * One row per owned game, keyed by appid. Steam is a keyed API and needs no
 * scraping, so there is no transport choice here: two requests (a vanity
 * costs a third) and the whole library arrives with its playtimes.
 *
 * The wishlist is deliberately not read: `IWishlistService` answers without a
 * key but with appids alone, and this importer never invents a title.
 */
export function dedupeGames(games: SteamOwnedGame[]): SteamOwnedGame[] {
  const byAppId = new Map<number, SteamOwnedGame>();
  for (const game of games) {
    const seen = byAppId.get(game.appid);
    const playtime = (candidate: SteamOwnedGame) => candidate.playtime_forever ?? 0;
    if (!seen || playtime(game) > playtime(seen)) byAppId.set(game.appid, game);
  }
  return [...byAppId.values()];
}

/** Fetch the library, map it. Reads, never writes. */
export async function fetchSteamEntries(options: FetchEntriesOptions): Promise<FetchedEntries> {
  const client = createSteamClient({
    apiKey: options.credentials.steamApiKey ?? '',
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.requestSpacingMs !== undefined
      ? { requestSpacingMs: options.requestSpacingMs }
      : {}),
  });

  const steamId = await client.resolveSteamId(options.profile);
  const games = dedupeGames(await client.fetchOwnedGames(steamId));

  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const warnings: ImportWarning[] = [];
  for (const raw of games) {
    const mapped = mapSteamGame(raw, options.now ? { now: options.now } : {});
    if (!mapped.entry) {
      warnings.push(...mapped.warnings);
      continue;
    }
    entryWarnings.set(entryKey(mapped.entry), mapped.warnings);
    entries.push(mapped.entry);
  }

  return { entries, entryWarnings, warnings };
}
