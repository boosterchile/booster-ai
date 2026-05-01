# Booster AI API — multi-stage Docker build
#
# Estrategia pnpm-deploy (ver apps/whatsapp-bot/Dockerfile para rationale):
# `pnpm deploy --prod` produce un árbol auto-contenido en /prod/api con
# flat node_modules — evita el ERR_MODULE_NOT_FOUND cuando pnpm deja
# paquetes sólo bajo node_modules/.pnpm/<pkg>/...
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- deps stage ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
# B.8.c — el api ahora depende del cliente Twilio para mandar templates.
COPY packages/whatsapp-client/package.json ./packages/whatsapp-client/
RUN pnpm install --frozen-lockfile

# --- build stage ---
FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/api build

# --- deploy stage: árbol auto-contenido production-only ---
FROM build AS deploy
RUN pnpm --filter=@booster-ai/api --prod deploy /prod/api

# --- runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S booster && adduser -S booster -G booster
# /prod/api incluye package.json + flat node_modules (sin .pnpm symlinks).
COPY --from=deploy --chown=booster:booster /prod/api ./
# dist/ está en .gitignore → pnpm deploy no lo copia. Lo traemos desde build.
COPY --from=build --chown=booster:booster /app/apps/api/dist ./dist
# Migraciones Drizzle — aplicadas al startup por src/db/migrator.ts.
COPY --from=build --chown=booster:booster /app/apps/api/drizzle ./drizzle
USER booster
EXPOSE 8080
CMD ["node", "dist/main.js"]
