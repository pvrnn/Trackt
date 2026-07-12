# ADR-0002: Federated catalog search, no instance-side full mirror

**Status:** Accepted — 2026-07-12
**Amends:** ADR-0001 (supersedes point 3 and the instance-side sync job it specified)

## Context

ADR-0001 point 3 had every instance mirror the entire central catalog into its
local `media` table via a BullMQ job (`apps/worker/src/catalog-sync.ts`) that
paged `GET /v1/catalog/changes` every 6 hours. This forces every self-hosted
instance into full-catalog replication from the project-operated central
service, with storage and dependency cost that scales with the size of the
catalog (projected at hundreds of thousands of rows / 0.5–2GB once populated,
see `docs/catalog-hosting.md`) rather than with what that instance's users
actually care about.

This is **not** a reversion to the design ADR-0001 itself replaced (PRD §4,
each instance calling upstream providers like TMDB/AniList directly with its
own API key). The single project-operated central catalog and the
deterministic canonical-UUID scheme (ADR-0001 points 1, 2, 4, 5) are
unchanged. Only the transport between an instance and that one service
changes: from periodic bulk-pull to live federated search.

## Decision

1. **Search queries both the instance's local `media` table and the central
   catalog, live, in parallel** (`apps/api/src/lib/federated-search.ts`).
   The central call is bounded by `CATALOG_SEARCH_TIMEOUT_MS` and never fails
   the request — a slow or unreachable catalog degrades to local-only
   results.

2. **Central-only hits are materialized into local `media` once, the moment
   they're first surfaced in a search** (`source: 'provider'`,
   `moderation: 'verified'`, a real slug via `mediaSlug()`). This is required
   regardless of policy: `SearchResultSchema.slug` is non-optional, and every
   FK from tracking/rating/progress/favorite tables points at a local
   `media.id`. After that one-time insert, nothing ever re-touches the row
   from the central side — no periodic refresh, no freshness column.

3. **No staleness/sync machinery.** Canonical UUIDs (ADR-0001 point 2) are
   identical across every instance and the central catalog by construction,
   so dedup on a search collision is a trivial `id` equality check. A local
   row is a one-time snapshot, not a mirror kept in sync — there is
   deliberately no background job re-fetching already-cached rows.

4. **`apps/catalog` adds `GET /v1/catalog/search`** (pg_trgm, same pattern as
   the instance-side search) and **removes `GET /v1/catalog/changes`** (the
   bulk-pull mechanism this ADR retires) along with its schemas. `GET
   /v1/catalog/version` stays — a cheap, independently useful stats endpoint,
   not part of the sync mechanism. `catalog_media.seq` and its bump trigger
   stay internally (still useful for future admin/audit tooling) but are no
   longer exposed as a pull feed.

5. **The instance-side `catalog-sync` BullMQ job is deleted outright** (no
   opt-in "eager mirror" mode). `apps/worker/src/index.ts` retires the
   `catalog-sync-repeat` scheduler on boot for any already-upgraded instance
   with a persisted Redis volume, the same way it already retired the
   pre-ADR-0001 provider-refresh schedulers.

## Consequences

- `apps/worker` has no active jobs until importers/notifications (PRD §6)
  land — expected, not a regression. The process stays alive via its open
  Redis connection for `docker/entrypoint.sh`'s liveness check.
- `apps/api/src/routes/v1/tracking.ts` needed no changes: anything trackable
  was already materialized locally by a prior search, since search is the
  only discovery path for provider-identified media.
- A locally-cached provider row can go stale relative to the central catalog
  (episode-count bumps, status changes, central deletions/merges) with no
  automatic correction — accepted for v1. A row only refreshes if it's
  re-discovered via a fresh search hit and happens not to collide with the
  existing local id (which, per point 3, it will — so in practice a
  materialized row is permanent until a future dedicated tool addresses it).
- Central-catalog traffic shape changes from instance-count × 1 poll/6h to
  instance-count × live-search-QPS — still instance-bounded (the browser
  never talks to `CATALOG_URL` directly), but now sits on the interactive
  request path, which changes the hosting cold-start tradeoff discussed in
  `docs/catalog-hosting.md`.
- `sync_state` (the old cursor table) is dropped; `QUEUES.catalogSync` is
  removed from `packages/shared/src/queues.ts`.
