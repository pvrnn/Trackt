import { inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { buildProviderMediaRow, insertNewProviderMedia, media, type Db } from '@trackt/db';
import {
  fetchNewsArticle,
  fetchNewsForMedia,
  fetchNewsList,
  type NewsArticle,
  type NewsArticleDetail,
  type NewsByMediaQuery,
  type NewsLinkedWork,
  type NewsListQuery,
  type NewsListResponse,
  type NewsMediaRef,
} from '@trackt/shared';
import type { SessionUser } from './session.js';
import { canViewMedia } from './visibility.js';

/**
 * The instance's view of central news (ADR-0005). News lives only in the
 * catalog; this module reads it live and never mirrors it, the same posture
 * `federated-search.ts` takes toward media.
 *
 * Degradation is the point: a slow or unreachable catalog yields an empty feed
 * and a logged warning, never a 500. A self-hoster whose catalog is down should
 * see a quiet News page, not a broken instance.
 */

/** Cache lifetime for a catalog response. Short — news is editorial, not live data. */
const MEMO_TTL_MS = 60_000;

/** Bound on distinct cached queries, so a filter-fuzzing client can't grow the heap. */
const MEMO_MAX_ENTRIES = 200;

interface MemoEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Dead-simple TTL memo, per process. Deliberately not Redis and not a table: the
 * only thing it protects is the central service from a busy instance's repeated
 * identical reads, and losing it on restart costs one extra upstream call.
 */
class TtlMemo<T> {
  private readonly entries = new Map<string, MemoEntry<T>>();

  get(key: string): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T): void {
    // Insertion-ordered, so the first key is the oldest written — good enough
    // eviction for a cache this small.
    if (this.entries.size >= MEMO_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + MEMO_TTL_MS });
  }

  clear(): void {
    this.entries.clear();
  }
}

const listMemo = new TtlMemo<NewsListResponse>();
const articleMemo = new TtlMemo<NewsArticle | null>();
const byMediaMemo = new TtlMemo<NewsListResponse>();

export interface NewsOptions {
  timeoutMs: number;
  logger: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
}

const EMPTY_FEED: NewsListResponse = { articles: [], nextCursor: null };

/**
 * One page of the feed, or an empty one.
 *
 * An unset `CATALOG_URL` means the feature is off rather than broken — a
 * catalog-less dev instance still renders `/news`, empty.
 */
