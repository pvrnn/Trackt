# syntax=docker/dockerfile:1
# Trackt catalog image: apps/catalog, the central slim-catalog Fastify
# service (ADR-0001). Project-operated — NOT part of the self-hosted
# monolith image/compose (docker-compose.yml). Single process: migrations
# run automatically on boot (apps/catalog/src/db/index.ts), then it serves.
# See docs/catalog-hosting.md for the deploy walkthrough.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Manifests only, no sources: Docker caches a layer by the contents of its
# inputs, so an install that sits after `COPY apps ./apps` is invalidated by
# every source-only change and re-downloads the workspace's packages on every
# redeploy.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
# Every workspace manifest, including the ones this image does not build:
# pnpm's --frozen-lockfile compares the lockfile's importers against the
# workspace, so a missing manifest is an out-of-date lockfile.
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/discord/package.json ./apps/discord/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/catalog/package.json ./apps/catalog/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/client/package.json ./packages/client/
COPY packages/llm/package.json ./packages/llm/
COPY packages/providers/package.json ./packages/providers/

# Production dependencies for the runtime image, in their own stage so a
# source-only change does not re-run them.
# Same reasoning as the root Dockerfile: NOT `pnpm prune --prod` (prune is
# unsupported in workspaces and strips per-package node_modules, including
# the workspace symlinks). Reinstall prod-only instead.
# CI=true: pnpm refuses to modify node_modules without a TTY otherwise.
FROM manifests AS deps
RUN --mount=type=cache,id=s/4c074682-8c96-4a9e-adb8-592d967a3869-/pnpm/store,target=/pnpm/store \
  CI=true pnpm install --store-dir /pnpm/store --prod --frozen-lockfile \
    --filter=trackt --filter='@trackt/catalog...'

FROM manifests AS build
# Filtered install: @trackt/catalog and its one workspace dependency
# (@trackt/shared), plus the root project for turbo. The root package comes
# along because the build below runs turbo.
#
# The pnpm store lives in a BuildKit cache mount: it is content-addressed, so
# reusing it across builds skips re-downloading every package whose version
# did not change. --store-dir is passed per install rather than configured
# globally: a global rc would not survive, and the repo's own .npmrc is
# copied over /app/.npmrc here.
#
# Railway requires a cache mount's id to start with `s/<service id>-`, so the
# deploying service's id is baked in here (docs.railway.com/builds/dockerfiles).
# Change it if this image is deployed as a different service. Other builders
# treat the id as an opaque cache key.
RUN --mount=type=cache,id=s/4c074682-8c96-4a9e-adb8-592d967a3869-/pnpm/store,target=/pnpm/store \
  pnpm install --store-dir /pnpm/store --frozen-lockfile \
    --filter=trackt --filter='@trackt/catalog...'
COPY apps ./apps
COPY packages ./packages
# Filtered build: only @trackt/catalog and its one workspace dependency
# (@trackt/shared, via turbo.json's dependsOn: ["^build"]) compile — skips
# apps/web (vite/tanstack-start), apps/api, apps/worker, packages/db,
# packages/providers, none of which this image ships or needs. The turbo cache
# lives in a cache mount so a source-only change rebuilds the touched packages
# instead of all of them.
RUN --mount=type=cache,id=s/4c074682-8c96-4a9e-adb8-592d967a3869-/app/.turbo,target=/app/.turbo \
  pnpm exec turbo run build --filter=@trackt/catalog...

# Runtime ships only what apps/catalog needs to boot: its own dist +
# migrations (kept as siblings — runCatalogMigrations resolves the
# migrations folder relative to the compiled dist/db/index.js,
# apps/catalog/src/db/index.ts), @trackt/shared's dist, package manifests,
# and production node_modules. No Redis, no uploads volume, no multi-process
# supervisor — a single `node` process migrates then serves.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/apps/catalog/package.json ./apps/catalog/
COPY --from=build /app/apps/catalog/dist ./apps/catalog/dist
COPY --from=build /app/apps/catalog/migrations ./apps/catalog/migrations
COPY --from=deps /app/apps/catalog/node_modules ./apps/catalog/node_modules
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3002/healthz || exit 1
CMD ["node", "apps/catalog/dist/index.js"]
