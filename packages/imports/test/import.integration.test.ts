import { eq, inArray, sql } from 'drizzle-orm';
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
import type { FetchLike } from '../src/http/fetch.js';
import { entryKey, resolveImportEntries } from '../src/resolve.js';
import { planImport, runImport } from '../src/run.js';
import { IMPORT_SOURCES } from '../src/sources.js';
import type { ImportEntry, ImportSource } from '../src/types.js';
import type { ImportSourceDefinition } from '../src/sources.js';

/**
 * The importer against a real Postgres: id resolution per source (key priority,
 * season scoping, title fallback, ambiguity refusal), the log/rating/progress
 * writes, and the idempotency a second run depends on.
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

const bebopId = canonicalMediaId('anime', 1); // MAL 1 / AniList 1, 26 episodes
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

interface AniListRowOptions {
  mediaId: number;
  status: string;
  score?: number;
  progress?: number;
  repeat?: number;
  notes?: string | null;
  startedAt?: { year: number | null; month: number | null; day: number | null } | null;
  completedAt?: { year: number | null; month: number | null; day: number | null } | null;
  idMal?: number | null;
  title?: { romaji: string | null; english: string | null };
}

function anilistRow(row: AniListRowOptions): unknown {
  return {
    mediaId: row.mediaId,
    status: row.status,
    score: row.score ?? 0,
    progress: row.progress ?? 0,
    repeat: row.repeat ?? 0,
    notes: row.notes ?? null,
    startedAt: row.startedAt ?? { year: null, month: null, day: null },
    completedAt: row.completedAt ?? { year: null, month: null, day: null },
    media: {
      id: row.mediaId,
      idMal: row.idMal ?? null,
      episodes: null,
      chapters: null,
      format: 'TV',
      seasonYear: null,
      title: row.title ?? { romaji: `AniList ${row.mediaId}`, english: null },
    },
  };
}

/** AniList answers both types in one response each; this stub serves both. */
function stubAniList(): FetchLike {
  return async (_url, init) => {
    const type = (JSON.parse(init.body ?? '{}') as { variables: { type: string } }).variables.type;
    const entries =
      type === 'MANGA'
        ? [
            anilistRow({
              mediaId: 30025,
              status: 'COMPLETED',
              score: 90,
              progress: 116,
              idMal: 25,
              title: { romaji: 'Hagane no Renkinjutsushi', english: 'Fullmetal Alchemist' },
            }),
          ]
        : [
            anilistRow({
              mediaId: 154587,
              status: 'CURRENT',
              score: 85,
              progress: 12,
              idMal: 52991,
              startedAt: { year: 2024, month: 1, day: 5 },
              title: { romaji: 'Sousou no Frieren', english: "Frieren: Beyond Journey's End" },
            }),
            anilistRow({
              mediaId: 900001,
              status: 'PLANNING',
              title: { romaji: 'A Work This Instance Does Not Have', english: null },
            }),
          ];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { MediaListCollection: { lists: [{ name: 'Lists', entries }] } },
      }),
    };
  };
}

function entry(overrides: Partial<ImportEntry> = {}): ImportEntry {
  return {
    source: 'anilist',
    kind: 'anime',
    externalId: '900100',
    title: 'Cowboy Bebop',
    year: 1998,
    seasonNumber: null,
    status: 'in_progress',
    score: null,
    progress: 3,
    repeats: 0,
    startedAt: null,
    finishedAt: null,
    notes: null,
    externalIds: { anilist: 900100 },
    ...overrides,
  };
}

const NOW = new Date('2026-10-30T12:00:00Z');

