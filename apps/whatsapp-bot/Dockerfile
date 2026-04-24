# Booster AI WhatsApp Bot — multi-stage Docker build
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- deps stage ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/whatsapp-bot/package.json ./apps/whatsapp-bot/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/whatsapp-client/package.json ./packages/whatsapp-client/
RUN pnpm install --frozen-lockfile

# --- build stage ---
FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/whatsapp-bot build

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S booster && adduser -S booster -G booster
COPY --from=build --chown=booster:booster /app/apps/whatsapp-bot/dist ./dist
COPY --from=build --chown=booster:booster /app/apps/whatsapp-bot/package.json ./
COPY --from=build --chown=booster:booster /app/node_modules ./node_modules
USER booster
EXPOSE 8080
CMD ["node", "dist/main.js"]
