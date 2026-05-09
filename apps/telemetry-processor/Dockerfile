# Booster AI — telemetry-processor (Cloud Run)
#
# Consumer Pub/Sub que persiste los AVL records en telemetria_puntos.
# Cloud Run alcanza para esto (no requiere TCP persistente como el
# gateway). Health probe HTTP /health para liveness.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/telemetry-processor/package.json ./apps/telemetry-processor/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/telemetry-processor build

FROM build AS deploy
RUN pnpm --filter=@booster-ai/telemetry-processor --prod deploy /prod/processor

FROM node:24-alpine AS runtime
WORKDIR /app
# Trivy IaC: ejecutar como non-root para mitigar container escape.
RUN addgroup -S booster && adduser -S booster -G booster
COPY --from=deploy --chown=booster:booster /prod/processor/dist ./dist
COPY --from=deploy --chown=booster:booster /prod/processor/node_modules ./node_modules
COPY --from=deploy --chown=booster:booster /prod/processor/package.json ./

ENV NODE_ENV=production
USER booster
EXPOSE 8080

CMD ["node", "dist/main.js"]
