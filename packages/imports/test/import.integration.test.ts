import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  media,
  mediaPart,
  progress,
  rating,
  runMigrations,
  seedMedia,
  userMedia,
  users,
  type Db,
} from '@trackt/db';
import { canonicalMediaId } from '@trackt/shared';
import type { FetchLike } from '../src/mal/client.js';
import { planMalImport, runMalImport } from '../src/run.js';

/**
 * The importer against a real Postgres: id resolution by `external_ids.mal`,
 * the log/rating/progress writes, and the idempotency a second run depends on.
 *
 * Creates and migrates its own `trackt_import_test` database and self-skips
 * when Postgres is down, so `pnpm test` stays green without the dev compose
 * stack (`CI_REQUIRE_DB=1` turns that skip into a failure).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_IMPORTS ??
  'postgres://trackt:trackt@localhost:5432/trackt_import_test';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt';
  const admin = postgres(adminUrl.href, { max: 1, connect_timeout: 3 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
    return true;
  } catch (error) {
    if (process.env.CI_REQUIRE_DB) {
      throw new Error(`Postgres is unavailable but CI_REQUIRE_DB is set: ${String(error)}`, {
        cause: error,
      });
    }
    return false;
  } finally {
    await admin.end();
  }
}

const available = await ensureTestDatabase();

const bebopId = canonicalMediaId('anime', 1); // MAL 1, 26 episodes
const frierenId = canonicalMediaId('anime', 154587); // MAL 52991, 28 episodes
const fmaMangaId = canonicalMediaId('manga', 30025); // MAL 25, 116 chapters

/**
 * A MAL list as the API would hand it over: two rows the seed carries, one it
 * does not, and one with a partial date to exercise the mapper's warning path.
 */
const MAL_ANIME = {
  data: [
    {
      node: { id: 1, title: 'Cowboy Bebop' },
      list_status: {
        status: 'completed',
        score: 8,
        num_episodes_watched: 26,
        num_times_rewatched: 1,
        start_date: '2019-04-01',
        finish_date: '2019-04-12',
        comments: '  the movie was better  ',
      },
    },
    {
      node: { id: 52991, title: 'Sousou no Frieren' },
      list_status: {
        status: 'watching',
        score: 0,
        num_episodes_watched: 12,
        start_date: '2024-01',
      },
    },
    {
      node: { id: 999_999, title: 'A Show This Instance Does Not Have' },
      list_status: { status: 'plan_to_watch', num_episodes_watched: 0 },
    },
  ],
  paging: {},
};

const MAL_MANGA = {
  data: [
    {
      node: { id: 25, title: 'Fullmetal Alchemist' },
      list_status: {
        status: 'reading',
        score: 9,
        num_chapters_read: 10,
        num_volumes_read: 1,
        num_times_reread: 0,
      },
    },
  ],
  paging: {},
};

function stubMal(): FetchLike {
  return async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url.includes('/mangalist') ? MAL_MANGA : MAL_ANIME),
  });
}

