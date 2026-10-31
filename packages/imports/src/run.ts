import type { Db } from '@trackt/db';
import { fetchAniListEntries } from './anilist/adapter.js';
import { applyImportPlan, type ApplyOptions, type ImportReport } from './apply.js';
import { lookupCatalog } from './catalog.js';
import type { FetchLike, PageFetcher } from './http/fetch.js';
import { fetchLetterboxdEntries } from './letterboxd/adapter.js';
import { fetchMalEntries } from './mal/adapter.js';
import { buildImportPlan, type ImportPlan } from './plan.js';
import { entryKey, findLoggedMediaIds, resolveImportEntries } from './resolve.js';
import { fetchTraktEntries } from './trakt/adapter.js';
import { mergeUncertain } from './uncertain.js';
import type {
  FetchedEntries,
  FetchEntriesOptions,
  ImportCredentials,
  ImportSource,
} from './types.js';

/**
 * The importer proper: fetch → map → resolve → plan → apply. One call, so the
 * caller does not need to know the order — the CLI drives it today, and the
 * `importer` queue's processor is a thin wrapper over the same function.
 */

export interface RunImportOptions {
  /** The Trackt user the log rows belong to. */
  userId: string;
  source: ImportSource;
  /** The provider username whose list is imported. */
  profile: string;
  /** Source credentials resolved from env by the caller (CLI/worker): `malClientId`, `traktClientId`. */
  credentials: ImportCredentials;
  /** Build the plan and stop. Nothing is written. */
  dryRun?: boolean;
  overwrite?: boolean;
  /** Injected clock, so date rules are testable. */
  now?: Date;
  /** Injected transport, so tests need no network. */
  fetch?: FetchLike;
  baseUrl?: string;
  requestSpacingMs?: number;
  /** Injected page transport for scrape sources (Letterboxd), so tests need no network. */
  fetcher?: PageFetcher;
  /**
   * The central catalog (ADR-0002). When set, rows this instance has never
   * materialized are looked up there and (on a real run) inserted exactly as a
   * search would — otherwise a profile full of unwatched-by-this-instance titles
   * is reported as "not in catalog" when the catalog has them.
   */
  catalogUrl?: string;
  /** Injected catalog transport, so tests need no network. */
  catalogFetch?: typeof fetch;
  catalogConcurrency?: number;
  catalogTimeoutMs?: number;
  /** Pause between two catalog lookups; the catalog allows 300 a minute. */
  catalogSpacingMs?: number;
  /** Scrape sources: read each work's own page for its provider ids (one request per work). */
  enrichFilmPages?: boolean;
  maxEnrich?: number;
  /** Rows applied so far, and how many there are. A queue job turns this into its progress. */
  onProgress?: (done: number, total: number) => void;
}

export interface ImportRun {
  plan: ImportPlan;
  /** Null on a dry run. */
  report: ImportReport | null;
}

/** One entry per source: adding a source is a module plus a line here. */
const ADAPTERS: Record<ImportSource, (options: FetchEntriesOptions) => Promise<FetchedEntries>> = {
  mal: fetchMalEntries,
  anilist: fetchAniListEntries,
  letterboxd: fetchLetterboxdEntries,
  trakt: fetchTraktEntries,
};

/** Fetch a source's lists and work out what the import would do. Reads, never writes. */
export async function planImport(db: Db, options: RunImportOptions): Promise<ImportPlan> {
  const fetched = await ADAPTERS[options.source]({
    profile: options.profile,
    credentials: options.credentials,
    ...(options.now ? { now: options.now } : {}),
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.requestSpacingMs !== undefined
      ? { requestSpacingMs: options.requestSpacingMs }
      : {}),
    ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    ...(options.enrichFilmPages ? { enrichFilmPages: options.enrichFilmPages } : {}),
    ...(options.maxEnrich !== undefined ? { maxEnrich: options.maxEnrich } : {}),
  });

  const local = await resolveImportEntries(db, fetched.entries);
  const targets = local.targets;
  const warnings = [...local.warnings];
  const uncertain = new Map(local.uncertain);

  if (options.catalogUrl) {
    const missing = fetched.entries.filter((entry) => !targets.has(entryKey(entry)));
    const catalog = await lookupCatalog(db, missing, {
      catalogUrl: options.catalogUrl,
      materialize: options.dryRun !== true,
      ...(options.catalogFetch ? { fetchImpl: options.catalogFetch } : {}),
      ...(options.catalogConcurrency !== undefined
        ? { concurrency: options.catalogConcurrency }
        : {}),
      ...(options.catalogTimeoutMs !== undefined ? { timeoutMs: options.catalogTimeoutMs } : {}),
      ...(options.catalogSpacingMs !== undefined ? { spacingMs: options.catalogSpacingMs } : {}),
    });
    for (const [key, target] of catalog.targets) targets.set(key, target);
    warnings.push(...catalog.warnings);
    // Both resolvers score on the same scale; the shortlist is the union.
    for (const [key, matches] of catalog.uncertain) {
      const merged = mergeUncertain(uncertain.get(key), matches);
      if (merged) uncertain.set(key, merged);
    }
  }

  const loggedMediaIds = await findLoggedMediaIds(
    db,
    options.userId,
    [...targets.values()].map((target) => target.id),
  );

  return buildImportPlan({
    source: options.source,
    profile: options.profile,
    entries: fetched.entries,
    targets,
    loggedMediaIds,
    entryWarnings: fetched.entryWarnings,
    warnings: [...warnings, ...fetched.warnings],
    uncertain,
  });
}

/** Plan, then apply unless `dryRun`. */
export async function runImport(
  db: Db,
  options: RunImportOptions & ApplyOptions,
): Promise<ImportRun> {
  const plan = await planImport(db, options);
  if (options.dryRun) return { plan, report: null };
  const report = await applyImportPlan(db, options.userId, plan, {
    overwrite: options.overwrite,
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return { plan, report };
}
