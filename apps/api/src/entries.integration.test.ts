import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, media, runMigrations, seedMedia, users, type Db } from '@trackt/db';
import {
  MEDIA_CREATE_DAILY_LIMIT,
  canonicalMediaId,
  loadEnv,
  type MediaDetail,
} from '@trackt/shared';
import { createAuth } from './auth.js';
import { buildApp, type App } from './app.js';

/**
 * Postgres-backed tests for user-created entries + the moderation queue
 * (own `trackt_entries_test` db, self-skips without Docker, fresh users per
 * run — same pattern as the other integration suites). Exercises creation,
 * creator/moderator-scoped visibility, covers, and the moderation verbs.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL_ENTRIES ??
  'postgres://trackt:trackt@localhost:5432/trackt_entries_test';

async function ensureTestDatabase(): Promise<boolean> {
  const adminUrl = new URL(TEST_DATABASE_URL);
  const testDbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/trackt';
  const admin = postgres(adminUrl.href, { max: 1, connect_timeout: 3 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${testDbName}`;
    if (exists.length === 0) await admin.unsafe(`CREATE DATABASE "${testDbName}"`);
    return true;
  } catch {
    return false;
  } finally {
    await admin.end();
  }
}

const available = await ensureTestDatabase();

const bebopId = canonicalMediaId('anime', 1); // verified seed row (provider source)

describe.runIf(available)('user-created entries + moderation (postgres)', () => {
  let app: App;
  let db: Db;
  let creatorCookie: string;
  let creatorId: string;
  let otherCookie: string; // regular user at first, promoted to moderator later
  const stamp = Date.now();
  const title = `Star Courier ${stamp}`;
  let entryId: string;
  let entrySlug: string;

  async function signUp(prefix: string): Promise<{ cookie: string; id: string }> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: {
        name: `${prefix} Tester`,
        username: `${prefix}${stamp}`.slice(0, 20),
        email: `${prefix}-${stamp}@example.com`,
        password: 'a-strong-password-1',
      },
    });
    expect(response.statusCode).toBe(200);
    const cookie = (response.headers['set-cookie'] as string[] | string | undefined)
      ?.toString()
      .split(';')[0] as string;
    return { cookie, id: response.json().user.id };
  }

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL);
    db = createDb(TEST_DATABASE_URL, { max: 1 });
    await seedMedia(db);
    const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'error' });
    app = await buildApp({ env, db, auth: createAuth(db, env) });

    const creator = await signUp('maker');
    creatorCookie = creator.cookie;
    creatorId = creator.id;
    const other = await signUp('viewer');
    otherCookie = other.cookie;
  });

  afterAll(async () => {
    await app?.close();
  });

  function createEntry(payload: Record<string, unknown>, cookie?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/media',
      headers: cookie ? { cookie } : {},
      payload,
    });
  }

  async function searchTitles(q: string, cookie?: string): Promise<string[]> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/search?q=${encodeURIComponent(q)}`,
      headers: cookie ? { cookie } : {},
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { title: string }[]).map((result) => result.title);
  }

  function getDetail(idOrSlug: string, cookie?: string) {
    return app.inject({
      method: 'GET',
      url: `/api/v1/media/${idOrSlug}`,
      headers: cookie ? { cookie } : {},
    });
  }

  it('requires a session to create', async () => {
    expect((await createEntry({ kind: 'webtoon', title })).statusCode).toBe(401);
  });

  it('creates an unverified entry with a derived slug', async () => {
    const response = await createEntry(
      {
        kind: 'webtoon',
        title,
        year: 2024,
        chapterCount: 42,
        genres: ['comedy'],
        description: 'Couriers, but in space.',
      },
      creatorCookie,
    );
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.moderation).toBe('unverified');
    expect(body.slug).toBe(`star-courier-${stamp}-2024`);
    entryId = body.id;
    entrySlug = body.slug;

    const [row] = await db.select().from(media).where(eq(media.id, entryId));
    expect(row).toMatchObject({ source: 'user', createdBy: creatorId, moderation: 'unverified' });
  });

  it('rejects count fields that do not fit the kind', async () => {
    const response = await createEntry(
      { kind: 'movie', title: 'Oops', episodeCount: 3 },
      creatorCookie,
    );
    expect(response.statusCode).toBe(400);
  });

  it('suffixes the slug when the title+year is already taken', async () => {
    const response = await createEntry({ kind: 'webtoon', title, year: 2024 }, creatorCookie);
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.slug).toBe(`${entrySlug}-${(body.id as string).slice(0, 8)}`);
    // Not needed below — reject it later via the queue's rejected filter test.
    await db.update(media).set({ moderation: 'rejected' }).where(eq(media.id, body.id));
  });

  it('shows the unverified entry to its creator only', async () => {
    expect(await searchTitles(title, creatorCookie)).toContain(title);
    expect(await searchTitles(title, otherCookie)).not.toContain(title);
    expect(await searchTitles(title)).not.toContain(title);

    expect((await getDetail(entrySlug, creatorCookie)).statusCode).toBe(200);
    expect((await getDetail(entrySlug, otherCookie)).statusCode).toBe(404);
    expect((await getDetail(entrySlug)).statusCode).toBe(404);
  });

  it('lets only the creator track the unverified entry', async () => {
    const mine = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${entryId}/log`,
      headers: { cookie: creatorCookie },
      payload: { status: 'in_progress' },
    });
    expect(mine.statusCode).toBe(200);

    const theirs = await app.inject({
      method: 'PUT',
      url: `/api/v1/media/${entryId}/log`,
      headers: { cookie: otherCookie },
      payload: { status: 'planned' },
    });
    expect(theirs.statusCode).toBe(404);
  });

  it('keeps unverified entries out of other viewers’ related suggestions', async () => {
    const bebop = (await getDetail(bebopId, creatorCookie)).json() as MediaDetail;
    const clone = await createEntry(
      { kind: 'anime', title: `Bebop But Fanmade ${stamp}`, genres: bebop.genres },
      creatorCookie,
    );
    expect(clone.statusCode).toBe(201);
    const cloneId = clone.json().id as string;

    const forOther = (await getDetail(bebopId, otherCookie)).json() as MediaDetail;
    expect(forOther.related.map((item) => item.id)).not.toContain(cloneId);
  });

  it('accepts a cover from the creator, rejects bad types', async () => {
    // 1×1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const boundary = '----trackt-test-boundary';
    const multipart = (filename: string, mime: string, body: Buffer) =>
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\ncontent-type: ${mime}\r\n\r\n`,
        ),
        body,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
    const uploadCover = (id: string, cookie: string | undefined, filename: string, mime: string) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/media/${id}/cover`,
        headers: {
          ...(cookie ? { cookie } : {}),
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: multipart(filename, mime, png),
      });

    const upload = await uploadCover(entryId, creatorCookie, 'cover.png', 'image/png');
    expect(upload.statusCode).toBe(200);
    const { coverUrl } = upload.json();
    expect(coverUrl).toMatch(/^\/uploads\/covers\/.+\.png$/);
    expect((await app.inject({ method: 'GET', url: coverUrl })).statusCode).toBe(200);

    expect((await uploadCover(entryId, creatorCookie, 'cover.gif', 'image/gif')).statusCode).toBe(
      400,
    );
    expect((await uploadCover(entryId, undefined, 'cover.png', 'image/png')).statusCode).toBe(401);
    // Invisible to a non-creator regular user → 404, not 403 (no existence leak).
    expect((await uploadCover(entryId, otherCookie, 'cover.png', 'image/png')).statusCode).toBe(
      404,
    );
    // Provider-synced rows never take user covers.
    expect((await uploadCover(bebopId, creatorCookie, 'cover.png', 'image/png')).statusCode).toBe(
      403,
    );
  });

  it('keeps the moderation queue away from regular users', async () => {
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/moderation/queue',
      headers: { cookie: otherCookie },
    });
    expect(queue.statusCode).toBe(403);

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/moderation/media/${entryId}`,
      headers: { cookie: otherCookie },
      payload: { moderation: 'verified' },
    });
    expect(patch.statusCode).toBe(403);
  });

  it('lists, edits, and approves via the queue as a moderator', async () => {
    // Promotion is CLI/SQL-only; the role is read per request, so no re-login.
    await db
      .update(users)
      .set({ role: 'moderator' })
      .where(eq(users.email, `viewer-${stamp}@example.com`));

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/moderation/queue',
      headers: { cookie: otherCookie },
    });
    expect(queue.statusCode).toBe(200);
    const items = queue.json().items as { id: string; creator: { username: string } | null }[];
    const mine = items.find((item) => item.id === entryId);
    expect(mine).toBeDefined();
    expect(mine?.creator?.username).toBe(`maker${stamp}`.slice(0, 20).toLowerCase());

    // Moderators can preview the pending entry.
    expect((await getDetail(entrySlug, otherCookie)).statusCode).toBe(200);

    const approve = await app.inject({
      method: 'PATCH',
      url: `/api/v1/moderation/media/${entryId}`,
      headers: { cookie: otherCookie },
      payload: { title: `${title} (fixed)`, moderation: 'verified' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().moderation).toBe('verified');

    // Verified → public: anonymous detail + search now see it (edited title).
    expect((await getDetail(entrySlug)).statusCode).toBe(200);
    expect(await searchTitles(title)).toContain(`${title} (fixed)`);
  });

  it('supports the rejected filter and un-rejecting', async () => {
    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/moderation/queue?status=rejected',
      headers: { cookie: otherCookie },
    });
    expect(queue.statusCode).toBe(200);
    const items = queue.json().items as { id: string; slug: string }[];
    const rejected = items.find((item) => item.slug.startsWith(`${entrySlug}-`));
    expect(rejected).toBeDefined();

    // Hidden from everyone but its creator…
    expect((await getDetail(rejected!.id, creatorCookie)).statusCode).toBe(200);
    expect((await getDetail(rejected!.id)).statusCode).toBe(404);

    // …and a verdict in the other direction restores it.
    const restore = await app.inject({
      method: 'PATCH',
      url: `/api/v1/moderation/media/${rejected!.id}`,
      headers: { cookie: otherCookie },
      payload: { moderation: 'verified' },
    });
    expect(restore.statusCode).toBe(200);
    expect((await getDetail(rejected!.id)).statusCode).toBe(200);
  });

  it('never moderates provider-synced rows', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/moderation/media/${bebopId}`,
      headers: { cookie: otherCookie },
      payload: { moderation: 'rejected' },
    });
    expect(response.statusCode).toBe(404);
  });

  it('caps creations per day', async () => {
    const filler = Array.from({ length: MEDIA_CREATE_DAILY_LIMIT }, (_, i) => ({
      kind: 'webtoon' as const,
      title: `Filler ${stamp}-${i}`,
      slug: `filler-${stamp}-${i}`,
      source: 'user' as const,
      createdBy: creatorId,
      moderation: 'unverified' as const,
    }));
    await db.insert(media).values(filler);
    try {
      const response = await createEntry(
        { kind: 'webtoon', title: `One Too Many ${stamp}` },
        creatorCookie,
      );
      expect(response.statusCode).toBe(429);
    } finally {
      for (const row of filler) {
        await db.delete(media).where(eq(media.slug, row.slug));
      }
    }
  });
});

describe.runIf(!available)('user-created entries + moderation (postgres)', () => {
  it.skip('skipped: dev Postgres not reachable — run docker compose -f docker-compose.dev.yml up -d', () => {});
});