export async function loadNewsList(
  catalogUrl: string | undefined,
  query: NewsListQuery,
  options: NewsOptions,
): Promise<NewsListResponse> {
  if (!catalogUrl) return EMPTY_FEED;

  const key = JSON.stringify([
    query.kind ?? '',
    query.topic ?? '',
    query.from ?? '',
    query.to ?? '',
    query.limit,
    query.cursor ?? '',
  ]);
  const cached = listMemo.get(key);
  if (cached) return cached;

  try {
    const response = await fetchNewsList(catalogUrl, {
      kind: query.kind,
      topic: query.topic,
      from: query.from,
      to: query.to,
      limit: query.limit,
      cursor: query.cursor,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    if (response.skipped.length > 0) {
      // Forward-compat: a newer catalog sent articles this build can't parse
      // (an unknown topic, say); the rest of the page still counts.
      options.logger.warn(
        { skipped: response.skipped },
        'skipping central news articles that do not match this build (upgrade to pick them up)',
      );
    }
    const page: NewsListResponse = {
      articles: response.articles,
      nextCursor: response.nextCursor,
    };
    listMemo.set(key, page);
    return page;
  } catch (error) {
    options.logger.warn({ err: error }, 'central news feed failed, serving an empty feed');
    return EMPTY_FEED;
  }
}

/**
 * The "In the news" strip on a media detail page: recent articles touching one
 * work, summaries only.
 *
 * Degrades like the feed rather than erroring — the strip is one section of a
 * page whose subject is the work, and a dead catalog should cost the reader
 * that section, not the page.
 *
 * Nothing here is viewer-scoped: the answer is article summaries, which carry
 * no linked works and so cannot leak a hidden one. Whether the *work* is
 * visible is already settled by the media route that rendered the page.
 */
export async function loadNewsForMedia(
  catalogUrl: string | undefined,
  query: NewsByMediaQuery,
  options: NewsOptions,
): Promise<NewsListResponse> {
  if (!catalogUrl) return EMPTY_FEED;

  const key = `${query.id}|${query.limit}`;
  const cached = byMediaMemo.get(key);
  if (cached) return cached;

  try {
    const response = await fetchNewsForMedia(catalogUrl, query.id, {
      limit: query.limit,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
    if (response.skipped.length > 0) {
      options.logger.warn(
        { skipped: response.skipped },
        'skipping central news articles that do not match this build (upgrade to pick them up)',
      );
    }
    // The contract never pages this route, so the envelope's cursor is null by
    // construction rather than by what the catalog happened to send.
    const strip: NewsListResponse = { articles: response.articles, nextCursor: null };
    byMediaMemo.set(key, strip);
    return strip;
  } catch (error) {
    options.logger.warn(
      { err: error, id: query.id },
      'central news by-media failed, serving an empty strip',
    );
    return EMPTY_FEED;
  }
}

/**
 * Resolve the works an article links to into local, routable rows.
 *
 * Same three-way handling as `materializeCatalogEdges` in relations.ts: a work
 * already local renders from the local row (never re-inserted, never
 * resurrected), a work local but invisible to this viewer is dropped, and a
 * work this instance has never seen is materialized once so its chip has a real
 * `/media/$slug` to point at. One at a time, so one bad row can't drop the rest.
 *
 * Rows are built from what was persisted, never from the catalog ref: the stored
 * slug can differ (suffixed on collision, or the id already existed under
 * another slug), and answering with the wrong one would misroute the reader.
 */
async function resolveLinkedWorks(
  db: Db,
  refs: NewsMediaRef[],
  viewer: SessionUser | null,
  logger: FastifyBaseLogger,
): Promise<NewsLinkedWork[]> {
  if (refs.length === 0) return [];

  const existing = await db
    .select()
    .from(media)
    .where(
      inArray(
        media.id,
        refs.map((ref) => ref.id),
      ),
    );
  const byId = new Map(existing.map((row) => [row.id, row]));

  const resolved: NewsLinkedWork[] = [];
  for (const ref of refs) {
    const local = byId.get(ref.id);
    if (local) {
      if (!canViewMedia(local)) continue;
      resolved.push({
        id: local.id,
        slug: local.slug,
        kind: local.kind,
        title: local.title,
        year: local.year,
        coverUrl: local.coverUrl,
        role: ref.role,
      });
      continue;
    }

    try {
      const [persisted] = await insertNewProviderMedia(db, [buildProviderMediaRow(ref)]);
      if (!persisted) {
        logger.warn({ id: ref.id }, 'news linked work missing after materialization');
        continue;
      }
      resolved.push({
        id: persisted.id,
        slug: persisted.slug,
        kind: persisted.kind,
        title: persisted.title,
        year: persisted.year,
        coverUrl: persisted.coverUrl,
        role: ref.role,
      });
    } catch (error) {
      logger.warn({ err: error, id: ref.id }, 'failed to materialize a news linked work');
    }
  }
  return resolved;
}

/**
 * Why an article could not be served. `unavailable` and `not-found` are kept
 * apart deliberately: one is a 404 the reader mistyped, the other a degraded
 * instance, and collapsing them would make an outage look like a dead link.
 */
export type NewsArticleResult =
  | { status: 'ok'; article: NewsArticleDetail }
  | { status: 'not-found' }
  | { status: 'unavailable' };

export async function loadNewsArticle(
  db: Db,
  catalogUrl: string | undefined,
  slug: string,
  viewer: SessionUser | null,
  options: NewsOptions,
): Promise<NewsArticleResult> {
  if (!catalogUrl) return { status: 'unavailable' };

  let article: NewsArticle | null;
  const cached = articleMemo.get(slug);
  if (cached !== undefined) {
    article = cached;
  } else {
    try {
      article = await fetchNewsArticle(catalogUrl, slug, {
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
      });
      // A 404 is cached too — a mistyped or retired slug is exactly the request
      // a crawler will repeat, and it should not cost an upstream call each time.
      articleMemo.set(slug, article);
    } catch (error) {
      options.logger.warn({ err: error, slug }, 'central news article failed');
      return { status: 'unavailable' };
    }
  }

  if (!article) return { status: 'not-found' };

  // Materialization happens per request rather than being cached with the
  // article: the memo holds the catalog's answer, and which works this
  // particular viewer may see is not the catalog's to decide.
  const linked = await resolveLinkedWorks(db, article.media, viewer, options.logger);
  return {
    status: 'ok',
    article: {
      id: article.id,
      slug: article.slug,
      title: article.title,
      dek: article.dek,
      topic: article.topic,
      kinds: article.kinds,
      coverUrl: article.coverUrl,
      publishedAt: article.publishedAt,
      body: article.body,
      sources: article.sources,
      media: linked,
    },
  };
}

/** Test seam: the memos are module-level, so suites must be able to reset them. */
export function clearNewsCache(): void {
  listMemo.clear();
  articleMemo.clear();
  byMediaMemo.clear();
}
