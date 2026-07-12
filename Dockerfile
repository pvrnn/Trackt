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
# pnpm refuses to prune node_modules without a TTY unless CI=true is set.
RUN CI=true pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /app/data/uploads \
  && chown -R node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/app/docker/entrypoint.sh"]
