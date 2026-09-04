# Plan — News section + provider-agnostic newsroom agent

> **Status:** **Phases 1–3 shipped** (contracts, catalog service, instance API + web) —
> recorded as [ADR-0005](adr/0005-news-and-newsroom-agent.md), which is authoritative
> where it and this plan disagree. **Phases 0, 4, 5 and 6 — `packages/llm`, `apps/newsroom`,
> the MCP server, and the offline prompt optimizer — are not built**; the sections below are
> still the plan for them.
> Deltas the implementation settled differently are noted inline as **[shipped: …]**.
> Deeper context: [PRD](PRD.md), [ROADMAP](ROADMAP.md), [ADR-0001](adr/0001-central-slim-catalog.md),
> [ADR-0002](adr/0002-federated-catalog-search.md), [ADR-0003](adr/0003-per-season-media.md),
> [ADR-0004](adr/0004-typed-media-relations.md).

## Context

Trackt tracks movies, series, anime, manga and webtoons but has no editorial surface: the
only discovery paths are search (ADR-0002) and typed relations (ADR-0004). We want a **News**
section — articles about announcements, renewals, adaptations, release dates — plus an
**AI agent** that periodically reads a list of sources the project operator provides, writes
articles from them, and can create the corresponding catalog media (e.g. "Season 3 of X
announced") through an admin API.

**No vendor lock-in.** The agent must run against whatever model is plugged in — Qwen, Kimi,
DeepSeek, OpenRouter, a local Ollama/vLLM, or Anthropic/OpenAI — by changing an API key, a
base URL and a model name. That constraint drives the design more than anything else (see
[Phase 0](#phase-0--provider-agnostic-llm-layer-packagesllm-tracktllm)): no provider SDK, no
provider-only features on the critical path.

Two existing facts shape the rest:

1. **The catalog publish path already exists** — `POST /v1/admin/media` and
   `POST /v1/admin/relations` (`apps/catalog/src/routes/v1/admin.ts`) shipped ahead of this
   work, along with the shared `requireAdmin` guard. Phase 2 below therefore only adds the
   *news* admin routes; the two publish routes it used to owe are struck through there.
2. **Canonical media IDs are frozen forever** — `uuidv5(namespace, "provider:kind:externalId")`
   (`packages/shared/src/canonical-id.ts`). No model can invent one. Media creation from a
   news item is only possible once a TMDB/AniList ID exists; that constraint is built into the
   pipeline rather than papered over.

## Decisions

| Question | Decision |
| --- | --- |
| LLM provider | **None hard-coded.** A `@trackt/llm` port with one OpenAI-compatible adapter reaching every major provider; swapping is config, not code. |
| Where news lives | **Central only, in `apps/catalog`**; instances read it live through their own API. Extends ADR-0002 — no instance mirror, no background sync, no new instance tables. |
| Autonomy | **Agent writes drafts; a human publishes.** Catalog media/relation writes are *proposals* attached to a draft, applied only on approval. |
| Agent surface | **Admin REST first**, with a thin **MCP server** over the same client, so the same operations are drivable by hand from an MCP client. |
| Sourcing | **RSS/Atom feeds the operator registers.** We fetch and extract the linked page ourselves — no provider-side browsing tool. Original synthesis + attribution, never verbatim reproduction. |
| Prompt quality | **Measured, then optimized offline.** Prompts are versioned data, not code; an out-of-band GEPA/DSPy harness ([Phase 6](#phase-6--prompt-optimization-gepadspy-offline)) proposes better ones against a graded fixture set. The runtime stays TypeScript and gains no dependency — a checked-in hand-written bundle is always the fallback. |

The provider-agnostic requirement is a hard constraint. The other five are defaults chosen to
match existing architecture decisions and are open to revision before implementation.

---

## Architecture

```
  RSS/Atom sources ──▶ apps/newsroom (project-operated, scheduled)
                          │  our own fetch + readability extraction
                          │  @trackt/llm  ──▶ any OpenAI-compatible endpoint
                          │  @trackt/providers (TMDB/AniList ID resolution)
                          ▼
                   apps/catalog  POST /v1/admin/news       (draft)
                                 POST /v1/admin/media      (was 501)
                                 POST /v1/admin/relations  (new)
                          │
                          ▼ human review → published
                   apps/catalog  GET /v1/news, /v1/news/:slug, /v1/news/by-media
                          ▲ live fetch (bounded, degrades to empty)
                   apps/api      GET /api/v1/news, /api/v1/news/:slug
                          ▲
                   apps/web      /news, /news/$slug
```

`apps/newsroom` is project-operated like `apps/catalog`: **not** in `docker-compose.yml`, not
something a self-hoster runs, so no instance pays model or fetching cost and the "no live
provider connectors, no scraping" decision (ROADMAP) stays true instance-side.

Off to the side of that flow, and never in it, sits
[Phase 6](#phase-6--prompt-optimization-gepadspy-offline): recorded runs and reviewed drafts
feed an offline GEPA/DSPy harness in `tools/prompt-optimizer/`, whose only output is a
checked-in prompt bundle the agent loads. It is a build-time asset, not a runtime component —
nothing in the diagram above calls it, and deleting it leaves a working agent.

---

## Phase 0 — Provider-agnostic LLM layer (`packages/llm`, `@trackt/llm`)

The seam that keeps everything else portable. New workspace package alongside
`shared`/`db`/`providers` (named `llm`, not `providers`, which is already the *metadata*
provider package).

### The port (`src/types.ts`)

```ts
export interface LlmClient {
  /** Free-text completion. */
  complete(req: LlmRequest): Promise<LlmResult<string>>;
  /** Schema-constrained completion: returns a value already parsed by `schema`. */
  completeJson<T>(
    req: LlmRequest & { schema: z.ZodType<T>; schemaName: string },
  ): Promise<LlmResult<T>>;
}

export interface LlmRequest {
  system: string;
  user: string;
  maxOutputTokens?: number;
  /** Merged into the request body verbatim — provider-specific knobs, no code change. */
  extraBody?: Record<string, unknown>;
}

export interface LlmResult<T> {
  value: T;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}
```

Deliberately narrow: **text in, text or JSON out.** No tool-calling, no streaming, no
thinking/effort parameters, no server-side browsing — none of that is portable, and the
pipeline is designed not to need it (page fetching is ours, orchestration is ours). Adding a
provider later means implementing two methods.

### The adapter (`src/openai-compatible.ts`)

One adapter, raw `fetch` against `POST {baseUrl}/chat/completions`, in the style of the
existing `packages/providers/src/http.ts` (timeout via `AbortSignal.timeout`, bounded retry
with backoff on 429/5xx, Zod-parsed response envelope). No vendor SDK — so we're not swapping
one provider's lock-in for another's client library.

That one adapter covers everything worth plugging in:

| Provider | `LLM_BASE_URL` | Notes |
| --- | --- | --- |
| Qwen (DashScope) | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | |
| Kimi (Moonshot) | `https://api.moonshot.ai/v1` | |
| DeepSeek | `https://api.deepseek.com/v1` | |
| OpenRouter | `https://openrouter.ai/api/v1` | one key, many models |
| Ollama / vLLM / LM Studio | `http://localhost:11434/v1` etc. | fully local, no key |
| OpenAI | `https://api.openai.com/v1` | |
| Anthropic | `https://api.anthropic.com/v1` | via its OpenAI-compatible endpoint |

### JSON output without provider-specific features

`completeJson` negotiates down a ladder, controlled by `LLM_JSON_MODE`
(`auto` | `json_schema` | `json_object` | `prompt`):

1. `response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }` —
   schema derived from the Zod type with `zod-to-json-schema`. Best when supported.
2. `response_format: { type: 'json_object' }` + the schema rendered into the prompt.
3. Prompt-only: "reply with JSON matching this schema, nothing else" + fenced-block stripping.

In every mode the result is `schema.parse()`d locally, and on a parse failure we do **one**
repair round (feed the invalid output plus the validation errors back and ask for a fix)
before failing the story. `auto` probes once per process and caches the working mode — so a
provider that doesn't do structured output still works, just with one extra round trip
occasionally. This is the piece that makes the whole thing portable; it gets the most tests.

### Config (`packages/shared/src/env-newsroom.ts`)

`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_MAX_OUTPUT_TOKENS` (default 8000),
`LLM_TIMEOUT_MS` (default 120000), `LLM_JSON_MODE` (default `auto`), `LLM_EXTRA_BODY` (a JSON
object merged into every request — this is where `{"enable_thinking":false}` for Qwen or
`{"reasoning_effort":"medium"}` for others goes, without touching code). Same
`loadEnv`-style Zod validation with `HINTS`, dev defaults, hard-fail in production.

Cost/latency logging comes from the OpenAI-compatible `usage` block
(`prompt_tokens`/`completion_tokens`), which every provider in the table returns — so per-run
token accounting works regardless of who's serving.

### Tests (`packages/llm/test/`)

`openai-compatible.test.ts` with a stubbed `fetch`: happy path, each of the three JSON modes,
the `auto` downgrade path, the repair round, timeout, 429 retry, malformed envelope. Plus a
`pnpm --filter @trackt/llm smoke` script that hits the configured provider once and prints the
round-tripped JSON — the fastest way to validate a new key.

---

## Phase 1 — Contracts (`packages/shared`) — **shipped**

> **[shipped: deltas]** `NewsMediaRefSchema` is a full `SlimMedia` + role, not a
> four-field pick — that is what lets an instance materialize a work it has never
> seen, without which a chip has no local slug to link to. The single
> `NewsArticleSchema` became two: `NewsArticleSummarySchema` for feed pages (no
> body/sources/media) and `NewsArticleSchema` for one article. `NewsDraftSchema`
> carries no `mediaProposals` — that is Phase 4, and an unapplied field would be
> dead contract. `NewsListQuerySchema` gained `from`/`to` for the mockup's date
> filter. The cursor codec uses `btoa`/`atob`, not `Buffer`, to keep the package
> browser-safe.


New `packages/shared/src/news.ts`, exported from `src/index.ts`, following the style of
`src/catalog.ts` (Zod, JSDoc citing the ADR, strict envelope + forward-compatible items):

- `NEWS_TOPICS` const array + `NewsTopicSchema`: `announcement | renewal | cancellation |
  release_date | trailer | casting | adaptation | award | general`.
- `NEWS_STATUSES`: `draft | published | rejected`.
- `NewsSourceRefSchema` — `{ url, outlet, title, publishedAt }`.
- `NewsMediaRefSchema` — `SlimMediaSchema.pick({ id, kind, title, year })` + `role:
  'subject' | 'mentioned'`, so the web app renders a linked-work chip with no extra fetch.
- `NewsArticleSchema` — `{ id, slug, title, dek, body (markdown), topic, kinds: MediaKind[],
  coverUrl, publishedAt, sources: NewsSourceRef[], media: NewsMediaRef[] }`.
- `NewsListQuerySchema` — `{ kind?, topic?, limit (1–50, default 20), cursor? }`.
- `NewsListResponseSchema` — `{ articles: NewsArticle[], nextCursor: string | null }`.
- `NewsDraftSchema` — what the agent produces and what `POST /v1/admin/news` accepts: article
  fields plus `mediaProposals: NewsMediaProposal[]` (Phase 4) and `sourceItemIds`.

New `packages/shared/src/news-client.ts`, a near-copy of `catalog-client.ts`
(`fetchNewsList`, `fetchNewsArticle`, `fetchNewsForMedia`): `AbortSignal.timeout`, strict
envelope parse, **per-item `safeParse` so one unknown enum value doesn't drop the response**.
Tests mirroring `packages/shared/test/catalog-client.test.ts`. Also export `NEWS_PAGE_LIMIT`,
the way `IN_PROGRESS_LIMIT` is exported today.

## Phase 2 — Catalog service (`apps/catalog`) — **shipped**

> **[shipped: deltas]** Migration is `0005_news.sql`; the admin routes live in a new
> `routes/v1/admin-news.ts` rather than growing `admin.ts`. `news_source_item.article_id`
> is `ON DELETE SET NULL`, not cascade — a deleted article must not take its ledger row
> with it, or the next run treats the entry as unseen and rewrites the story. The publish
> PATCH keeps the original `published_at` on republish. Two guardrails are enforced at the
> route: no sources → 400, and a title copying a source headline verbatim → 400.


### Schema (`apps/catalog/src/db/schema.ts`)

Five tables, same conventions as `catalogMedia` (snake_case columns, `withTimezone` timestamps,
`$onUpdate`, index array from the second callback, `text({ enum })` not `pgEnum`):

- `news_source` — the registry of feeds the operator provides: `id`, `name`, `feedUrl`
  (unique), `homepageUrl`, `kinds text[]`, `enabled bool`, `etag`, `lastModified`,
  `lastPolledAt`. Sources are data, not code — added through the admin API or MCP, no redeploy.
- `news_source_item` — the dedup ledger: PK `(sourceId, guid)`, plus `url`, `title`,
  `publishedAt`, `seenAt`, `status: pending|used|skipped`, `articleId`. This is what stops the
  agent rewriting the same story every run; dedup is enforced by the PK, not by the model.
- `news_article` — `id`, `slug` (unique), `title`, `dek`, `body`, `topic`, `kinds text[]`,
  `coverUrl`, `status`, `publishedAt`, `createdAt`, `updatedAt`. Indexes:
  `(status, published_at DESC, id DESC)` for the keyset feed, GIN on `kinds`.
- `news_article_source` — PK `(articleId, url)` + `outlet`, `title`, `publishedAt`.
- `news_article_media` — PK `(articleId, mediaId, role)`, `mediaId` FK → `catalogMedia`
  `onDelete: cascade`. Deliberately no `seq`/`deletedAt`, same reasoning as
  `catalog_media_relation`: news is served live, never through a pull feed.

Migration `apps/catalog/migrations/0005_news.sql` via `pnpm --filter @trackt/catalog db:generate`
(review the SQL, commit it with the schema change — `db:push` is forbidden per CONTRIBUTING).

### Shared admin auth (`apps/catalog/src/lib/admin-auth.ts`)

~~Lift the existing `tokenMatches` + bearer check out of `routes/v1/admin.ts` into a
`requireAdmin` guard so every admin route reuses one timing-safe comparison.~~ **Delivered.**
It landed as a Fastify `preHandler` rather than an in-handler call, so a route cannot forget
to check its return value. The news admin routes below just declare `preHandler: requireAdmin`.

### Admin routes (`apps/catalog/src/routes/v1/admin.ts`)

- ~~**`POST /v1/admin/media`** — replaces the 501, verifying the canonical id against the
  body's own `externalIds` and upserting under the single-writer publish lock.~~
  **Delivered** — see the ROADMAP row. Note the id check is per-kind: `series` derives from
  `canonicalSeriesSeasonId(showId, seasonNumber)` (ADR-0003), not `canonicalMediaId` alone.
- ~~**`POST /v1/admin/relations`** — `{ fromId, toId, type }`, forward-direction only,
  `ON CONFLICT DO NOTHING`, 404 on a missing or tombstoned endpoint, 400 on a self-edge.~~
  **Delivered.**
- **`POST /v1/admin/news`** — create a draft (`status: 'draft'`), its sources, its resolved
  media links, and its `mediaProposals`; marks the referenced `news_source_item` rows `used`.
  Slug via `packages/shared/src/slug.ts`, de-duplicated with a numeric suffix.
- **`PATCH /v1/admin/news/:id`** — edit any field; setting `status: 'published'` stamps
  `publishedAt` and, in the same transaction, **applies the draft's `mediaProposals`** through
  the same code path as the two routes above. This is the review gate.
- **`GET /v1/admin/news?status=`** — the review queue (default `draft`).
- **`GET|POST|PATCH /v1/admin/news/sources`** — source registry CRUD.
- **`GET /v1/admin/news/items?status=pending`** — the ledger, for the agent's ingest step.
- **`POST /v1/admin/news/items`** — bulk-insert seen feed entries, `ON CONFLICT DO NOTHING`,
  returning only the rows that were new. Dedup lives here, server-side.

### Public read routes (`apps/catalog/src/routes/v1/news.ts`)

- `GET /v1/news` — published only (`status = 'published' AND published_at <= now()`), ordered
  `(published_at DESC, id DESC)`, **keyset cursor** (base64 of `publishedAt|id`). This is the
  repo's first paginated endpoint; the ADR should call that out. Filters `kind` (array
  containment) and `topic`.
- `GET /v1/news/:slug` — one article with sources + media refs.
- `GET /v1/news/by-media?id=<uuid>&limit=` — articles touching one work, for a future
  "In the news" block on the media detail page.

Register in `apps/catalog/src/routes/v1/index.ts`. Tighter per-route rate limit on the list
route, matching the `/search` precedent
(`config: { rateLimit: { max: 60, timeWindow: '1 minute' } }`).

## Phase 3 — Instance API + web — **shipped**

> **[shipped: deltas]** The article route resolves linked works against local `media`,
> materializing unseen ones (ADR-0005 point 5) — the plan did not account for slugs being
> instance-local. It answers 503 for a degraded catalog and 404 for a missing article,
> rather than degrading. The feed uses LOAD MORE, not the mockup's numbered pager (keyset
> cursors cannot address a page by number). Per-topic tag colours were dropped for the
> existing selected-chip treatment (no new tokens), and the `＋ PLAN TO WATCH` card button
> is absent (a feed summary carries no per-viewer tracking state). `/news` is public, via a
> new `useOptionalSession`. The "In the news" media-detail strip landed later, as a sidebar
> section over a proxied `/api/v1/news/by-media`: it renders nothing at all when the work has
> no news (or the catalog is unreachable), rather than leaving an empty block on the page. **The topic filter row was later removed** —
> the feed filters by kind and date only, and `?topic=` is no longer a page search param.
> Topic survives as the badge on each card, and `GET /v1/news`/`/api/v1/news` still accept
> a `topic` filter for other consumers.


### API (`apps/api/src/routes/v1/news.ts` + `src/lib/news.ts`)

`GET /api/v1/news` and `GET /api/v1/news/:slug`, anonymous, tighter rate-limit bucket. They
call `fetchNewsList`/`fetchNewsArticle` against `env.CATALOG_URL` with a new
`CATALOG_NEWS_TIMEOUT_MS` (default 2000), added to `packages/shared/src/env.ts` next to
`CATALOG_SEARCH_TIMEOUT_MS` with a `HINTS` entry, and to `turbo.json` `passThroughEnv`.
**A catalog failure degrades to an empty list and a logged warning — never a 500**, exactly
like `federated-search.ts`. A small in-process TTL memo (60s, keyed on the serialized query)
keeps a busy instance off the central service; no Redis, no new table. If `CATALOG_URL` is
unset, the routes return an empty feed so a catalog-less dev instance still renders.

### Web (`apps/web`)

- `src/lib/news.ts` — `useNewsList` / `useNewsArticle` on the existing `ky` client
  (`lib/http.ts`), same shape as `lib/search.ts`.
- `src/routes/news.tsx` — the feed. Kind filter reusing the search page's Radix
  `toggle-group` chips, topic chips, shareable `?kind=&topic=` URLs, "Load more" on the
  cursor. Reuses `CoverCard`/`GlassCard`/`Chip`/`KindDot`; **no new design tokens** — AURA
  PRISM's set is final per [docs/design](design/README.md), and Radix stays headless-only.
- `src/routes/news.$slug.tsx` — article: hero, dek, markdown body, a source list with
  outbound links and outlet attribution, linked-work chips routing to `/media/$slug`.
  Render markdown with a small allow-listed renderer (no raw HTML) — the body is
  model-authored, so treat it as untrusted input.
- `src/components/layout/AppNav.tsx` and `MarketingNav.tsx` — a NEWS entry.
- `src/components/news/MediaNews.tsx` — the "In the news" strip on `media.$slug.tsx`, backed
  by `/v1/news/by-media`. Deferred out of this phase and landed after it.

`routeTree.gen.ts` regenerates itself — don't hand-edit.

## Phase 4 — The agent (`apps/newsroom`)

New workspace app, project-operated. Package `@trackt/newsroom`, ESM, `tsx watch` in dev,
`node dist/index.js` in prod. Depends on `@trackt/shared`, `@trackt/llm`, `@trackt/providers`
(unparked here — provider calls are legitimate *centrally*, exactly what ADR-0001 reserved
them for), `zod`, `pino`, an RSS/Atom parser, `@mozilla/readability` + `linkedom` for
extraction, and `node-cron`.

### Pipeline (`src/pipeline/`) — deterministic code, the model as bounded steps

1. **`ingest.ts`** — read enabled sources, fetch and parse each feed (conditional GET using
   the stored ETag/Last-Modified), `POST` every entry to `/v1/admin/news/items`. The response
   is *only the new ones*. No model involved.
2. **`extract.ts`** — **this is what replaces a provider's browsing tool.** For each pending
   item, fetch the linked page ourselves and reduce it to readable text with Readability,
   truncated to a character budget. Honours `robots.txt`, sends a real User-Agent, and reuses
   `packages/providers/src/rate-limit.ts` for per-host throttling and
   `packages/providers/src/http.ts` for timeout/retry. Everything the model sees is captured
   here, which makes runs auditable and re-runnable offline from fixtures.
3. **`cluster.ts`** — one `completeJson` call over the pending items (title + summary +
   outlet only, no bodies — keeps it cheap). Groups items covering the same story, drops
   non-news, assigns a `topic` and confidence.
4. **`write.ts`** — one `completeJson` call per story, capped at
   `NEWSROOM_MAX_STORIES_PER_RUN`, over the extracted text from step 2. Returns a `NewsDraft`.
5. **`resolve.ts`** — **the guardrail that keeps canonical IDs honest.** The model emits
   `NewsMediaProposal { kind, title, year, seasonNumber?, provider?, externalId? }` — never a
   UUID. This step resolves each proposal against TMDB/AniList through `@trackt/providers`,
   then derives the id with `canonicalMediaId` / `canonicalSeriesSeasonId`. Then:
   - resolved **and** already in the catalog → link the article to it;
   - resolved but absent → a `create` proposal on the draft;
   - unresolved (a pure announcement with no provider entry yet) → **no media row**; the
     announcement lives in the article prose and the source item is re-queued for a later run.
     A rumoured season never becomes a permanent catalog row.
6. **`publish.ts`** — `POST /v1/admin/news` with the draft, sources, links and proposals.
   Nothing goes live; `NEWSROOM_DRY_RUN=true` prints instead of posting.

`src/catalog-admin-client.ts` is the single typed client for every admin call (bearer token,
retry with backoff on 5xx, Zod-parsed responses). Both the pipeline and the MCP server use it.

### Prompts (`src/prompts/`) — versioned data, not code

Two layers, and the split is what makes [Phase 6](#phase-6--prompt-optimization-gepadspy-offline)
possible at all:

- **The frame** (`src/prompts/<step>.ts`) — everything mechanical and invariant: the rendered
  JSON schema, the input serialization, the house rules and kind vocabulary, the assembly of
  the user message. Code, reviewed as code, never rewritten by a machine.
- **The instruction bundle** (`prompts/<step>/<id>.json`, loaded at startup) — the one text
  block the frame interpolates, plus optional few-shot demos:

  ```jsonc
  {
    "step": "write",            // cluster | write
    "id": "default",            // file name; the hand-written baseline
    "models": ["*"],            // or ["qwen*", "deepseek*"] — see fallback below
    "instruction": "You are …", // the optimizable text
    "demos": [],                // optional few-shot examples, same shape as the step's IO
    "provenance": {             // hand | gepa
      "kind": "hand", "createdAt": "2026-…", "notes": "baseline"
    }
  }
  ```

`resolvePrompt(step, model)` picks the most specific bundle whose `models` glob matches the
configured `LLM_MODEL`, and falls back to `default` — which is hand-written, always present,
and the only one the test suite runs. **Deleting every optimized bundle must leave a working
agent**; that is the property that keeps ADR-0005's "no provider-specific feature on the
critical path" true once prompts start being tuned per model family.

Bundles are checked in, so a prompt change is a reviewable diff with a test run behind it,
exactly like a schema change. Keeping the frame's stable prefix first still lets providers
with implicit prefix caching benefit for free; we don't depend on it or assert on it.

### Recorded runs (`src/record.ts`) — the corpus everything downstream needs

With `NEWSROOM_RECORD_DIR` set, every model step appends a JSONL trace:

```ts
type StepTrace = {
  runId: string; step: 'cluster' | 'write';
  promptId: string; model: string;
  input: unknown;        // exactly what the frame was given — extracted text, never raw HTML
  rawOutput: string; parsed: unknown | null;
  checks: CheckResult[]; // the code-level guardrails below, per check, with messages
  usage: { inputTokens: number; outputTokens: number }; latencyMs: number;
};
```

`extract.ts` already captures everything the model sees, so a trace plus its extraction fixture
is a **replayable rollout with no network** — which is what makes the pipeline tests cheap, and
what Phase 6 grades against. Build it in Phase 4 even though nothing consumes it yet:
reconstructing this corpus after the fact means re-fetching pages that have since changed.

### Editorial and legal guardrails (in the prompts *and* enforced in code)

- Articles are **original synthesis**. Verbatim reproduction beyond a short attributed quote
  is forbidden; every article carries every source URL with its outlet name; single-sourced
  claims are framed as "reported by X".
- The agent reads **only** the registered feeds, and `extract.ts` will only fetch URLs that
  came from a registered source's feed. Disabling a source stops it immediately.
- **No third-party image hotlinking by default**: `coverUrl` falls back to the linked work's
  catalog cover, or a PRISM gradient placeholder.
- Code-level rejection of a draft with no linked source, or whose title matches a source
  headline verbatim.

Write these as `src/checks.ts` — a list of named, pure `(draft, sources) => CheckResult`
functions the pipeline runs before `publish.ts` — rather than inline `if`s. They are then
three things at once: the runtime guardrail, the assertion set in `pipeline.test.ts`, and
**the scoring function Phase 6 optimizes against**. GEPA's own advice is to reuse the checks
you already have rather than invent a metric; this is that, arranged in advance.

### Scheduling

Default is a one-shot run — `pnpm newsroom:run` — so it sits behind any existing scheduler
(cron, a Scaleway job, GitHub Actions). Setting `NEWSROOM_CRON` runs an internal `node-cron`
loop instead for a long-lived container. Deliberately **not** BullMQ: that queue lives in
`apps/worker`, which is the self-hosted instance side.

Deployment mirrors the catalog precedent: `apps/newsroom/Dockerfile` (turbo-filtered
multi-stage), `apps/newsroom/.env.example`, and a build-only CI job like `docker-catalog` —
never auto-published.

## Phase 5 — MCP server

`apps/newsroom/src/mcp.ts`: a stdio MCP server (`@modelcontextprotocol/sdk`) that is a **thin
second face over `catalog-admin-client.ts`**, not a parallel implementation. Tools:
`catalog_search`, `catalog_publish_media`, `catalog_publish_relation`, `news_list_drafts`,
`news_get_draft`, `news_create_draft`, `news_update_draft`, `news_publish`, `news_reject`,
`news_list_sources`, `news_add_source`, `news_list_pending_items`. Run with
`pnpm --filter @trackt/newsroom mcp`; document the client config snippet in `docs/newsroom.md`
so drafts can be reviewed and published conversationally. This is MCP as a *client-facing*
protocol and is independent of which model the pipeline itself uses.

## Phase 6 — Prompt optimization (GEPA/DSPy, offline)

Phases 0–5 give the agent a pipeline, a schema and a review gate. What they do **not** give it
is a way to know whether its prompts are any good. Two of the pipeline's steps are pure
judgement — `cluster.ts` decides what counts as one story and what isn't news at all, `write.ts`
decides what a well-attributed article reads like — and both would otherwise be tuned by
reading a few drafts and editing prose until they look better. That is unmeasurable, it does
not survive a model swap (the whole point of Phase 0 is that the model *will* be swapped), and
it silently regresses.

This phase adds the measurement, and then an optimizer that consumes it.

### What GEPA and DSPy actually are

**DSPy** (Stanford) is a Python framework for programming — rather than prompting — language
models: you declare a *signature* (typed inputs → typed outputs), compose *modules*, and hand
the program to an *optimizer* that rewrites the instructions and selects few-shot demos against
a metric you define. Prompt text becomes a compiled artifact instead of a hand-tuned string.

**GEPA** (Genetic-Pareto, [arXiv:2507.19457](https://arxiv.org/abs/2507.19457), Agrawal et al.
2025; ICLR 2026 oral) is the optimizer we care about, available as `dspy.GEPA` and wrapping the
standalone [`gepa-ai/gepa`](https://github.com/gepa-ai/gepa) engine. Its loop:

1. Sample a candidate from a **Pareto frontier** — the set of prompts each of which is best on
   *at least one* evaluation instance, not the single best on average. That is what stops the
   search collapsing onto one local optimum and keeps complementary strategies alive.
2. Run it on a minibatch, capturing full traces.
3. Feed those traces **plus the metric's natural-language feedback** to a *reflection LM*,
   which diagnoses why the candidate failed and writes a new instruction targeting that.
4. Keep the mutant if it improves; occasionally merge lineages.

The interesting part for us is step 3. A metric that returns `0.4` tells the optimizer nothing;
a metric that returns `0.4` **and** "the draft cited two sources but framed a single-sourced
renewal claim as fact; the title reproduced Deadline's headline word for word" tells it exactly
what to write into the next instruction. GEPA's own guidance is to build that feedback out of
artifacts you already have — validators, schema errors, test failures. `src/checks.ts` from
Phase 4 *is* that artifact set, which is why it is specified as named pure functions with
messages rather than inline `if`s.

Sample efficiency is why this is affordable at our scale: the paper reports GEPA beating GRPO
by ~10% average (up to 20%) using **up to 35× fewer rollouts** — on the order of 100–500 metric
calls rather than 5,000–25,000 — and beating MIPROv2, the previous best DSPy prompt optimizer,
by over 10%. A GEPA run against our fixtures is a coffee-break job with a two-figure API bill,
not a training run.

### Decision: the optimizer lives outside the Node graph and outside the runtime

`tools/prompt-optimizer/` — Python, **not** a pnpm workspace package, not in
`pnpm-workspace.yaml`, not in `turbo.json`, not in CI's default pipeline, not a dependency of
`apps/newsroom`. `pyproject.toml` + `uv.lock`, `dspy` and `gepa` pinned, a `README.md`, and a
`make optimize STEP=write` entry point. Nothing in the TypeScript build ever imports it, and a
contributor who never touches prompts never installs Python.

```
tools/prompt-optimizer/
  programs/          # one dspy.Module per optimizable step, mirroring src/prompts/<step>.ts
  metrics/           # feedback metrics — the real work of this phase
  data/              # graded fixtures, exported from recorded runs
  export/            # writes prompts/<step>/gepa-<date>.json back into apps/newsroom
```

The output of a run is **a JSON bundle in the format Phase 4 already loads** — an instruction
string and optional demos — committed by a human after reading the diff. Not a DSPy program,
not a pickle: `dspy.save(save_program=False)` state is DSPy's private shape (instructions,
demos, LM config), and our runtime is not DSPy. We lift the instruction out and throw the
container away. That is the seam that keeps a Python research tool from becoming a production
dependency.

### The programs and how they stay honest about the contract

One `dspy.Module` per optimizable step, whose signature mirrors the corresponding frame in
`src/prompts/`. The output schema is **not** re-declared in Python: `apps/newsroom` gains a
`pnpm --filter @trackt/newsroom export-schemas` script that dumps the Zod output schemas to
`tools/prompt-optimizer/data/schemas/*.json` via the same `zod-to-json-schema` Phase 0 already
uses. If the contract changes and the export is stale, the optimizer fails loudly instead of
tuning a prompt for a shape the pipeline no longer accepts.

The task model is the model we actually ship against: DSPy reaches any OpenAI-compatible
endpoint through LiteLLM, so `dspy.LM("openai/<LLM_MODEL>", api_base=LLM_BASE_URL,
api_key=LLM_API_KEY)` points the optimizer at the exact `.env` the runtime uses — Qwen, Kimi,
DeepSeek, OpenRouter or a local Ollama alike. `reflection_lm` is configured separately and is
deliberately a *stronger, more expensive* model: it is called a handful of times per run, so
its cost is noise, and its job is writing good instructions rather than executing the task.

### The dataset

GEPA needs far less data than its reputation suggests — the engine runs on a few dozen
examples, and the paper's headline results come from small validation sets. Ours comes from
the review gate we already built:

- **`cluster`** — 60–100 recorded pending-item batches with a human grouping: which items are
  the same story, which are not news at all, what the topic is. Cheap to label; the reviewer is
  already reading these.
- **`write`** — every draft that went through `PATCH /v1/admin/news/:id`. A **published**
  article is a positive; a **rejected** one is a negative with a reason; and an article the
  editor *edited before publishing* is the most valuable row of all, because the diff between
  the model's draft and the published text is exactly the feedback GEPA's reflection step
  wants. Capturing that means storing the pre-edit body — a `news_article.draft_body` column,
  or simply the recorded trace matched by `articleId`; the trace is enough and costs no schema
  change.

Split ~70/30 into `trainset`/`valset`. **The valset is never used to write prompts by hand** —
it is the only defence against tuning the optimizer's own harness until the number goes up.

### The metrics — where this phase's real work is

Each returns `dspy.Prediction(score=…, feedback=…, objective_scores=…)`:

| Step | Score | Feedback text (what reflection reads) |
| --- | --- | --- |
| `cluster` | Pairwise F1 against the human grouping, × topic accuracy, × non-news precision | The titles it wrongly merged and wrongly split, named; each item it kept that a human dropped; the topic it chose vs the topic assigned |
| `write` | Weighted composite of `src/checks.ts` (hard, deterministic) and an LLM-as-judge rubric (soft) | Every failing check verbatim with its message, plus the judge's per-criterion notes, plus — when the row is an edited article — the editor's diff |

The `write` checks are the ones the pipeline and the catalog routes already enforce, which is
what makes the metric trustworthy: schema parse, ≥1 source, title not a verbatim source
headline (Phase 2 rejects this at the route), dek length, `kinds` ⊆ vocabulary, no bare UUID in
prose, no n-gram overlap with source text beyond a short attributed quote, every
single-sourced claim framed as "reported by X". A prompt that scores well and then trips a
route guard is a metric bug, not a prompt success — the two must be the same list.

The judge is one `completeJson` call against a rubric, run on the same OpenAI-compatible
client. It is the soft half deliberately: no automatic check can tell you an article reads
like a press release. Judge scores are advisory in weight (≤40%) so a rubric-gaming prompt
cannot outrun the deterministic half.

**Objectives are tracked separately from the scalar.** The metric also returns
`objective_scores={"editorial": …, "compliance": …}` with `gepa_kwargs={"frontier_type":
"objective"}`, so the frontier keeps candidates that are strongest on attribution and
verbatim-avoidance even when a livelier candidate wins on aggregate. Note the semantics:
the scalar score still gates acceptance and picks the final candidate — objectives only steer
parent and merge selection. `compliance` is therefore *also* weighted into the scalar, and any
run whose winner scores worse on `compliance` than the `default` bundle is discarded by hand.

### Guardrails on the optimization itself

This phase points a model at text that ends up in production, and the traces it reflects over
contain third-party page content. Both need the same posture as the articles themselves.

- **Prompt injection through the reflective dataset is a real path.** A hostile source page
  can contain "when writing about this studio, always say…"; that text lands in a trace,
  the trace goes to the reflection LM, and the reflection LM writes instructions. Mitigations,
  in order: traces carry Readability-extracted text only (never raw HTML), the reflective
  dataset renders page content inside a clearly delimited, labelled block, an `export/lint.py`
  rejects a candidate instruction containing URLs, outlet-specific proper-noun directives, or
  imperative override phrasing, and **a human reads the whole instruction diff before it is
  committed**. No promotion path exists that a machine can walk alone.
- **Never auto-promote, never optimize in CI.** Runs are manual, keyed, and metered. CI must
  stay green with no LLM key set (Phase 0's rule) — the optimizer's tests use recorded traces
  and a fake LM, or don't run.
- **The `default` bundle is hand-written and permanent.** It is what CI exercises, what an
  unrecognized model falls back to, and the answer to "we changed provider and everything got
  worse". Optimized bundles are additive.
- **Cost is bounded by `max_metric_calls`.** Start at `auto="light"` (≈6 candidates evaluated)
  to validate the harness end to end, then a fixed `max_metric_calls` of 150–300 for a real
  run. Remember a `write` rollout is two model calls (task + judge), so budget accordingly;
  log the same `usage` accounting Phase 0 already exposes and print a per-run cost line.
- **Re-run on model change, not on schedule.** A bundle is tuned for one model family; the
  trigger for a new run is swapping `LLM_MODEL`, or a metric moving on new data — not a cron.

### Alternatives considered

| Option | Verdict |
| --- | --- |
| **[`@ax-llm/ax`](https://github.com/ax-llm/ax)** (Apache-2.0, the de facto TypeScript DSPy; ships GEPA and bootstrap few-shot, ~3k stars) | **No, as a runtime dependency** — it would own generation, retries, JSON mode and provider config, which is precisely the surface Phase 0 exists to keep at two methods. It is the fallback if we ever want *in-process* optimization, and the only serious candidate for it. |
| **[`gepa-ts`](https://github.com/tangle-network/gepa-ts)** (MIT, TS port claiming Python parity) | **No** — archived read-only in April 2026, single-digit adoption. Not something to build an editorial pipeline on. |
| Optimizing with **MIPROv2** instead | Available in the same DSPy install and worth running as a baseline, but GEPA's textual-feedback channel is exactly what our checks produce, and the paper puts it >10% ahead. Use MIPROv2 as the control, not the plan. |
| **RL / fine-tuning** a small model | Out of scope by an order of magnitude in cost and by the vendor-neutrality constraint — a fine-tuned model is the lock-in Phase 0 refuses. |
| Hand-tuning prompts, no harness | The status quo. Fine for the first weeks of Phase 4; unmeasurable the moment there are two model families and two people editing. |

### When to do this

**Not before Phase 4 has run for real.** The prerequisite is data: a few dozen reviewed drafts
and a handful of labelled cluster batches. Build the trace recorder and the bundle loader *in*
Phase 4 (they are cheap then and expensive to retrofit), run the agent by hand for a few weeks,
then do this phase against a corpus that actually reflects the feeds we read. Doing it earlier
optimizes against fixtures we invented, which is how you get a prompt that is excellent at the
examples and mediocre at the job.

## Docs to write with the implementation

- **`docs/adr/0005-news-and-newsroom-agent.md`** — records: news is central-only and read
  live (extends ADR-0002); the agent is project-operated so instances keep the "no scraping"
  property; **the LLM is behind a two-method port and no provider-specific feature sits on
  the critical path**; the model never mints canonical IDs; publication is human-gated;
  keyset pagination arrives here first.
- **`docs/ROADMAP.md`** — its own rule is that every PR completing an item updates it in the
  same commit. Add the News/newsroom rows, and mark ROADMAP item 1's `POST /v1/admin/media`
  and the owed relations publish path as delivered.
- **`docs/newsroom.md`** — running the agent, registering sources, the review workflow, the
  MCP setup, the provider table above with a worked example per provider, and how to add a
  new adapter.
- `README.md` layout block gains `newsroom/` and `packages/llm/`; `.env.example` and
  `turbo.json` gain the new variables.
- **A new ADR when Phase 6 lands** (`docs/adr/000N-offline-prompt-optimization.md`, number
  taken at the time) — records: prompts are versioned data with a permanent hand-written
  fallback; the optimizer is Python, offline, and outside the pnpm/turbo graph; model-authored
  instructions are human-reviewed diffs, never auto-promoted; the metric and the runtime
  guardrails are one list. Two of those are architecture stances a future contributor will
  otherwise re-litigate (Python in a TS monorepo; machine-written text in `main`).
- **`docs/newsroom.md`** also covers the optimization loop: labelling a corpus, running
  `make optimize`, reading the report, and what disqualifies a candidate bundle.

## Tests

| File | Covers |
| --- | --- |
| `packages/llm/test/openai-compatible.test.ts` | three JSON modes, `auto` downgrade, repair round, retry, timeout, malformed envelope |
| `packages/shared/test/news-client.test.ts` | forward-compatible per-item parsing, timeout |
| `apps/catalog/test/news.integration.test.ts` | drafts invisible publicly, keyset pagination, kind/topic filters, `by-media` |
| `apps/catalog/test/admin.integration.test.ts` | 401 without/with wrong token, canonical-id mismatch → 400, idempotent upsert, `seq` monotonic across sequential publishes, relations conflict + self-edge |
| `apps/api/test/news.integration.test.ts` | proxy shape, **catalog down → empty list, not 500**, cache TTL |
| `apps/newsroom/test/extract.test.ts` | fixture HTML → text, robots.txt refusal, per-host throttle |
| `apps/newsroom/test/resolve.test.ts` | unresolvable proposal produces **no** media row; resolved proposal derives the right canonical UUID |
| `apps/newsroom/test/pipeline.test.ts` | fixture feeds + a **fake `LlmClient`**; no network, no key needed in CI |
| `apps/newsroom/test/prompts.test.ts` | bundle resolution: model glob precedence, fallback to `default`, malformed bundle rejected at load, **a bundle set stripped to `default` alone still runs the pipeline** |
| `apps/newsroom/test/checks.test.ts` | each guardrail in `src/checks.ts` against a passing and a failing draft — the same list Phase 6 scores against, so a drift here is a metric bug |
| `tools/prompt-optimizer/tests/` (pytest, **not in `pnpm test`**) | metrics score recorded traces deterministically; feedback strings name the offending item; `export/lint.py` rejects an instruction carrying a URL or an override phrase |

The fake `LlmClient` is the payoff of the port: the whole pipeline is testable with zero API
calls. The optimizer's own tests are the one suite outside `pnpm test` — Python, run by hand,
never gating CI, because CI must stay green with no LLM key and no Python toolchain. Follow the existing integration idiom exactly — per-suite database
(`trackt_news_test`), `TEST_DATABASE_URL_NEWS` override, `describe.runIf(available)`,
`app.inject()`, `CI_REQUIRE_DB` turning a skip into a failure. Register the new
`TEST_DATABASE_URL_*` in `turbo.json`.

## Verification

```sh
docker compose -f docker-compose.dev.yml up -d
pnpm install && pnpm build
pnpm --filter @trackt/catalog db:migrate        # applies 0005_news
pnpm dev                                        # web :3000, api :3001, catalog :3002
```

1. **Provider swap is config-only** — `pnpm --filter @trackt/llm smoke` against two different
   providers (e.g. a Qwen key and a local Ollama) with **no code change**, only
   `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`. Both must return schema-valid JSON. Then run the
   same check with `LLM_JSON_MODE=prompt` forced, to prove the no-structured-output path works.
2. **Admin publish path** — `curl -H "Authorization: Bearer $CATALOG_ADMIN_TOKEN" -d @media.json
   localhost:3002/v1/admin/media` returns 200 (not 501); re-POST is idempotent; a body whose
   `id` doesn't match its `externalIds` returns 400.
3. **Draft → publish** — POST a draft, confirm `GET localhost:3002/v1/news` does *not* include
   it, `PATCH .../news/:id {status:'published'}`, confirm it appears and that any `create`
   proposal produced a real `catalog_media` row with the expected canonical UUID.
4. **Federated read** — `curl localhost:3001/api/v1/news` returns the same article; stop the
   catalog and confirm the API still answers **200 with an empty list**.
5. **Web** — open `http://localhost:3000/news`, filter by kind, open the article, click a
   linked work through to `/media/$slug`; check source links and attribution render.
6. **Agent, dry run** — register one feed, then
   `NEWSROOM_DRY_RUN=true pnpm --filter @trackt/newsroom run:once`. Confirm the printed draft
   carries sources, that a proposal without a resolvable provider ID is dropped rather than
   invented, and that per-run token usage is logged.
7. **MCP** — `pnpm --filter @trackt/newsroom mcp`, connect an MCP client, list drafts and
   publish one; verify it appears at `/news`.
8. **Prompt bundles are swappable and optional** — run the agent once with the shipped
   bundles, then delete every file under `apps/newsroom/prompts/*/` except `default.json` and
   run it again. Both runs must produce a schema-valid draft; only the prose should differ.
9. **Optimization round trip** (Phase 6, run by hand, never in CI) —
   `cd tools/prompt-optimizer && uv run make optimize STEP=write AUTO=light`. Confirm it reads
   the exported schemas rather than a hand-copied one, that the printed report shows train and
   **val** scores plus a per-objective breakdown, that the winner beats `default` on the val
   set *and* does not regress `compliance`, and that `export/` wrote a bundle the TypeScript
   loader accepts. Then re-run the pipeline against the new bundle and check the draft still
   passes every `src/checks.ts` guard — a candidate that scores well and trips a route guard
   means the metric has drifted from the runtime.
10. `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` — exactly what CI runs, with
    no LLM key set **and no Python installed**, proving nothing in the suite needs a provider or
    the optimizer.
11. `docker/smoke-test-catalog.sh` still passes with the new routes registered.

## Known follow-ups (explicitly out of scope)

- A native Anthropic-Messages adapter in `@trackt/llm` (the OpenAI-compatible endpoint covers
  Anthropic today; the port is the seam if native tool use or caching control is ever wanted).
- The `verify` skill is stale — it references the retired `catalog-sync-repeat` job (removed
  by ADR-0002) and API port 3011 rather than 3001. Worth fixing, unrelated to this change.
- Newsroom cover-image sourcing beyond the catalog-cover fallback.
- Per-instance news curation / hiding (would need the instance-mirror model this plan declines).
- Notifications on a followed show's news — belongs with the v1.x airing-calendar work.
- **GEPA as inference-time search** — setting the valset to the live batch with
  `track_best_outputs=True` turns the optimizer into a per-story search that returns the best
  draft it found. Real quality gain, but it multiplies per-article cost by the search budget
  and puts a Python process on the publishing path. Out of scope; revisit only if drafts stay
  weak after prompt optimization.
- **`optimize_anything` beyond prompts** — the same engine optimizes any text artifact against
  an evaluator (the GEPA project reports agent-architecture and policy search with it). The
  obvious candidates here are the extraction character budget, the cluster/write step boundary,
  and the judge rubric itself. Interesting, and strictly after the prompt loop is boring.
- **Few-shot demos in bundles** — the format carries `demos`, but Phase 6 optimizes
  instructions first. Demos cost input tokens on every call forever, so they need their own
  cost/benefit measurement before being turned on.
- **In-process optimization via `@ax-llm/ax`** — would remove the Python side entirely at the
  cost of adopting a framework in `packages/llm`. Only worth it if we ever want the agent to
  adapt online, which nothing currently asks for.
