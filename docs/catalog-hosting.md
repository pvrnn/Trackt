# Catalog service hosting — provider comparison

Decision doc behind the shipped **catalog service deployment** (ROADMAP → Done, Infra). Prices checked July 2026; cloud pricing drifts, re-verify before committing a card.

> **Read this first — the traffic shape changed after the comparison was made.**
> This doc was written when instances polled `GET /v1/catalog/changes` every 6
> hours and cold starts were absorbed by a background job's retry/backoff.
> **ADR-0002 deleted that feed.** The catalog is now on the *interactive request
> path* of every self-hosted instance, through three live reads:
>
> | Read | Timeout | Degrades to |
> | --- | --- | --- |
> | `GET /v1/catalog/search` (ADR-0002) | `CATALOG_SEARCH_TIMEOUT_MS`, 1500 ms | local-only results |
> | `GET /v1/catalog/relations` (ADR-0004) | `CATALOG_RELATIONS_TIMEOUT_MS`, 1000 ms | locally-known edges |
> | `GET /v1/news`, `/v1/news/:slug` (ADR-0005) | `CATALOG_NEWS_TIMEOUT_MS`, 2000 ms | an empty feed |
>
> Traffic is still instance-bounded — browsers never see `CATALOG_URL` — but a
> cold start now eats a live user's latency budget rather than a cron's. The
> per-provider comparison below is unaffected (the prices and the shape of each
> platform's offer haven't changed); what *is* affected is the scale-to-zero
> recommendation, revised at the bottom.

## What we're hosting

`apps/catalog` is deliberately easy to host (see [ADR-0001](adr/0001-central-slim-catalog.md)):

- One tiny Fastify container (Node 22), self-migrates on boot, `/healthz` + `/readyz`.
- One small dedicated Postgres. Seven tables: `catalog_media`, `catalog_media_relation` (ADR-0004) and the five `news_*` tables (ADR-0005). Populated catalog likely **0.5–2 GB**, essentially all of it `catalog_media` (anime-offline-database + TVmaze + Wikidata movies + manga ≈ a few hundred thousand slim rows); relations and news are rounding errors beside it.
- **Read path is live, not polled** — the three endpoints in the callout above, each timeout-bounded and each degrading rather than failing.
- Write path is a single-writer admin path (`POST /v1/admin/media`, `/v1/admin/relations`, `/v1/admin/news`), hit occasionally by the operator or an importer.
- No PII in the catalog, but EU hosting is a nice-to-have (project operator is in France).

## TL;DR comparison

| Provider | What it gives us | Est. monthly cost | EU region | Fit |
| --- | --- | --- | --- | --- |
| **Scaleway** (Serverless Container + Neon or Serverless SQL) | Container, scale-to-zero | **~€0–2** (≤ free tiers) / ~€5 always-on | ✅ Paris | ⭐ Cheapest real option |
| **Railway** | App + Postgres, one platform | **~$7–12** ($5 floor + usage) | ✅ Amsterdam | ⭐ Best DX, simplest |
| **Clever Cloud** | App + Postgres, one platform (FR) | ~€10–15 | ✅ Paris | OK, pricier than Railway |
| **DigitalOcean** App Platform + Managed PG | App $5 + PG $15 | ~$20 | ✅ AMS/FRA | Managed PG floor too high |
| **DigitalOcean** droplet + compose | Self-managed VM | ~$6–8 | ✅ | Cheap but you're the SRE |
| **Neon** | Postgres only (no app hosting) | $0 (free tier) → few $ | ✅ AWS eu | ⭐ As the DB half of a combo |
| **Supabase** | Postgres + BaaS we won't use | $0 (500 MB cap) → $25 | ✅ | Free tier too small once populated |
| **Vercel** | Serverless functions (no Postgres) | $0\* → $20 | edge | ❌ Wrong shape for Fastify |

## Per-provider notes

### Railway — simplest, ~$7–12/mo

