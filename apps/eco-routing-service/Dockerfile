# Booster AI — eco-routing-service (Cloud Run)
#
# Event-driven service: consume posiciones de conductores (Pub/Sub),
# mantiene estado por viaje, y sugiere rutas más ecológicas cuando
# detecta degradación de ETA.
#
# Task 9 (deploy) finalizará los detalles de pnpm deploy --prod y packages
# adicionales que haya que copiar en la etapa deps. Por ahora se incluyen
# los packages directos declarados en dependencies.
#
# Nota para Task 9: este servicio NO tiene dependencias nativas (sin pg,
# sin ioredis — usa store in-memory). El pnpm deploy --prod debería ser
# más liviano que telemetry-processor. Verificar que routes-api-client
# (google-auth-library) y @google-cloud/pubsub se incluyan correctamente.

FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/eco-routing-service/package.json ./apps/eco-routing-service/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/otel-bootstrap/package.json ./packages/otel-bootstrap/
COPY packages/routes-api-client/package.json ./packages/routes-api-client/
COPY packages/traffic-condition-detector/package.json ./packages/traffic-condition-detector/
COPY packages/route-alternatives-evaluator/package.json ./packages/route-alternatives-evaluator/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/eco-routing-service build

FROM build AS deploy
RUN pnpm --filter=@booster-ai/eco-routing-service --prod deploy /prod/eco-routing

FROM node:24-alpine AS runtime
WORKDIR /app
# Trivy IaC: ejecutar como non-root para mitigar container escape.
RUN addgroup -S booster && adduser -S booster -G booster
COPY --from=deploy --chown=booster:booster /prod/eco-routing/dist ./dist
COPY --from=deploy --chown=booster:booster /prod/eco-routing/node_modules ./node_modules
COPY --from=deploy --chown=booster:booster /prod/eco-routing/package.json ./

ENV NODE_ENV=production
USER booster
EXPOSE 8080

# Trivy IaC AVD-DS-0026: HEALTHCHECK para detectar runtime issues.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# --import carga OTel ANTES de main (ESM; spec feat-otel-bootstrap).
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]
