# ADR-0005: News section (and the newsroom agent it prepares for)

**Status:** Accepted — 2026-08-06
**Extends:** ADR-0002 (a second live-read surface, same degradation posture), ADR-0001 (news is central, published through the admin path), ADR-0004 (a third trigger for lazy materialization)
**Implements:** phases 1–3 of [docs/news-and-newsroom-plan.md](../news-and-newsroom-plan.md). Phases 0, 4 and 5 — the `@trackt/llm` port, the `apps/newsroom` agent, and its MCP face — are **not** built; this ADR records the decisions the shipped half settles and the seams left for them.

## Context

Trackt could track works but never say anything about them. Discovery was search
(ADR-0002) and typed relations (ADR-0004) — both of which require you to already
know what you are looking for. There was no editorial surface: no renewals, no
adaptation announcements, no release dates.

The eventual goal is an agent that reads registered feeds and drafts articles.
But an agent that writes into nothing is untestable, and the review workflow it
needs — draft, read, correct, publish — is worth having on its own. So the
service, contract, and reading experience ship first, driven by hand.

Two prior decisions constrained the design before it started. Canonical media IDs
are frozen and derived from provider IDs (ADR-0001), so **no writer — human or
model — can mint one**. And ADR-0002 removed the bulk pull feed, so instances
learn central data live, per request, or not at all.

## Decision

1. **News is central-only and read live.** Articles live in `apps/catalog`
   (`news_article` and four companion tables); instances hold no news tables and
   mirror nothing. `apps/api` proxies `GET /v1/news` and `GET /v1/news/:slug`
   through `packages/shared/src/news-client.ts`, bounded by
   `CATALOG_NEWS_TIMEOUT_MS` (default 2000 — the loosest of the three catalog
   timeouts, because unlike search the news page has no local content to fall
   back on).

   **A catalog failure degrades the feed to empty and never 500s**, exactly as
   `federated-search.ts` degrades to local-only. The article route is the one
   exception: there is no such thing as half an article, so it answers 503 while
   a genuinely missing article answers 404. Collapsing those two would make every
   story look retired whenever the catalog hiccups.

2. **Publication is human-gated, and the gate is structural.** Every write lands
   `status = 'draft'`. Only `PATCH /v1/admin/news/:id {status:'published'}`
   stamps `published_at` and puts an article on the public feed. The create route
   has no `status` field at all, so there is no single call that publishes. Every
   public read filters `status = 'published' AND published_at <= now()`, and an
   unpublished slug answers 404 rather than 403 — a draft's existence must not be
   probeable. This is what will make it safe to point a model at this API.

   Republishing after an unpublish keeps the original `published_at`, so a
   correction cannot fling an old story back to the top of the feed.

3. **The model never mints a canonical ID — enforced by a foreign key.**
   `news_article_media.media_id` references `catalog_media`, so an article can
   only link to a work the catalog already has. A story about a season that has
   no provider entry yet lives in prose, not as a poisoned catalog row. The
   *proposal* mechanism the plan sketched (resolve a title against TMDB/AniList,
   propose a create, apply it on approval) belongs to the agent and is
   deliberately **absent** here rather than present and unapplied.

4. **Keyset pagination — the repo's first.** `GET /v1/news` orders
   `(published_at DESC, id DESC)` and pages through an opaque base64 cursor of
   `publishedAt|id`, served whole by `news_article_feed_idx`. Offset pagination
   would drift as articles publish under a reader mid-scroll, and would make
   Postgres walk every skipped row. The `id` tiebreak is load-bearing: on
   `published_at` alone, articles sharing a timestamp would repeat or vanish
   across page boundaries. A malformed cursor restarts the feed rather than
   erroring — cursors outlive deploys in bookmarks, and a broken one is not
   something a reader can act on.

   The cost is that **numbered pages are impossible**, a deliberate deviation
   from `News.dc.html`, which draws a numbered pager. The feed has a LOAD MORE
   button instead.

