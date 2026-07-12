# Catalog service hosting — provider comparison

Decision doc for ROADMAP item 1 (**Catalog service deployment**). Prices checked July 2026; cloud pricing drifts, re-verify before committing a card.

> **Traffic-shape update (ADR-0002):** the assumption below — background polling,
> cold starts tolerated by retry/backoff — no longer holds. Search now queries
> the central catalog live from every self-hosted instance's request path
> (`GET /v1/catalog/search`, via `apps/api/src/lib/federated-search.ts`), bounded
> by a short client-side timeout (`CATALOG_SEARCH_TIMEOUT_MS`). Traffic is still
> instance-bounded (browsers never see `CATALOG_URL`), but a cold start now
> eats into a live user's search latency instead of a background job's retry
> budget. This strengthens the case for an always-on floor tier (e.g. Scaleway
> min-scale 1) over pure scale-to-zero once there's real self-hosted adoption —
> not re-evaluated here, just flagged for whoever picks this doc back up.

## What we're hosting

`apps/catalog` is deliberately easy to host (see [ADR-0001](adr/0001-central-slim-catalog.md)):

- One tiny Fastify container (Node 22), self-migrates on boot, `/healthz` + `/readyz`.
- One small dedicated Postgres (`catalog_media`, single table). Populated catalog likely **0.5–2 GB** (anime-offline-database + TVmaze + Wikidata movies + manga ≈ a few hundred thousand slim rows).
- **Read path is now live, not polled** (ADR-0002): instances query `GET /v1/catalog/search` on every user search, timeout-bounded and degrading to local-only results if the catalog is slow or down. See the callout above — this replaces the old "instances poll `/v1/catalog/changes` every 6h, cold starts are fine" assumption.
- Write path is a single-writer importer hitting `POST /v1/admin/media` occasionally (next sprint).
- No PII in the catalog, but EU hosting is a nice-to-have (project operator is in France).

Scale-to-zero is still viable at low traffic, but the cold-start tolerance this
section used to lean on is gone — re-check the always-on-floor-tier tradeoff
once there's real self-hosted search volume.

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

- **Serverless Containers**: €0.00001/vCPU-s + €0.000002/GB-s **after a free tier of 200k vCPU-s + 400k GB-s per month**. With scale-to-zero (min-scale 0), our 6-hourly poll traffic stays comfortably inside the free tier → **~€0**. Pinned always-on at 0.25 vCPU/256 MB ≈ **€5/mo**.
- Cold starts (~a few seconds, plus migration check on boot) are absorbed by the worker's retry/backoff.
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

- Serverless Postgres, scale-to-zero after 5 min idle. **Free tier: 100 CU-hours/mo + 0.5 GB storage** — our 6-hourly sync queries barely dent the compute budget.
- 2026 pricing removed the paid-plan floor: **Launch is purely usage-based** ($0.106/CU-h, $0.35/GB-mo storage). If the populated catalog outgrows 0.5 GB, we'd pay **single-digit $/mo**, mostly storage.
- No app hosting — pairs with Scaleway/Railway/anything for the Fastify container.

### Supabase — more product than we need

- Free tier: 500 MB database, then the project **goes read-only**; a populated catalog will blow past that, and the next step is a **$25/mo Pro** plan — paying for auth/storage/realtime features the catalog will never use.
- Also: direct Postgres connections are IPv6-first (external hosts often need their pooler), and free projects pause after ~1 week idle (our 6 h sync would keep it alive, but it's a footgun).
- Verdict: great BaaS, wrong tool — if we want serverless Postgres, Neon is the leaner pick.

### Vercel — architectural mismatch

- Built for serverless/edge functions, not a long-running Fastify server: we'd wrap the app in a handler, migrations-on-boot would run per cold start, and Hobby caps execution at 10 s.
- **Hobby is restricted to non-commercial use**, and there's no bundled Postgres — you'd add Neon anyway. At that point, pairing Neon with a real container host is strictly better. Skip.

## Cost scenarios (populated catalog, a handful of instances syncing)

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

1. **Cheapest / EU: Scaleway Serverless Container (min-scale 0) + Neon free tier.** ~€0/mo until the project has real traction, Paris + EU regions, and the sync protocol was *designed* to tolerate exactly this (cold starts, retries). Cost of admission: a Dockerfile, a registry push, and a ~30-line GitHub Action.
2. **Simplest: Railway (app + Postgres together).** ~$7–12/mo, one dashboard, GitHub-integrated deploys, matches the PRD §6.1 platform choice. Pay ~€100/yr for near-zero ops thought.

**Suggested: start on Scaleway + Neon.** The service is a background dependency nobody watches — paying a monthly floor for instant responses to a 6-hourly cron is waste. If operating two providers ever grates, the Dockerfile and env contract (`DATABASE_URL`, `CATALOG_ADMIN_TOKEN`, `PORT`) move to Railway unchanged in an afternoon.

Whichever is picked, the deploy artifact is the same and platform-agnostic: `apps/catalog/Dockerfile` + CI image build + env docs — no platform lock-in in the repo itself.

## Sources

- [Railway pricing plans](https://docs.railway.com/pricing/plans), [Railway pricing overview](https://www.srvrlss.io/provider/railway/)
- [Scaleway serverless pricing](https://www.scaleway.com/en/pricing/serverless/), [Scaleway Serverless SQL](https://www.scaleway.com/en/serverless-sql-database/), [Scaleway managed PG tiers](https://hoststack.dev/blog/scaleway-postgresql-pricing-2026)
- [Neon pricing](https://neon.com/pricing), [Neon plans](https://neon.com/docs/introduction/plans), [Neon 2026 pricing breakdown](https://vela.simplyblock.io/articles/neon-serverless-postgres-pricing-2026/)
- [Supabase pricing](https://supabase.com/pricing)
- [Vercel pricing](https://vercel.com/pricing), [Vercel free tier limits](https://infrafree.dev/en-us/provider/vercel)
- [DigitalOcean App Platform pricing](https://docs.digitalocean.com/products/app-platform/details/pricing/), [DO PG review](https://ghostlyinc.com/en-us/digitalocean-app-platform-test-review/)
- [Clever Cloud pricing](https://www.clever.cloud/pricing/), [Clever Cloud review](https://europeanstack.com/software/clever-cloud)
