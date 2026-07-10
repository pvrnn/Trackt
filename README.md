# Trackt

Open-source, self-hostable tracker for **movies, series, anime, manga, and webtoons** — community-owned, so it can never be taken away from its users.

> TV Time shut down and deleted everyone's history. Trackt exists so that never happens again: **full export at any time, a public API from day one, and self-hosting in one command.**

See the full product spec in [docs/PRD.md](docs/PRD.md).

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

Requirements: Node 22+, pnpm 10 (`corepack enable`), Docker.

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
  worker/     BullMQ background jobs: catalog sync, importers, notifications
  catalog/    Central slim catalog service (project-operated, not self-hosted)
packages/
  shared/     Zod schemas, shared types, env validation — single source of truth
  db/         Drizzle ORM schema + migrations (PostgreSQL 16)
  providers/  Parked: metadata providers (future per-instance enrichment)
```

### Architecture notes

- **Central slim catalog** ([ADR-0001](docs/adr/0001-central-slim-catalog.md)): a project-operated service holds the shared catalog of redistributable facts (titles, synonyms, years, genres, counts, external IDs); every instance syncs it, so all instances share the same catalog and the same deterministic canonical media IDs (UUIDv5). Instance search runs entirely on the local Postgres.
- **Shard-friendly schema** (PRD §5): UUIDs everywhere, `user_id` on every user-owned table, no cross-user joins in hot paths. Scaling ladder: partitioning → read replicas → Citus, without an app rewrite.
- **Monolith image**: one container runs API (public port), web SSR, and worker; the API proxies non-API routes to the SSR server. Separate processes remain the advanced path.
- **Config via env vars only**, Zod-validated at startup with actionable errors.

## Metadata attribution

Catalog entries reference external IDs from [TMDB](https://www.themoviedb.org/), [AniList](https://anilist.co/), and [TVmaze](https://www.tvmaze.com/). Optional per-instance enrichment may use the TMDB API with the instance's own key; this product uses the TMDB API but is not endorsed or certified by TMDB.

## License

[GPL-3.0](LICENSE)
