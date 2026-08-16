# Trackt development guidance

`AGENTS.md` is the source of truth for AI-assisted development guidance in this repository. `CLAUDE.md` is a symlink to this file so that Claude Code and tools that use either convention receive identical instructions.

## Project orientation

Trackt is a pnpm/Turborepo monorepo for a self-hostable tracker of movies, series, anime, manga, and webtoons. Read the relevant source and tests before making a change; use `README.md`, `CONTRIBUTING.md`, and `docs/` for broader product and architecture context.

## Working conventions

- Keep changes small, focused, and consistent with the existing code style.
- Do not edit generated files, build output, or lockfiles unless the change requires it.
- Tests live in each package's `test/` directory, mirroring `src/`. Use `*.test.ts` for unit tests and `*.integration.test.ts` for database-backed tests.
- For schema changes, update `packages/db/src/schema/`, generate a migration with `pnpm db:generate`, and review the generated SQL. Do not use `drizzle-kit push` or Studio for migrations.
- Use deterministic UUIDv5 canonical media IDs for provider-identified works; do not mint random IDs for them.
- Data-layer code that both clients use — fetch + Zod + React Query, query keys, pure display helpers — belongs in `packages/client`, never in one app. It owns no transport: `configureClient()` injects the HTTP client and the session source, so nothing in it may import `ky` directly or reach for better-auth. Components stay in their app; there is no cross-platform component layer.
- `apps/mobile` is the one package that does not extend `tsconfig.base.json` (React Native needs `moduleResolution: bundler`). It does **not** get its own TypeScript: `typescript` is an optional peer of the expo tooling, so a second major produces duplicate peer-suffixed `expo` instances and expo-doctor fails the duplicate-native-module check. Let `expo install` choose native dependency versions rather than picking them by hand, and do not hand-write `metro.config.js` monorepo settings.
- In `apps/mobile`, the origin of the instance the user picked is the root of every URL. Paths from the API are instance-relative: put them through `resolveInstanceUrl()` rather than concatenating. Import Google fonts by weight subpath, never from the package root.

## Verification

Run the narrowest relevant checks first. Before handing off a non-trivial change, run the applicable commands from:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
```

`pnpm --filter @trackt/mobile doctor` (expo-doctor) is the mobile app's fourth check and runs in CI — SDK alignment and duplicate native modules are invisible to lint and typecheck.

Database-backed integration tests can self-skip without the development Compose services, so say clearly when those services were not available.

## Environment

Development uses Node 22+ and pnpm 10+. Start supporting services with:

```sh
docker compose -f docker-compose.dev.yml up -d
```

Development defaults are configured in `packages/shared/src/env.ts`; a `.env` file is not normally needed.
