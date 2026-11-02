import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapSteamGame } from '../src/steam/map.js';
import type { SteamOwnedGame } from '../src/steam/schemas.js';

/**
 * Hand-written from GetOwnedGames' documented shape, not a capture: there is no
 * STEAM_API_KEY on this machine. The playtime ladder is the whole point of this
 * mapper, so each row here exists to pin one rung of it.
 */
function fixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/steam/${name}`, import.meta.url), 'utf8'),
  ) as T;
}

const NOW = new Date('2026-11-01T12:00:00Z');
const games = fixture<{ response: { games: SteamOwnedGame[] } }>('owned-games.json').response.games;

function game(appid: number): SteamOwnedGame {
  const found = games.find((candidate) => candidate.appid === appid);
  if (!found) throw new Error(`no app ${appid} in the fixture`);
  return found;
}

describe('mapSteamGame', () => {
  it('reads a game played in the last two weeks as in progress', () => {
    const { entry, warnings } = mapSteamGame(game(1145360), { now: NOW });

    expect(warnings).toEqual([]);
    expect(entry).toMatchObject({
      source: 'steam',
      kind: 'game',
      externalId: '1145360',
      title: 'Hades',
      status: 'in_progress',
      score: null,
      progress: 0,
      notes: null,
      favourite: false,
      externalIds: { steam: 1145360 },
    });
    // "Playing right now" is not a finish, so it claims no day.
    expect(entry?.finishedAt).toBeNull();
  });

  it('reads a game played at all as completed, dated by its last session', () => {
    const { entry } = mapSteamGame(game(1245620), { now: NOW });
    expect(entry).toMatchObject({ status: 'completed', finishedAt: '2024-03-01' });
  });

  it('leaves the day empty when Steam states no last-played time', () => {
    const { entry } = mapSteamGame(game(292030), { now: NOW });
    expect(entry).toMatchObject({ status: 'completed', finishedAt: null });
  });

  it('reads an owned game never launched as planned', () => {
    const { entry } = mapSteamGame({ appid: 588650, name: 'Dead Cells' }, { now: NOW });
    expect(entry).toMatchObject({ status: 'planned', finishedAt: null });
  });

  it('skips an app Steam no longer names, naming its id', () => {
    const { entry, warnings } = mapSteamGame(game(632470), { now: NOW });

    expect(entry).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'malformed-row', externalId: '632470' });
    expect(warnings[0]?.message).toContain('632470');
  });
});
