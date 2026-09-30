import { eq } from 'drizzle-orm';
import { DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import pino from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, discordNewsFeed, runMigrations, type Db } from '@trackt/db';
import { loadEnv, type NewsArticleSummary } from '@trackt/shared';
import type { BotContext } from '../../src/context.js';
import { pollNews } from '../../src/news/poller.js';
import { testDatabase } from '../support/database.js';

const TEST_DATABASE_URL = await testDatabase('trackt_discord_news_test');

/** The news poller against the dev compose database, with the catalog and the Discord client faked. */

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000002';
const SEED = new Date('2026-09-30T10:00:00.000Z');

function article(n: number, publishedAt: string, kinds: NewsArticleSummary['kinds']) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `article-${n}`,
    title: `Article ${n}`,
    dek: null,
    topic: 'general',
    kinds,
    coverUrl: null,
    publishedAt,
  } satisfies NewsArticleSummary;
}

/** The catalog serves `pages` in order, newest first, as `GET /v1/news` does. */
function stubCatalog(pages: NewsArticleSummary[][]) {
  const fetchMock = vi.fn(async (input: URL | string) => {
    const cursor = new URL(String(input)).searchParams.get('cursor');
    const index = cursor ? Number(cursor) : 0;
    const nextCursor = index + 1 < pages.length ? String(index + 1) : null;
    return Response.json({ articles: pages[index] ?? [], nextCursor });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fakeClient(send: (payload: unknown) => Promise<unknown>) {
  return {
    channels: { fetch: vi.fn(async () => ({ isSendable: () => true, send })) },
  } as unknown as Client;
}

function postedTitles(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls.map(
    (call) => (call[0] as { embeds: { toJSON(): { title: string } }[] }).embeds[0]!.toJSON().title,
  );
}

describe.runIf(TEST_DATABASE_URL)('pollNews (postgres)', () => {
  let db: Db;
  let ctx: BotContext;

  beforeAll(async () => {
    await runMigrations(TEST_DATABASE_URL!);
    db = createDb(TEST_DATABASE_URL!, { max: 1 });
    const env = loadEnv({ NODE_ENV: 'test', APP_URL: 'https://trackt.example' });
    ctx = { db, env, logger: pino({ level: 'silent' }) };
  });

  afterAll(async () => {
    await db?.$client.end();
  });

  beforeEach(async () => {
    await db.delete(discordNewsFeed);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function addFeed(kinds: NewsArticleSummary['kinds'] = []) {
    await db.insert(discordNewsFeed).values({
      guildId: GUILD,
      channelId: CHANNEL,
      kinds,
      cursorPublishedAt: SEED,
      createdByDiscordId: '300000000000000003',
    });
  }

  async function feedCursor() {
    const [row] = await db
      .select()
      .from(discordNewsFeed)
      .where(eq(discordNewsFeed.channelId, CHANNEL));
    return row && { at: row.cursorPublishedAt.toISOString(), id: row.cursorArticleId };
  }

  it('posts only articles newer than the feed, oldest first, and advances the cursor', async () => {
    await addFeed();
    stubCatalog([
      [
        article(3, '2026-09-30T12:00:00.000Z', ['movie']),
        article(2, '2026-09-30T11:00:00.000Z', ['anime']),
        article(1, '2026-09-30T09:00:00.000Z', ['anime']),
      ],
    ]);
    const send = vi.fn(async () => ({}));

    await pollNews(fakeClient(send), ctx);

    expect(postedTitles(send)).toEqual(['Article 2', 'Article 3']);
    expect(await feedCursor()).toEqual({
      at: '2026-09-30T12:00:00.000Z',
      id: article(3, '', []).id,
    });

    send.mockClear();
    await pollNews(fakeClient(send), ctx);
    expect(send).not.toHaveBeenCalled();
  });

  it('filters by the feed kinds', async () => {
    await addFeed(['anime']);
    stubCatalog([
      [
        article(3, '2026-09-30T12:00:00.000Z', ['movie']),
        article(2, '2026-09-30T11:00:00.000Z', ['anime', 'manga']),
      ],
    ]);
    const send = vi.fn(async () => ({}));

    await pollNews(fakeClient(send), ctx);

    expect(postedTitles(send)).toEqual(['Article 2']);
  });

  it('pages back until it reaches what the feed has already seen', async () => {
    await addFeed();
    const fetchMock = stubCatalog([
      [article(4, '2026-09-30T14:00:00.000Z', []), article(3, '2026-09-30T13:00:00.000Z', [])],
      [article(2, '2026-09-30T11:00:00.000Z', []), article(1, '2026-09-30T09:00:00.000Z', [])],
      [article(0, '2026-09-30T08:00:00.000Z', [])],
    ]);
    const send = vi.fn(async () => ({}));

    await pollNews(fakeClient(send), ctx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(postedTitles(send)).toEqual(['Article 2', 'Article 3', 'Article 4']);
  });

  it('keeps the cursor on the last article that went out when a send fails', async () => {
    await addFeed();
    stubCatalog([
      [article(3, '2026-09-30T12:00:00.000Z', []), article(2, '2026-09-30T11:00:00.000Z', [])],
    ]);
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('rate limited'));

    await pollNews(fakeClient(send), ctx);

    expect(await feedCursor()).toEqual({
      at: '2026-09-30T11:00:00.000Z',
      id: article(2, '', []).id,
    });
  });

  it('drops the feed when its channel no longer exists', async () => {
    await addFeed();
    stubCatalog([[article(2, '2026-09-30T11:00:00.000Z', [])]]);
    const unknownChannel = new DiscordAPIError(
      { code: RESTJSONErrorCodes.UnknownChannel, message: 'Unknown Channel' },
      RESTJSONErrorCodes.UnknownChannel,
      404,
      'GET',
      '/channels/x',
      {},
    );
    const client = {
      channels: { fetch: vi.fn().mockRejectedValue(unknownChannel) },
    } as unknown as Client;

    await pollNews(client, ctx);

    expect(await feedCursor()).toBeUndefined();
  });
});
