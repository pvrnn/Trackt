# Roadmap & status

The living record of what's built and what's next. **Every PR/sprint that completes an item must update this file in the same commit** — that's how future contributors (and AI sessions) know where to pick up. Deeper context: [PRD](PRD.md) for product scope, [ADR-0001](adr/0001-central-slim-catalog.md) for catalog architecture, [docs/design](design/README.md) for the AURA PRISM mockups.

## ✅ Done

| Area         | What                                                                                                                                                                                                             | Ref                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Foundation   | Monorepo scaffold: apps (web/api/worker), packages (shared/db/providers), Docker monolith, CI                                                                                                                    | `22cb05c`              |
| Design       | AURA PRISM design handoff — 8 mockups (Landing, Login, Home, Search, Media Detail, Lists, Profile, Design System)                                                                                                | `a99582b`, docs/design |
| Design       | Tailwind v4 + AURA PRISM tokens + self-hosted fonts wired into apps/web; shared component primitives                                                                                                             | `4a370a9`, `da1de5e`   |
| Web          | Landing page (AURA PRISM)                                                                                                                                                                                        | `9735f1c`              |
| Web          | Login + register pages, end-to-end auth flow (better-auth, email/password + username)                                                                                                                            | `9f13a9b`              |
| Architecture | Central slim catalog pivot: deterministic canonical IDs (UUIDv5), slim media contract, local-Postgres search (`/api/v1/search`), `apps/catalog` service with seq-cursor sync protocol, dev seed (`pnpm db:seed`) | `495ba65`, ADR-0001    |

## 🔜 Next (in order)

1. **Instance-side catalog sync job** — worker handler on the `catalog-sync` queue: page `GET /v1/catalog/changes?since=<seq>`, upsert into local `media`, honor tombstones, persist the cursor. Contract: `packages/shared/src/catalog.ts`. `since=0` doubles as initial full sync.
2. **Catalog population** — importers feeding `apps/catalog` from redistributable sources only (anime-offline-database → anime; TVmaze → series; Wikidata → movies; MangaDex/AniList → manga). Single-writer publish path (seq caveat, ADR-0001). Replaces the 501 stub at `POST /v1/admin/media`.
3. **Search UI** in apps/web (mockup: `docs/design/Search.dc.html`) — first consumer of `/api/v1/search`.
4. **Catalog service deployment** — Dockerfile/deploy for apps/catalog (project-operated; stays out of the self-hoster compose).
5. **Home dashboard** (mockup: `Home.dc.html`) — replace the placeholder in `apps/web/src/routes/home.tsx`.

## 📋 Backlog (unordered, from PRD)

- Tracking core: log/rate/progress per episode & chapter (`user_media`, `progress` tables exist, no API/UI)
- Media detail page (mockup: `Media Detail.dc.html`)
- Profile + favourites (mockup: `Profile.dc.html`), lists (mockup: `Lists.dc.html`)
- User-created entries (webtoons) + moderation queue
- TV Time importer; full account export (JSON/CSV)
- Per-instance enrichment (descriptions/posters via instance's TMDB key — repurpose parked `packages/providers`)
- Activity feed, comments, episode rating graphs, airing calendar + notifications (v1.x per PRD §9)

## Decisions to remember

- **No live provider connectors, no scraping** — catalog data flows only through the central slim catalog (ADR-0001).
- Canonical IDs are frozen forever: namespace `f8d11238-d681-551c-875d-5ac53892f6e7`, key `provider:kind:externalId`.
- `packages/providers` is parked, not deleted; `TMDB_API_KEY` reserved for future enrichment.
