# Booster AI — document-service (worker TED, Cloud Run, frente F4-4b)
#
# Consumer Pub/Sub de `document.uploaded`. Decodifica el TED PDF417 de
# documentos tributarios de terceros (best-effort) y persiste el <DD>.
#
# WASM-only (C-8): NADA de `apt-get install` de libs de sistema. La
# rasterización de PDF (`@hyzyla/pdfium`) y la decodificación PDF417
# (`zxing-wasm`) son WASM prebuilt. `sharp` (preprocesado de FOTOS) instala su
# binario prebuilt npm para la plataforma del runtime — no compila libvips a
# mano. Por eso la imagen es Debian slim (no Alpine/musl): el prebuilt de sharp
# y los .node prebuilt resuelven contra glibc sin toolchain de compilación.

FROM node:24-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/document-service/package.json ./apps/document-service/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/otel-bootstrap/package.json ./packages/otel-bootstrap/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/transport-documents/package.json ./packages/transport-documents/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @booster-ai/document-service build

FROM build AS deploy
RUN pnpm --filter=@booster-ai/document-service --prod deploy /prod/worker --legacy

FROM node:24-slim AS runtime
WORKDIR /app
# Trivy IaC: ejecutar como non-root para mitigar container escape.
RUN groupadd -r booster && useradd -r -g booster booster
COPY --from=deploy --chown=booster:booster /prod/worker/dist ./dist
COPY --from=deploy --chown=booster:booster /prod/worker/node_modules ./node_modules
COPY --from=deploy --chown=booster:booster /prod/worker/package.json ./

ENV NODE_ENV=production
USER booster
EXPOSE 8080

# Trivy IaC AVD-DS-0026: HEALTHCHECK requerido. Node http.get a /health del
# worker (expone health probe para liveness de Cloud Run).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# --import carga la instrumentación OTel ANTES de main (ESM; feat-otel-bootstrap)
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]
