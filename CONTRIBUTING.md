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

CI runs exactly these. `pnpm format` fixes formatting. The Postgres-backed search tests self-skip when the dev compose databases aren't running, so bring them up for full coverage.

Two gotchas worth knowing before you debug a red run:

- **Stop `pnpm dev` before `pnpm test`.** `loadEnv` applies its dev fallback (`CATALOG_URL=http://localhost:3002`) under `NODE_ENV=test` as well, so an explicitly-empty `CATALOG_URL` still resolves to localhost. `apps/api`'s "no catalog is configured" news tests therefore only pass when nothing is listening on 3002 — with a dev catalog up they fail against the live service, which is an environment artifact, not a regression.
- Migration `0003` creates an `immutable_array_to_string` SQL function outside drizzle's model — `drizzle-kit push`/`studio` won't know about it; always go through migrations.

## Making schema changes

There are **two independent schemas** — the instance database and the central catalog's own — and several changes (ADR-0003, ADR-0004, ADR-0005) had to touch both.

Instance database (`packages/db`):

1. Edit the Drizzle schema in `packages/db/src/schema/`.
2. `pnpm db:generate` — creates a SQL migration in `packages/db/migrations/`.
3. Review the generated SQL, commit it together with the schema change.
4. Migrations apply automatically on container boot (or `pnpm db:migrate` locally).

Central catalog (`apps/catalog`, project-operated — not part of a self-hosted deployment):

1. Edit `apps/catalog/src/db/schema.ts`.
2. `pnpm --filter @trackt/catalog db:generate` — writes to `apps/catalog/migrations/`. There is no root alias for this one.
3. Review and commit the SQL as above.
4. The service migrates itself on boot (`runCatalogMigrations`, `apps/catalog/src/db/index.ts`); there is no separate migrate command.

Schema rules (PRD §5): UUID primary keys, `user_id` on every user-owned table, indexes for every hot-path query, no cross-user joins. `db:push` is forbidden in both — always go through a reviewed migration.

## The catalog

Search is **federated**: an instance queries its own `media` table _and_ the project-operated central catalog (`apps/catalog`) live, in parallel, then materializes central-only hits into `media` on first sight — see [ADR-0001](docs/adr/0001-central-slim-catalog.md) for the central-catalog design and [ADR-0002](docs/adr/0002-federated-catalog-search.md) for the federation that replaced the old sync job. There is no full-catalog mirror and no background re-sync; relation targets ([ADR-0004](docs/adr/0004-typed-media-relations.md)) and news-linked works ([ADR-0005](docs/adr/0005-news-and-newsroom-agent.md)) materialize the same way.

Every central call must stay timeout-bounded and degrade instead of failing the request — that posture is the contract, not an implementation detail. Canonical media IDs are deterministic UUIDv5s (`packages/shared/src/canonical-id.ts`) and must be identical on every instance: never mint random IDs for provider-identified works. `packages/providers` is parked (future per-instance enrichment) — don't extend it for core features.

## Tests

Tests live in each package's `test/` directory (mirroring `src/`), not alongside the source files. Name them `<subject>.test.ts` for unit tests or `<subject>.integration.test.ts` for tests that need the dev compose databases.

## Commit style

Small, focused commits with imperative subjects ("add chapter progress endpoint"). Reference issues where relevant.
