# Trackt

Open-source, self-hostable tracker for **movies, series, anime, manga, and webtoons** — community-owned, so it can never be taken away from its users.

> TV Time shut down and deleted everyone's history. Trackt exists so that never happens again: **full export at any time, a public API from day one, and self-hosting in one command.**

See the full product spec in [docs/PRD.md](docs/PRD.md) and the current status in [docs/ROADMAP.md](docs/ROADMAP.md).

## Founding principles

1. **Data portability is sacred** — open export formats, public REST API ([OpenAPI docs](http://localhost:3000/docs) on every instance).
2. **Self-hostable in one command** — `docker compose up`.
3. **Open source** so hosted forks contribute back.
4. **Community catalog** — users can add what the big databases don't have (webtoons especially).

## Quick start (self-hosting)

```sh
cp .env.example .env        # set AUTH_SECRET (openssl rand -base64 32), optionally TMDB_API_KEY
docker compose up -d
open http://localhost:3000
```

Migrations run automatically on boot; upgrading is `docker compose pull && docker compose up -d`. A nightly `pg_dump` sidecar is included (`--profile backup`), and optional MinIO for S3-compatible cover storage (`--profile minio`). TLS is not bundled — put [Caddy](https://caddyserver.com/) in front, or deploy on a platform that terminates TLS for you.

## Development

Requirements: Node 22+, pnpm 11 (`corepack enable` — the exact version is pinned in `package.json`'s `packageManager`), Docker.

```sh
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres 16 (:5432), Redis, catalog Postgres (:5433)
pnpm db:migrate                                   # apply schema (after pnpm build once)
pnpm db:seed                                      # fixture catalog so search has data
pnpm dev                                          # web :3000, api :3001, catalog :3002, worker — hot reload
```

No `.env` needed in development — every variable has a dev default (see `packages/shared/src/env.ts`). The web dev server proxies `/api`, `/docs`, and health endpoints to the API.

| Command                                        | What it does                                           |
| ---------------------------------------------- | ------------------------------------------------------ |
| `pnpm dev`                                     | run everything in watch mode (Turborepo)               |
| `pnpm build`                                   | build all apps and packages                            |
| `pnpm test`                                    | run vitest suites                                      |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | the usual suspects                                     |
| `pnpm db:generate`                             | generate a migration from schema changes (drizzle-kit) |
| `pnpm db:migrate`                              | apply migrations to `DATABASE_URL`                     |
| `pnpm db:seed`                                 | insert the dev fixture catalog (idempotent)            |

## Repository layout

```
apps/
  web/        TanStack Start PWA (SSR for public pages, installable on mobile)
  api/        Fastify public REST API — OpenAPI generated from Zod schemas at /docs
  worker/     BullMQ background jobs: importers, notifications (none built yet)
  catalog/    Central slim catalog service, and the News surface (project-operated, not self-hosted)
packages/
  shared/     Zod schemas, shared types, env validation — single source of truth
  client/     The API data layer every client shares: fetch + Zod + React Query, no UI
  db/         Drizzle ORM schema + migrations (PostgreSQL 16)
  providers/  Parked: metadata providers (future per-instance enrichment)
```

### Architecture notes

- **Central slim catalog** ([ADR-0001](docs/adr/0001-central-slim-catalog.md)): a project-operated service holds the shared catalog of redistributable facts (titles, synonyms, years, genres, counts, external IDs), keyed by deterministic canonical media IDs (UUIDv5) that every instance derives identically with zero coordination.
- **Federated search, no mirror** ([ADR-0002](docs/adr/0002-federated-catalog-search.md)): an instance queries its local Postgres _and_ the central catalog live, in parallel, merges by canonical id, and writes central-only hits into local `media` on first sight. Every central call is timeout-bounded and degrades rather than failing — an unreachable catalog costs you central results, never a 500.
- **One media row is one trackable unit** ([ADR-0003](docs/adr/0003-per-season-media.md)): a `series`/`anime` row is a single **season** with its own canonical ID and one `part_count`; there is no parent show row. [ADR-0004](docs/adr/0004-typed-media-relations.md) adds the typed `sequel`/`adaptation`/`spinoff`/`related` edges that reconnect them, stored one direction only with the inverse rendered as a derived label.
- **News** ([ADR-0005](docs/adr/0005-news-and-newsroom-agent.md)): articles live only in the central catalog and are published by the project operator through a human-gated admin path; instances read `/news` live and degrade to an empty feed if the catalog is unreachable. Nothing is mirrored, and self-hosters run no news infrastructure.
- **Shard-friendly schema** (PRD §5): UUIDs everywhere, `user_id` on every user-owned table, no cross-user joins in hot paths. Scaling ladder: partitioning → read replicas → Citus, without an app rewrite.
- **Monolith image**: one container runs API (public port), web SSR, and worker; the API proxies non-API routes to the SSR server. Separate processes remain the advanced path.
- **Config via env vars only**, Zod-validated at startup with actionable errors.

## Metadata attribution

Catalog entries reference external IDs from [TMDB](https://www.themoviedb.org/), [AniList](https://anilist.co/), and [TVmaze](https://www.tvmaze.com/). Optional per-instance enrichment may use the TMDB API with the instance's own key; this product uses the TMDB API but is not endorsed or certified by TMDB.

## License

[GPL-3.0](LICENSE)
