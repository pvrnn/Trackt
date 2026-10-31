import type { Db } from '@trackt/db';
import { applyImportPlan, type ApplyOptions, type ImportReport } from './apply.js';
import { lookupCatalog } from './catalog.js';
import { buildImportPlan, type ImportPlan } from './plan.js';
import { buildPlanReport, type PlanReport, type PlanReportRow } from './report.js';
import { entryKey, findLoggedMediaIds, resolveImportEntries } from './resolve.js';
import type { ImportEntry, ImportSource, ImportWarning, ImportWarningCode } from './types.js';
import { mergeUncertain } from './uncertain.js';

/**
 * Re-resolve a saved report against the catalog as it is *now*, with no network
 * at all.
 *
 * A report is a snapshot: its plan was computed against the media rows the
 * instance carried at that instant, and visiting a title materializes it later.
 * Re-scraping the provider to pick those up costs the whole profile again, so
 * replaying the saved rows is the cheap half of a re-run — the provider data is
 * already in the file, only the matching moved.
 */

export interface ReplayOptions extends ApplyOptions {
  /** The Trackt user the log rows belong to. */
  userId: string;
  report: PlanReport;
  /** Re-resolve and stop. Nothing is written. */
  dryRun?: boolean;
  now?: Date;
  /** The central catalog, as for a live run — a replay is where it pays most. */
  catalogUrl?: string;
  catalogFetch?: typeof fetch;
  catalogConcurrency?: number;
  catalogSpacingMs?: number;
}

export interface ReplayRun {
  plan: ImportPlan;
  /** Null on a dry run. */
  report: ImportReport | null;
  /** The new plan as a report, ready to overwrite the file it came from. */
  snapshot: PlanReport;
}

/** A report row back into the entry the pipeline produced. */
export function entryFromReportRow(row: PlanReportRow, source: ImportSource): ImportEntry {
  return {
    source,
    kind: row.kind as ImportEntry['kind'],
    externalId: row.externalId,
    title: row.title,
    year: row.year,
    seasonNumber: row.seasonNumber,
    status: row.status as ImportEntry['status'],
    score: row.score,
    progress: row.progress,
    repeats: row.repeats,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    notes: row.notes,
    favourite: row.favourite,
    // A report keeps no provider ids: a row that matched on one already did, and
    // one that did not has only a title and a year to be matched on again.
    externalIds: {},
    ...(row.originCountry?.length ? { originCountry: row.originCountry } : {}),
  };
}

function toWarning(value: { code: string; message: string }, row: PlanReportRow): ImportWarning {
  return {
    code: value.code as ImportWarningCode,
    externalId: row.externalId,
    title: row.title,
    message: value.message,
  };
}

export async function replayImportReport(db: Db, options: ReplayOptions): Promise<ReplayRun> {
  const entries = options.report.rows.map((row) => entryFromReportRow(row, options.report.source));

  const entryWarnings = new Map<string, ImportWarning[]>();
  for (const [index, row] of options.report.rows.entries()) {
    if (row.warnings.length === 0) continue;
    const entry = entries[index]!;
    entryWarnings.set(
      entryKey(entry),
      row.warnings.map((value) => toWarning(value, row)),
    );
  }

  const local = await resolveImportEntries(db, entries);
  const targets = local.targets;
  const warnings = [...local.warnings];
  const uncertain = new Map(local.uncertain);

  if (options.catalogUrl) {
    const missing = entries.filter((entry) => !targets.has(entryKey(entry)));
    const catalog = await lookupCatalog(db, missing, {
      catalogUrl: options.catalogUrl,
      materialize: options.dryRun !== true,
      ...(options.catalogFetch ? { fetchImpl: options.catalogFetch } : {}),
      ...(options.catalogConcurrency !== undefined
        ? { concurrency: options.catalogConcurrency }
        : {}),
      ...(options.catalogSpacingMs !== undefined ? { spacingMs: options.catalogSpacingMs } : {}),
    });
    for (const [key, target] of catalog.targets) targets.set(key, target);
    warnings.push(...catalog.warnings);
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

  const plan = buildImportPlan({
    source: options.report.source,
    profile: options.report.profile,
    entries,
    targets,
    loggedMediaIds,
    entryWarnings,
    warnings,
    uncertain,
  });

  const snapshot = buildPlanReport(plan, {
    applied: !options.dryRun,
    ...(options.now ? { now: options.now } : {}),
  });

  if (options.dryRun) return { plan, report: null, snapshot };

  const report = await applyImportPlan(db, options.userId, plan, {
    ...(options.overwrite === undefined ? {} : { overwrite: options.overwrite }),
  });
  return { plan, report, snapshot };
}
