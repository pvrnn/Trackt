import { and, asc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import {
  canViewMedia,
  checkInPart,
  discordLink,
  discordWatchParty,
  discordWatchPartyRsvp,
  media,
  mediaPart,
  mediaRelation,
  setLogStatus,
  visibleMediaSql,
  type Db,
} from '@trackt/db';
import { PART_KIND_BY_MEDIA, type RsvpResponse } from '@trackt/shared';
import type { PartyView } from './render.js';

/**
 * Watch party state in Postgres. Every transition is a conditional UPDATE
 * that names the state it expects, so a double click or a tick racing a
 * button applies once and the loser gets null back.
 */

export type PartyRow = typeof discordWatchParty.$inferSelect;
type MediaRow = typeof media.$inferSelect;

export interface NextItem {
  mediaId: string;
  partNumber: number;
}

/** The episode after `partNumber`: the next in this season, else the first of the next season. */
export async function findNextItem(
  db: Db,
  work: MediaRow,
  partNumber: number | null,
): Promise<NextItem | null> {
  if (!PART_KIND_BY_MEDIA[work.kind] || partNumber === null) return null;
  if (work.partCount === null || partNumber < work.partCount) {
    return { mediaId: work.id, partNumber: partNumber + 1 };
  }

  const [sequel] = await db
    .select({ id: media.id })
    .from(mediaRelation)
    .innerJoin(media, eq(media.id, mediaRelation.toId))
    .where(
      and(
        eq(mediaRelation.fromId, work.id),
        eq(mediaRelation.type, 'sequel'),
        eq(media.kind, work.kind),
        visibleMediaSql(sql.raw('"media".')),
      ),
    )
    .orderBy(asc(media.seasonNumber))
    .limit(1);
  if (sequel) return { mediaId: sequel.id, partNumber: 1 };

  const showId = work.externalIds.tmdb;
  if (work.kind !== 'series' || showId == null || work.seasonNumber === null) return null;
  const [season] = await db
    .select({ id: media.id })
    .from(media)
    .where(
      and(
        eq(media.kind, 'series'),
        sql`${media.externalIds} ->> 'tmdb' = ${String(showId)}`,
        eq(media.seasonNumber, work.seasonNumber + 1),
        visibleMediaSql(sql.raw('"media".')),
      ),
    )
    .limit(1);
  return season ? { mediaId: season.id, partNumber: 1 } : null;
}

/** The episode's runtime, else the work's, else the host's; null when nobody knows. */
export async function resolveDurationSeconds(
  db: Db,
  mediaId: string,
  partNumber: number | null,
  fallbackMinutes: number | null,
): Promise<number | null> {
  if (partNumber !== null) {
    const [part] = await db
      .select({ runtimeMinutes: mediaPart.runtimeMinutes })
      .from(mediaPart)
      .where(and(eq(mediaPart.mediaId, mediaId), eq(mediaPart.number, String(partNumber))));
    if (part?.runtimeMinutes) return part.runtimeMinutes * 60;
  }
  const [work] = await db
    .select({ runtimeMinutes: media.runtimeMinutes })
    .from(media)
    .where(eq(media.id, mediaId));
  const minutes = work?.runtimeMinutes ?? fallbackMinutes;
  return minutes ? minutes * 60 : null;
}

export async function loadParty(db: Db, id: string): Promise<PartyRow | null> {
  const [row] = await db.select().from(discordWatchParty).where(eq(discordWatchParty.id, id));
  return row ?? null;
}

export async function loadPartyView(db: Db, row: PartyRow): Promise<PartyView | null> {
  const [work] = await db.select().from(media).where(eq(media.id, row.mediaId));
  if (!work) return null;
  const [part, rsvps, next] = await Promise.all([
    row.partNumber === null
      ? Promise.resolve(undefined)
      : db
          .select({ title: mediaPart.title })
          .from(mediaPart)
          .where(
            and(eq(mediaPart.mediaId, row.mediaId), eq(mediaPart.number, String(row.partNumber))),
          )
          .then((rows) => rows[0]),
    db
      .select({
        discordUserId: discordWatchPartyRsvp.discordUserId,
        response: discordWatchPartyRsvp.response,
      })
      .from(discordWatchPartyRsvp)
      .where(eq(discordWatchPartyRsvp.partyId, row.id))
      .orderBy(asc(discordWatchPartyRsvp.respondedAt)),
    findNextItem(db, work, row.partNumber),
  ]);
  return {
    id: row.id,
    status: row.status,
    hostDiscordId: row.hostDiscordId,
    scheduledAt: row.scheduledAt,
    endedAt: row.endedAt,
    voiceChannelId: row.voiceChannelId,
    clock: { itemStartedAt: row.itemStartedAt, pausedAt: row.pausedAt, pausedMs: row.pausedMs },
    durationSeconds: row.durationSeconds,
    media: {
      title: work.title,
      slug: work.slug,
      kind: work.kind,
      year: work.year,
      seasonNumber: work.seasonNumber,
      coverUrl: work.coverUrl,
    },
    partNumber: row.partNumber,
    partTitle: part?.title ?? null,
    rsvps,
    hasNext: next !== null,
  };
}

/** Only while the party can still be joined. */
export async function setRsvp(
  db: Db,
  row: PartyRow,
  discordUserId: string,
  response: RsvpResponse,
): Promise<boolean> {
  if (row.status !== 'scheduled' && row.status !== 'live') return false;
  await db
    .insert(discordWatchPartyRsvp)
    .values({ partyId: row.id, discordUserId, response })
    .onConflictDoUpdate({
      target: [discordWatchPartyRsvp.partyId, discordWatchPartyRsvp.discordUserId],
      set: { response, respondedAt: new Date() },
    });
  return true;
}

async function transition(
  db: Db,
  id: string,
  set: PgUpdateSetSource<typeof discordWatchParty>,
  ...conditions: Parameters<typeof and>
): Promise<PartyRow | null> {
  const [row] = await db
    .update(discordWatchParty)
    .set(set)
    .where(and(eq(discordWatchParty.id, id), ...conditions))
    .returning();
  return row ?? null;
}

export function startParty(db: Db, id: string, now: Date) {
  return transition(
    db,
    id,
    { status: 'live', itemStartedAt: now, pausedAt: null, pausedMs: 0, renderedAt: now },
    eq(discordWatchParty.status, 'scheduled'),
  );
}

export function pauseParty(db: Db, id: string, now: Date) {
  return transition(
    db,
    id,
    { pausedAt: now, renderedAt: now },
    eq(discordWatchParty.status, 'live'),
    isNull(discordWatchParty.pausedAt),
  );
}

export function resumeParty(db: Db, id: string, now: Date) {
  return transition(
    db,
    id,
    {
      pausedMs: sql`${discordWatchParty.pausedMs} + (EXTRACT(EPOCH FROM (${now.toISOString()}::timestamptz - ${discordWatchParty.pausedAt})) * 1000)::int`,
      pausedAt: null,
      renderedAt: now,
    },
    eq(discordWatchParty.status, 'live'),
    isNotNull(discordWatchParty.pausedAt),
  );
}

export function endParty(db: Db, id: string, now: Date) {
  return transition(
    db,
    id,
    { status: 'ended', endedAt: now, renderedAt: now },
    eq(discordWatchParty.status, 'live'),
  );
}

export function cancelParty(db: Db, id: string, now: Date) {
  return transition(
    db,
    id,
    { status: 'cancelled', endedAt: now, renderedAt: now },
    eq(discordWatchParty.status, 'scheduled'),
  );
}

/** Claim the right to credit the current item; null if it was already claimed or has moved on. */
export function claimCredit(db: Db, row: PartyRow, now: Date) {
  return transition(
    db,
    row.id,
    { itemCreditedAt: now },
    eq(discordWatchParty.status, 'live'),
    isNull(discordWatchParty.itemCreditedAt),
    eq(discordWatchParty.mediaId, row.mediaId),
    row.partNumber === null
      ? isNull(discordWatchParty.partNumber)
      : eq(discordWatchParty.partNumber, row.partNumber),
  );
}

export function advanceParty(
  db: Db,
  row: PartyRow,
  next: NextItem,
  durationSeconds: number | null,
  now: Date,
) {
  return transition(
    db,
    row.id,
    {
      mediaId: next.mediaId,
      partNumber: next.partNumber,
      durationSeconds,
      itemStartedAt: now,
      pausedAt: null,
      pausedMs: 0,
      itemCreditedAt: null,
      renderedAt: now,
    },
    eq(discordWatchParty.status, 'live'),
    eq(discordWatchParty.mediaId, row.mediaId),
    row.partNumber === null
      ? isNull(discordWatchParty.partNumber)
      : eq(discordWatchParty.partNumber, row.partNumber),
  );
}

export interface CreditResult {
  /** Discord ids whose Trackt account now has the item. */
  credited: string[];
  /** Discord ids in voice with no linked Trackt account. */
  unlinked: string[];
}

/**
 * Mark the party's current item watched for each linked member present: a
 * movie is completed, an episode checked in. Idempotent per member, as both
 * writes are.
 */
export async function creditWatchers(
  db: Db,
  row: PartyRow,
  discordUserIds: string[],
): Promise<CreditResult> {
  if (discordUserIds.length === 0) return { credited: [], unlinked: [] };
  const [work] = await db.select().from(media).where(eq(media.id, row.mediaId));
  if (!work || !canViewMedia(work)) return { credited: [], unlinked: [] };
  if (row.partNumber !== null && work.partCount !== null && row.partNumber > work.partCount) {
    return { credited: [], unlinked: [] };
  }

  const links = await db
    .select({ discordUserId: discordLink.discordUserId, userId: discordLink.userId })
    .from(discordLink)
    .where(inArray(discordLink.discordUserId, discordUserIds));
  for (const link of links) {
    if (row.partNumber === null) await setLogStatus(db, link.userId, work, 'completed');
    else await checkInPart(db, link.userId, work, row.partNumber);
  }
  const linked = new Set(links.map((link) => link.discordUserId));
  return {
    credited: discordUserIds.filter((id) => linked.has(id)),
    unlinked: discordUserIds.filter((id) => !linked.has(id)),
  };
}

/** Parties the scheduler still has work on. */
export function loadActiveParties(db: Db) {
  return db
    .select()
    .from(discordWatchParty)
    .where(
      or(
        inArray(discordWatchParty.status, ['scheduled', 'live']),
        isNotNull(discordWatchParty.voiceChannelId),
      ),
    );
}
