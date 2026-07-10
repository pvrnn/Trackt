# ADR-0001: Central slim catalog with deterministic canonical IDs

**Status:** Accepted — 2026-07-10
**Supersedes:** PRD §4 "federated fetch-and-cache"

## Context

The original architecture had every instance fetch metadata live from upstream
providers (TMDB, AniList, TVmaze) with its own API keys, caching results locally.
That design has three problems the project owner weighted heavily:

- **Divergent catalogs and IDs.** Each instance minted random UUIDs on first
  import, so the same work had a different identity on every instance — blocking
  cross-instance import/export, federation, and social features.
- **Upstream dependence.** Rate limits, terms-of-service constraints, and the
  risk of an upstream API closing (the TV Time lesson) sit on the live request
  path of every instance.
- **Onboarding friction.** Self-hosters needed a TMDB key before movie search
  worked at all.

A central mirror of licensed provider data (whether API-fed or scraped) was
considered and rejected: TMDB's terms prohibit operating a redistribution
database, and such a service would be a legal liability plus a single point of
failure. Scraping does not avoid this — the constraint is database rights, not
the access method.

## Decision

1. **Central slim catalog service** (`apps/catalog`, package `@trackt/catalog`) —
   operated by the project, NOT part of self-hosted deployments. It stores only
   **redistributable facts** per work: title, synonyms, year, kind, status,
   genres, episode/season/chapter/volume counts, external IDs. Long descriptions
   and cover art are _enrichment_, nullable in the contract, and may later be
   fetched per-instance (the compliant place for licensed data). Population comes
   from redistributable sources (e.g. anime-offline-database, TVmaze, Wikidata) in
   a later sprint.

2. **Deterministic canonical IDs** — `media.id` for provider-identified works is
   `uuidv5(TRACKT_CATALOG_NAMESPACE, "<provider>:<kind>:<externalId>")` with
   namespace `f8d11238-d681-551c-875d-5ac53892f6e7` (frozen forever; =
   `uuidv5(DNS, 'catalog.trackt.app')`). Identity providers per kind:

   | Kind          | Identity provider                 |
   | ------------- | --------------------------------- |
   | movie, series | `tmdb`                            |
   | anime, manga  | `anilist`                         |
   | webtoon       | none — user-created, random UUIDs |

   Every instance derives the same ID with zero coordination. Implementation:
   `packages/shared/src/canonical-id.ts`.

3. **Instance search is local-only.** `GET /api/v1/search` queries the instance's
   own `media` table (pg_trgm on title + synonyms). No upstream calls at request
   time. Instances will receive the catalog via a sync job (v0.2) pulling
   `GET /v1/catalog/changes?since=<seq>` — one endpoint serves both the initial
   snapshot (`since=0`, paged) and incremental deltas. Deletions propagate as
   tombstones (`deletedAt`).

4. **Versioning** — catalog version = `max(seq)`, a monotonic bigint bumped by a
   database trigger on every write. Caveat: sequence values can commit out of
   order under concurrent writers, so the publish path must remain single-writer
   (acceptable: publishing is a project-operated admin path).

5. **`packages/providers` is parked**, not deleted — it may be repurposed for
   per-instance enrichment later. The worker's provider-refresh crons were
   removed; `TMDB_API_KEY` remains in env validation, reserved for enrichment.

## Consequences

- Search on a fresh instance is empty until the sync job lands; development and
  tests use `pnpm db:seed` (fixture catalog with canonical IDs).
- Canonical IDs are forever: the namespace, key format, and identity-provider
  table must never change. Merges (e.g. a tmdb-keyed and an anilist-keyed row
  turning out to be the same work) are a catalog-service concern, resolved
  centrally, not per-instance.
- The catalog service is a new deployable (own Postgres, own migrations inside
  the app); its deployment artifact is a later sprint. The shared contract with
  instances is the zod schemas in `packages/shared/src/catalog.ts`, not tables.
- Instance-side sync job (BullMQ queue `catalog-sync`) and catalog population are
  explicitly out of scope of the sprint that introduced this ADR.
