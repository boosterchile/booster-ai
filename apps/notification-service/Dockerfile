# Booster AI — notification-service (Cloud Run, T10-21)
#
# Consumer Pub/Sub pull de `notification-events`: entrega WhatsApp vía Twilio
# Content Templates y compara en sombra. Sin libs nativas.

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/notification-service/package.json ./apps/notification-service/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/otel-bootstrap/package.json ./packages/otel-bootstrap/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/whatsapp-client/package.json ./packages/whatsapp-client/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/notification-service build

FROM build AS deploy
RUN pnpm --filter=@booster-ai/notification-service --prod deploy /prod/service --legacy

FROM node:24-slim AS runtime
WORKDIR /app
# Trivy IaC: ejecutar como non-root para mitigar container escape.
RUN groupadd -r booster && useradd -r -g booster booster
COPY --from=deploy --chown=booster:booster /prod/service/dist ./dist
COPY --from=deploy --chown=booster:booster /prod/service/node_modules ./node_modules
COPY --from=deploy --chown=booster:booster /prod/service/package.json ./

ENV NODE_ENV=production
USER booster
EXPOSE 8080

# Trivy IaC AVD-DS-0026: HEALTHCHECK requerido.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# --import carga la instrumentación OTel ANTES de main (ESM).
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]
