import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  favorite,
  importMatch,
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
import { canonicalMediaId, canonicalSeriesSeasonId } from '@trackt/shared';
import { recordUncertainMatches } from '../src/apply.js';
import type { FetchLike, PageFetcher } from '../src/http/fetch.js';
import { MATCH_THRESHOLD } from '../src/match.js';
import { buildImportPlan } from '../src/plan.js';
import { replayImportReport } from '../src/replay.js';
import type { PlanReport, PlanReportRow } from '../src/report.js';
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
const breakingBadS1Id = canonicalSeriesSeasonId(1396, 1); // 7 episodes
const breakingBadS2Id = canonicalSeriesSeasonId(1396, 2); // 13 episodes

/**
 * A MAL list as `/load.json` hands it over: two rows the seed carries, one it
 * does not, the client's own dates in MAL's `DD-MM-YY`, and a rewatch flag.
 */
const MAL_ANIME = [
  {
    anime_id: 1,
    anime_title: 'Cowboy Bebop',
    status: 2,
    score: 8,
    num_watched_episodes: 26,
    is_rewatching: 1,
    start_date_string: '01-04-19',
    finish_date_string: '12-04-19',
    anime_start_date_string: '03-04-98',
    notes: '  the movie was better  ',
  },
  {
    anime_id: 52991,
    anime_title: 'Sousou no Frieren',
    status: 1,
    score: 0,
    num_watched_episodes: 12,
    is_rewatching: 0,
    start_date_string: null,
    finish_date_string: null,
    anime_start_date_string: '29-09-23',
    notes: '',
  },
  {
    anime_id: 999_999,
    anime_title: 'A Show This Instance Does Not Have',
    status: 6,
    score: 0,
    num_watched_episodes: 0,
    is_rewatching: 0,
    start_date_string: null,
    finish_date_string: null,
    anime_start_date_string: '01-01-30',
    notes: '',
  },
];

const MAL_MANGA = [
  {
    manga_id: 25,
    manga_title: 'Fullmetal Alchemist',
    status: 1,
    score: 9,
    num_read_chapters: 10,
    num_read_volumes: 1,
    is_rereading: 0,
    start_date_string: null,
    finish_date_string: null,
    manga_start_date_string: '06-07-01',
    notes: '',
  },
];

/** Bebop is on the list; NHK ni Youkoso! is pinned but on neither list. */
const MAL_FAVORITES = `
  <h5>Anime</h5>
  <div class="boxlist-container anime mb16">
    <div class="boxlist col-4">
      <div class="di-tc va-t pl8 data">
        <div class="title"><a href="https://myanimelist.net/anime/1/Cowboy_Bebop">Cowboy Bebop</a></div>
        <div class="di-ib mt4 fn-grey2">TV ･ 1998</div>
      </div>
    </div>
    <div class="boxlist col-4">
      <div class="di-tc va-t pl8 data">
        <div class="title"><a href="https://myanimelist.net/anime/1210/NHK_ni_Youkoso">NHK ni Youkoso!</a></div>
        <div class="di-ib mt4 fn-grey2">TV ･ 2006</div>
      </div>
    </div>
  </div>`;