describe.runIf(available)('MyAnimeList import (postgres)', () => {
  let db: Db;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 2 });
    await seedMedia(db);
    // The seed re-creates rows; import state from an earlier run must not leak.
    await db.delete(progress);
    await db.delete(rating);
    await db.delete(userMedia);
  });

  beforeEach(async () => {
    await db.delete(progress);
    await db.delete(rating);
    await db.delete(userMedia);
    const [user] = await db
      .insert(users)
      .values({ name: 'MAL Import Test', email: 'mal-import@test.local' })
      .onConflictDoUpdate({ target: users.email, set: { name: 'MAL Import Test' } })
      .returning({ id: users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  const run = (overrides: { dryRun?: boolean; overwrite?: boolean } = {}) =>
    runMalImport(db, {
      userId,
      profile: 'Kyoma__',
      clientId: 'test-client',
      fetch: stubMal(),
      requestSpacingMs: 0,
      now: new Date('2026-10-30T12:00:00Z'),
      ...overrides,
    });

  it('plans against the catalog and reports what it cannot place', async () => {
    const plan = await planMalImport(db, {
      userId,
      profile: 'Kyoma__',
      clientId: 'test-client',
      fetch: stubMal(),
      requestSpacingMs: 0,
      now: new Date('2026-10-30T12:00:00Z'),
    });

    expect(plan.summary).toMatchObject({ total: 4, matched: 3, unmatched: 1, existing: 0 });
    expect(plan.rows.find((row) => row.entry.externalId === 999_999)?.target).toBeNull();
    // The partial MAL date is dropped, not guessed at.
    expect(plan.warnings.map((w) => w.code)).toContain('partial-date');
  });

  it('writes status, dates, notes, score and progress, and skips unmatched rows', async () => {
    const { report } = await run();
    expect(report).toMatchObject({ created: 3, updated: 0, skippedExisting: 0, ratings: 2 });
    expect(report?.unmatched).toEqual([
      { externalId: 999_999, title: 'A Show This Instance Does Not Have' },
    ]);

    const [bebop] = await db.select().from(userMedia).where(eq(userMedia.mediaId, bebopId));
    expect(bebop).toMatchObject({
      status: 'completed',
      repeats: 1,
      notes: 'the movie was better',
    });
    expect(bebop?.startedAt).toBe('2019-04-01');
    expect(bebop?.finishedAt).toBe('2019-04-12');

    const [score] = await db.select().from(rating).where(eq(rating.targetId, bebopId));
    expect(Number(score?.score)).toBe(8);

    const [frieren] = await db.select().from(userMedia).where(eq(userMedia.mediaId, frierenId));
    expect(frieren).toMatchObject({ status: 'in_progress', notes: null });
    expect(frieren?.startedAt).toBeNull();

    const [fma] = await db.select().from(userMedia).where(eq(userMedia.mediaId, fmaMangaId));
    expect(fma?.status).toBe('in_progress');
  });

  it('checks in every part of a completed work and the position for a partial one', async () => {
    await run();

    const bebopParts = await db
      .select({ id: mediaPart.id })
      .from(mediaPart)
      .where(eq(mediaPart.mediaId, bebopId));
    const bebopProgress = await db
      .select({ partId: progress.partId })
      .from(progress)
      .where(eq(progress.userId, userId));
    expect(bebopParts).toHaveLength(26);
    expect(bebopProgress).toHaveLength(26 + 12 + 10);

    const frierenChecked = await db.execute(sql`
      SELECT count(*)::int AS count FROM progress p
      JOIN media_part mp ON mp.id = p.part_id
      WHERE p.user_id = ${userId} AND mp.media_id = ${frierenId}
    `);
    expect((frierenChecked[0] as { count: number }).count).toBe(12);
  });

  it('does nothing on a dry run', async () => {
    const { plan, report } = await run({ dryRun: true });
    expect(report).toBeNull();
    expect(plan.summary.matched).toBe(3);
    const rows = await db.select().from(userMedia);
    expect(rows).toHaveLength(0);
  });

  it('is idempotent: a second run adds nothing and rewrites nothing', async () => {
    await run();
    const { report } = await run();
    expect(report).toMatchObject({ created: 0, updated: 0, skippedExisting: 3 });
    const rows = await db.select().from(userMedia);
    expect(rows).toHaveLength(3);
  });

  it('rewrites an existing log only when asked to', async () => {
    await run();
    await db
      .update(userMedia)
      .set({ status: 'dropped', notes: 'mine, not MAL’s' })
      .where(eq(userMedia.mediaId, bebopId));

    await run();
    const [untouched] = await db.select().from(userMedia).where(eq(userMedia.mediaId, bebopId));
    expect(untouched?.status).toBe('dropped');
    expect(untouched?.notes).toBe('mine, not MAL’s');

    const { report } = await run({ overwrite: true });
    expect(report).toMatchObject({ created: 0, updated: 3 });
    const [rewritten] = await db.select().from(userMedia).where(eq(userMedia.mediaId, bebopId));
    expect(rewritten?.status).toBe('completed');
    expect(rewritten?.notes).toBe('the movie was better');
  });

  it('will not target a work pulled from circulation', async () => {
    await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, bebopId));
    try {
      const { plan } = await run({ dryRun: true });
      expect(plan.rows.find((row) => row.entry.externalId === 1)?.target).toBeNull();
      expect(plan.summary).toMatchObject({ matched: 2, unmatched: 2 });
    } finally {
      await db.update(media).set({ deletedAt: null }).where(eq(media.id, bebopId));
    }
  });
});
