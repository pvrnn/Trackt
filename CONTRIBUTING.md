# Contributing to Trackt

Thanks for helping build a tracker that can't be taken away from its users.

## Getting productive in 5 minutes

```sh
corepack enable                                   # provides pnpm
pnpm install
docker compose -f docker-compose.dev.yml up -d    # Postgres + Redis
pnpm build                                        # first build (generates route tree, compiles packages)
pnpm db:migrate                                   # apply the schema
pnpm dev                                          # web :3000 · api :3001 · worker, all hot-reloading
```

No `.env` is required in development — defaults are baked into `packages/shared/src/env.ts`. Add a TMDB key to `.env` if you want movie/series search locally.

## Before you push

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm format:check
```

CI runs exactly these. `pnpm format` fixes formatting.

## Making schema changes

1. Edit the Drizzle schema in `packages/db/src/schema/`.
2. `pnpm db:generate` — creates a SQL migration in `packages/db/migrations/`.
3. Review the generated SQL, commit it together with the schema change.
4. Migrations apply automatically on container boot (or `pnpm db:migrate` locally).

Schema rules (PRD §5): UUID primary keys, `user_id` on every user-owned table, indexes for every hot-path query, no cross-user joins.

## Adding a metadata provider

Implement the `MetadataProvider` interface in `packages/providers/src/` (see `tvmaze.ts` for the smallest example), give it a `TokenBucket` matching the upstream rate limit, and register it in `registry.ts`. Providers must never require payment to be useful — free tiers or keyless APIs only for core features.

## Commit style

Small, focused commits with imperative subjects ("add chapter progress endpoint"). Reference issues where relevant.
