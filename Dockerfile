# syntax=docker/dockerfile:1
# Trackt monolith image: API + web SSR + worker (+ optional Discord bot) in one container (PRD §6.1).
# Migrations run automatically on boot; upgrades are `docker compose pull && up`.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Manifests only, no sources. Docker caches a layer by the contents of its
# inputs, so an install that sits after `COPY apps ./apps` is invalidated by
# every source-only change and re-downloads the workspace's packages on every
# redeploy. Keeping the manifests in their own stage makes both installs depend
# on dependency declarations alone.
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

# Production dependencies for the runtime image. Its own stage so that a
# source-only change does not re-run it: it reads nothing but the manifests,
# and the runtime's node_modules is what this stage produces.
#
# NOT `pnpm prune --prod`: prune is unsupported in workspaces and strips the
# per-package node_modules (including the workspace symlinks), leaving every
# app unable to resolve its dependencies at runtime. Reinstall prod-only
# instead. CI=true: pnpm refuses to modify node_modules without a TTY.
# (The tree still contains vite/esbuild/prettier: those are production
# dependencies of @tanstack/react-start via start-plugin-core, not leftovers.)
FROM manifests AS deps
RUN --mount=type=cache,id=s/ef9e3d63-8810-40bb-a9c6-7eba34b414c2-/pnpm/store,target=/pnpm/store \
  CI=true pnpm install --store-dir /pnpm/store --prod --frozen-lockfile \
    --filter=trackt \
    --filter='@trackt/api...' --filter='@trackt/web...' \
    --filter='@trackt/worker...' --filter='@trackt/discord...'

FROM manifests AS build
# Filtered to the monolith's workspace graph (api, web, worker, discord and
# their dependencies: shared, db, client). The root project comes along for
# turbo. apps/mobile, apps/catalog, packages/llm and packages/providers are
# not part of this image — see the runtime stage.
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
RUN --mount=type=cache,id=s/ef9e3d63-8810-40bb-a9c6-7eba34b414c2-/pnpm/store,target=/pnpm/store \
  pnpm install --store-dir /pnpm/store --frozen-lockfile \
    --filter=trackt \
    --filter='@trackt/api...' --filter='@trackt/web...' \
    --filter='@trackt/worker...' --filter='@trackt/discord...'
# Tailwind scans again for SSR after dist/client exists; keep it out of build output.
COPY .gitignore ./
COPY apps ./apps
COPY packages ./packages
# Same filter for the build: `turbo run build` would otherwise also compile
# apps/catalog, packages/providers and packages/llm, none of which this image
# ships. The turbo cache lives in a cache mount so a source-only change
# rebuilds the touched packages instead of all of them.
RUN --mount=type=cache,id=s/ef9e3d63-8810-40bb-a9c6-7eba34b414c2-/app/.turbo,target=/app/.turbo \
  pnpm exec turbo run build \
    --filter='@trackt/api...' --filter='@trackt/web...' \
    --filter='@trackt/worker...' --filter='@trackt/discord...'

# Runtime ships only what the entrypoint's processes need: the boot migration
# (packages/db dist + migrations), the API, web SSR and worker dist outputs,
# their package manifests, and production node_modules (installed above). No TS
# sources, tests, or build caches; apps/catalog and packages/providers are not
# part of the self-hosted monolith. Workspace symlinks in node_modules stay
# valid because the /app layout is preserved.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/discord/package.json ./apps/discord/
COPY --from=build /app/apps/discord/dist ./apps/discord/dist
COPY --from=deps /app/apps/discord/node_modules ./apps/discord/node_modules
COPY --from=build /app/apps/web/package.json /app/apps/web/server.mjs ./apps/web/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /app/data/uploads \
  && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/app/docker/entrypoint.sh"]
