# PRD — Open-Source Media Tracker (working title: "Logbook")

**Version:** 0.1 draft · **Date:** July 2026
**Context:** TV Time shuts down July 15, 2026, deleting all user data. 25M+ users are exporting their history via GDPR tools with no open, community-owned home to migrate to. Existing self-hosted trackers (Ryot, Yamtrack, MediaTracker) are single-user/small-group tools with weak social features and no webtoon support.

---

## 1. Vision & Principles

A community-owned, open-source tracker for **movies, series, anime, manga, and webtoons** that can never be taken away from its users.

**Founding principles:**

1. **Data portability is sacred.** Full export at any time, in an open documented format. Public API from day one. The reason this project exists is that TV Time users lost everything.
2. **Self-hostable in one command.** `docker compose up` or a Railway one-click template. No mandatory external services beyond free metadata API keys.
3. **Open source (AGPLv3 recommended)** so hosted forks must contribute back.
4. **Community catalog.** Users can add what the big databases don't have (webtoons especially), and instances can share those entries.

**Non-goals (v1):** streaming/playback, scrobbling from Plex/Jellyfin (v2), mobile native apps (PWA first), recommendations engine.

---

## 2. Personas

- **The migrator** — TV Time refugee with a GDPR export file. Wants import in <5 minutes and the same one-tap episode check-in habit.
- **The completionist** — tracks anime seasons and manga chapters across MAL/AniList/paper. Wants per-episode and per-chapter granularity, rewatch counts, precise stats.
- **The webtoon reader** — reads on Webtoon/Tapas; nothing indexes this well. Wants to create entries for unlisted titles and track chapters.
- **The self-hoster** — wants their own instance for friends/family, low maintenance, own data.

---

## 3. Core Features

### 3.1 Tracking

- Log status per media: planned / in progress / completed / dropped / paused.
- **Granular progress:** per-episode for series/anime, per-chapter (and volume) for manga/webtoons, simple watched-date for movies.
- One-tap check-in for "next episode/chapter" (speed is a hard UX requirement: ≤2 taps from home screen).
- Rewatch / reread counters with dated history.
- Start/finish dates, personal notes per entry.

### 3.2 Rating & Reviews

- Rate the **whole work** and/or **individual episodes/chapters** (0–10, half-points).
- Text reviews at both levels, with spoiler-flag toggle.
- Aggregate ratings shown per instance; per-episode rating graphs (the beloved TV Time "episode heat map").

### 3.3 Comments & Community

- Comment threads on any media, season, episode, or chapter.
- Reactions (emoji), spoiler-blurring by default on episodes the viewer hasn't logged.
- Follows: follow users, see an activity feed (X rated Y, Z finished W).
- Report/moderation queue per instance.

### 3.4 Profiles

- Public profile: avatar, bio, links.
- **Distinguished profile blocks:** favourite movies / series / anime / manga / webtoons (pinned, ordered, à la Letterboxd top-4), stats (hours watched, chapters read, streaks), badges.
- Custom lists (ranked or unranked), optionally collaborative.
- Privacy levels: public / followers / private, per section.

### 3.5 Catalog & User-Created Entities

- Search across all media types with type filters.
- Media pages: canonical info, cast/authors, seasons/episodes or volumes/chapters, related media, where-to-watch (v2).
- **Create entity flow:** any user can propose a new media entry (title, type, cover upload, description, chapter/episode structure). Entries are immediately usable by the creator, flagged `unverified`, and enter a per-instance moderation queue (approve / edit / merge-into-existing).
- Duplicate-merge tool for moderators (merges progress/ratings pointing at the duplicate).

### 3.6 Import / Export

- **TV Time GDPR export importer** (launch-critical).
- Trakt, MyAnimeList, AniList importers (v1.x).
- Full account export: JSON + CSV, includes ratings, progress, comments, lists.

### 3.7 Discovery (v1 minimal)

- Trending on this instance, airing calendar (from metadata providers), new-episode notifications (web push + email digest).

---

## 4. Catalog Architecture

### Decision: federated fetch-and-cache, no central metadata server for licensed data

Each instance fetches from upstream providers using its own API keys and caches results in its local Postgres. Rationale:

- **Licensing:** TMDB terms allow app-level caching but not operating a redistribution database; TheTVDB is a paid licensed API. A central mirror of their data is a legal and financial liability.
- **Cost & resilience:** a central server recreates the single point of failure that killed TV Time.
- **Simplicity:** proven pattern (Ryot, Yamtrack, Jellyseerr all do this).

### Provider abstraction layer

```
interface MetadataProvider {
  kind: MediaKind[]            // which media types it serves
  search(q, kind): ProviderResult[]
  getDetails(externalId): CanonicalMedia
  getStructure(externalId): Part[]   // seasons/episodes or volumes/chapters
}
```

