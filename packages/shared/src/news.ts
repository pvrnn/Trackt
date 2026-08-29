import { z } from 'zod';
import { SlimMediaSchema } from './catalog.js';
import { MediaKindSchema } from './media.js';

/**
 * The News contract (ADR-0005). News is central-only: articles live in
 * `apps/catalog` and instances read them live, the same posture federated search
 * takes toward media (ADR-0002). Nothing here is mirrored instance-side.
 *
 * Two article shapes, deliberately:
 *   - {@link NewsArticleSummarySchema} — what a feed page serves. No body, no
 *     sources, no linked works, because a 20-item page would otherwise carry 20
 *     markdown documents and up to a hundred inlined media rows.
 *   - {@link NewsArticleSchema} — one article in full.
 * (The plan sketched a single type; splitting it is what keeps the paginated
 * feed cheap enough to serve uncached.)
 */

/** What a story is about. Assigned per article, one topic each. */
export const NEWS_TOPICS = [
  'announcement',
  'renewal',
  'cancellation',
  'release_date',
  'trailer',
  'casting',
  'adaptation',
  'award',
  'general',
] as const;
export const NewsTopicSchema = z.enum(NEWS_TOPICS);
export type NewsTopic = z.infer<typeof NewsTopicSchema>;

/**
 * Editorial lifecycle. Publication is human-gated (ADR-0005): everything is
 * created `draft` and only a `PATCH` to `published` puts it on the public feed.
 */
export const NEWS_STATUSES = ['draft', 'published', 'rejected'] as const;
export const NewsStatusSchema = z.enum(NEWS_STATUSES);
export type NewsStatus = z.infer<typeof NewsStatusSchema>;

/** How many articles one feed page serves, mirroring `IN_PROGRESS_LIMIT`'s export. */
export const NEWS_PAGE_LIMIT = 20;

/**
 * Attribution for one story a article was written from. Every article carries at
 * least one: articles are original synthesis, and a claim with no traceable
 * origin is not publishable (ADR-0005).
 */
export const NewsSourceRefSchema = z.object({
  url: z.url(),
  /** Publication name as it should be credited, e.g. "Anime News Network". */
  outlet: z.string().min(1).max(120),
  /** The source item's own headline — credited, never reused as our title. */
  title: z.string().min(1).max(300),
  publishedAt: z.iso.datetime().nullable(),
});
export type NewsSourceRef = z.infer<typeof NewsSourceRefSchema>;

/** Whether a work is what the story is about, or merely named in passing. */
export const NEWS_MEDIA_ROLES = ['subject', 'mentioned'] as const;
export const NewsMediaRoleSchema = z.enum(NEWS_MEDIA_ROLES);
export type NewsMediaRole = z.infer<typeof NewsMediaRoleSchema>;

/**
 * A work an article is about, inlined in full slim form rather than as an id.
 *
 * The plan proposed a four-field pick, enough to render a chip without a second
 * fetch. Full `SlimMedia` costs a little more and buys the thing that actually
 * matters: an instance can *materialize* a work it has never seen, exactly as
 * `CatalogRelationEdgeSchema` lets it (ADR-0004). Without that, a chip for an
 * unknown work has nowhere to link, because slugs are instance-local.
 */
export const NewsMediaRefSchema = SlimMediaSchema.extend({
  role: NewsMediaRoleSchema,
});
export type NewsMediaRef = z.infer<typeof NewsMediaRefSchema>;

/** Feed-page shape: everything a card renders, and nothing else. */
export const NewsArticleSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  title: z.string().min(1).max(300),
  /** Standfirst under the headline; the feed card's body text. */
  dek: z.string().max(400).nullable(),
  topic: NewsTopicSchema,
  /** Media kinds the story touches — drives the feed's kind tabs. */
  kinds: z.array(MediaKindSchema),
  coverUrl: z.string().nullable(),
  publishedAt: z.iso.datetime(),
});
export type NewsArticleSummary = z.infer<typeof NewsArticleSummarySchema>;

/** One article in full. `body` is markdown, and is model-authored — treat as untrusted. */
export const NewsArticleSchema = NewsArticleSummarySchema.extend({
  body: z.string().min(1),
  sources: z.array(NewsSourceRefSchema),
  media: z.array(NewsMediaRefSchema),
});
export type NewsArticle = z.infer<typeof NewsArticleSchema>;

/**
 * A linked work as an *instance* serves it, once the catalog's slim row has been
 * resolved against local `media`.
 *
 * The extra hop exists because slugs are instance-local: the central catalog
 * knows a work's canonical id, but only this instance knows what `/media/$slug`
 * to send a reader to. Absent works are materialized on the way through, the
 * same one-time snapshot federated search and relations already do
 * (ADR-0002 point 2, ADR-0004).
 */
export const NewsLinkedWorkSchema = z.object({
  id: z.uuid(),
  slug: z.string().min(1),
  kind: MediaKindSchema,
  title: z.string().min(1),
  year: z.number().int().nullable(),
  coverUrl: z.string().nullable(),
  role: NewsMediaRoleSchema,
});
export type NewsLinkedWork = z.infer<typeof NewsLinkedWorkSchema>;

