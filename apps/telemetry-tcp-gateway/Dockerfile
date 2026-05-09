# Booster AI — telemetry-tcp-gateway
#
# Long-lived TCP server para devices Teltonika. NO sirve en Cloud Run
# (Cloud Run cierra conexiones inactivas tras ~1 min); deployado en GKE
# Autopilot donde las conexiones TCP persistentes son first-class.
#
# Misma estrategia pnpm-deploy que apps/api y apps/whatsapp-bot:
# `pnpm deploy --prod` produce un árbol auto-contenido con flat
# node_modules para evitar ERR_MODULE_NOT_FOUND.

FROM node:24-alpine AS base
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
FROM node:24-alpine AS runtime
WORKDIR /app
# Trivy IaC: ejecutar como non-root para mitigar container escape.
# Port 5027 > 1024 -> non-root puede bindearlo sin CAP_NET_BIND_SERVICE.
# UID/GID >= 10000 (AVD-KSV-0118) — coincide con runAsUser:10001 del K8s
# pod-level securityContext y evita colisiones con UIDs reservados del SO.
RUN addgroup -S -g 10001 booster && adduser -S -u 10001 -G booster booster
COPY --from=deploy --chown=booster:booster /prod/gateway/dist ./dist
COPY --from=deploy --chown=booster:booster /prod/gateway/node_modules ./node_modules
COPY --from=deploy --chown=booster:booster /prod/gateway/package.json ./

ENV NODE_ENV=production
USER booster
EXPOSE 5027

# Trivy IaC AVD-DS-0026: HEALTHCHECK requerido. Gateway es TCP-only — usamos
# net.connect a 127.0.0.1:5027 para validar que el server escucha. K8s
# tcpSocket probe en el manifest hace lo mismo a nivel pod (Docker
# HEALTHCHECK es cosmetic en GKE pero satisface Trivy + util en local).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('net').connect(5027,'127.0.0.1').on('connect',function(){this.end();process.exit(0)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
