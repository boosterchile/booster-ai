# Booster AI WhatsApp Bot — multi-stage Docker build
#
# Estrategia pnpm-deploy:
#   - stage `build` compila con tsup contra el workspace completo
#   - stage `deploy` usa `pnpm deploy --prod` para producir un árbol
#     auto-contenido en /prod/bot (flat node_modules, sin .pnpm/symlinks
#     cross-workspace). Esto evita el ERR_MODULE_NOT_FOUND para pino y
#     cualquier paquete que pnpm normalmente deja sólo en
#     /app/node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>.
#   - stage `runtime` solo copia /prod/bot → imagen minimal.
FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- deps stage: solo package.json + lockfile para cachear node_modules ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/whatsapp-bot/package.json ./apps/whatsapp-bot/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/whatsapp-client/package.json ./packages/whatsapp-client/
RUN pnpm install --frozen-lockfile

# --- build stage: compila tsup ---
FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/whatsapp-bot build

# --- deploy stage: árbol auto-contenido production-only ---
FROM build AS deploy
RUN pnpm --filter=@booster-ai/whatsapp-bot --prod deploy /prod/bot

# --- runtime stage ---
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S booster && adduser -S booster -G booster
# /prod/bot incluye package.json + flat node_modules (sin .pnpm symlinks).
COPY --from=deploy --chown=booster:booster /prod/bot ./
# dist/ está en .gitignore → pnpm deploy no lo copia. Lo traemos desde build.
COPY --from=build --chown=booster:booster /app/apps/whatsapp-bot/dist ./dist
USER booster
EXPOSE 8080
# Trivy IaC AVD-DS-0026: HEALTHCHECK requerido para detectar runtime issues.
# Node http.get a /health — el container falla si el server no responde 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "dist/main.js"]
