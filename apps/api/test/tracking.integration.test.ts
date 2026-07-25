import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  createDb,
  media,
  mediaRelation,
  progress,
  rating,
  runMigrations,
  seedMedia,
  seedMediaRelations,
  userMedia,
  type Db,
} from '@trackt/db';
import {
  canonicalMediaId,
  canonicalSeriesSeasonId,
  loadEnv,
  type MediaDetail,
} from '@trackt/shared';
import { createAuth } from '../src/auth.js';
import { buildApp, type App } from '../src/app.js';

/**
 * Postgres-backed media-detail + tracking tests against the dev compose database
 * (`docker compose -f docker-compose.dev.yml up -d`). Creates and migrates its own
 * `trackt_tracking_test` database and self-skips when Postgres is down, so
 * `pnpm test` stays green without Docker. Auth flows go through the real
 * better-auth endpoints (sign-up → session cookie).
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_TRACKING ??
  'postgres://trackt:trackt@localhost:5432/trackt_tracking_test';

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

const bebopId = canonicalMediaId('anime', 1); // Cowboy Bebop, 26 episodes in the seed
const matrixId = canonicalMediaId('movie', 603);
const frierenId = canonicalMediaId('anime', 154587);

describe.runIf(available)('media detail + tracking (postgres)', () => {
  let app: App;
  let db: Db;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    await seedMediaRelations(db);
    // Tracking rows from previous runs would skew community stats.
    await db.delete(progress);
    await db.delete(rating);
    await db.delete(userMedia);
    // No CATALOG_URL: this suite covers the two *local* relation paths (stored
    // edges and derived season siblings). Federation has its own suite, and the
    // dev default would otherwise make every detail fetch dial localhost:3002.
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error', CATALOG_URL: '' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });

    // Unique per run — the test database persists between runs.
    const stamp = Date.now();
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: 'Track Tester',
        username: `tracker${stamp}`.slice(0, 20),
        email: `tracker-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(signUp.statusCode).toBe(200);
    userId = signUp.json().user.id;
    cookie = (signUp.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
    expect(cookie).toContain('better-auth');
  });

  afterAll(async () => {
    await app?.close();
  });

  async function getDetail(idOrSlug: string, authed = true): Promise<MediaDetail> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/media/${idOrSlug}`,
      headers: authed ? { cookie } : {},
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('serves the detail by slug and by id, anonymous viewer null', async () => {
    const bySlug = await getDetail('cowboy-bebop-1998', false);
    expect(bySlug).toMatchObject({ id: bebopId, kind: 'anime', partCount: 26, viewer: null });
    expect(bySlug.community).toEqual({ averageScore: null, ratingCount: 0 });
    const byId = await getDetail(bebopId, false);
    expect(byId.slug).toBe('cowboy-bebop-1998');
  });

  it('offers genre-overlap suggestions as the fallback list', async () => {
    const detail = await getDetail('cowboy-bebop-1998', false);
    expect(detail.related.length).toBeGreaterThan(0);
    for (const item of detail.related) {
      expect(item.kind).toBe('anime');
      expect(item.id).not.toBe(bebopId);
    }
    // Bebop has no edges and no sibling season, so the client shows the fallback.
    expect(detail.relations).toEqual([]);
  });

  it('always sends both lists, so the payload never depends on hidden state', async () => {
    // Severance S1 has a stored sequel edge *and* genre overlap: the API sends
    // both and lets the client decide which to render (ADR-0004 point 5).
    const detail = await getDetail(canonicalSeriesSeasonId(95396, 1), false);
    expect(detail.relations.length).toBeGreaterThan(0);
    expect(detail.related.length).toBeGreaterThan(0);
  });

  it('derives adjacent series seasons with no stored edge', async () => {
    // Breaking Bad S1/S2 are deliberately unlinked in the seed — these come from
    // external_ids.tmdb + season_number alone.
    const s1 = await getDetail(canonicalSeriesSeasonId(1396, 1), false);
    expect(s1.relations).toEqual([
      expect.objectContaining({
        id: canonicalSeriesSeasonId(1396, 2),
        relation: 'sequel',
        seasonNumber: 2,
      }),
    ]);
  });

  it('labels the same derived edge as a prequel from the later season', async () => {
    const s2 = await getDetail(canonicalSeriesSeasonId(1396, 2), false);
    expect(s2.relations).toEqual([
      expect.objectContaining({ id: canonicalSeriesSeasonId(1396, 1), relation: 'prequel' }),
    ]);
  });

  it('reverses a stored adaptation edge into a source label', async () => {
    const fmaMangaId = canonicalMediaId('manga', 30025);
    const fmaAnimeId = canonicalMediaId('anime', 5114);

    const manga = await getDetail(fmaMangaId, false);
    expect(manga.relations).toEqual([
      expect.objectContaining({ id: fmaAnimeId, relation: 'adaptation', kind: 'anime' }),
    ]);

    const anime = await getDetail(fmaAnimeId, false);
    expect(anime.relations).toEqual([
      expect.objectContaining({ id: fmaMangaId, relation: 'source', kind: 'manga' }),
    ]);
  });

  it('reads a symmetric `related` edge as `related` from both ends', async () => {
    const onePieceId = canonicalMediaId('manga', 30013);
    const chainsawId = canonicalMediaId('manga', 105778);

    const onePiece = await getDetail(onePieceId, false);
    expect(onePiece.relations).toEqual([
      expect.objectContaining({ id: chainsawId, relation: 'related' }),
    ]);

    const chainsaw = await getDetail(chainsawId, false);
    expect(chainsaw.relations).toEqual([
      expect.objectContaining({ id: onePieceId, relation: 'related' }),
    ]);
  });

  it('lets a stored edge win over the derived season sibling, exactly once', async () => {
    // An adversarial (and factually wrong) type on a pair that also derives as a
    // sequel. Pins the merge key: one target, one heading, no duplicate card.
    const s1 = canonicalSeriesSeasonId(1396, 1);
    const s2 = canonicalSeriesSeasonId(1396, 2);
    await db.insert(mediaRelation).values({ fromId: s1, toId: s2, type: 'spinoff' });
    try {
      const detail = await getDetail(s1, false);
      const toS2 = detail.relations.filter((item) => item.id === s2);
      expect(toS2).toHaveLength(1);
      expect(toS2[0]!.relation).toBe('spinoff');
    } finally {
      await db.delete(mediaRelation).where(eq(mediaRelation.type, 'spinoff'));
    }
  });

  it('hides a soft-deleted relation target from both local paths', async () => {
    const s1 = canonicalSeriesSeasonId(1396, 1);
    const s2 = canonicalSeriesSeasonId(1396, 2);
    // Same pair reachable two ways: a stored edge and the derived sibling. A
    // soft delete must suppress it in both.
    await db.insert(mediaRelation).values({ fromId: s1, toId: s2, type: 'sequel' });
    await db.update(media).set({ deletedAt: new Date() }).where(eq(media.id, s2));
    try {
      const detail = await getDetail(s1, false);
      expect(detail.relations.map((item) => item.id)).not.toContain(s2);
    } finally {
      await db.update(media).set({ deletedAt: null }).where(eq(media.id, s2));
      await db.delete(mediaRelation).where(eq(mediaRelation.fromId, s1));
    }
  });

  it('hides an unverified relation target from a stranger but not its creator', async () => {
    const s1 = canonicalSeriesSeasonId(1396, 1);
    const s2 = canonicalSeriesSeasonId(1396, 2);
    // Recast the seeded S2 as an unverified user entry owned by the signed-up
    // user, reachable both by a stored edge and by season derivation.
    await db.insert(mediaRelation).values({ fromId: s1, toId: s2, type: 'sequel' });
    await db
      .update(media)
      .set({ source: 'user', moderation: 'unverified', createdBy: userId })
      .where(eq(media.id, s2));
    try {
      const anonymous = await getDetail(s1, false);
      expect(anonymous.relations.map((item) => item.id)).not.toContain(s2);

      const asCreator = await getDetail(s1, true);
      expect(asCreator.relations.map((item) => item.id)).toContain(s2);
    } finally {
      await db
        .update(media)
        .set({ source: 'provider', moderation: 'verified', createdBy: null })
        .where(eq(media.id, s2));
      await db.delete(mediaRelation).where(eq(mediaRelation.fromId, s1));
    }
  });

  it('never treats season 0 specials as a prequel', async () => {
    const showId = 424242;
    const specials = canonicalSeriesSeasonId(showId, 0);
    const first = canonicalSeriesSeasonId(showId, 1);
    await db.insert(media).values([
      {
        id: specials,
        kind: 'series',
        title: 'Derivation Fixture',
        slug: 'derivation-fixture-specials',
        seasonNumber: 0,
        partCount: 3,
        externalIds: { tmdb: showId },
      },
      {
        id: first,
        kind: 'series',
        title: 'Derivation Fixture',
        slug: 'derivation-fixture-2020',
        seasonNumber: 1,
        partCount: 10,
        externalIds: { tmdb: showId },
      },
    ]);
    try {
      const detail = await getDetail(first, false);
      expect(detail.relations).toEqual([]);
    } finally {
      await db.delete(media).where(inArray(media.id, [specials, first]));
    }
  });

  it('404s on unknown slugs', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/media/not-a-thing' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects tracking mutations without a session', async () => {
    for (const [method, url, payload] of [
      ['PUT', `/api/v1/media/${bebopId}/log`, { status: 'planned' }],
      ['PUT', `/api/v1/media/${bebopId}/rating`, { score: 8 }],
      ['PUT', `/api/v1/media/${bebopId}/progress/1`, undefined],
      ['DELETE', `/api/v1/media/${bebopId}/progress/1`, undefined],
    ] as const) {
      const response = await app.inject({ method, url, payload });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('upserts and clears the log status', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'planned' },
    });
    expect(put.statusCode).toBe(200);
    expect((await getDetail(bebopId)).viewer?.status).toBe('planned');

    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'completed' },
    });
    expect((await getDetail(bebopId)).viewer?.status).toBe('completed');

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(200);
    expect((await getDetail(bebopId)).viewer?.status).toBeNull();
  });

  it('upserts ratings, reflects them in community stats, validates the scale', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/rating`,
      headers: { cookie },
      payload: { score: 8.5 },
    });
    expect(put.statusCode).toBe(200);
    const detail = await getDetail(bebopId);
    expect(detail.viewer?.score).toBe(8.5);
    expect(detail.community).toEqual({ averageScore: 8.5, ratingCount: 1 });

    for (const score of [10.5, -1, 7.3]) {
      const bad = await app.inject({
        method: 'PUT',
        url: `/api/v1/media/${bebopId}/rating`,
        headers: { cookie },
        payload: { score },
      });
      expect(bad.statusCode, `score ${score}`).toBe(400);
    }

    await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${bebopId}/rating`,
      headers: { cookie },
    });
    const cleared = await getDetail(bebopId);
    expect(cleared.viewer?.score).toBeNull();
    expect(cleared.community.ratingCount).toBe(0);
  });

  it('checks in episodes idempotently with lazy part creation and auto-log', async () => {
    for (const number of [1, 2, 1]) {
      const response = await app.inject({
        method: 'PUT',
        url: `/api/v1/media/${frierenId}/progress/${number}`,
        headers: { cookie },
      });
      expect(response.statusCode).toBe(200);
    }
    const detail = await getDetail(frierenId);
    expect(detail.viewer?.watched).toEqual([1, 2]);
    // First check-in on an unlogged work starts the log.
    expect(detail.viewer?.status).toBe('in_progress');

    const uncheck = await app.inject({
      method: 'DELETE',
      url: `/api/v1/media/${frierenId}/progress/1`,
      headers: { cookie },
    });
    expect(uncheck.statusCode).toBe(200);
    expect((await getDetail(frierenId)).viewer?.watched).toEqual([2]);
  });

  it('keeps an existing status when checking in', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/log`,
      headers: { cookie },
      payload: { status: 'paused' },
    });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/progress/5`,
      headers: { cookie },
    });
    expect((await getDetail(bebopId)).viewer?.status).toBe('paused');
  });

  it('rejects out-of-range numbers and movie check-ins', async () => {
    const tooHigh = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${bebopId}/progress/27`,
      headers: { cookie },
    });
    expect(tooHigh.statusCode).toBe(400);

    const movie = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${matrixId}/progress/1`,
      headers: { cookie },
    });
    expect(movie.statusCode).toBe(400);
  });
});

describe.runIf(!available)('media detail + tracking (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
