# Trackt monolith image: API + web SSR + worker in one container (PRD §6.1).
# Migrations run automatically on boot; upgrades are `docker compose pull && up`.

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
RUN pnpm build
# NOT `pnpm prune --prod`: prune is unsupported in workspaces and strips the
# per-package node_modules (including the workspace symlinks), leaving every
# app unable to resolve its dependencies at runtime. Reinstall prod-only
# instead — packages come from the local store populated above, so it's fast.
# CI=true: pnpm refuses to modify node_modules without a TTY otherwise.
# (The tree still contains vite/esbuild/prettier: those are production
# dependencies of @tanstack/react-start via start-plugin-core, not leftovers.)
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && CI=true pnpm install --prod --frozen-lockfile

# Runtime ships only what the entrypoint's processes need: the boot migration
# (packages/db dist + migrations), the API, web SSR and worker dist outputs,
# their package manifests, and production node_modules (installed above). No TS
# sources, tests, or build caches; apps/catalog and packages/providers are not
# part of the self-hosted monolith. Workspace symlinks in node_modules stay
# valid because the /app layout is preserved.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=build /app/packages/db/migrations ./packages/db/migrations
COPY --from=build /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/web/package.json /app/apps/web/server.mjs ./apps/web/
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /app/data/uploads \
  && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/app/docker/entrypoint.sh"]
