---
name: start-app
description: Start Trackt's dev stack (web, api, catalog, worker + Postgres/Redis) and smoke-test it. Use when asked to run, start, or open the app, or to confirm a change works in the running app rather than in tests.
---

# Starting the Trackt dev stack

Four apps run on the host with hot reload; Postgres and Redis run in containers.

| Service           | Port | Notes                              |
| ----------------- | ---- | ---------------------------------- |
| `apps/web`        | 3000 | TanStack Start (`vite dev`)        |
| `apps/api`        | 3001 | Fastify                            |
| `apps/catalog`    | 3002 | central slim catalog, own Postgres |
| `apps/worker`     | —    | BullMQ, pino logs to stdout        |
| instance Postgres | 5432 | db `trackt`                        |
| catalog Postgres  | 5433 | db `trackt_catalog`                |
| Redis             | 6379 |                                    |

For driving the catalog → worker sync → search flow specifically (scratch
databases, forcing a resync, publishing catalog rows by hand), use the
`verify` skill instead. This skill is just "get it running".

## 1. Docker

WSL2 — the daemon lives on the Windows side and is usually not running.

```bash
docker ps >/dev/null 2>&1 || nohup "/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe" >/dev/null 2>&1 &
until docker ps >/dev/null 2>&1; do sleep 2; done
```

`docker: command not found` means the daemon is down, not that Docker is
missing — WSL prints a "could not be found in this WSL 2 distro" message.
Takes ~30-60s to come up.

```bash
docker compose -f docker-compose.dev.yml up -d
until [ "$(docker inspect -f '{{.State.Health.Status}}' trackt-postgres-1)" = healthy ] \
   && [ "$(docker inspect -f '{{.State.Health.Status}}' trackt-postgres-catalog-1)" = healthy ]; do sleep 2; done
```

## 2. Migrate the instance database

`apps/catalog` migrates its own db on boot; the instance db does not.
`pnpm db:migrate` does **not** pick up the `packages/shared` dev defaults —
it exits with `DATABASE_URL is not set` unless you pass the URL explicitly
(turbo/pnpm strips undeclared env vars):

```bash
DATABASE_URL=postgres://trackt:trackt@localhost:5432/trackt pnpm db:migrate
```

## 3. Launch

```bash
pnpm dev > /tmp/.../dev.log 2>&1 &   # scratchpad, not the repo
```

Wait for `Local:   http://localhost:3000/` in the log. Expect noise on
startup and don't mistake it for failure:

- an `AUTH_SECRET is unset — running with the built-in development secret`
  warning from each service (normal in development);
- `schema "drizzle" already exists, skipping` NOTICE objects from the
  catalog migrator;
- one round of `[tsx] change in ./../../packages/shared/dist/index.js
Restarting...` + `received SIGTERM` as the `tsc --watch` packages emit
  their first build. The services come straight back up.

Everything is ready once `api`, `catalog`, and `worker` have each logged a
second `Server listening` / `worker started`.

## 4. Smoke-test it

Health routes are `/healthz` and `/readyz` — there is no `/health`.

```bash
curl -s http://localhost:3001/readyz     # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
curl -s http://localhost:3002/readyz     # {"status":"ok","checks":{"database":"ok"}}
curl -s 'http://localhost:3001/api/v1/search?q=matrix'
curl -s 'http://localhost:3001/api/v1/news?limit=2'
```

Search hits the instance db, so an empty `[]` usually means no data rather
than a broken service. Check before concluding anything:

```bash
docker exec trackt-postgres-1 psql -U trackt -d trackt -tAc "select count(*) from media"
docker exec trackt-postgres-catalog-1 psql -U trackt -d trackt_catalog -tAc "select title from catalog_media limit 8"
```

## 5. Look at the web app

No browser is installed in this environment (no `chromium-cli`, no
Playwright). The home page is server-rendered, so strip the tags and read
the text to confirm it actually rendered:

```bash
curl -s http://localhost:3000/ | sed -e 's/<script[^>]*>.*<\/script>//g' -e 's/<[^>]*>/ /g' | tr -s ' \n' ' \n' | grep -v '^\s*$'
```

A healthy home page contains the hero ("Track everything. Lose nothing."),
the numbered "Why this exists" 01–04 blocks, and the TMDB/AniList/TVmaze
footer. `/news` returns only the document shell — it loads its data
client-side, so it is **not** verifiable this way; hit
`/api/v1/news` instead, or ask the user to open the page.

## Teardown

```bash
kill %1                                   # or pkill -f 'turbo run dev'
docker compose -f docker-compose.dev.yml down
```

Leave the containers up if the user is likely to keep working — the volumes
(`pgdata_dev`, `pgdata_catalog_dev`) persist either way.

## Gotchas

- `sleep` is blocked in the harness sandbox in some contexts; use `/bin/sleep`.
- Integration tests self-skip without Compose running, so a green `pnpm test`
  proves nothing about the db-backed paths unless the containers are up.
