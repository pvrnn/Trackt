# Plan — News section + provider-agnostic newsroom agent

> **Status:** proposed, not yet implemented. This is the implementation plan; the
> architectural decisions it settles will be recorded as ADR-0005 when the work lands.
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

1. **`POST /v1/admin/media` is a 501 stub** (`apps/catalog/src/routes/v1/admin.ts`) and
   `POST /v1/admin/relations` doesn't exist. ROADMAP item 1 explicitly owes both. The agent
   needs them, so this work delivers the publish path the roadmap was already waiting on.
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

The provider-agnostic requirement is a hard constraint. The other four are defaults chosen to
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

## Phase 1 — Contracts (`packages/shared`)

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

## Phase 2 — Catalog service (`apps/catalog`)

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

Lift the existing `tokenMatches` + bearer check out of `routes/v1/admin.ts` into a
`requireAdmin(app, request, reply)` guard so every admin route reuses one timing-safe
comparison. Behaviour and the 401 body are unchanged.

### Admin routes (`apps/catalog/src/routes/v1/admin.ts`)

- **`POST /v1/admin/media`** — replaces the 501. Validates `SlimMediaSchema`, and **verifies
  the id**: recompute `canonicalMediaId(kind, externalId, provider)` from `externalIds` and
  reject a mismatch (`400 canonical id mismatch`) unless `kind === 'webtoon'`, which has no
  identity provider. Upsert on `id` inside a transaction holding
  `pg_advisory_xact_lock(hashtextextended('catalog-publish', 0))` — the single-writer
  requirement the `seq` trigger needs (ADR-0001), same lock idiom as `lists.ts`. Idempotent.
- **`POST /v1/admin/relations`** — the path ROADMAP item 1 owes. Body `{ fromId, toId, type }`,
  always forward-direction; `ON CONFLICT DO NOTHING` on the three-column PK; 404 if either
  endpoint is missing or tombstoned; 400 on self-edge.
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

## Phase 3 — Instance API + web

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
- Optional in the same phase if cheap: an "In the news" strip on `media.$slug.tsx` backed by
  `/v1/news/by-media`.

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

### Prompts (`src/prompts/`)

Plain `.ts` template modules, not inline strings — one per step, so switching models means
tuning text in one place. Kept stable and content-free at the top (style guide, house rules,
kind vocabulary) so providers that do implicit prefix caching benefit for free; we don't
depend on it or assert on it.

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

The fake `LlmClient` is the payoff of the port: the whole pipeline is testable with zero API
calls. Follow the existing integration idiom exactly — per-suite database
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
8. `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check` — exactly what CI runs, with
   no LLM key set, proving nothing in the suite needs a provider.
9. `docker/smoke-test-catalog.sh` still passes with the new routes registered.

## Known follow-ups (explicitly out of scope)

- A native Anthropic-Messages adapter in `@trackt/llm` (the OpenAI-compatible endpoint covers
  Anthropic today; the port is the seam if native tool use or caching control is ever wanted).
- The `verify` skill is stale — it references the retired `catalog-sync-repeat` job (removed
  by ADR-0002) and API port 3011 rather than 3001. Worth fixing, unrelated to this change.
- Newsroom cover-image sourcing beyond the catalog-cover fallback.
- Per-instance news curation / hiding (would need the instance-mirror model this plan declines).
- Notifications on a followed show's news — belongs with the v1.x airing-calendar work.