| Media type | Primary                   | Secondary / fallback            |
| ---------- | ------------------------- | ------------------------------- |
| Movies     | TMDB                      | —                               |
| Series     | TMDB                      | TVmaze (free, no key)           |
| Anime      | AniList (GraphQL, no key) | Jikan (MAL), Kitsu              |
| Manga      | AniList                   | MangaDex API, MangaUpdates      |
| Webtoons   | **user-created entities** | MangaUpdates (partial coverage) |

- External IDs stored per media (`{tmdb, imdb, anilist, mal, mangadex, mangaupdates}`) → enables dedup, cross-import, and provider switching.
- Cache policy: details refreshed by background job (weekly for ended titles, daily for airing/publishing ones). Respect provider rate limits with a per-provider token bucket.
- TMDB attribution displayed in footer/media pages as required by their terms.

### Community catalog (v2)

A small central service — run by the project, optional to use — that only hosts **user-created entities** (webtoons, obscure titles) and their canonical merges:

- Instances can push approved local entities (opt-in) and pull/subscribe to the shared set.
- Entries carry a stable UUID + content license (CC0/CC-BY for contributed metadata) so redistribution is legally clean.
- Signed snapshots published as downloadable dumps (also usable fully offline).
- Moderation at the community level: trusted-editor roles, edit history, merge requests (think "OpenLibrary for webtoons").

---

## 5. Data Model (PostgreSQL)

**Why Postgres:** the domain is relational (users↔ratings↔episodes↔series, comments, follows) and needs transactional integrity; JSONB gives per-type schema flexibility; scales beyond any realistic instance size; available as one-click on Docker/Railway; full-text search built in (Meilisearch optional later).

### Core tables (simplified)

```sql
media (
  id uuid pk,
  kind enum('movie','series','anime','manga','webtoon'),
  title text, original_title text, slug text,
  description text, cover_url text, release_date date,
  status enum('announced','airing','publishing','ended','cancelled'),
  external_ids jsonb,        -- {"tmdb":123,"anilist":456,...}
  metadata jsonb,            -- type-specific: runtime, studios, demographics...
  source enum('provider','user'),
  created_by uuid null references user,
  moderation enum('verified','unverified','rejected'),
  community_uuid uuid null   -- link to shared community catalog entry
)

media_part (                 -- generic hierarchy
  id uuid pk,
  media_id uuid fk,
  parent_id uuid null fk(media_part),  -- episode→season, chapter→volume
  kind enum('season','episode','volume','chapter'),
  number numeric,            -- numeric: supports chapter 10.5
  title text, air_date date, metadata jsonb
)

user_media (                 -- one row per user per media: the "log"
  user_id, media_id,
  status enum('planned','in_progress','completed','dropped','paused'),
  repeats int default 0, started_at date, finished_at date, notes text
)

progress (                   -- granular check-ins
  user_id, part_id, watched_at timestamptz, repeat_index int
)

rating (
  id, user_id,
  target_type enum('media','part'), target_id uuid,   -- polymorphic
  score numeric(3,1) check (score between 0 and 10),
  review text, has_spoilers bool,
  unique(user_id, target_type, target_id)
)

comment (
  id, user_id, target_type enum('media','part'), target_id uuid,
  parent_comment_id uuid null, body text, has_spoilers bool, created_at
)

favorite (user_id, media_id, kind, position int)   -- pinned profile blocks
list (id, owner_id, title, is_ranked, visibility)
list_item (list_id, media_id, position)
follow (follower_id, followee_id)
activity (id, user_id, verb, target..., created_at)  -- feed, partitioned by month
```

Indexes on `(user_id, media_id)`, `(target_type, target_id)`, GIN on `external_ids` and title trigram for search.

### Scaling strategy (decided)

**No sharding for v1 — design shard-friendly.** Vanilla Postgres has no built-in transparent sharding, and this workload doesn't need it: a single well-indexed node handles hundreds of millions of rows. Scaling ladder, in order:

1. **Native partitioning** on write-heavy append-only tables (`activity`, `progress`) by month — built in, single node.
2. **Read replicas** (streaming replication) when a hosted instance grows — media pages, profiles, and feeds are read-dominated.
3. **Citus** (open-source Postgres extension) if true horizontal sharding is ever needed — an infra change, not an app rewrite, provided the schema stays shard-friendly.

Shard-friendly design rules (enforced from day one):

- UUIDs everywhere (no global auto-increment coordination).
- `user_id` present on all user-owned tables (`rating`, `progress`, `user_media`, `comment`) — the future shard key.
- No cross-user joins in hot paths: the activity feed is fan-out-on-read or a materialized feed, never a giant join.

