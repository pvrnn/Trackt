import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { PART_KIND_BY_MEDIA, type LogStatus } from '@trackt/shared';
import { mediaPart, type media } from './schema/media.js';
import { progress, userMedia } from './schema/tracking.js';
import type { Db } from './index.js';

/**
 * Tracking writes (PRD §3.1–3.2), shared by the API's tracking routes and the
 * Discord bot's watch parties. Callers resolve and authorize the media row;
 * nothing here checks who may see it.
 */

type MediaRow = typeof media.$inferSelect;

/** Postgres caps a statement at 65535 bind parameters; long manga run to thousands of parts. */
const BULK_CHUNK = 1000;

function chunked<T>(items: T[], size = BULK_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Set the viewer's position in a work: every part up to `upTo` is checked in,
 * and everything past it is cleared. The bulk primitive behind both the
 * `completed`/`planned` sweeps (PRD §3.1) and `PUT …/progress` — done
 * server-side so it stays one request and one consistent state, where per-part
 * calls would be N round trips (a 900-chapter manga is not a UI's problem).
 *
 * Clearing above the mark is the point rather than a side effect: "I am at
 * chapter 120" is a statement about the whole work, so a stray check-in at 400
 * cannot survive it. That makes the call destructive of sparse progress, and
 * the only control that issues it is one whose meaning is a *position*.
 */
export async function setProgressUpTo(
  db: Db,
  userId: string,
  row: MediaRow,
  upTo: number,
): Promise<void> {
  const partKind = PART_KIND_BY_MEDIA[row.kind];
  if (!partKind) return; // movies have no parts

  const partsOfMedia = db
    .select({ id: mediaPart.id })
    .from(mediaPart)
    .where(and(eq(mediaPart.mediaId, row.id), eq(mediaPart.kind, partKind)));

  if (upTo <= 0) {
    await db
      .delete(progress)
      .where(and(eq(progress.userId, userId), inArray(progress.partId, partsOfMedia)));
    return;
  }

  const numbers = Array.from({ length: upTo }, (_, i) => i + 1);
  for (const chunk of chunked(numbers)) {
    await db
      .insert(mediaPart)
      .values(chunk.map((number) => ({ mediaId: row.id, kind: partKind, number: String(number) })))
      .onConflictDoNothing();
  }

  const parts = await db
    .select({ id: mediaPart.id, number: mediaPart.number })
    .from(mediaPart)
    .where(and(eq(mediaPart.mediaId, row.id), eq(mediaPart.kind, partKind)));
  const within = parts.filter((part) => Number(part.number) <= upTo);
  const beyond = parts.filter((part) => Number(part.number) > upTo);

  for (const chunk of chunked(within)) {
    await db
      .insert(progress)
      .values(chunk.map((part) => ({ userId, partId: part.id })))
      .onConflictDoNothing();
  }
  for (const chunk of chunked(beyond)) {
    await db.delete(progress).where(
      and(
        eq(progress.userId, userId),
        inArray(
          progress.partId,
          chunk.map((part) => part.id),
        ),
      ),
    );
  }
}

/**
 * Check in, or clear, every part of a work at once — what `completed` and
 * `planned` mean for progress (PRD §3.1).
 *
 * Clearing is destructive and has no undo: `planned` discards existing check-ins.
 */
export async function setAllProgress(
  db: Db,
  userId: string,
  row: MediaRow,
  watched: boolean,
): Promise<void> {
  if (!watched) return setProgressUpTo(db, userId, row, 0);
  // Nothing to complete against until the catalog knows how many parts exist.
  const total = row.partCount;
  if (total === null || total <= 0) return;
  await setProgressUpTo(db, userId, row, total);
}

/**
 * First interaction starts the log; never overrides an existing status.
 *
 * Status is untouched on purpose: checking in an episode of a `paused` show
 * must not silently re-open it (the original `DO NOTHING` contract). Only a
 * missing start date is filled in — `setWhere` keeps the statement a no-op for
 * the overwhelmingly common case, so a check-in stays one cheap upsert.
 */
export async function startLog(db: Db, userId: string, mediaId: string): Promise<void> {
  await db
    .insert(userMedia)
    .values({ userId, mediaId, status: 'in_progress', startedAt: sql`CURRENT_DATE` })
    .onConflictDoUpdate({
      target: [userMedia.userId, userMedia.mediaId],
      set: { startedAt: sql`CURRENT_DATE` },
      setWhere: sql`${userMedia.startedAt} IS NULL`,
    });
}

/**
 * What a status change does to the log's dates (ADR-0007). `CURRENT_DATE` is
 * evaluated *in the statement*, never as a JS `new Date()`, so the API and the
 * database can never disagree about which day it is.
 *
 * Three rules the table encodes deliberately:
 *
 * - **COALESCE, never overwrite.** Marking a series completed, then paused,
 *   then completed again must not replace the real start date with today's.
 * - **`planned` clears both**, because it already means "none of this has
 *   happened" — the route sweeps every check-in for it, and the dates leaving
 *   with the check-ins is the consistent behaviour.
 * - **`in_progress` clears `finished_at`.** Re-opening a completed log is
 *   either a correction or a rewatch; under both readings "finished on" is no
 *   longer true. The lost date is recoverable through `PATCH …/log`. This is
 *   the rule that changes when dated rewatch runs land.
 * - **`dropped` does not stamp `finished_at`.** Dropped works still appear in
 *   the history, filed under their start date, but `finished_at` keeps meaning
 *   *completed on* — what the column is called and what the UI labels it.
 */
function insertDates(status: LogStatus): { startedAt: SQL | null; finishedAt: SQL | null } {
  if (status === 'planned') return { startedAt: null, finishedAt: null };
  return {
    startedAt: sql`CURRENT_DATE`,
    finishedAt: status === 'completed' ? sql`CURRENT_DATE` : null,
  };
}

/** Same rules against a row that already exists — hence the COALESCEs. */
function updateDates(status: LogStatus): { startedAt: SQL | null; finishedAt: SQL | null } {
  if (status === 'planned') return { startedAt: null, finishedAt: null };
  const startedAt = sql`COALESCE(${userMedia.startedAt}, CURRENT_DATE)`;
  if (status === 'completed') {
    return { startedAt, finishedAt: sql`COALESCE(${userMedia.finishedAt}, CURRENT_DATE)` };
  }
  if (status === 'in_progress') return { startedAt, finishedAt: null };
  // paused / dropped: neither finishes the work, so `finished_at` is left as-is.
  return { startedAt, finishedAt: sql`${userMedia.finishedAt}` };
}

/** Set a log's status, stamping its dates (ADR-0007) and sweeping progress to match. */
export async function setLogStatus(
  db: Db,
  userId: string,
  row: MediaRow,
  status: LogStatus,
): Promise<void> {
  await db
    .insert(userMedia)
    .values({ userId, mediaId: row.id, status, ...insertDates(status) })
    .onConflictDoUpdate({
      target: [userMedia.userId, userMedia.mediaId],
      set: { status, ...updateDates(status), updatedAt: new Date() },
    });
  // `completed` means every part is seen; `planned` means none is yet.
  if (status === 'completed') await setAllProgress(db, userId, row, true);
  else if (status === 'planned') await setAllProgress(db, userId, row, false);
}

/**
 * Check in one episode or chapter. Idempotent, and it never completes the work
 * on its own, even on the last part (ADR-0007). The caller rejects kinds
 * without parts and numbers past `partCount`.
 */
export async function checkInPart(
  db: Db,
  userId: string,
  row: MediaRow,
  number: number,
): Promise<void> {
  const partKind = PART_KIND_BY_MEDIA[row.kind];
  if (!partKind) throw new Error(`${row.kind} entries have no parts to check in`);

  // Lazy flat parts: create the numbered row on first check-in (any user).
  await db
    .insert(mediaPart)
    .values({ mediaId: row.id, kind: partKind, number: String(number) })
    .onConflictDoNothing();
  const [part] = await db
    .select({ id: mediaPart.id })
    .from(mediaPart)
    .where(
      and(
        eq(mediaPart.mediaId, row.id),
        eq(mediaPart.kind, partKind),
        eq(mediaPart.number, String(number)),
      ),
    );

  await db.insert(progress).values({ userId, partId: part!.id }).onConflictDoNothing();
  await startLog(db, userId, row.id);
}
