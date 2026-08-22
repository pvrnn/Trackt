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

## Running the mobile app

`pnpm dev` already starts Metro — `@trackt/mobile:dev` is `expo start`, so port 8081 is taken from the moment the stack is up and its output is in the turbo stream prefixed `@trackt/mobile:dev:`. Running `expo start` again in `apps/mobile` collides with it and, being non-interactive, exits with `Skipping dev server` rather than prompting for another port. There is only ever one Metro.

Open the app in [Expo Go](https://expo.dev/go) — a physical device on the same network can scan the QR. The app has no baked-in base URL (ADR-0008 §2), so the first screen is a server picker: give it the origin of a running `apps/api`, **including the scheme**, since `https://` is assumed for a bare host. `apps/api` binds `0.0.0.0` and trusts `exp://*` in development, so no server-side change is needed.

Expo Go runs the app, with one thing missing. `react-native-mmkv` (the offline
cache, phase 5) is a Nitro module — native code compiled into the client — and
Expo Go ships a fixed set that does not include it. `lib/persist.ts` detects
Expo Go and falls back to an in-memory cache, warning once so the degradation is
not silent: everything offline does within a session still works, but nothing is
restored on launch and a write still queued when the app is killed is lost.
Testing the cross-launch half of phase 5 needs a dev client (`eas build
--profile development`).

On an Android emulator the client has to reach both Metro and the API, which `adb reverse` handles without exposing anything on the network:

```sh
adb reverse tcp:8081 tcp:8081   # Metro
adb reverse tcp:3001 tcp:3001   # apps/api
adb shell am start -a android.intent.action.VIEW -d "exp://127.0.0.1:8081"
```

The instance address is then `http://localhost:3001` — not `10.0.2.2`, because the reverse makes the emulator's own loopback the right one. The forwards are lost when the emulator or the adb server restarts; re-running the two `reverse` commands is enough.

Three things bite on WSL2, where the emulator and the Android SDK live on the Windows side: call the Windows `adb.exe` (there is no adb in the distro, and the Windows adb server is the one the emulator is attached to), and expect a fresh AVD to have no Expo Go — sideload the SDK-matched APK from `https://api.expo.dev/v2/versions/latest` (`.data.sdkVersions["<sdk>"].androidClientUrl`) via `adb install`. `expo run:android` is not the way around this: it needs an Android SDK and JDK inside the distro. And `adb reverse` forwards to the _Windows_ loopback, which WSL2 relays back
in — a relay that goes stale when the listener behind it restarts, so restarting
Metro can leave `adb reverse` connecting to nothing and Expo Go reporting
"Failed to download remote update" while `curl localhost:8081` from the distro
still answers. Check it from the Windows side
(`/mnt/c/Windows/System32/curl.exe http://127.0.0.1:8081/status`); when that is
the failure, launch against the distro's own address instead —
`adb shell am start -a android.intent.action.VIEW -d "exp://$(hostname -I | awk '{print $1}'):8081"`.

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
