---
name: verify
description: Build, launch, and drive Trackt's services end-to-end (catalog → worker sync → API search) to verify changes at their runtime surface.
---

# Verifying Trackt changes

Monorepo services: `apps/api` (Fastify, port 3001), `apps/web` (TanStack Start, 3000), `apps/worker` (BullMQ), `apps/catalog` (central slim catalog, 3002, own Postgres on 5433).

## Environment

- WSL2; Docker Desktop must be running on the Windows side. If `docker ps` fails, launch it: `nohup "/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe" &` — the daemon is reachable ~10s later.
- `docker compose -f docker-compose.dev.yml up -d` starts instance Postgres (5432), catalog Postgres (5433), Redis (6379). Wait for `healthy`.
- Dev env vars all have defaults (`loadEnv`/`loadCatalogEnv`); `CATALOG_URL` defaults to `http://localhost:3002` in development.

## Build & launch

```bash
pnpm turbo build --filter=<app>       # deps build automatically
node apps/catalog/dist/index.js       # migrates its own db on boot
DATABASE_URL=postgres://trackt:trackt@localhost:5432/<db> node apps/api/dist/index.js
DATABASE_URL=... node apps/worker/dist/index.js   # pino logs to stdout
```

Use a scratch instance database (`CREATE DATABASE trackt_verify` via `docker exec trackt-postgres-1 psql -U trackt -d trackt`, then `DATABASE_URL=...trackt_verify pnpm --dir packages/db db:migrate`) so dev data stays untouched. Drop it afterwards.

## Driving the catalog → sync → search flow

1. Publish into the catalog db directly (importers may not exist yet; single-writer path): `docker exec trackt-postgres-catalog-1 psql -U trackt -d trackt_catalog -c "INSERT INTO catalog_media (id, kind, title, ...) VALUES (...)"` — a trigger assigns `seq`. Canonical ids: `node -e "import('@trackt/shared').then(m => console.log(m.canonicalMediaId('series', 1396)))"` (run from an app dir that depends on @trackt/shared, e.g. apps/worker).
2. Start the worker — the `catalog-sync-repeat` job scheduler fires immediately on first boot; watch for the `catalog sync finished` log with `{cursor, upserted, deleted}`.
3. To force another immediate run: kill the worker, delete its queue state (`docker exec trackt-redis-1 redis-cli --scan --pattern 'bull:catalog-sync:*' | xargs -r docker exec trackt-redis-1 redis-cli del`), restart.
4. Observe downstream via the API: `curl 'http://localhost:3011/api/v1/search?q=...'`.

## Gotchas

- `sleep` is blocked in the harness sandbox; use `/bin/sleep`.
- Kill background node processes and clean redis `bull:catalog-sync:*` keys + catalog rows you inserted when done.
- Integration tests (`apps/worker`, `apps/api`) self-skip without Postgres — a green run proves nothing unless compose is up.