/** One article as `GET /api/v1/news/:slug` serves it: catalog prose, local links. */
export const NewsArticleDetailSchema = NewsArticleSummarySchema.extend({
  body: z.string().min(1),
  sources: z.array(NewsSourceRefSchema),
  media: z.array(NewsLinkedWorkSchema),
});
export type NewsArticleDetail = z.infer<typeof NewsArticleDetailSchema>;

/**
 * Feed query. `from`/`to` are ISO dates (YYYY-MM-DD) bounding `publishedAt`
 * inclusively — the mockup's date-range control, which composes with the keyset
 * below for free because both order on the same column.
 */
export const NewsListQuerySchema = z.object({
  kind: MediaKindSchema.optional(),
  topic: NewsTopicSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(NEWS_PAGE_LIMIT),
  /** Opaque keyset cursor from the previous page's `nextCursor`. */
  cursor: z.string().max(200).optional(),
});
export type NewsListQuery = z.infer<typeof NewsListQuerySchema>;

/**
 * The media detail page's "In the news" strip: articles touching one work.
 * Never paged — the strip is a handful of links, so the shared envelope's
 * `nextCursor` is always null on this route.
 */
export const NEWS_BY_MEDIA_LIMIT = 5;

export const NewsByMediaQuerySchema = z.object({
  id: z.uuid(),
  limit: z.coerce.number().int().min(1).max(20).default(NEWS_BY_MEDIA_LIMIT),
});
export type NewsByMediaQuery = z.infer<typeof NewsByMediaQuerySchema>;

export const NewsListResponseSchema = z.object({
  articles: z.array(NewsArticleSummarySchema),
  /** null on the last page. Opaque — decode only via {@link decodeNewsCursor}. */
  nextCursor: z.string().nullable(),
});
export type NewsListResponse = z.infer<typeof NewsListResponseSchema>;

/**
 * Keyset cursor over `(published_at DESC, id DESC)` — the repo's first paginated
 * endpoint (ADR-0005). Offset pagination would drift as articles publish under a
 * reader mid-scroll and would make Postgres count past every skipped row; a
 * keyset does neither, at the cost of losing numbered pages (a deliberate
 * deviation from `News.dc.html`, which draws a numbered pager).
 *
 * Base64url of `publishedAt|id`. Opaque to clients by contract, not by
 * encryption: it carries only values the same page already returned.
 *
 * `btoa`/`atob` rather than `Buffer`, which does not exist in a browser — this
 * package is imported by apps/web and stays runtime-neutral. Both are safe here
 * because the payload (an ISO timestamp, a `|`, a UUID) is pure ASCII.
 */
export interface NewsCursor {
  publishedAt: string;
  id: string;
}

