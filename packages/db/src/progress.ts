import { and, eq, inArray } from 'drizzle-orm';
import { PART_KIND_BY_MEDIA } from '@trackt/shared';
import { mediaPart, progress } from './schema/index.js';
import type { media } from './schema/media.js';
import type { Db } from './index.js';

/**
 * The bulk progress primitive (PRD §3.1), shared by the tracking routes and the
 * account importers: "I am at episode 12" is one write, whichever surface asked.
 */

/** The slice of a media row these helpers need. */
export type ProgressMediaRow = Pick<typeof media.$inferSelect, 'id' | 'kind' | 'partCount'>;

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
  row: ProgressMediaRow,
  upTo: number,
): Promise<void> {
  const partKind = PART_KIND_BY_MEDIA[row.kind];
  if (!partKind) return; // whole-work kinds have no parts

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
  row: ProgressMediaRow,
  watched: boolean,
): Promise<void> {
  if (!watched) return setProgressUpTo(db, userId, row, 0);
  // Nothing to complete against until the catalog knows how many parts exist.
  const total = row.partCount;
  if (total === null || total <= 0) return;
  await setProgressUpTo(db, userId, row, total);
}
