import type { MediaKind, NewsArticleSummary } from '@trackt/shared';

/** Keyset position in the catalog feed's `(published_at DESC, id DESC)` order. */
export interface FeedCursor {
  publishedAt: Date;
  /** Null for a freshly created feed, which is seeded with its creation time alone. */
  articleId: string | null;
}

/** Whether `article` sorts after `cursor`, i.e. has not been posted yet. */
export function isAfter(article: NewsArticleSummary, cursor: FeedCursor): boolean {
  const published = Date.parse(article.publishedAt);
  const at = cursor.publishedAt.getTime();
  if (published !== at) return published > at;
  // Lowercase hex compares in the same order Postgres sorts uuids.
  return cursor.articleId === null || article.id > cursor.articleId;
}

/** Orders cursors along the feed; a seed without an article id sorts first at its instant. */
export function compareCursors(a: FeedCursor, b: FeedCursor): number {
  const byTime = a.publishedAt.getTime() - b.publishedAt.getTime();
  if (byTime !== 0) return byTime;
  if (a.articleId === b.articleId) return 0;
  if (a.articleId === null) return -1;
  if (b.articleId === null) return 1;
  return a.articleId < b.articleId ? -1 : 1;
}

/** An empty filter takes everything; otherwise any shared kind is a match. */
export function matchesKinds(articleKinds: readonly MediaKind[], filter: readonly MediaKind[]) {
  return filter.length === 0 || articleKinds.some((kind) => filter.includes(kind));
}

/**
 * The articles a feed has not posted yet, oldest first, at most `limit` of
 * them — posting in that order means advancing the cursor after each send
 * leaves any overflow for the next poll instead of skipping it.
 */
export function pickNewArticles(
  articles: readonly NewsArticleSummary[],
  cursor: FeedCursor,
  kinds: readonly MediaKind[],
  limit: number,
): NewsArticleSummary[] {
  return articles
    .filter((article) => isAfter(article, cursor) && matchesKinds(article.kinds, kinds))
    .sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}
