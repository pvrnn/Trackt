# syntax=docker/dockerfile:1
# Trackt import worker image: apps/worker alone, for running account imports in
# a service of their own (WORKER_QUEUES=importer, usually with
# WORKER_IDLE_SECONDS so the host can sleep it between imports). The monolith
# image (root Dockerfile) still runs a worker of its own; point that one at the
# trophy sweep only (WORKER_QUEUES=trophies) once this service takes imports.
# No migrations here: the monolith runs them on boot.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
# Every workspace manifest: pnpm's --frozen-lockfile compares the lockfile's
# importers against the workspace, so a missing manifest is an out-of-date lockfile.
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY apps/discord/package.json ./apps/discord/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/catalog/package.json ./apps/catalog/
COPY packages/shared/package.json ./packages/shared/
COPY packages/db/package.json ./packages/db/
COPY packages/client/package.json ./packages/client/
COPY packages/imports/package.json ./packages/imports/
COPY packages/llm/package.json ./packages/llm/
COPY packages/providers/package.json ./packages/providers/

# Railway requires a cache mount's id to start with `s/<service id>-`; this is
# the `worker` service's id. Change it if the image is deployed as another service.
FROM manifests AS deps
RUN --mount=type=cache,id=s/871449b5-4374-4764-9b4e-195367d589e4-/pnpm/store,target=/pnpm/store \
  CI=true pnpm install --store-dir /pnpm/store --prod --frozen-lockfile \
    --filter=trackt --filter='@trackt/worker...'

FROM manifests AS build
RUN --mount=type=cache,id=s/871449b5-4374-4764-9b4e-195367d589e4-/pnpm/store,target=/pnpm/store \
  pnpm install --store-dir /pnpm/store --frozen-lockfile \
    --filter=trackt --filter='@trackt/worker...'
COPY .gitignore ./
COPY apps/worker ./apps/worker
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/imports ./packages/imports
RUN --mount=type=cache,id=s/871449b5-4374-4764-9b4e-195367d589e4-/app/.turbo,target=/app/.turbo \
  pnpm exec turbo run build --filter='@trackt/worker...'

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build /app/packages/db/package.json ./packages/db/
COPY --from=build /app/packages/db/dist ./packages/db/dist
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=build /app/packages/imports/package.json ./packages/imports/
COPY --from=build /app/packages/imports/dist ./packages/imports/dist
COPY --from=deps /app/packages/imports/node_modules ./packages/imports/node_modules
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules
USER node
CMD ["node", "apps/worker/dist/index.js"]