describe.runIf(available)('account import (postgres)', () => {
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
      .values({ name: 'Import Test', email: 'import@test.local' })
      .onConflictDoUpdate({ target: users.email, set: { name: 'Import Test' } })
      .returning({ id: users.id });
    userId = user!.id;
  });

  afterAll(async () => {
    await db.$client.end();
  });

  const runMal = (overrides: { dryRun?: boolean; overwrite?: boolean } = {}) =>
    runImport(db, {
      userId,
      source: 'mal',
      profile: 'Kyoma__',
      credentials: { malClientId: 'test-client' },
      fetch: stubMal(),
      requestSpacingMs: 0,
      now: NOW,
      ...overrides,
    });

  describe('MyAnimeList', () => {
    it('plans against the catalog and reports what it cannot place', async () => {
      const plan = await planImport(db, {
        userId,
        source: 'mal',
        profile: 'Kyoma__',
        credentials: { malClientId: 'test-client' },
        fetch: stubMal(),
        requestSpacingMs: 0,
        now: NOW,
      });

      expect(plan.summary).toMatchObject({ total: 4, matched: 3, unmatched: 1, existing: 0 });
      expect(plan.rows.find((row) => row.entry.externalId === '999999')?.target).toBeNull();
      // The partial MAL date is dropped, not guessed at.
      expect(plan.warnings.map((w) => w.code)).toContain('partial-date');
      expect(
        plan.rows.every((row) => row.matchedBy === 'external-id' || row.matchedBy === null),
      ).toBe(true);
    });

    it('writes status, dates, notes, score and progress, and skips unmatched rows', async () => {
      const { report } = await runMal();
      expect(report).toMatchObject({ created: 3, updated: 0, skippedExisting: 0, ratings: 2 });
      expect(report?.unmatched).toEqual([
        { externalId: '999999', title: 'A Show This Instance Does Not Have' },
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
      await runMal();

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
      const { plan, report } = await runMal({ dryRun: true });
      expect(report).toBeNull();
      expect(plan.summary.matched).toBe(3);
      const rows = await db.select().from(userMedia);
      expect(rows).toHaveLength(0);
    });

    it('is idempotent: a second run adds nothing and rewrites nothing', async () => {
      await runMal();
      const { report } = await runMal();
      expect(report).toMatchObject({ created: 0, updated: 0, skippedExisting: 3 });
      const rows = await db.select().from(userMedia);
      expect(rows).toHaveLength(3);
    });

    it('rewrites an existing log only when asked to', async () => {
      await runMal();
      await db
        .update(userMedia)
        .set({ status: 'dropped', notes: 'mine, not MAL’s' })
        .where(eq(userMedia.mediaId, bebopId));

      await runMal();
      const [untouched] = await db.select().from(userMedia).where(eq(userMedia.mediaId, bebopId));
      expect(untouched?.status).toBe('dropped');
      expect(untouched?.notes).toBe('mine, not MAL’s');

      const { report } = await runMal({ overwrite: true });
      expect(report).toMatchObject({ created: 0, updated: 3 });
      const [rewritten] = await db.select().from(userMedia).where(eq(userMedia.mediaId, bebopId));
      expect(rewritten?.status).toBe('completed');
      expect(rewritten?.notes).toBe('the movie was better');
    });

    it('will not target a work pulled from circulation', async () => {
      await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, bebopId));
      try {
        const { plan } = await runMal({ dryRun: true });
        expect(plan.rows.find((row) => row.entry.externalId === '1')?.target).toBeNull();
        expect(plan.summary).toMatchObject({ matched: 2, unmatched: 2 });
      } finally {
        await db.update(media).set({ deletedAt: null }).where(eq(media.id, bebopId));
      }
    });
  });

  describe('AniList', () => {
    it('imports a list end to end, through its own join key', async () => {
      const { plan, report } = await runImport(db, {
        userId,
        source: 'anilist',
        profile: 'taluun',
        credentials: {},
        fetch: stubAniList(),
        requestSpacingMs: 0,
        now: NOW,
      });

      expect(plan.summary).toMatchObject({ total: 3, matched: 2, unmatched: 1, pending: 2 });
      expect(plan.rows.find((row) => row.target === null)?.entry.externalId).toBe('900001');
      expect(report).toMatchObject({ created: 2, ratings: 2 });

      const [frieren] = await db.select().from(userMedia).where(eq(userMedia.mediaId, frierenId));
      expect(frieren).toMatchObject({ status: 'in_progress' });
      expect(frieren?.startedAt).toBe('2024-01-05');

      // The mapper carried AniList's 85/100 as an 8.5 → 9 on Trackt's scale.
      const [score] = await db.select().from(rating).where(eq(rating.targetId, frierenId));
      expect(Number(score?.score)).toBe(9);
    });

    it('joins on the id its registry declares, and not on another source’s', async () => {
      const [viaAniList, viaMal] = await Promise.all([
        resolveImportEntries(db, [entry({ externalIds: { anilist: 154587 } })]),
        resolveImportEntries(db, [entry({ externalIds: { mal: 52991 } })]),
      ]);

      const matched = viaAniList.targets.get(entryKey(entry({ externalIds: { anilist: 154587 } })));
      expect(matched).toMatchObject({ id: frierenId, matchedBy: 'external-id' });
      // AniList's entry carries the MAL id too, but the resolver only walks the
      // keys its source declares — a MAL id alone is not an AniList match.
      expect(viaMal.targets.size).toBe(0);
    });

    it('scopes a per-season entry to the row for that season', async () => {
      // What Trakt will declare: one entry per season, joined on the show id.
      const perSeason: Record<ImportSource, ImportSourceDefinition> = {
        ...IMPORT_SOURCES,
        anilist: { ...IMPORT_SOURCES.anilist, kinds: ['series'], joinKeys: ['tmdb'] },
      };
      const season = (seasonNumber: number) =>
        entry({
          kind: 'series',
          title: 'Breaking Bad',
          year: 2008,
          seasonNumber,
          externalIds: { tmdb: 1396 },
        });

      const { targets } = await resolveImportEntries(
        db,
        [season(1), season(2), season(3)],
        perSeason,
      );

      expect(targets.get(entryKey(season(1)))?.seasonNumber).toBe(1);
      expect(targets.get(entryKey(season(2)))?.seasonNumber).toBe(2);
      expect(targets.get(entryKey(season(1)))?.id).not.toBe(targets.get(entryKey(season(2)))?.id);
      // Season 3 is not in the fixture catalog.
      expect(targets.has(entryKey(season(3)))).toBe(false);
    });

    it('falls back to a normalised title with the exact year, and says so', async () => {
      const withFallback: Record<ImportSource, ImportSourceDefinition> = {
        ...IMPORT_SOURCES,
        anilist: { ...IMPORT_SOURCES.anilist, titleFallback: true },
      };
      const byTitle = entry({
        externalId: '424242',
        title: 'FRIEREN: Beyond Journey’s End!!',
        year: 2023,
        externalIds: { anilist: 424242 },
      });
      const wrongYear = entry({
        externalId: '424243',
        title: 'Frieren: Beyond Journey’s End',
        year: 2020,
        externalIds: { anilist: 424243 },
      });

      const { targets, warnings } = await resolveImportEntries(
        db,
        [byTitle, wrongYear],
        withFallback,
      );

      expect(targets.get(entryKey(byTitle))).toMatchObject({
        id: frierenId,
        matchedBy: 'title',
      });
      // A title alone is not a match: the year has to agree.
      expect(targets.has(entryKey(wrongYear))).toBe(false);
      expect(warnings).toEqual([]);
    });

    it('refuses a title two local rows answer to', async () => {
      const twins = [
        '00000000-0000-4000-8000-0000000000a1',
        '00000000-0000-4000-8000-0000000000a2',
      ];
      await db
        .insert(media)
        .values(
          twins.map((id, index) => ({
            id,
            kind: 'anime' as const,
            title: 'Twin Work',
            slug: `twin-work-2020-${index}`,
            year: 2020,
            partCount: 12,
            externalIds: {},
          })),
        )
        .onConflictDoNothing();

      try {
        const withFallback: Record<ImportSource, ImportSourceDefinition> = {
          ...IMPORT_SOURCES,
          anilist: { ...IMPORT_SOURCES.anilist, titleFallback: true },
        };
        const ambiguous = entry({
          externalId: '424244',
          title: 'Twin Work',
          year: 2020,
          externalIds: { anilist: 424244 },
        });

        const { targets, warnings } = await resolveImportEntries(db, [ambiguous], withFallback);

        expect(targets.has(entryKey(ambiguous))).toBe(false);
        expect(warnings.map((w) => w.code)).toEqual(['ambiguous-title-match']);

        const plan = await planImport(db, {
          userId,
          source: 'anilist',
          profile: 'taluun',
          credentials: {},
          fetch: async (_url, init) => {
            const type = (JSON.parse(init.body ?? '{}') as { variables: { type: string } })
              .variables.type;
            return {
              ok: true,
              status: 200,
              json: async () => ({
                data: {
                  MediaListCollection: {
                    lists:
                      type === 'ANIME'
                        ? [
                            {
                              name: 'Lists',
                              entries: [
                                anilistRow({
                                  mediaId: 424244,
                                  status: 'COMPLETED',
                                  progress: 12,
                                  title: { romaji: 'Twin Work', english: null },
                                }),
                              ],
                            },
                          ]
                        : [],
                  },
                },
              }),
            };
          },
        });
        // The fallback is off by default, so a same-title row is simply unmatched.
        expect(plan.summary).toMatchObject({ matched: 0, unmatched: 1 });
      } finally {
        await db.delete(media).where(inArray(media.id, twins));
      }
    });
  });
});
