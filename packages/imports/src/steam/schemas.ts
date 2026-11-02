import { z } from 'zod';

/**
 * Steam's Web API shapes. Deliberately tolerant: `GetOwnedGames` omits `name`
 * for apps pulled from the store, omits `playtime_2weeks` unless the game was
 * played recently, and answers `{"response": {}}` — no keys at all — when the
 * profile keeps its game details private.
 */

export const SteamResolveVanitySchema = z.object({
  response: z.object({
    steamid: z.string().optional(),
    /** 1 on a match; 42 is Steam's "No match". */
    success: z.number(),
    message: z.string().optional(),
  }),
});

export const SteamOwnedGameSchema = z.object({
  appid: z.number().int().positive(),
  name: z.string().optional(),
  /** Minutes on record, all time. */
  playtime_forever: z.number().int().nonnegative().optional(),
  /** Minutes in the last two weeks — Steam's only "playing right now" signal. */
  playtime_2weeks: z.number().int().nonnegative().optional(),
  rtime_last_played: z.number().int().nonnegative().optional(),
});

export const SteamOwnedGamesSchema = z.object({
  response: z.object({
    game_count: z.number().int().nonnegative().optional(),
    games: z.array(SteamOwnedGameSchema).optional(),
  }),
});

export type SteamOwnedGame = z.infer<typeof SteamOwnedGameSchema>;
