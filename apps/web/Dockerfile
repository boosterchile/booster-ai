# Booster AI Web (PWA) — multi-stage build
#
# Vite produce un bundle estático en /dist. Lo servimos con nginx-alpine.
#
# Las variables VITE_* son inyectadas a BUILD-TIME (no runtime) porque Vite
# las reemplaza textualmente en el bundle. Cambiar una var requiere rebuild.
# Esto es estándar para SPAs estáticas — el costo de re-buildear es bajo.
#
# Las claves de Firebase web (apiKey, authDomain, projectId, etc.) NO son
# credenciales de servidor: viajan en el bundle al cliente y son públicas
# por diseño. La seguridad la dan las Firebase Security Rules + el dominio
# autorizado en Firebase Auth Settings.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# --- deps stage: instalar todo el monorepo (necesario para workspace deps) ---
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json biome.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared-schemas/package.json ./packages/shared-schemas/
COPY packages/ui-tokens/package.json ./packages/ui-tokens/
RUN pnpm install --frozen-lockfile

# --- build stage: vite build con env vars inyectadas via ARG ---
FROM deps AS build
ARG VITE_API_URL
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_GOOGLE_MAPS_API_KEY

ENV VITE_API_URL=$VITE_API_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_STORAGE_BUCKET=$VITE_FIREBASE_STORAGE_BUCKET \
    VITE_FIREBASE_MESSAGING_SENDER_ID=$VITE_FIREBASE_MESSAGING_SENDER_ID \
    VITE_FIREBASE_APP_ID=$VITE_FIREBASE_APP_ID \
    VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY

COPY . .
RUN pnpm --filter @booster-ai/web build

# --- runtime stage: nginx-alpine sirviendo el bundle ---
FROM nginx:1.27-alpine AS runtime

# Cloud Run inyecta PORT (por defecto 8080); nginx tiene que escuchar ahí.
# Usamos un template y substituimos PORT al startup.
ENV PORT=8080

COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Cloud Run health check: la propia request del LB pega a / esperando 200.
# nginx sirve index.html (200) por SPA fallback. Suficiente para liveness.

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
