import { and, eq, sql } from 'drizzle-orm';
import { rating, setProgressUpTo, userMedia, type Db } from '@trackt/db';
import type { ImportPlan, ImportPlanRow } from './plan.js';
import type { ImportSource, ImportWarning } from './types.js';

export interface ApplyOptions {
  /**
   * Rewrite rows the viewer already logs. Off by default: an import is a
   * backfill, so a second run adds the new entries and touches nothing else.
   */
  overwrite?: boolean;
  /**
   * Rows applied so far, and how many there are in total. The pipeline has no
   * finer granularity than this: the fetch is a handful of list requests, and
   * apply is the only loop that runs per row.
   */
  onProgress?: (done: number, total: number) => void;
}

export interface ImportReport {
  source: ImportSource;
  profile: string;
  /** Log rows created. */
  created: number;
  /** Log rows rewritten (`overwrite` only). */
  updated: number;
  skippedExisting: number;
  /** Works that got a progress position (episodes/chapters), not a part count. */
  withProgress: number;
  /** Scores written. */
  ratings: number;
  /** Works pinned as favourites (never a removal: a favourite is the viewer's). */
  favourites: number;
  warnings: ImportWarning[];
  /** Provider rows this instance's catalog does not carry, skipped. */
  unmatched: { externalId: string; title: string }[];
}

/**
 * Write one row's log entry.
 *
 * `overwrite` replaces what the provider *states* and leaves what it does not:
 * a provider with no dates must not blank a date the viewer typed in. The
 * destructive half of an overwrite is progress, which is a position by
 * definition — `setProgressUpTo` clears anything past the new mark.
 */
async function writeLogRow(
  db: Db,
  userId: string,
  row: ImportPlanRow,
  overwrite: boolean,
): Promise<'created' | 'updated' | 'skipped'> {
  const target = row.target;
  if (!target) return 'skipped';
  const { entry } = row;

  // Favourites sit outside the existing-log check: a log the viewer already had
  // still gains the favourite their provider's list carried, and the insert is
  // idempotent. Rank is appended within the kind, as the API's own pin does.
  if (entry.favourite) {
    await db.execute(sql`
      INSERT INTO favorite (user_id, media_id, kind, position)
      VALUES (
        ${userId}, ${target.id}, ${target.kind},
        COALESCE((SELECT max(position) + 1 FROM favorite
                  WHERE user_id = ${userId} AND kind = ${target.kind}), 1)
      )
      ON CONFLICT (user_id, media_id) DO NOTHING
    `);
  }

  if (row.existing && !overwrite) return 'skipped';

  const fields = {
    status: entry.status,
    repeats: entry.repeats,
    startedAt: entry.startedAt,
    finishedAt: entry.finishedAt,
    notes: entry.notes,
  };

  if (row.existing) {
    const set: Partial<typeof userMedia.$inferInsert> = {
      status: entry.status,
      repeats: entry.repeats,
    };
    if (entry.startedAt) set.startedAt = entry.startedAt;
    if (entry.finishedAt) set.finishedAt = entry.finishedAt;
    if (entry.notes) set.notes = entry.notes;
    await db
      .update(userMedia)
      .set(set)
      .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, target.id)));
  } else {
    // A log row can appear between the plan and this write; the import must not
    // overwrite it merely by losing the race.
    await db
      .insert(userMedia)
      .values({ userId, mediaId: target.id, ...fields })
      .onConflictDoNothing();
  }

  // New rows with no progress have nothing to clear; an overwrite does.
  if (row.upTo > 0 || overwrite) {
    await setProgressUpTo(db, userId, target, row.upTo);
  }

  if (entry.score !== null) {
    await db
      .insert(rating)
      .values({
        userId,
        targetType: 'media',
        targetId: target.id,
        score: String(entry.score),
      })
      .onConflictDoUpdate({
        target: [rating.userId, rating.targetType, rating.targetId],
        set: { score: String(entry.score), updatedAt: new Date() },
      });
  }

  return row.existing ? 'updated' : 'created';
}

/**
 * Apply a plan. Idempotent row by row rather than in one transaction: a run
 * that dies halfway leaves whole rows written, and the next run — which skips
 * existing logs by default — resumes from there instead of starting over.
 */
export async function applyImportPlan(
  db: Db,
  userId: string,
  plan: ImportPlan,
  options: ApplyOptions = {},
): Promise<ImportReport> {
  const overwrite = options.overwrite ?? false;
  const report: ImportReport = {
    source: plan.source,
    profile: plan.profile,
    created: 0,
    updated: 0,
    skippedExisting: 0,
    withProgress: 0,
    ratings: 0,
    favourites: 0,
    warnings: plan.warnings,
    unmatched: [],
  };

  let done = 0;
  for (const row of plan.rows) {
    if (row.target === null) {
      report.unmatched.push({ externalId: row.entry.externalId, title: row.entry.title });
    } else {
      if (row.entry.favourite) report.favourites += 1;
      const outcome = await writeLogRow(db, userId, row, overwrite);
      if (outcome === 'skipped') {
        report.skippedExisting += 1;
      } else {
        if (outcome === 'created') report.created += 1;
        else report.updated += 1;
        if (row.upTo > 0) report.withProgress += 1;
        if (row.entry.score !== null) report.ratings += 1;
      }
    }

    done += 1;
    options.onProgress?.(done, plan.rows.length);
  }

  return report;
}
