# Booster AI sms-fallback-gateway — multi-stage Docker build
#
# Patrón idéntico al de apps/whatsapp-bot/Dockerfile (mismo stack: Hono +
# tsup + workspace deps config/logger/shared-schemas + pnpm deploy
# auto-contenido). Los 3 stages son: deps → build → deploy → runtime.
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- deps stage: solo package.json + lockfile para cachear node_modules ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/sms-fallback-gateway/package.json ./apps/sms-fallback-gateway/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
RUN pnpm install --frozen-lockfile

# --- build stage: compila tsup ---
FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/sms-fallback-gateway build

# --- deploy stage: árbol auto-contenido production-only ---
FROM build AS deploy
RUN pnpm --filter=@booster-ai/sms-fallback-gateway --prod deploy /prod/svc

# --- runtime stage ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S booster && adduser -S booster -G booster
COPY --from=deploy --chown=booster:booster /prod/svc ./
COPY --from=build --chown=booster:booster /app/apps/sms-fallback-gateway/dist ./dist
USER booster
EXPOSE 8080
CMD ["node", "dist/main.js"]
