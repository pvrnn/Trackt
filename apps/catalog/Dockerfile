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

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
# Filtered build: only @trackt/catalog and its one workspace dependency
# (@trackt/shared, via turbo.json's dependsOn: ["^build"]) compile — skips
# apps/web (vite/tanstack-start), apps/api, apps/worker, packages/db,
# packages/providers, none of which this image ships or needs.
RUN pnpm exec turbo run build --filter=@trackt/catalog...
# Same reasoning as the root Dockerfile: NOT `pnpm prune --prod` (prune is
# unsupported in workspaces and strips per-package node_modules, including
# the workspace symlinks). Reinstall prod-only instead.
# CI=true: pnpm refuses to modify node_modules without a TTY otherwise.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && CI=true pnpm install --prod --frozen-lockfile

# Runtime ships only what apps/catalog needs to boot: its own dist +
# migrations (kept as siblings — runCatalogMigrations resolves the
# migrations folder relative to the compiled dist/db/index.js,
# apps/catalog/src/db/index.ts), @trackt/shared's dist, package manifests,
# and production node_modules. No Redis, no uploads volume, no multi-process
# supervisor — a single `node` process migrates then serves.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/apps/catalog/package.json ./apps/catalog/
COPY --from=build /app/apps/catalog/dist ./apps/catalog/dist
COPY --from=build /app/apps/catalog/migrations ./apps/catalog/migrations
COPY --from=build /app/apps/catalog/node_modules ./apps/catalog/node_modules
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3002/healthz || exit 1
CMD ["node", "apps/catalog/dist/index.js"]
