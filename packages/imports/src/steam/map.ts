import { applyDateRules } from '../dates.js';
import { warning, type ImportEntry, type ImportWarning } from '../types.js';
import type { SteamOwnedGame } from './schemas.js';

/**
 * Steam says how long you played, never how far you got. There is no completion
 * signal in the API — no "finished" flag, and achievement counts are per-game
 * requests — so the only honest ladder is playtime:
 *
 * - played in the last two weeks → in progress,
 * - played at all → completed, the same reading Letterboxd's "watched" gets,
 * - owned but never launched → planned, which is what a backlog is.
 *
 * `rtime_last_played` becomes the log day of a completed row: the day you last
 * played it is the only date Steam states, and a work with no parts takes one
 * day (see `datesForTarget`). A row with no such date keeps none.
 */

function lastPlayedDay(timestamp: number | undefined): string | null {
  if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function played(status: SteamOwnedGame): ImportEntry['status'] {
  if ((status.playtime_2weeks ?? 0) > 0) return 'in_progress';
  if ((status.playtime_forever ?? 0) > 0) return 'completed';
  return 'planned';
}

export interface SteamMapOptions {
  /** Injected so the future-date rule is testable. */
  now?: Date;
}

/** One owned game → one import entry, or nothing when Steam states no title. */
export function mapSteamGame(
  raw: SteamOwnedGame,
  options: SteamMapOptions = {},
): { entry: ImportEntry | null; warnings: ImportWarning[] } {
  const warnings: ImportWarning[] = [];
  const title = raw.name?.trim();
  const row = { externalId: String(raw.appid), title: title ? title : null };

  if (!title) {
    // Steam keeps the playtime of apps it no longer lists, but not their name,
    // and a row with no name cannot be reported, matched or written.
    warnings.push(
      warning(
        'malformed-row',
        row,
        `Steam states no title for app ${raw.appid} (delisted) — row skipped`,
      ),
    );
    return { entry: null, warnings };
  }

  const status = played(raw);
  const { finishedAt } = applyDateRules(
    null,
    status === 'completed' ? lastPlayedDay(raw.rtime_last_played) : null,
    row,
    options.now ?? new Date(),
    warnings,
  );

  return {
    entry: {
      source: 'steam',
      kind: 'game',
      externalId: String(raw.appid),
      title,
      // GetOwnedGames states no release year; a title-only match is scored on
      // the title alone, and two rows it cannot separate stay uncertain.
      year: null,
      seasonNumber: null,
      status,
      score: null,
      progress: 0,
      repeats: 0,
      startedAt: null,
      finishedAt,
      notes: null,
      favourite: false,
      externalIds: { steam: raw.appid },
    },
    warnings,
  };
}
