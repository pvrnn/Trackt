import { and, eq } from 'drizzle-orm';
import { DiscordAPIError, RESTJSONErrorCodes, type Client } from 'discord.js';
import { discordNewsFeed } from '@trackt/db';
import { fetchNewsList, type NewsArticleSummary } from '@trackt/shared';
import type { BotContext } from '../context.js';
import { newsEmbed } from './embed.js';
import { compareCursors, isAfter, pickNewArticles, type FeedCursor } from './select.js';

export const NEWS_POLL_INTERVAL_MS = 2 * 60 * 1000;
/** Nobody waits on a background poll, so ride out a cold-starting catalog rather than fail. */
const NEWS_FETCH_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 50;
const MAX_PAGES = 5;
/** Per feed per poll: a backlog drains over several polls instead of flooding a channel. */
const MAX_POSTS_PER_POLL = 10;

type FeedRow = typeof discordNewsFeed.$inferSelect;

function cursorOf(feed: FeedRow): FeedCursor {
  return { publishedAt: feed.cursorPublishedAt, articleId: feed.cursorArticleId };
}

/** Pages back from the newest article until everything any feed still needs is loaded. */
async function loadUnseenArticles(
  catalogUrl: string,
  oldest: FeedCursor,
): Promise<NewsArticleSummary[]> {
  const articles: NewsArticleSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchNewsList(catalogUrl, {
      limit: PAGE_SIZE,
      cursor,
      timeoutMs: NEWS_FETCH_TIMEOUT_MS,
    });
    articles.push(...result.articles);
    const last = result.articles.at(-1);
    if (!result.nextCursor || !last || !isAfter(last, oldest)) break;
    cursor = result.nextCursor;
  }
  return articles;
}

export async function pollNews(client: Client, ctx: BotContext): Promise<void> {
  const { db, env } = ctx;
  if (!env.CATALOG_URL) return;

  const feeds = await db.select().from(discordNewsFeed);
  if (feeds.length === 0) return;

  const oldest = feeds.map(cursorOf).reduce((a, b) => (compareCursors(a, b) <= 0 ? a : b));
  const articles = await loadUnseenArticles(env.CATALOG_URL, oldest);

  for (const feed of feeds) {
    const fresh = pickNewArticles(articles, cursorOf(feed), feed.kinds, MAX_POSTS_PER_POLL);
    if (fresh.length > 0) await postToFeed(client, ctx, feed, fresh);
  }
}

async function postToFeed(
  client: Client,
  { db, env, logger }: BotContext,
  feed: FeedRow,
  articles: NewsArticleSummary[],
): Promise<void> {
  const where = and(
    eq(discordNewsFeed.guildId, feed.guildId),
    eq(discordNewsFeed.channelId, feed.channelId),
  );
  try {
    const channel = await client.channels.fetch(feed.channelId);
    if (!channel?.isSendable()) {
      logger.warn({ channel: feed.channelId }, 'news feed channel is not sendable');
      return;
    }
    for (const article of articles) {
      await channel.send({ embeds: [newsEmbed(article, env.APP_URL)] });
      await db
        .update(discordNewsFeed)
        .set({ cursorPublishedAt: new Date(article.publishedAt), cursorArticleId: article.id })
        .where(where);
    }
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownChannel) {
      logger.info({ channel: feed.channelId }, 'news feed channel is gone; removing the feed');
      await db.delete(discordNewsFeed).where(where);
      return;
    }
    logger.warn({ err: error, channel: feed.channelId }, 'could not post to news feed');
  }
}