function stubMal(): PageFetcher {
  return {
    async get(url) {
      if (url.includes('/favorites')) return { status: 200, body: MAL_FAVORITES };
      const first = url.includes('offset=0');
      const rows = url.includes('/animelist/') ? MAL_ANIME : MAL_MANGA;
      return { status: 200, body: first ? JSON.stringify(rows) : '[]' };
    },
  };
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

/**
 * Trakt as the adapter reads it. The bodies are the hand-written fixtures in
 * `test/fixtures/trakt/` (documented shapes, not captures): no client id was
 * available on this machine to record a real profile.
 */
function stubTrakt(): FetchLike {
  const fixture = (name: string): unknown =>
    JSON.parse(
      readFileSync(new URL(`./fixtures/trakt/${name}`, import.meta.url), 'utf8'),
    ) as unknown;

  const announcedProgress = {
    aired: 0,
    completed: 0,
    seasons: [{ number: 1, title: 'Season 1', aired: 0, completed: 0, episodes: [] }],
  };

  return async (url) => {
    const path = new URL(url).pathname;
    let body: unknown;
    if (path.endsWith('/watched/movies')) body = fixture('watched-movies.json');
    else if (path.endsWith('/watched/shows')) body = fixture('watched-shows.json');
    else if (path.endsWith('/shows/1388/progress/watched')) body = fixture('show-progress.json');
    else if (path.endsWith('/progress/watched')) body = announcedProgress;
    else if (path.endsWith('/ratings/movies')) body = fixture('ratings-movies.json');
    else if (path.endsWith('/ratings/shows'))
      body = [
        {
          rated_at: '2020-03-01T10:00:00.000Z',
          rating: 9,
          type: 'show',
          show: { title: 'Breaking Bad', year: 2008, ids: { trakt: 1388, tmdb: 1396 } },
        },
      ];
    else if (path.endsWith('/watchlist/movies')) body = fixture('watchlist-movies.json');
    else if (path.endsWith('/watchlist/shows'))
      body = [
        {
          rank: 1,
          listed_at: '2026-01-06T10:00:00.000Z',
          type: 'show',
          show: { title: 'The Wire', year: 2002, ids: { trakt: 1438, tmdb: 1438 } },
        },
      ];
    else return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
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
    favourite: false,
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
    await db.delete(favorite);
    await db.delete(userMedia);
  });

  beforeEach(async () => {
    await db.delete(progress);
    await db.delete(rating);
    await db.delete(favorite);
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
      credentials: {},
      fetcher: stubMal(),
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
        credentials: {},
        fetcher: stubMal(),
        requestSpacingMs: 0,
        now: NOW,
      });

      expect(plan.summary).toMatchObject({ total: 4, matched: 3, unmatched: 1, existing: 0 });
      expect(plan.rows.find((row) => row.entry.externalId === '999999')?.target).toBeNull();
      // A favourite with no list row is reported, not invented.
      expect(plan.warnings.map((w) => w.code)).toContain('favourite-not-listed');
      expect(plan.summary.favourites).toBe(1);
      expect(
        plan.rows.every((row) => row.matchedBy === 'external-id' || row.matchedBy === null),
      ).toBe(true);
    });

    it('writes status, dates, notes, score and progress, and skips unmatched rows', async () => {
      const { report } = await runMal();
      expect(report).toMatchObject({
        created: 3,
        updated: 0,
        skippedExisting: 0,
        ratings: 2,
        favourites: 1,
      });
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

      // The profile's pin lands on the row the list already carried.
      const pins = await db.select().from(favorite).where(eq(favorite.userId, userId));
      expect(pins.map((pin) => pin.mediaId)).toEqual([bebopId]);
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

    /**
     * The two-2023-films case, end to end: `/media/cobweb-2023` is Kim Jee-woon's
     * (KR) and the second row is Samuel Bodin's (US). A provider that states no
     * country leaves the call a coin flip; one that does state it decides.
     */
    it('breaks a same-title tie on the provider’s country, and only then', async () => {
      const ids = ['00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000b2'];
      await db
        .insert(media)
        .values([
          {
            id: ids[0]!,
            kind: 'movie' as const,
            title: 'Cobweb Tie',
            slug: 'cobweb-tie-kr',
            year: 2023,
            externalIds: {},
            metadata: { originCountry: ['KR'] },
          },
          {
            id: ids[1]!,
            kind: 'movie' as const,
            title: 'Cobweb Tie',
            slug: 'cobweb-tie-us',
            year: 2023,
            externalIds: {},
            metadata: { originCountry: ['US'] },
          },
        ])
        .onConflictDoNothing();

      try {
        const withFallback: Record<ImportSource, ImportSourceDefinition> = {
          ...IMPORT_SOURCES,
          letterboxd: { ...IMPORT_SOURCES.letterboxd, titleFallback: true },
        };
        const korean = entry({
          source: 'letterboxd',
          kind: 'movie',
          externalId: 'cobweb-tie-kr',
          title: 'Cobweb Tie',
          year: 2023,
          originCountry: ['South Korea'],
          externalIds: {},
        });
        const silent = entry({
          source: 'letterboxd',
          kind: 'movie',
          externalId: 'cobweb-tie-unknown',
          title: 'Cobweb Tie',
          year: 2023,
          externalIds: {},
        });

        const { targets, warnings, uncertain } = await resolveImportEntries(
          db,
          [korean, silent],
          withFallback,
        );

        expect(targets.get(entryKey(korean))).toMatchObject({
          id: ids[0]!,
          matchedBy: 'title',
          matchScore: 1,
        });
        // No country on either side is not evidence: the tie stands.
        expect(targets.has(entryKey(silent))).toBe(false);
        expect(warnings.map((w) => w.code)).toEqual(['ambiguous-title-match']);

        // …and both rows are kept, because only the viewer knows which one.
        const shortlist = uncertain.get(entryKey(silent));
        expect(shortlist?.outcome).toBe('tie');
        expect(shortlist?.candidates.map((candidate) => candidate.id).sort()).toEqual(
          [...ids].sort(),
        );
        expect(shortlist?.candidates.every((candidate) => candidate.score > 0.9)).toBe(true);
        expect(shortlist?.candidates.every((candidate) => candidate.origin === 'local')).toBe(true);
      } finally {
        await db.delete(media).where(inArray(media.id, ids));
      }
    });

    /**
     * A word off in a long title is evidence, not noise: 7 of 8 words agree, so
     * the row matches — and the warning is what a person checks afterwards.
     */
    it('matches a title one word off when the title is long, and flags it', async () => {
      const id = '00000000-0000-4000-8000-0000000000c1';
      await db
        .insert(media)
        .values({
          id,
          kind: 'movie' as const,
          title: 'A Very Long Title About Nothing At All',
          slug: 'a-very-long-title-about-nothing-at-all',
          year: 2024,
          externalIds: {},
        })
        .onConflictDoNothing();

      try {
        const withFallback: Record<ImportSource, ImportSourceDefinition> = {
          ...IMPORT_SOURCES,
          letterboxd: { ...IMPORT_SOURCES.letterboxd, titleFallback: true },
        };
        const near = entry({
          source: 'letterboxd',
          kind: 'movie',
          externalId: 'a-very-long-title',
          title: 'A Very Long Title About Something At All',
          year: 2024,
          externalIds: {},
        });

        const { targets, warnings } = await resolveImportEntries(db, [near], withFallback);

        const target = targets.get(entryKey(near));
        expect(target).toMatchObject({ id, matchedBy: 'title' });
        expect(target?.matchScore).toBeGreaterThan(0.8);
        expect(target?.matchScore).toBeLessThan(1);
        expect(warnings.map((w) => w.code)).toEqual(['fuzzy-title-match']);
      } finally {
        await db.delete(media).where(inArray(media.id, [id]));
      }
    });

    /**
     * The real case: Letterboxd dates Good Manners 2017, TMDB (and so this
     * instance) 2018. A year is a release convention, not identity, so one year
     * apart matches; two years apart is a near miss the report keeps.
     */
    it('matches across a one-year disagreement, and refuses two', async () => {
      const id = '00000000-0000-4000-8000-0000000000d1';
      await db
        .insert(media)
        .values({
          id,
          kind: 'movie' as const,
          title: 'Good Manners Year',
          slug: 'good-manners-year',
          year: 2018,
          externalIds: {},
        })
        .onConflictDoNothing();

      try {
        const withFallback: Record<ImportSource, ImportSourceDefinition> = {
          ...IMPORT_SOURCES,
          letterboxd: { ...IMPORT_SOURCES.letterboxd, titleFallback: true },
        };
        const one = entry({
          source: 'letterboxd',
          kind: 'movie',
          externalId: 'good-manners-year',
          title: 'Good Manners Year',
          year: 2017,
          externalIds: {},
        });
        const two = entry({
          source: 'letterboxd',
          kind: 'movie',
          externalId: 'good-manners-year-2',
          title: 'Good Manners Year',
          year: 2016,
          externalIds: {},
        });

        const { targets, uncertain, warnings } = await resolveImportEntries(
          db,
          [one, two],
          withFallback,
        );

        const matched = targets.get(entryKey(one));
        expect(matched).toMatchObject({ id, matchedBy: 'title' });
        // ~0.83: the year costs the confidence, the identical title carries it.
        expect(matched?.matchScore).toBeGreaterThan(MATCH_THRESHOLD);
        expect(matched?.matchScore).toBeLessThan(0.9);
        // An identical title is not a "fuzzy" one, whatever the year says.
        expect(warnings).toEqual([]);

        expect(targets.has(entryKey(two))).toBe(false);
        const shortlist = uncertain.get(entryKey(two));
        expect(shortlist?.outcome).toBe('below-threshold');
        expect(shortlist?.candidates[0]?.score).toBeLessThan(MATCH_THRESHOLD);
        expect(shortlist?.candidates[0]?.score).toBeGreaterThan(0.6);
        expect(shortlist?.candidates[0]?.id).toBe(id);
      } finally {
        await db.delete(media).where(inArray(media.id, [id]));
      }
    });

    it('stores the shortlist a picker needs, and clears it on the next run', async () => {
      const id = '00000000-0000-4000-8000-0000000000e1';
      await db
        .insert(media)
        .values({
          id,
          kind: 'movie' as const,
          title: 'Almost Chosen',
          slug: 'almost-chosen',
          year: 2018,
          externalIds: {},
        })
        .onConflictDoNothing();

      try {
        const near = entry({
          source: 'letterboxd',
          kind: 'movie',
          externalId: 'almost-chosen',
          title: 'Almost Chosen Film',
          year: 2018,
          externalIds: {},
        });
        const withFallback: Record<ImportSource, ImportSourceDefinition> = {
          ...IMPORT_SOURCES,
          letterboxd: { ...IMPORT_SOURCES.letterboxd, titleFallback: true },
        };
        const { uncertain } = await resolveImportEntries(db, [near], withFallback);

        const plan = buildImportPlan({
          source: 'letterboxd',
          profile: 'someone',
          entries: [near],
          targets: new Map(),
          loggedMediaIds: new Set(),
          uncertain,
        });

        expect(await recordUncertainMatches(db, userId, plan)).toBe(1);
        const [stored] = await db
          .select()
          .from(importMatch)
          .where(and(eq(importMatch.userId, userId), eq(importMatch.entryKey, entryKey(near))));
        expect(stored).toMatchObject({
          source: 'letterboxd',
          externalId: 'almost-chosen',
          outcome: 'below-threshold',
          title: 'Almost Chosen Film',
          year: 2018,
        });
        expect(stored!.bestScore).toBeGreaterThan(0.5);
        expect(stored!.bestScore).toBeLessThan(MATCH_THRESHOLD);
        expect(stored!.candidates[0]).toMatchObject({ id, origin: 'local' });
        // The entry rides along, so answering the pick later needs no provider.
        expect(stored!.entry).toMatchObject({ externalId: 'almost-chosen', status: 'in_progress' });

        // A run that resolves everything replaces the set instead of appending.
        const clean = buildImportPlan({
          source: 'letterboxd',
          profile: 'someone',
          entries: [near],
          targets: new Map([
            [
              entryKey(near),
              {
                id,
                kind: 'movie' as const,
                title: 'Almost Chosen',
                partCount: null,
                seasonNumber: null,
                matchedBy: 'title' as const,
                matchScore: 1,
              },
            ],
          ]),
          loggedMediaIds: new Set(),
        });
        expect(await recordUncertainMatches(db, userId, clean)).toBe(0);
        expect(
          await db
            .select({ id: importMatch.id })
            .from(importMatch)
            .where(and(eq(importMatch.userId, userId), eq(importMatch.source, 'letterboxd'))),
        ).toEqual([]);
      } finally {
        await db.delete(importMatch).where(eq(importMatch.userId, userId));
        await db.delete(media).where(inArray(media.id, [id]));
      }
    });

    it('keeps the closest rejected row, so “absent” and “nearly” differ', async () => {
      const withFallback: Record<ImportSource, ImportSourceDefinition> = {
        ...IMPORT_SOURCES,
        anilist: { ...IMPORT_SOURCES.anilist, titleFallback: true },
      };
      const grey = entry({
        externalId: '424246',
        title: 'Frieren Beyond Journeys',
        year: 2023,
        externalIds: { anilist: 424246 },
      });

      const { targets, uncertain } = await resolveImportEntries(db, [grey], withFallback);

      expect(targets.has(entryKey(grey))).toBe(false);
      const shortlist = uncertain.get(entryKey(grey));
      expect(shortlist).toBeDefined();
      expect(shortlist!.candidates[0]!.score).toBeLessThan(MATCH_THRESHOLD);
      expect(shortlist!.candidates[0]!.title).toContain('Frieren');
      expect(shortlist!.candidates[0]!.origin).toBe('local');
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

  describe('Trakt', () => {
    const traktSeason = (seasonNumber: number): ImportEntry =>
      entry({
        source: 'trakt',
        kind: 'series',
        title: 'Breaking Bad',
        year: 2008,
        seasonNumber,
        externalIds: { tmdb: 1396 },
      });

    it('scopes a per-season entry to the row with that season number', async () => {
      // The real registry this time, not a mutated one: Trakt joins on TMDB and
      // one show is one entry per season.
      const { targets } = await resolveImportEntries(db, [
        traktSeason(1),
        traktSeason(2),
        traktSeason(3),
      ]);

      expect(targets.get(entryKey(traktSeason(1)))?.id).toBe(breakingBadS1Id);
      expect(targets.get(entryKey(traktSeason(2)))?.id).toBe(breakingBadS2Id);
      expect(targets.get(entryKey(traktSeason(1)))?.seasonNumber).toBe(1);
      expect(targets.get(entryKey(traktSeason(2)))?.seasonNumber).toBe(2);
      // Season 3 is not in the fixture catalog, and a season number must not
      // fall back to "any season of this show".
      expect(targets.has(entryKey(traktSeason(3)))).toBe(false);
    });

    it('imports movies and one row per watched season end to end', async () => {
      const { plan, report } = await runImport(db, {
        userId,
        source: 'trakt',
        profile: 'paul',
        credentials: { traktClientId: 'test-client' },
        fetch: stubTrakt(),
        requestSpacingMs: 0,
        now: NOW,
      });

      // Three watched films, two Breaking Bad seasons, one watchlisted film
      // (The Matrix is watchlisted *and* watched: one row, the watched one).
      // The announced show's season has nothing out and is skipped.
      expect(plan.summary).toMatchObject({ total: 6, matched: 5, unmatched: 1 });
      expect(plan.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['partial-source']));
      expect(plan.warnings.some((w) => /no aired episode/.test(w.message))).toBe(true);
      expect(plan.warnings.some((w) => /planned show names no season/.test(w.message))).toBe(true);

      const seasonOne = plan.rows.find((row) => row.entry.seasonNumber === 1);
      const seasonTwo = plan.rows.find((row) => row.entry.seasonNumber === 2);
      expect(seasonOne?.target?.id).toBe(breakingBadS1Id);
      expect(seasonTwo?.target?.id).toBe(breakingBadS2Id);

      expect(report).toMatchObject({ created: 5, ratings: 3 });

      const [s1] = await db.select().from(userMedia).where(eq(userMedia.mediaId, breakingBadS1Id));
      expect(s1).toMatchObject({ status: 'in_progress', repeats: 1 });
      expect(s1?.startedAt).toBe('2020-01-05');
      expect(s1?.finishedAt).toBeNull();

      const [s2] = await db.select().from(userMedia).where(eq(userMedia.mediaId, breakingBadS2Id));
      expect(s2).toMatchObject({ status: 'completed' });
      expect(s2?.startedAt).toBe('2020-02-01');
      expect(s2?.finishedAt).toBe('2020-02-03');

      // The show rating landed on both seasons, each on its own media row.
      const scores = await db
        .select({ targetId: rating.targetId, score: rating.score })
        .from(rating)
        .where(eq(rating.userId, userId));
      expect(
        scores.filter(
          (row) => row.targetId === breakingBadS1Id || row.targetId === breakingBadS2Id,
        ),
      ).toHaveLength(2);

      // Season 1 is on episode 5 (1, 2 and 5 watched), so five parts are checked.
      const checked = await db.execute(sql`
        SELECT count(*)::int AS count FROM progress p
        JOIN media_part mp ON mp.id = p.part_id
        WHERE p.user_id = ${userId} AND mp.media_id = ${breakingBadS1Id}
      `);
      expect((checked[0] as { count: number }).count).toBe(5);
    });
  });

  describe('central catalog lookup', () => {
    const filmId = '3f7e1d3a-1a1f-5a0e-9a06-000000000042';
    const film = {
      id: filmId,
      kind: 'movie',
      title: 'Donkey Skin',
      synonyms: ["Peau d'âne", 'Piel de asno'],
      year: 1970,
      status: 'ended',
      genres: ['fantasy'],
      partCount: null,
      seasonNumber: null,
      externalIds: { tmdb: 5590, imdb: 'tt0066207' },
      metadata: {},
      description: null,
      coverUrl: null,
      bannerUrl: null,
      rank: 1,
    };

    // These rows are the point of the tests, so each starts without them: a
    // materialized row outlives its test, and the local resolver would answer
    // the next one before the catalog ever hears about it.
    beforeEach(async () => {
      await db
        .delete(media)
        .where(inArray(media.id, [filmId, '3f7e1d3a-1a1f-5a0e-9a06-000000000043']));
    });

    /** The catalog service, as `fetchCatalogSearch` reads it. */
    const stubCatalog = (results: unknown[]): typeof fetch =>
      (async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({ results }),
        }) as unknown as Response) as unknown as typeof fetch;

    const report = (rows: PlanReportRow[]): PlanReport => ({
      source: 'letterboxd',
      profile: 'someone',
      generatedAt: NOW.toISOString(),
      applied: false,
      summary: {
        total: rows.length,
        matched: 0,
        unmatched: rows.length,
        existing: 0,
        pending: 0,
        fromCatalog: 0,
        favourites: 0,
        warnings: 0,
      },
      warnings: [],
      rows,
    });

    const filmRow = (overrides: Partial<PlanReportRow> = {}): PlanReportRow => ({
      externalId: 'donkey-skin',
      title: 'Donkey Skin',
      year: 1970,
      seasonNumber: null,
      kind: 'movie',
      status: 'completed',
      score: 7,
      progress: 0,
      repeats: 0,
      startedAt: null,
      finishedAt: null,
      notes: null,
      favourite: false,
      matched: false,
      matchedBy: null,
      matchScore: null,
      closestScore: null,
      closestTitle: null,
      originCountry: null,
      mediaTitle: null,
      warnings: [],
      ...overrides,
    });

    it('finds a work the instance has never materialized, and writes nothing on a preview', async () => {
      const { plan } = await replayImportReport(db, {
        userId,
        report: report([filmRow()]),
        dryRun: true,
        now: NOW,
        catalogUrl: 'http://catalog.test',
        catalogFetch: stubCatalog([film]),
      });

      // An instance that only carries what it has served reports "not in catalog";
      // the central catalog is the rest of the answer.
      const [row] = plan.rows;
      expect(row?.target).toMatchObject({ id: filmId, matchedBy: 'catalog', title: 'Donkey Skin' });
      expect(plan.summary).toMatchObject({ matched: 1, fromCatalog: 1, pending: 1 });

      const persisted = await db.select({ id: media.id }).from(media).where(eq(media.id, filmId));
      expect(persisted).toHaveLength(0); // a preview is a preview
    });

    it('materializes the hit and logs it, exactly as a search would', async () => {
      const { plan, report: written } = await replayImportReport(db, {
        userId,
        report: report([filmRow()]),
        now: NOW,
        catalogUrl: 'http://catalog.test',
        catalogFetch: stubCatalog([film]),
      });

      expect(plan.summary).toMatchObject({ matched: 1, fromCatalog: 1 });
      expect(written).toMatchObject({ created: 1, updated: 0 });

      const [materialized] = await db
        .select({ id: media.id, slug: media.slug, year: media.year })
        .from(media)
        .where(eq(media.id, filmId));
      expect(materialized).toMatchObject({ slug: 'donkey-skin-1970', year: 1970 });

      const [log] = await db
        .select({ status: userMedia.status })
        .from(userMedia)
        .where(and(eq(userMedia.userId, userId), eq(userMedia.mediaId, filmId)));
      expect(log?.status).toBe('completed');

      // A second replay is a no-op: the row exists, the log exists.
      const again = await replayImportReport(db, {
        userId,
        report: report([filmRow()]),
        now: NOW,
        catalogUrl: 'http://catalog.test',
        catalogFetch: stubCatalog([film]),
      });
      expect(again.plan.summary).toMatchObject({ matched: 1, existing: 1, pending: 0 });
    });

    it('refuses two catalog works with the same title and year', async () => {
      const twin = { ...film, id: '3f7e1d3a-1a1f-5a0e-9a06-000000000043', rank: 2 };
      const { plan } = await replayImportReport(db, {
        userId,
        report: report([filmRow()]),
        dryRun: true,
        now: NOW,
        catalogUrl: 'http://catalog.test',
        catalogFetch: stubCatalog([film, twin]),
      });

      expect(plan.rows[0]?.target).toBeNull();
      expect(plan.warnings.map((w) => w.code)).toContain('ambiguous-title-match');
    });
  });

  it('pins a liked work as a favourite, even when the log already exists', async () => {
    // Any seeded film will do: the subject is the pin, not the work.
    const [film] = await db
      .select({ id: media.id, title: media.title, year: media.year })
      .from(media)
      .where(and(eq(media.kind, 'movie'), isNotNull(media.year)))
      .limit(1);
    if (!film) throw new Error('the fixture seed carries no movie');

    // A log the viewer already had, with no favourite: the provider's like is
    // still theirs to give, so the import writes it without overwriting.
    await db.insert(userMedia).values({ userId, mediaId: film.id, status: 'completed' });

    const runs = await replayImportReport(db, {
      userId,
      report: {
        source: 'letterboxd',
        profile: 'someone',
        generatedAt: NOW.toISOString(),
        applied: false,
        warnings: [],
        summary: {
          total: 1,
          matched: 0,
          unmatched: 1,
          existing: 0,
          pending: 0,
          fromCatalog: 0,
          favourites: 0,
          warnings: 0,
        },
        rows: [
          {
            externalId: film.id,
            title: film.title,
            year: film.year,
            seasonNumber: null,
            kind: 'movie',
            status: 'completed',
            score: 7,
            progress: 0,
            repeats: 0,
            startedAt: null,
            finishedAt: null,
            notes: null,
            favourite: true,
            matched: false,
            matchedBy: null,
            matchScore: null,
            closestScore: null,
            closestTitle: null,
            originCountry: null,
            mediaTitle: null,
            warnings: [],
          },
        ],
      },
      now: NOW,
    });

    expect(runs.plan.summary).toMatchObject({ favourites: 1, existing: 1, pending: 0 });
    expect(runs.report).toMatchObject({ favourites: 1, created: 0, skippedExisting: 1 });

    const pinned = await db
      .select({ position: favorite.position })
      .from(favorite)
      .where(and(eq(favorite.userId, userId), eq(favorite.mediaId, film.id)));
    expect(pinned).toHaveLength(1); // idempotent: no second row, no second position
  });
});