export function encodeNewsCursor(cursor: NewsCursor): string {
  return btoa(`${cursor.publishedAt}|${cursor.id}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Returns null for anything malformed — a bad cursor restarts the feed, never 500s. */
export function decodeNewsCursor(raw: string): NewsCursor | null {
  let decoded: string;
  try {
    decoded = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  // The id is a UUID and the timestamp an ISO string, so exactly one separator.
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  const publishedAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  const parsed = z.object({ publishedAt: z.iso.datetime(), id: z.uuid() }).safeParse({
    publishedAt,
    id,
  });
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ *
 * Admin contracts — the project-operated editorial surface.
 * Behind CATALOG_ADMIN_TOKEN, same as the media/relation publish path.
 * ------------------------------------------------------------------ */

/** A registered feed. Sources are data, not code: added over the API, no redeploy. */
export const NewsSourceInputSchema = z.object({
  name: z.string().min(1).max(120),
  feedUrl: z.url(),
  homepageUrl: z.url().nullable().default(null),
  /** Which media kinds this outlet covers; advisory, used to steer the agent. */
  kinds: z.array(MediaKindSchema).default([]),
  enabled: z.boolean().default(true),
});
export type NewsSourceInput = z.infer<typeof NewsSourceInputSchema>;

export const NewsSourceSchema = NewsSourceInputSchema.extend({
  id: z.uuid(),
  /** Conditional-GET state, written by the agent's ingest step (Phase 4). */
  etag: z.string().nullable(),
  lastModified: z.string().nullable(),
  lastPolledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NewsSource = z.infer<typeof NewsSourceSchema>;

/** Every field optional — a PATCH may touch one. */
export const NewsSourceUpdateSchema = NewsSourceInputSchema.partial();
export type NewsSourceUpdate = z.infer<typeof NewsSourceUpdateSchema>;

/** Where a feed entry stands: unwritten, written up, or judged not news. */
export const NEWS_ITEM_STATUSES = ['pending', 'used', 'skipped'] as const;
export const NewsItemStatusSchema = z.enum(NEWS_ITEM_STATUSES);
export type NewsItemStatus = z.infer<typeof NewsItemStatusSchema>;

/**
 * One entry seen in a registered feed. `(sourceId, guid)` is the primary key, so
 * dedup is a database constraint rather than something a model has to remember.
 */
export const NewsSourceItemInputSchema = z.object({
  sourceId: z.uuid(),
  /** The feed's own `<guid>`/`<id>`, falling back to the entry URL. */
  guid: z.string().min(1).max(500),
  url: z.url(),
  title: z.string().min(1).max(500),
  publishedAt: z.iso.datetime().nullable().default(null),
});
export type NewsSourceItemInput = z.infer<typeof NewsSourceItemInputSchema>;

export const NewsSourceItemSchema = NewsSourceItemInputSchema.extend({
  status: NewsItemStatusSchema,
  /** The article written from this item, once one exists. */
  articleId: z.uuid().nullable(),
  seenAt: z.iso.datetime(),
});
export type NewsSourceItem = z.infer<typeof NewsSourceItemSchema>;

/** Bulk ingest is `ON CONFLICT DO NOTHING`; only genuinely new rows come back. */
export const NewsSourceItemsInputSchema = z.object({
  items: z.array(NewsSourceItemInputSchema).min(1).max(200),
});
export const NewsSourceItemsResponseSchema = z.object({
  created: z.array(NewsSourceItemSchema),
});
export type NewsSourceItemsResponse = z.infer<typeof NewsSourceItemsResponseSchema>;

/** Which feed entry a draft was written from, for marking the ledger. */
export const NewsSourceItemRefSchema = z.object({
  sourceId: z.uuid(),
  guid: z.string().min(1).max(500),
});

/** A link from an article to a work the catalog already has. */
export const NewsMediaLinkSchema = z.object({
  id: z.uuid(),
  role: NewsMediaRoleSchema.default('subject'),
});

/**
 * The editable fields of an article, **without defaults**.
 *
 * Default-free on purpose. `z.object({…}).partial()` keeps any inner
 * `.default()`, so a schema built from a defaulted base would materialize those
 * defaults on a PATCH that never mentioned the field — turning
 * `PATCH {status:'published'}` into a silent reset of `kinds`, `dek`,
 * `coverUrl`, and every linked work. Defaults belong to
 * {@link NewsDraftSchema}, which is the only place a field can legitimately be
 * absent and still need a value.
 */
const NewsArticleFieldsSchema = z.object({
  title: z.string().min(1).max(300),
  dek: z.string().max(400).nullable(),
  body: z.string().min(1),
  topic: NewsTopicSchema,
  kinds: z.array(MediaKindSchema),
  coverUrl: z.url().nullable(),
  /** At least one: an article with no attribution is rejected at the route. */
  sources: z.array(NewsSourceRefSchema).min(1),
  media: z.array(NewsMediaLinkSchema),
});

/**
 * A draft as submitted. Always lands `draft` — there is no way to publish in one
 * call, because the review gate is the point (ADR-0005).
 *
 * `media` links to works that already exist in the catalog. The agent's
 * *proposals* — works a story implies but the catalog lacks — are Phase 4, and
 * deliberately absent here rather than present and unapplied.
 */
export const NewsDraftSchema = NewsArticleFieldsSchema.extend({
  dek: z.string().max(400).nullable().default(null),
  kinds: z.array(MediaKindSchema).default([]),
  coverUrl: z.url().nullable().default(null),
  media: z.array(NewsMediaLinkSchema).default([]),
  sourceItemIds: z.array(NewsSourceItemRefSchema).default([]),
});
export type NewsDraft = z.infer<typeof NewsDraftSchema>;

/**
 * An edit. `status` is what makes this the publish gate: setting `published`
 * stamps `publishedAt` and puts the article on the public feed.
 *
 * Every key is genuinely absent unless sent, so the route can treat presence as
 * intent — `sources`/`media` are replace-in-full, and replacing them with
 * nothing has to be something the caller asked for.
 */
export const NewsArticleUpdateSchema = NewsArticleFieldsSchema.partial().extend({
  status: NewsStatusSchema.optional(),
});
export type NewsArticleUpdate = z.infer<typeof NewsArticleUpdateSchema>;

/** An article as the review queue sees it: the public shape plus editorial state. */
export const NewsAdminArticleSchema = NewsArticleSchema.extend({
  status: NewsStatusSchema,
  /** Null until published — the public schema can assume it set. */
  publishedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type NewsAdminArticle = z.infer<typeof NewsAdminArticleSchema>;

export const NewsAdminListQuerySchema = z.object({
  status: NewsStatusSchema.default('draft'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const NewsAdminListResponseSchema = z.object({
  articles: z.array(NewsAdminArticleSchema),
});

export const NewsItemsQuerySchema = z.object({
  status: NewsItemStatusSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const NewsItemsResponseSchema = z.object({
  items: z.array(NewsSourceItemSchema),
});

export const NewsSourcesResponseSchema = z.object({
  sources: z.array(NewsSourceSchema),
});
