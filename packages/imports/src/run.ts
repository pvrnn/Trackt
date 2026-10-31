import type { Db } from '@trackt/db';
import { applyImportPlan, type ApplyOptions, type ImportReport } from './apply.js';
import { createMalClient, type FetchLike } from './mal/client.js';
import { mapMalEntry } from './mal/map.js';
import { buildImportPlan, type ImportPlan } from './plan.js';
import { findLoggedMediaIds, importKey, resolveImportEntries } from './resolve.js';
import type { ImportEntry, ImportKind, ImportWarning } from './types.js';

/**
 * The importer proper: fetch → map → resolve → plan → apply. One call, so the
 * caller does not need to know the order — the CLI drives it today, and the
 * `importer` queue's processor will be a thin wrapper over the same function.
 */

export interface RunMalImportOptions {
  /** The Trackt user the log rows belong to. */
  userId: string;
  /** MyAnimeList username (or `@me`, which needs an OAuth token this client does not have). */
  profile: string;
  /** MAL API client id — `MAL_CLIENT_ID`. */
  clientId: string;
  /** Build the plan and stop. Nothing is written. */
  dryRun?: boolean;
  overwrite?: boolean;
  /** Injected clock, so date rules are testable. */
  now?: Date;
  /** Injected transport, so tests need no network. */
  fetch?: FetchLike;
  baseUrl?: string;
  requestSpacingMs?: number;
}

export interface MalImportRun {
  plan: ImportPlan;
  /** Null on a dry run. */
  report: ImportReport | null;
}

const LIST_KINDS: ImportKind[] = ['anime', 'manga'];

/** Fetch both lists and work out what the import would do. Reads, never writes. */
export async function planMalImport(db: Db, options: RunMalImportOptions): Promise<ImportPlan> {
  const client = createMalClient({
    clientId: options.clientId,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.requestSpacingMs !== undefined
      ? { requestSpacingMs: options.requestSpacingMs }
      : {}),
  });

  const entries: ImportEntry[] = [];
  const entryWarnings = new Map<string, ImportWarning[]>();
  const dropped: ImportWarning[] = [];

  // Sequential on purpose: MAL allows 3 requests/second and two lists are two
  // requests. Parallelising would save nothing and start on the wrong foot.
  for (const kind of LIST_KINDS) {
    const rows = await client.fetchList(kind, options.profile);
    for (const raw of rows) {
      const mapped = mapMalEntry(kind, raw, options.now ? { now: options.now } : {});
      if (!mapped.entry) {
        // A row the mapper refused is not in the plan, so its warning has to
        // travel on its own rather than with the entry's.
        dropped.push(...mapped.warnings);
        continue;
      }
      entryWarnings.set(importKey(mapped.entry.kind, mapped.entry.externalId), mapped.warnings);
      entries.push(mapped.entry);
    }
  }

  const { targets, warnings: resolveWarnings } = await resolveImportEntries(db, entries);
  const loggedMediaIds = await findLoggedMediaIds(
    db,
    options.userId,
    [...targets.values()].map((target) => target.id),
  );

  return buildImportPlan({
    source: 'mal',
    profile: options.profile,
    entries,
    targets,
    loggedMediaIds,
    entryWarnings,
    warnings: [...resolveWarnings, ...dropped],
  });
}

/** Plan, then apply unless `dryRun`. */
export async function runMalImport(
  db: Db,
  options: RunMalImportOptions & ApplyOptions,
): Promise<MalImportRun> {
  const plan = await planMalImport(db, options);
  if (options.dryRun) return { plan, report: null };
  const report = await applyImportPlan(db, options.userId, plan, {
    overwrite: options.overwrite,
  });
  return { plan, report };
}