5. **Linked works are inlined in full slim form, then resolved instance-side.**
   The catalog serves each linked work as a complete `SlimMedia` + role, the same
   shape `CatalogRelationEdgeSchema` uses. The instance API resolves each against
   local `media`, **materializing anything it has never seen** — a third trigger
   for ADR-0002 point 2, after search and relations. The reason is prosaic and
   unavoidable: slugs are instance-local, so a chip has nowhere to point until the
   work exists locally. Resolution is per request, never cached with the article,
   because which works a viewer may see is not the catalog's decision — every
   linked work passes through `canViewMedia`, so an unverified user entry or a
   soft-deleted row is dropped rather than leaked or resurrected.

   Materialization runs on the **article** route only. Doing it on the feed would
   mean up to a hundred inserts per page render.

6. **Two article shapes, not one.** `NewsArticleSummary` (feed) carries no body,
   sources, or media; `NewsArticle` (detail) carries all three. A 20-item page
   would otherwise ship 20 markdown documents and every linked work inline. The
   plan proposed a single type; this is a refinement, not a reversal.

7. **Article bodies are untrusted input, rendered without an HTML path.**
   `apps/web/src/components/news/Markdown.tsx` builds React elements directly and
   supports a small subset (headings, paragraphs, lists, quotes, emphasis, code,
   links). There is no `dangerouslySetInnerHTML` anywhere on the path, so raw
   HTML in a body can only ever render as text — a stronger guarantee than
   sanitising a full pipeline's output, and the reason a 90-line renderer beats a
   dependency here. Link hrefs are restricted to `http:`/`https:`; anything else
   degrades to its label as plain text.

8. **Editorial guardrails live in code, not only in prompts.** The admin route
   rejects a draft with no sources, and rejects a title that reproduces a source
   headline verbatim (normalised for case and whitespace). Articles are original
   synthesis with full attribution; that posture cannot depend on a prompt once a
   model is doing the writing.

9. **The source registry and item ledger ship now, inert.** `news_source` and
   `news_source_item` (PK `(source_id, guid)`) are the agent's server half.
   Dedup — the thing that stops a story being rewritten every run — is a database
   constraint, not something a model must remember. Nothing reads them yet;
   registering feeds and ingesting entries already work over the admin API.

## Consequences

- News is public and anonymous, so `/news` renders for signed-out visitors with
  the marketing nav. `useOptionalSession` is a new gate-free counterpart to
  `useAuthedPage`, which redirects.
- An instance with no `CATALOG_URL` shows an empty News page with an explanatory
  empty state, not an error — a catalog-less dev instance still renders.
- A 60-second in-process TTL memo (bounded at 200 entries) keeps a busy instance
  off the central service. No Redis, no table: losing it on restart costs one
  upstream call. 404s are memoized too, since a retired slug is exactly what a
  crawler will re-request.
- Cover images are not sourced. `coverUrl` is nullable everywhere and the UI falls
  back to the same seeded PRISM gradient generated covers use. No third-party
  hotlinking.
- Per-topic tag colours from the mockup were **not** adopted: nine new palette
  entries would violate the "AURA PRISM's token set is final" rule
  (docs/design/README.md). The tag takes the existing selected-chip treatment and
  colour variety comes from the per-kind dots.
- The mockup's `＋ PLAN TO WATCH` button on feed cards is absent: acting on a work
  needs the viewer's tracking state for it, which a feed summary does not carry,
  and a control that only looks like it works is worse than none.
- `packages/shared` stays browser-safe: the cursor codec uses `btoa`/`atob`, not
  `Buffer`.
- **Open for the agent (Phases 0, 4, 5):** the `@trackt/llm` port and its
  OpenAI-compatible adapter, the ingest → extract → cluster → write → resolve →
  publish pipeline, media *proposals* and their apply-on-publish step, cover
  sourcing, and the MCP server. Note also that `resolve.ts` will unpark
  `packages/providers` for central TMDB/AniList lookups — legitimate centrally,
  and exactly what ADR-0001 reserved them for, but it will be the project's first
  live provider traffic and deserves its own decision record.
