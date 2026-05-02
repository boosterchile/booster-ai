# Booster AI — telemetry-tcp-gateway
#
# Long-lived TCP server para devices Teltonika. NO sirve en Cloud Run
# (Cloud Run cierra conexiones inactivas tras ~1 min); deployado en GKE
# Autopilot donde las conexiones TCP persistentes son first-class.
#
# Misma estrategia pnpm-deploy que apps/api y apps/whatsapp-bot:
# `pnpm deploy --prod` produce un árbol auto-contenido con flat
# node_modules para evitar ERR_MODULE_NOT_FOUND.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- deps stage ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/telemetry-tcp-gateway/package.json ./apps/telemetry-tcp-gateway/
COPY packages/codec8-parser/package.json ./packages/codec8-parser/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
RUN pnpm install --frozen-lockfile

# --- build stage ---
FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/telemetry-tcp-gateway build

# --- deploy stage ---
FROM build AS deploy
RUN pnpm --filter=@booster-ai/telemetry-tcp-gateway --prod deploy /prod/gateway

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=deploy /prod/gateway/dist ./dist
COPY --from=deploy /prod/gateway/node_modules ./node_modules
COPY --from=deploy /prod/gateway/package.json ./

ENV NODE_ENV=production
EXPOSE 5027

CMD ["node", "dist/main.js"]
