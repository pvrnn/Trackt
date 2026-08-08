---
name: verify
description: Build, launch, and drive Trackt's services end-to-end (catalog → federated API search / relations / news) to verify changes at their runtime surface.
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

## Driving the catalog → instance flow

There is **no sync step** — ADR-0002 deleted it. The instance reads the catalog
live, per request, and materializes what it sees into local `media` on first
sight. So the loop is: put a row in the catalog, then hit the instance API and
watch it appear locally.

1. Publish through the admin API (preferred — it verifies canonical ids the way an importer will):

       curl -X POST localhost:3002/v1/admin/media \
         -H "Authorization: Bearer $CATALOG_ADMIN_TOKEN" \
         -H 'content-type: application/json' -d @media.json

   Or insert into `catalog_media` directly for a quick fixture (`docker exec trackt-postgres-catalog-1 psql -U trackt -d trackt_catalog -c "INSERT INTO catalog_media ..."`) — a trigger assigns `seq`. Canonical ids: `node -e "import('@trackt/shared').then(m => console.log(m.canonicalMediaId('series', 1396)))"` from an app dir that depends on `@trackt/shared`. Series seasons use `canonicalSeriesSeasonId(showId, seasonNumber)` (ADR-0003), not the show id alone.

2. Search through the instance API — the central hit should appear and be written into local `media`:

       curl 'http://localhost:3001/api/v1/search?q=...'

3. Verify the materialization actually happened (this is the ADR-0002 behaviour worth checking, not just the response): `psql -U trackt -d <instance-db> -c "SELECT id, title, source FROM media WHERE title ILIKE '%...%'"` — expect `source = 'provider'`.
4. Relations (ADR-0004): `curl localhost:3002/v1/catalog/relations?id=<uuid>` for the central edge, then `curl localhost:3001/api/v1/media/<slug>` and check the `relations` array; targets materialize the same way.
5. News (ADR-0005): everything lands `draft`, so publish explicitly — `POST /v1/admin/news`, then `PATCH /v1/admin/news/:id '{"status":"published"}'` — then `curl localhost:3001/api/v1/news`.

**Degradation is a feature and worth verifying:** stop the catalog container and confirm search still answers 200 with local-only results, and `/api/v1/news` answers 200 with an empty list. A 500 anywhere here is a bug.

## Gotchas

- `sleep` is blocked in the harness sandbox; use `/bin/sleep`.
- The API caches news for 60s in-process (ADR-0005) — restart it rather than waiting when a publish doesn't show.
- `apps/worker` runs no jobs at all (ADR-0002 removed the only one); it staying alive on its Redis connection is the expected state, not a hang.
- Kill background node processes and clean up catalog rows you inserted when done.
- Integration tests (`apps/api`, `apps/catalog`) self-skip without Postgres — a green run proves nothing unless compose is up.
