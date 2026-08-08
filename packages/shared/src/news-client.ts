import { z } from 'zod';
import {
  NewsArticleSchema,
  NewsArticleSummarySchema,
  type NewsArticle,
  type NewsArticleSummary,
} from './news.js';
import type { SkippedItem } from './catalog-client.js';

/**
 * Live client for the central catalog's news read endpoints (ADR-0005).
 * Same contract as `catalog-client.ts`, for the same reasons: hard failures
 * throw so the degradation policy lives in exactly one place (the API route),
 * while individual items parse forward-compatibly — a newer catalog may emit a
 * topic or media kind this build has never heard of, and one such article must
 * not blank the whole feed.
 */

/* `SkippedItem` is re-exported by catalog-client via the package index; naming it
 * again here would make the star export ambiguous. Import it from the package. */

/** Envelopes stay strict; per-item contents are validated individually below. */
const ListEnvelopeSchema = z.object({
  articles: z.array(z.looseObject({})),
  nextCursor: z.string().nullable(),
});

/**
 * Validate each item on its own so one unparseable entry costs only itself.
 * Deliberately a copy of `catalog-client.ts`'s helper rather than a shared
 * export: the two clients are separate contracts that happen to agree today.
 */
function parseItems<T>(
  raws: Record<string, unknown>[],
  schema: z.ZodType<T>,
  label: string,
): { items: T[]; skipped: SkippedItem[] } {
  const items: T[] = [];
  const skipped: SkippedItem[] = [];
  for (const raw of raws) {
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      items.push(parsed.data);
    } else {
      const reason = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || label}: ${issue.message}`)
        .join('; ');
      skipped.push({ id: typeof raw.id === 'string' ? raw.id : null, reason });
    }
  }
  return { items, skipped };
}

export interface FetchNewsListOptions {
  kind?: string | undefined;
  topic?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface FetchNewsListResult {
  articles: NewsArticleSummary[];
  /** null on the last page. */
  nextCursor: string | null;
  skipped: SkippedItem[];
}

export async function fetchNewsList(
  catalogUrl: string,
  options: FetchNewsListOptions,
): Promise<FetchNewsListResult> {
  const { timeoutMs, fetchImpl = fetch, ...query } = options;
  const url = new URL('/v1/news', catalogUrl);
  for (const key of ['kind', 'topic', 'from', 'to', 'cursor'] as const) {
    const value = query[key];
    if (value) url.searchParams.set(key, value);
  }
  if (query.limit) url.searchParams.set('limit', String(query.limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`news list failed: ${response.status} ${response.statusText}`);
  }

  const envelope = ListEnvelopeSchema.parse(await response.json());
  const { items, skipped } = parseItems(envelope.articles, NewsArticleSummarySchema, '(article)');
  return { articles: items, nextCursor: envelope.nextCursor, skipped };
}

export interface FetchNewsArticleOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * One article by slug, or null when the catalog has no such article.
 *
 * A 404 is a legitimate answer, not a failure, so it returns rather than throws
 * — otherwise the API's catch-all would turn "no such article" into the same
 * degraded empty response as "catalog is down", and a mistyped URL would look
 * like an outage.
 *
 * No per-item skip here: an article that doesn't parse *is* the response, so a
 * schema mismatch throws and the caller degrades.
 */
export async function fetchNewsArticle(
  catalogUrl: string,
  slug: string,
  options: FetchNewsArticleOptions,
): Promise<NewsArticle | null> {
  const { timeoutMs, fetchImpl = fetch } = options;
  const url = new URL(`/v1/news/${encodeURIComponent(slug)}`, catalogUrl);

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`news article failed: ${response.status} ${response.statusText}`);
  }
  return NewsArticleSchema.parse(await response.json());
}

export interface FetchNewsForMediaOptions {
  limit?: number;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Articles touching one work, for the media detail page's "In the news" block.
 * Summaries only — that block links out, it does not render bodies.
 */
export async function fetchNewsForMedia(
  catalogUrl: string,
  mediaId: string,
  options: FetchNewsForMediaOptions,
): Promise<{ articles: NewsArticleSummary[]; skipped: SkippedItem[] }> {
  const { limit, timeoutMs, fetchImpl = fetch } = options;
  const url = new URL('/v1/news/by-media', catalogUrl);
  url.searchParams.set('id', mediaId);
  if (limit) url.searchParams.set('limit', String(limit));

  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`news by-media failed: ${response.status} ${response.statusText}`);
  }

  const envelope = ListEnvelopeSchema.parse(await response.json());
  const { items, skipped } = parseItems(envelope.articles, NewsArticleSummarySchema, '(article)');
  return { articles: items, skipped };
}