- Hobby plan is **$5/mo which includes $5 of usage**; you always pay the floor. A small Node service + small Postgres typically lands **$6–12/mo** total.
- Postgres is a first-class Railway service on the same project — one dashboard, private networking, `DATABASE_URL` injected.
- Deploys straight from GitHub with a Dockerfile; `europe-west4` (Amsterdam) region available.
- Trade-off: usage-metered (CPU/mem/egress) so cost creeps with traffic; no scale-to-zero on Hobby that suits a long-running server + DB well (the DB must stay up anyway here since it's Railway-hosted).

### Scaleway — cheapest, EU, ~€0–5/mo

- **Serverless Containers**: €0.00001/vCPU-s + €0.000002/GB-s **after a free tier of 200k vCPU-s + 400k GB-s per month**. With scale-to-zero (min-scale 0) and today's traffic (no self-hosted adoption yet) this stays inside the free tier → **~€0**. Pinned always-on at 0.25 vCPU/256 MB ≈ **€5/mo**.
- Cold starts are ~a few seconds plus a migration check on boot. That used to be free — a background job just retried. It is now paid for by whoever is typing in a search box, and it exceeds all three client timeouts, so a cold start is a *degraded response*, not a slow one.
- DB options:
  - **Scaleway Serverless SQL Database** (Postgres protocol): storage ~€0.10/GB-mo, compute billed per active query time → near-zero for our load. Keeps everything in one French provider.
  - Or **Neon free tier** (below) — also ~€0.
  - Managed Postgres DEV-S (~€11/mo) only if we insist on a conventional instance — not worth it here.
- Trade-off: more assembly than Railway — container registry push + a small GitHub Action deploy step, two products to wire together, less polished dashboard.

### Clever Cloud — French PaaS, ~€10–15/mo

- Smallest app instance from **~€4.8/mo**; small managed Postgres adds a few € more (tiny shared DEV plans exist but are too small for a populated catalog).
- Per-second billing, git-push deploys, solid EU/French story (SecNumCloud-adjacent, Paris).
- Trade-off: costs roughly double Railway for the same shape, DX is decent but less slick; no scale-to-zero.

### DigitalOcean — fine VM host, wrong managed floor

- App Platform container **$5/mo** is fair, but **Managed Postgres starts at $15/mo** — a $20/mo floor for a service Scaleway runs for ~€0. Two separate products to configure.
- The alternative — a **$6–8/mo droplet running `docker compose` (catalog + postgres)** — is the cheapest *self-managed* route, but then we own OS patching, Postgres backups, and TLS. Reasonable fallback, not a first choice for a project-operated always-there dependency.

### Neon — the DB half, not the whole answer

- Serverless Postgres, scale-to-zero after 5 min idle. **Free tier: 100 CU-hours/mo + 0.5 GB storage** — comfortable at current query volume, though its own idle-suspend adds a second cold start under the container's (see the recommendation).
- 2026 pricing removed the paid-plan floor: **Launch is purely usage-based** ($0.106/CU-h, $0.35/GB-mo storage). If the populated catalog outgrows 0.5 GB, we'd pay **single-digit $/mo**, mostly storage.
- No app hosting — pairs with Scaleway/Railway/anything for the Fastify container.

### Supabase — more product than we need

- Free tier: 500 MB database, then the project **goes read-only**; a populated catalog will blow past that, and the next step is a **$25/mo Pro** plan — paying for auth/storage/realtime features the catalog will never use.
- Also: direct Postgres connections are IPv6-first (external hosts often need their pooler), and free projects pause after ~1 week idle — a footgun for a service whose traffic is entirely other people's instances.
- Verdict: great BaaS, wrong tool — if we want serverless Postgres, Neon is the leaner pick.

### Vercel — architectural mismatch

- Built for serverless/edge functions, not a long-running Fastify server: we'd wrap the app in a handler, migrations-on-boot would run per cold start, and Hobby caps execution at 10 s.
- **Hobby is restricted to non-commercial use**, and there's no bundled Postgres — you'd add Neon anyway. At that point, pairing Neon with a real container host is strictly better. Skip.

## Cost scenarios (populated catalog, a handful of instances reading live)

| Setup | Monthly |
| --- | --- |
| Scaleway Serverless Container (scale-to-zero) + Neon free | **~€0** |
| Scaleway Serverless Container + Scaleway Serverless SQL | ~€0–2 |
| Scaleway always-on (min-scale 1) + Neon Launch (1–2 GB) | ~€5–7 |
| Railway app + Railway Postgres | ~$7–12 |
| Clever Cloud app + PG | ~€10–15 |
| DO App Platform + Managed PG | ~$20 |

## Recommendation

Two defensible picks, one clear loser set (Vercel/Supabase out; DO managed too expensive):

1. **Cheapest / EU: Scaleway Serverless Container (min-scale 0) + Neon free tier.** ~€0/mo, Paris + EU regions. Cost of admission: a Dockerfile, a registry push, and a ~30-line GitHub Action.
2. **Simplest: Railway (app + Postgres together).** ~$7–12/mo, one dashboard, GitHub-integrated deploys, matches the PRD §6.1 platform choice. Pay ~€100/yr for near-zero ops thought.

**Suggested: start on Scaleway + Neon at min-scale 0, and move to min-scale 1 the moment a third party actually runs an instance.**

The original reasoning for scale-to-zero — "a background dependency nobody watches; paying a monthly floor for instant responses to a 6-hourly cron is waste" — **no longer applies.** ADR-0002 put this service on the interactive path, so a cold start is now a user-visible degradation: search silently drops to local-only results, the relations rail thins out, the news feed renders empty. Nothing errors, which is by design and also means **nobody will report it.**

Scale-to-zero is still right *today*, because the only instance reading this catalog is the operator's own and a €5/mo floor buys nothing. It stops being right the moment the read traffic belongs to someone else. Two compounding cold starts make this sharper than it looks: Neon suspends after 5 minutes idle underneath a container that has also scaled to zero, so the first search after a quiet period pays both. Budget **~€5–7/mo** (Scaleway min-scale 1 + Neon Launch) as the real steady-state cost, not €0.

If operating two providers ever grates, the Dockerfile and env contract (`DATABASE_URL`, `CATALOG_ADMIN_TOKEN`, `PORT`) move to Railway unchanged in an afternoon — and Railway has no scale-to-zero, so it sidesteps this tradeoff by charging for it.

Whichever is picked, the deploy artifact is the same and platform-agnostic: `apps/catalog/Dockerfile` + CI image build + env docs — no platform lock-in in the repo itself.

## Deploying

Concrete walkthrough for the "Suggested: start on Scaleway + Neon" pick above.
The deploy artifact itself — `apps/catalog/Dockerfile`, the `docker-catalog`
CI job, `apps/catalog/.env.example` — is platform-agnostic; swap steps 2–3 for
Railway (documented at the end) without touching the repo.

### 1. Image

CI (`docker-catalog` job, `.github/workflows/ci.yml`) builds and
smoke-tests `apps/catalog/Dockerfile` on every PR/push as a regression net,
but deliberately never publishes it — unlike the self-hosted monolith image,
nobody but the project operator ever pulls this one, so there's no standing
"many self-hosters need a pre-built image" reason to auto-publish on every
merge. Publish it yourself, only when you're actually about to redeploy:

    docker build -t ghcr.io/pvrnn/trackt-catalog:latest -f apps/catalog/Dockerfile .
    docker/smoke-test-catalog.sh ghcr.io/pvrnn/trackt-catalog:latest   # sanity check before pushing
    echo "$GHCR_PAT" | docker login ghcr.io -u pvrnn --password-stdin
    docker push ghcr.io/pvrnn/trackt-catalog:latest

ghcr.io packages default to **private**; either make `trackt-catalog` public
(package Settings → Change visibility) or give the hosting platform a
registry pull secret (a GitHub PAT with `read:packages`) before it can pull.

If you pick Railway instead of Scaleway (see the fallback at the end of this
section), skip this step entirely — Railway builds straight from
`apps/catalog/Dockerfile` in the GitHub repo, no registry involved.

### 2. Database — Neon

1. Create a Neon project (EU region) at neon.tech.
2. Create a database (or use the default, renamed if you like).
3. Copy the **pooled** connection string (Neon's "Connect" panel → pooled
   connection) — this becomes `DATABASE_URL`.
4. No manual migration step: `apps/catalog` runs its own migrations at boot
   (`runCatalogMigrations`, `apps/catalog/src/db/index.ts`). The first boot
   against a fresh database creates `catalog_media` and its indexes/extensions
   (`pg_trgm`) automatically — Neon's default role has the privileges needed
   for `CREATE EXTENSION`.

### 3. Container — Scaleway Serverless Containers

1. Create a Serverless Container (Paris region `fr-par`), pointed at
   `ghcr.io/pvrnn/trackt-catalog:latest` (whatever tag you pushed in step 1).
2. Leave the port on Scaleway's injected `PORT` — the app already reads
   `PORT` from env (default 3002) and binds `0.0.0.0`, so no extra config.
3. Min scale 0 to start (matches the ~€0/mo estimate above); switch to 1 once
   anyone but you runs an instance, per the recommendation above.
4. Environment variables:
   - `NODE_ENV=production`
   - `DATABASE_URL=<Neon pooled connection string>`
   - `CATALOG_ADMIN_TOKEN=<openssl rand -base64 32>` — keep secret; gates every
     write route: `POST /v1/admin/media`, `POST /v1/admin/relations` and the
     `/v1/admin/news` surface, all behind one `requireAdmin` preHandler.
   - `LOG_LEVEL=info` (optional)
5. Health check path: `/healthz`.
6. Deploy, then confirm:

       curl https://<container-url>/healthz
       curl https://<container-url>/readyz   # expect {"status":"ok","checks":{"database":"ok"}}
       curl "https://<container-url>/v1/catalog/search?q=test"   # expect {"results":[]} on an empty catalog
       curl "https://<container-url>/v1/news"                    # expect {"articles":[],"nextCursor":null}

7. A custom domain is optional — the platform-issued URL is fine, since this
   is only ever called server-to-server by self-hosted instances' backends,
   never by browsers (`apps/catalog/src/app.ts` sets `cors: { origin: true }`
   by design for exactly that reason).

### 4. Wire up self-hosted instances

One variable turns on every central read — federated search (ADR-0002), typed
relations (ADR-0004) and the News section (ADR-0005) all travel over it. In the
instance's own `.env` / `docker-compose.yml`:

    CATALOG_URL=https://<the container's public URL>

Left unset, each of those degrades independently and silently: search returns
local-only results, relations fall back to the genre-overlap list, and `/news`
renders its empty state. There's no hard dependency, so this rolls out
gradually and safely. The three timeouts
(`CATALOG_SEARCH_TIMEOUT_MS`, `CATALOG_RELATIONS_TIMEOUT_MS`,
`CATALOG_NEWS_TIMEOUT_MS`) are optional overrides — raise them if the container
runs at min-scale 0 and cold starts are being tolerated deliberately.

### Fallback: Railway

1. New Railway project → deploy from the same `ghcr.io/pvrnn/trackt-catalog`
   image (or "Deploy from Dockerfile" pointed at `apps/catalog/Dockerfile`
   in this repo).
2. Add a Railway Postgres plugin to the project; wire its `DATABASE_URL`
   into the catalog service's variables.
3. Set `CATALOG_ADMIN_TOKEN` and `NODE_ENV=production` as service variables,
   same values/generation as above.
4. Railway auto-detects the listening port; health check path `/healthz`.
5. Step 4 above (wiring `CATALOG_URL` into self-hosted instances) is identical.

## Sources

- [Railway pricing plans](https://docs.railway.com/pricing/plans), [Railway pricing overview](https://www.srvrlss.io/provider/railway/)
- [Scaleway serverless pricing](https://www.scaleway.com/en/pricing/serverless/), [Scaleway Serverless SQL](https://www.scaleway.com/en/serverless-sql-database/), [Scaleway managed PG tiers](https://hoststack.dev/blog/scaleway-postgresql-pricing-2026)
- [Neon pricing](https://neon.com/pricing), [Neon plans](https://neon.com/docs/introduction/plans), [Neon 2026 pricing breakdown](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/)
- [Supabase pricing](https://supabase.com/pricing)
- [Vercel pricing](https://vercel.com/pricing), [Vercel free tier limits](https://infrafree.dev/en-us/provider/vercel)
- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [DO PG review](https://ghostlyinc.com/en-us/digitalocean-app-platform-test-review/)
- [Clever Cloud pricing](https://www.clever.cloud/pricing/), [Clever Cloud review](https://europeanstack.com/software/clever-cloud)
