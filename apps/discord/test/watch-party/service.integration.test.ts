import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  discordLink,
  discordWatchParty,
  media,
  mediaPart,
  progress,
  runMigrations,
  seedMedia,
  seedMediaRelations,
  userMedia,
  users,
  type Db,
} from '@trackt/db';
import { canonicalMediaId, canonicalSeriesSeasonId } from '@trackt/shared';
import {
  advanceParty,
  cancelParty,
  claimCredit,
  creditWatchers,
  endParty,
  findNextItem,
  loadParty,
  loadPartyView,
  pauseParty,
  resolveDurationSeconds,
  resumeParty,
  setRsvp,
  startParty,
  type PartyRow,
} from '../../src/watch-party/service.js';
import { testDatabase } from '../support/database.js';

const TEST_DATABASE_URL = await testDatabase('trackt_discord_watch_party_test');

const matrix = canonicalMediaId('movie', 603);
const breakingBadS1 = canonicalSeriesSeasonId(1396, 1);
const breakingBadS2 = canonicalSeriesSeasonId(1396, 2);
const severanceS1 = canonicalSeriesSeasonId(95396, 1);
const severanceS2 = canonicalSeriesSeasonId(95396, 2);
const bebop = canonicalMediaId('anime', 1);

describe.runIf(TEST_DATABASE_URL)('watch party service (postgres)', () => {
  let db: Db;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL!);
    db = createDb(TEST_DATABASE_URL!, { max: 1 });
    await seedMedia(db);
    await seedMediaRelations(db);
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  beforeEach(async () => {
    await db.delete(discordWatchParty);
    await db.update(media).set({ runtimeMinutes: null });
    await db.delete(mediaPart);
  });

  async function work(id: string) {
    const [row] = await db.select().from(media).where(eq(media.id, id));
    return row!;
  }

  async function party(
    mediaId: string,
    partNumber: number | null,
    overrides: Partial<typeof discordWatchParty.$inferInsert> = {},
  ): Promise<PartyRow> {
    const [row] = await db
      .insert(discordWatchParty)
      .values({
        guildId: '1',
        channelId: '2',
        hostDiscordId: '3',
        mediaId,
        partNumber,
        scheduledAt: new Date(),
        ...overrides,
      })
      .returning();
    return row!;
  }

  async function linkedUser(discordUserId: string): Promise<string> {
    const username = `w${randomUUID().slice(0, 12)}`;
    const [user] = await db
      .insert(users)
      .values({ name: 'Watcher', email: `${username}@example.com`, username })
      .returning({ id: users.id });
    await db
      .insert(discordLink)
      .values({ userId: user!.id, discordUserId, discordUsername: username });
    return user!.id;
  }

  describe('findNextItem', () => {
    it('steps through a season', async () => {
      expect(await findNextItem(db, await work(breakingBadS1), 3)).toEqual({
        mediaId: breakingBadS1,
        partNumber: 4,
      });
    });

    it('moves to the next season derived from the show id', async () => {
      expect(await findNextItem(db, await work(breakingBadS1), 7)).toEqual({
        mediaId: breakingBadS2,
        partNumber: 1,
      });
    });

    it('follows a stored sequel edge', async () => {
      expect(await findNextItem(db, await work(severanceS1), 9)).toEqual({
        mediaId: severanceS2,
        partNumber: 1,
      });
    });

    it('stops at the last known episode, and never for a movie', async () => {
      expect(await findNextItem(db, await work(breakingBadS2), 13)).toBeNull();
      expect(await findNextItem(db, await work(bebop), 26)).toBeNull();
      expect(await findNextItem(db, await work(matrix), null)).toBeNull();
    });
  });

  describe('resolveDurationSeconds', () => {
    it("prefers the episode's runtime, then the season's, then the host's", async () => {
      expect(await resolveDurationSeconds(db, breakingBadS1, 1, null)).toBeNull();
      expect(await resolveDurationSeconds(db, breakingBadS1, 1, 50)).toBe(50 * 60);
      await db.update(media).set({ runtimeMinutes: 47 }).where(eq(media.id, breakingBadS1));
      expect(await resolveDurationSeconds(db, breakingBadS1, 1, 50)).toBe(47 * 60);
      await db
        .insert(mediaPart)
        .values({ mediaId: breakingBadS1, kind: 'episode', number: '1', runtimeMinutes: 58 });
      expect(await resolveDurationSeconds(db, breakingBadS1, 1, 50)).toBe(58 * 60);
    });
  });

  describe('transitions', () => {
    it('runs a party through start, pause, resume and end, once each', async () => {
      const row = await party(matrix, null);
      const t0 = new Date('2026-09-30T20:00:00Z');

      expect(await startParty(db, row.id, t0)).toMatchObject({ status: 'live', itemStartedAt: t0 });
      expect(await startParty(db, row.id, t0)).toBeNull();

      expect(await pauseParty(db, row.id, new Date('2026-09-30T20:10:00Z'))).not.toBeNull();
      expect(await pauseParty(db, row.id, new Date('2026-09-30T20:11:00Z'))).toBeNull();
      const resumed = await resumeParty(db, row.id, new Date('2026-09-30T20:15:30Z'));
      expect(resumed).toMatchObject({ pausedAt: null, pausedMs: 330_000 });

      expect(await cancelParty(db, row.id, t0)).toBeNull();
      expect(await endParty(db, row.id, t0)).toMatchObject({ status: 'ended' });
      expect(await endParty(db, row.id, t0)).toBeNull();
    });

    it('credits an item once, and again only after moving on', async () => {
      const row = (await startParty(db, (await party(breakingBadS1, 1)).id, new Date()))!;
      expect(await claimCredit(db, row, new Date())).not.toBeNull();
      expect(await claimCredit(db, row, new Date())).toBeNull();

      const moved = await advanceParty(
        db,
        row,
        { mediaId: breakingBadS1, partNumber: 2 },
        2820,
        new Date(),
      );
      expect(moved).toMatchObject({ partNumber: 2, itemCreditedAt: null, durationSeconds: 2820 });
      // A stale row cannot advance a party that has already moved on.
      expect(
        await advanceParty(db, row, { mediaId: breakingBadS1, partNumber: 2 }, null, new Date()),
      ).toBeNull();
      expect(await claimCredit(db, moved!, new Date())).not.toBeNull();
    });

    it('takes RSVPs only while the party is open', async () => {
      const row = await party(matrix, null);
      expect(await setRsvp(db, row, '10', 'going')).toBe(true);
      expect(await setRsvp(db, row, '10', 'maybe')).toBe(true);
      const view = await loadPartyView(db, (await loadParty(db, row.id))!);
      expect(view?.rsvps).toEqual([{ discordUserId: '10', response: 'maybe' }]);

      const cancelled = (await cancelParty(db, row.id, new Date()))!;
      expect(await setRsvp(db, cancelled, '11', 'going')).toBe(false);
    });
  });

  describe('creditWatchers', () => {
    it('completes a movie for linked watchers and names the rest', async () => {
      const discordId = `${Date.now()}1`;
      const userId = await linkedUser(discordId);
      const row = await party(matrix, null);

      const result = await creditWatchers(db, row, [discordId, 'unlinked-1']);

      expect(result).toEqual({ credited: [discordId], unlinked: ['unlinked-1'] });
      const [log] = await db
        .select()
        .from(userMedia)
        .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, matrix)));
      expect(log?.status).toBe('completed');
      expect(log?.finishedAt).not.toBeNull();
    });

    it('checks in the episode, and only that one', async () => {
      const discordId = `${Date.now()}2`;
      const userId = await linkedUser(discordId);
      const row = await party(breakingBadS1, 3);

      await creditWatchers(db, row, [discordId]);
      await creditWatchers(db, row, [discordId]);

      const watched = await db
        .select({ number: mediaPart.number })
        .from(progress)
        .innerJoin(mediaPart, eq(mediaPart.id, progress.partId))
        .where(eq(progress.userId, userId));
      expect(watched).toEqual([{ number: '3.00' }]);
      const [log] = await db
        .select()
        .from(userMedia)
        .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, breakingBadS1)));
      expect(log?.status).toBe('in_progress');
    });
  });
});