---

## 6. Tech Stack (confirmed)

| Layer      | Choice                                                                 | Why                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language   | **TypeScript everywhere**                                              | team decision; shared types/Zod schemas                                                                                                                               |
| Monorepo   | **pnpm workspaces + Turborepo**                                        | apps/web, apps/api, packages/db, packages/providers                                                                                                                   |
| Frontend   | **TanStack Start** (+ TanStack Query) as PWA                           | SSR required for public media/profile pages (SEO drives instance discovery), installable on mobile                                                                    |
| API        | **Fastify**                                                            | dedicated public REST API — first-class for portability; OpenAPI spec generated                                                                                       |
| Validation | **Zod** shared between front/back, validates env config at startup     |                                                                                                                                                                       |
| ORM        | **Drizzle**                                                            | SQL-transparent, light, solid migrations; `drizzle-kit migrate` runs on container boot                                                                                |
| DB         | **PostgreSQL 16**                                                      | see §5, incl. scaling strategy                                                                                                                                        |
| Cache/Jobs | **Redis + BullMQ**                                                     | metadata refresh, importers, notifications                                                                                                                            |
| Search     | Postgres FTS v1 → **Meilisearch** optional container v1.x              | typo tolerance for catalog search                                                                                                                                     |
| Auth       | **better-auth**                                                        | MIT-licensed, free, no usage limits or paid tiers for the framework (their paid offering is optional managed infra we don't use); users/sessions live in our Postgres |
| Images     | local volume or S3-compatible (env-switchable), optional MinIO service | covers for user-created entities                                                                                                                                      |
| CI         | GitHub Actions → **ghcr.io images**, semver tags, semantic releases    | self-hosters never build from source                                                                                                                                  |

### 6.1 Deployment (confirmed)

- **Primary target: `docker compose up` and Railway one-click template.** Helm chart + Unraid/Portainer/CasaOS community templates later (large share of self-hosted adoption comes from these).
- **Single "monolith" image** (API + web + worker, process-managed) as the default path; separate images as the advanced path. Compose file: app, Postgres 16, Redis, optional MinIO/Meilisearch.
- **Migrations on boot** — automatic `drizzle-kit migrate` at container start; upgrades are `docker compose pull && up`.
- **Config via env vars only**, Zod-validated at startup with actionable errors ("TMDB_API_KEY missing — get one at ..."). First-run UI setup wizard for API keys.
- **TLS/reverse proxy not bundled**: documented Caddy config (auto-HTTPS) for VPS users; Railway handles TLS natively.
- **Health endpoints** `/healthz` and `/readyz` for Docker/Railway restarts and zero-downtime deploys.
- **Backups**: documented `pg_dump` cron sidecar in the compose file; pgBackRest/wal-g for the flagship instance; app-level "export everything" admin action as last-resort backup (doubles as the portability principle).
- **Observability, lightweight**: pino structured logs (native to Fastify), optional Sentry (self-hostable) for errors. Prometheus/Grafana only if/when a flagship instance justifies it.
- **Contributor DX**: `docker-compose.dev.yml` with hot reload — clone → `pnpm i` → compose up → productive in 5 minutes.

---

## 7. Moderation & Abuse

- Per-instance roles: admin, moderator, user.
- User-created entities: unverified until approved; rate-limit creations; image upload scanning hook.
- Comments: report queue, shadow-hide, per-media lock.
- Community catalog (v2): edit history, trusted editors, revert.

## 8. Success Metrics (v1)

- TV Time import completes for a 1,000-episode history in < 60 s.
- Check-in of next episode in ≤ 2 interactions.
- Fresh instance deploy (compose) to first tracked episode in < 10 minutes.
- 100% of user data covered by export.

## 9. Roadmap

- **v0.1 (MVP):** auth, catalog search (TMDB+AniList), track/rate/progress movies+series+anime, profiles with favourites, Docker Compose. **TV Time importer.**
- **v0.2:** manga + webtoons, user-created entities + moderation, comments, lists, activity feed, Railway template.
- **v1.0:** episode rating graphs, airing calendar + notifications, Trakt/MAL/AniList importers, public API v1 (OpenAPI), Meilisearch.
- **v2:** community catalog service, Plex/Jellyfin scrobbling, ActivityPub federation of activity feeds, mobile apps.

## 10. Open Questions

1. License: AGPLv3 (protects against closed SaaS forks) vs MIT (max adoption)?
2. Does the project run a flagship hosted instance? If so, funding model (donations/OpenCollective) must be decided early — sustainability is the whole lesson of TV Time.
3. Ratings aggregation across instances: per-instance only, or federated via the community service?
4. Name + trademark check.
