# Contributing to Trackt

Thanks for helping build a tracker that can't be taken away from its users.

## Getting productive in 5 minutes

```sh
corepack enable                                   # provides pnpm
pnpm install
docker compose -f docker-compose.dev.yml up -d    # Postgres (:5432), Redis, catalog Postgres (:5433)
pnpm build                                        # first build (generates route tree, compiles packages)
pnpm db:migrate                                   # apply the schema
pnpm db:seed                                      # fixture catalog so search has data
pnpm dev                                          # web :3000 · api :3001 · catalog :3002 · worker, all hot-reloading
```

No `.env` is required in development — defaults are baked into `packages/shared/src/env.ts`.

If your dev database predates the central-catalog pivot ([ADR-0001](docs/adr/0001-central-slim-catalog.md)), reset it once: `docker compose -f docker-compose.dev.yml down -v && docker compose -f docker-compose.dev.yml up -d && pnpm db:migrate && pnpm db:seed`.

## Before you push

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```

CI runs exactly these. `pnpm format` fixes formatting. The Postgres-backed search tests self-skip when the dev compose databases aren't running, so bring them up for full coverage. Note: migration `0003` creates an `immutable_array_to_string` SQL function outside drizzle's model — `drizzle-kit push`/`studio` won't know about it; always go through migrations.

## Making schema changes

1. Edit the Drizzle schema in `packages/db/src/schema/`.
2. `pnpm db:generate` — creates a SQL migration in `packages/db/migrations/`.
3. Review the generated SQL, commit it together with the schema change.
4. Migrations apply automatically on container boot (or `pnpm db:migrate` locally).

Schema rules (PRD §5): UUID primary keys, `user_id` on every user-owned table, indexes for every hot-path query, no cross-user joins.

## The catalog

Instances search their local `media` table only; the catalog is synced from the project-operated slim catalog service (`apps/catalog`) — see [ADR-0001](docs/adr/0001-central-slim-catalog.md). Canonical media IDs are deterministic UUIDv5s (`packages/shared/src/canonical-id.ts`) and must be identical on every instance: never mint random IDs for provider-identified works. `packages/providers` is parked (future per-instance enrichment) — don't extend it for core features.

## Tests

Tests live in each package's `test/` directory (mirroring `src/`), not alongside the source files. Name them `<subject>.test.ts` for unit tests or `<subject>.integration.test.ts` for tests that need the dev compose databases.

## Commit style

Small, focused commits with imperative subjects ("add chapter progress endpoint"). Reference issues where relevant.
