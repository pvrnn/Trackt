import { and, eq, isNull, sql } from 'drizzle-orm';
import type { LogStatus } from '@trackt/shared';
import {
  importMatch,
  rating,
  setProgressUpTo,
  userMedia,
  type Db,
  type ImportMatchCandidate,
} from '@trackt/db';
import type { ImportPlan, ImportPlanRow } from './plan.js';
import { entryKey } from './resolve.js';
import type { ImportSource, ImportWarning } from './types.js';

export interface ApplyOptions {
  /**
   * Rewrite rows the viewer already logs. Off by default: a log that exists is
   * merged instead (`mergeLogRow`), so a second source only adds what it knows.
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
  /** Existing log rows a merge added something to. */
  merged: number;
  /** Existing log rows the source had nothing new for. */
  skippedExisting: number;
  /** Works that got a progress position (episodes/chapters), not a part count. */
  withProgress: number;
  /** Scores written. */
  ratings: number;
  /** Works pinned as favourites (never a removal: a favourite is the viewer's). */
  favourites: number;
  /** Rows the score could not settle, stored for a picker (see `import_match`). */
  uncertain: number;
  warnings: ImportWarning[];
  /** Provider rows this instance's catalog does not carry, skipped. */
  unmatched: { externalId: string; title: string }[];
}

/** A merge moves a status only to a higher rank; a tie keeps what is logged. */
const STATUS_RANK: Record<LogStatus, number> = {
  planned: 0,
  in_progress: 1,
  paused: 1,
  completed: 2,
  dropped: 2,
};

/** Highest part number the viewer has checked in for a work; 0 when none. */
async function furthestPart(db: Db, userId: string, mediaId: string): Promise<number> {
  const [row] = await db.execute<{ furthest: string | null }>(sql`
    SELECT max(mp.number) AS furthest FROM progress p
    JOIN media_part mp ON mp.id = p.part_id
    WHERE p.user_id = ${userId} AND mp.media_id = ${mediaId}
  `);
  return Number(row?.furthest ?? 0);
}

/**
 * Fold a source's row into a log the viewer already has, so importing a second
 * service adds what it knows without undoing the first or what was typed by hand.
 *
 * - Dates and notes fill gaps only, and a filled date never lands on the wrong
 *   side of the other one.
 * - Status only climbs: planned < in_progress/paused < completed/dropped.
 * - Progress and repeats only rise, so progress goes through `setProgressUpTo`
 *   only when the new mark is past every part already checked in.
 * - A score lands only where the viewer has none.
 */
async function mergeLogRow(
  db: Db,
  userId: string,
  row: ImportPlanRow,
): Promise<'merged' | 'skipped'> {
  const target = row.target!;
  const { entry } = row;
  const where = and(eq(userMedia.userId, userId), eq(userMedia.mediaId, target.id));
  const [current] = await db.select().from(userMedia).where(where);
  if (!current) return 'skipped';

  const set: Partial<typeof userMedia.$inferInsert> = {};
  if (STATUS_RANK[entry.status] > STATUS_RANK[current.status]) set.status = entry.status;
  if (entry.repeats > current.repeats) set.repeats = entry.repeats;
  const finish = current.finishedAt;
  if (!current.startedAt && entry.startedAt && (!finish || entry.startedAt <= finish)) {
    set.startedAt = entry.startedAt;
  }
  const start = set.startedAt ?? current.startedAt;
  if (!finish && entry.finishedAt && (!start || entry.finishedAt >= start)) {
    set.finishedAt = entry.finishedAt;
  }
  if (!current.notes && entry.notes) set.notes = entry.notes;

  let changed = Object.keys(set).length > 0;
  if (changed) await db.update(userMedia).set(set).where(where);

  if (row.upTo > 0 && row.upTo > (await furthestPart(db, userId, target.id))) {
    await setProgressUpTo(db, userId, target, row.upTo);
    changed = true;
  }

  if (entry.score !== null) {
    const written = await db
      .insert(rating)
      .values({ userId, targetType: 'media', targetId: target.id, score: String(entry.score) })
      .onConflictDoUpdate({
        target: [rating.userId, rating.targetType, rating.targetId],
        set: { score: String(entry.score), updatedAt: new Date() },
        setWhere: isNull(rating.score),
      })
      .returning({ id: rating.id });
    if (written.length > 0) changed = true;
  }

  return changed ? 'merged' : 'skipped';
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
): Promise<'created' | 'updated' | 'merged' | 'skipped'> {
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

  if (row.existing && !overwrite) return mergeLogRow(db, userId, row);

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
    // A log row can appear between the plan and this write, or from an earlier
    // row of this same import naming the same work: either way it is merged into.
    const inserted = await db
      .insert(userMedia)
      .values({ userId, mediaId: target.id, ...fields })
      .onConflictDoNothing()
      .returning({ mediaId: userMedia.mediaId });
    if (inserted.length === 0) return mergeLogRow(db, userId, row);
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
    merged: 0,
    skippedExisting: 0,
    withProgress: 0,
    ratings: 0,
    favourites: 0,
    warnings: plan.warnings,
    unmatched: [],
    uncertain: 0,
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
        else if (outcome === 'merged') report.merged += 1;
        else report.updated += 1;
        if (row.upTo > 0) report.withProgress += 1;
        if (row.entry.score !== null) report.ratings += 1;
      }
    }

    done += 1;
    options.onProgress?.(done, plan.rows.length);
  }

  report.uncertain = await recordUncertainMatches(db, userId, plan);
  return report;
}

/**
 * Keep the rows the score could not settle, for a picker to ask about.
 *
 * The unresolved set is replaced, not appended to: a re-run recomputes the plan,
 * so a shortlist from a previous run is stale by definition. Rows the viewer has
 * already answered are left alone (`resolved_at`), which is also why the insert
 * is `onConflictDoNothing` — a conflict here means "already decided", and the
 * answer outranks a later run's doubt.
 */
export async function recordUncertainMatches(
  db: Db,
  userId: string,
  plan: ImportPlan,
): Promise<number> {
  await db
    .delete(importMatch)
    .where(
      and(
        eq(importMatch.userId, userId),
        eq(importMatch.source, plan.source),
        isNull(importMatch.resolvedAt),
      ),
    );

  const rows = [];
  for (const row of plan.rows) {
    if (row.target !== null || row.uncertain === null) continue;
    const [best] = row.uncertain.candidates;
    if (!best) continue;
    rows.push({
      userId,
      source: plan.source,
      externalId: row.entry.externalId,
      entryKey: entryKey(row.entry),
      kind: row.entry.kind,
      title: row.entry.title,
      year: row.entry.year,
      seasonNumber: row.entry.seasonNumber,
      status: row.entry.status,
      outcome: row.uncertain.outcome,
      bestScore: best.score,
      candidates: row.uncertain.candidates as ImportMatchCandidate[],
      entry: row.entry as unknown as Record<string, unknown>,
    });
  }
  if (rows.length === 0) return 0;

  // Postgres caps a statement's parameters; a shortlist set is small, but the
  // chunk keeps a pathological import from failing at the last step.
  for (let index = 0; index < rows.length; index += 100) {
    await db
      .insert(importMatch)
      .values(rows.slice(index, index + 100))
      .onConflictDoNothing();
  }
  return rows.length;
}
