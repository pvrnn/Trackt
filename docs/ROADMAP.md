# Roadmap & status

The living record of what's built and what's next. **Every PR/sprint that completes an item must update this file in the same commit** — that's how future contributors (and AI sessions) know where to pick up. Deeper context: [PRD](PRD.md) for product scope, [ADR-0001](adr/0001-central-slim-catalog.md) for catalog architecture, [docs/design](design/README.md) for the AURA PRISM mockups.

## ✅ Done

| Area         | What                                                                                                                                                                                                                                                                                                                   | Ref                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Foundation   | Monorepo scaffold: apps (web/api/worker), packages (shared/db/providers), Docker monolith, CI                                                                                                                                                                                                                          | `22cb05c`                             |
| Design       | AURA PRISM design handoff — 8 mockups (Landing, Login, Home, Search, Media Detail, Lists, Profile, Design System)                                                                                                                                                                                                      | `a99582b`, docs/design                |
| Design       | Tailwind v4 + AURA PRISM tokens + self-hosted fonts wired into apps/web; shared component primitives                                                                                                                                                                                                                   | `4a370a9`, `da1de5e`                  |
| Web          | Landing page (AURA PRISM)                                                                                                                                                                                                                                                                                              | `9735f1c`                             |
| Web          | Login + register pages, end-to-end auth flow (better-auth, email/password + username)                                                                                                                                                                                                                                  | `9f13a9b`                             |
| Architecture | Central slim catalog pivot: deterministic canonical IDs (UUIDv5), slim media contract, local-Postgres search (`/api/v1/search`), `apps/catalog` service with seq-cursor sync protocol, dev seed (`pnpm db:seed`)                                                                                                       | `495ba65`, ADR-0001                   |
| Worker       | Instance-side catalog sync job: pages `/v1/catalog/changes` into local `media` (slug on insert only, enrichment-preserving upserts, tombstones), `sync_state` cursor, 6-hour scheduler + immediate first run, `CATALOG_URL` env                                                                                        | `apps/worker/src/catalog-sync.ts`     |
| Web          | Search/Discover page (`/search`, mockup Search.dc.html): debounced `/api/v1/search` consumer, kind filter chips, shareable `?q=&kind=` URLs, ⌘K focus, `AppNav`; `@trackt/shared` made browser-safe (pure-TS SHA-1 for uuidv5)                                                                                         | `apps/web/src/routes/search.tsx`      |
| Core         | Tracking core API: log status, 0–10 half-step ratings, per-episode/chapter check-ins with lazily generated flat `media_part` rows (numbered from slim-catalog totals), auto `in_progress` on first check-in                                                                                                            | `apps/api/src/routes/v1/tracking.ts`  |
| Web          | Media detail page (`/media/$slug`, mockup Media Detail.dc.html): hero + check-in/status/rate actions, episode/chapter checklist, community stats, genre-overlap related, details card; search results link to it                                                                                                       | `apps/web/src/routes/media.$slug.tsx` |
| Web          | Home dashboard (`/home`, mockup Home.dc.html): `GET /api/v1/me/home` summary — up-next one-tap check-ins, in-progress shelf with PRISM bars, own recent-activity feed (Friends waits for v1.x follows), this-year stats, fresh-account empty state, nav search pill                                                    | `apps/web/src/routes/home.tsx`        |
| Web          | Profile page + favourites (`/profile`, mockup Profile.dc.html): `GET /api/v1/me/profile`, ♥ favourite toggle on media pages, per-kind ranked shelves, stats strip, recent feed; edit profile (name/bio + avatar upload via multipart → `UPLOADS_DIR`, served at `/uploads`); followers/badges/visibility wait for v1.x | `apps/web/src/routes/profile.tsx`     |

## 🔜 Next (in order)

1. **Catalog service deployment** — Dockerfile/deploy for apps/catalog (project-operated; stays out of the self-hoster compose).
2. **Catalog population** (deliberately last — relies on importer scripts to be built in a later dedicated sprint) — importers feeding `apps/catalog` from redistributable sources only (anime-offline-database → anime; TVmaze → series; Wikidata → movies; MangaDex/AniList → manga). Single-writer publish path (seq caveat, ADR-0001). Replaces the 501 stub at `POST /v1/admin/media`.

## 📋 Backlog (unordered, from PRD)

- Lists (mockup: `Lists.dc.html`); profile follow-ups: favourite reordering, public profiles + visibility (v1.x)
- Media detail follow-ups: per-episode titles/seasons once the catalog carries structure; episode rating heatmap (v1.x)
- User-created entries (webtoons) + moderation queue
- TV Time importer; full account export (JSON/CSV)
- Per-instance enrichment (descriptions/posters via instance's TMDB key — repurpose parked `packages/providers`)
- Activity feed, comments, episode rating graphs, airing calendar + notifications (v1.x per PRD §9)

## Decisions to remember

- **No live provider connectors, no scraping** — catalog data flows only through the central slim catalog (ADR-0001).
- Canonical IDs are frozen forever: namespace `f8d11238-d681-551c-875d-5ac53892f6e7`, key `provider:kind:externalId`.
- `packages/providers` is parked, not deleted; `TMDB_API_KEY` reserved for future enrichment.
