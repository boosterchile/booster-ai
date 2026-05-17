# Inventory — auditoría full-stack Booster AI

**Fecha**: 2026-05-17 (carpeta `audit-2026-05-14` por consistencia con el feature slug)
**Alcance**: pasada 100% lectura — no se modifica ningún archivo del proyecto.
**Fase**: AUDIT-INVENTORY (precede a las pasadas focalizadas).
**HEAD**: `2114dba feat(scripts): H1-H3 — agent query helper implementation (#277)`
**Ledger**: `.claude/ledger/2026-05-17_8eef12fe-1dfc-4389-936f-139caac69d93.jsonl`

---

## 1. Stack tecnológico

### 1.1 Runtimes y package management

| Capa | Tecnología | Versión declarada | Fuente |
|---|---|---|---|
| Node | runtime | `>=22.0.0` (NVM pin `22`) | `package.json` engines, `.nvmrc` |
| pnpm | package manager | `9.15.4` (pinned vía `packageManager`) | `package.json` |
| Turborepo | task runner | `^2.9.8` | `package.json` |
| TypeScript | compilador | `^5.8.2` | `package.json` (root + apps) |
| Biome | lint + format | `^1.9.4` | `package.json` |
| Husky | git hooks | `^9.1.7` | `package.json` |
| Commitlint | conventional | `^19.6.1` (`config-conventional` `^19.6.0`) | `commitlint.config.cjs` |
| Changesets | releases | `^2.27.11` | `package.json` |
| gitleaks | secret scan | (binario externo) | script `security:scan` |

### 1.2 Backend (`apps/api`)

| Dep | Versión |
|---|---|
| `hono` | `^4.12.18` |
| `@hono/node-server` | `^1.13.7` |
| `@hono/zod-validator` | `^0.7.6` |
| `drizzle-orm` | `^0.45.2` |
| `drizzle-kit` (dev) | `^0.31.10` |
| `pg` | `^8.13.1` |
| `ioredis` | `^5.4.2` |
| `pino` + `pino-http` | `^9.5.0` / `^10.3.0` |
| `firebase-admin` | `^13.7.0` |
| `google-auth-library` | `^10.6.2` |
| `googleapis` | `^171.4.0` |
| `@google-cloud/kms` | `^4.5.0` |
| `@google-cloud/pubsub` | `^4.10.0` |
| `@google-cloud/storage` | `^7.13.0` |
| `@opentelemetry/sdk-node` | `^0.218.0` (suite OTEL completa) |
| `@signpdf/signpdf` + `placeholder-plain` + `utils` | `^3.2.4` |
| `pdf-lib` / `node-forge` / `web-push` | `^1.17.1` / `^1.3.1` / `^3.6.7` |
| `zod` | `^3.25.76` |
| `vitest` + `@vitest/coverage-v8` (dev) | `^4.0.18` |

### 1.3 Frontend (`apps/web`)

| Dep | Versión |
|---|---|
| `react` / `react-dom` | `^18.3.1` |
| `vite` | `^6.2.0` |
| `@vitejs/plugin-react` | `^4.3.4` |
| `@tanstack/react-router` + `router-plugin` | `^1.169.2` / `^1.167.35` |
| `@tanstack/react-query` | `^5.100.9` |
| `react-hook-form` + `@hookform/resolvers` | `^7.75.0` / `^3.10.0` |
| `zustand` | `^5.0.2` |
| `firebase` (client SDK) | `^12.10.0` |
| `idb` | `^8.0.0` |
| `tailwindcss` + `@tailwindcss/vite` + `postcss` + `autoprefixer` | `^4.0.0` / `^4.0.0` / `^8.5.13` / `^10.4.20` |
| `@tremor/react` | `^3.18.7` |
| `@vis.gl/react-google-maps` | `^1.5.0` |
| `lucide-react` | `^0.469.0` |
| `clsx` / `tailwind-merge` | `^2.1.1` / `^2.5.5` |
| `vite-plugin-pwa` + `workbox-*` | `^0.21.1` / `^7.3.0` |
| `@playwright/test` + `@axe-core/playwright` | `^1.49.1` / `^4.11.3` |
| `@testing-library/react` + `jest-dom` + `user-event` | `^16.1.0` / `^6.6.3` / `^14.5.2` |
| `jsdom` | `^26.0.0` |
| `vitest` | `^4.0.18` |

### 1.4 Infra y CI/CD

- **IaC**: Terraform (`infrastructure/`) sobre GCP. 22 archivos `.tf` raíz + 3 módulos (`cloud-run-service`, `cloud-run-job`, `iap-bastion`) + 8 manifiestos K8s (`infrastructure/k8s/`).
- **Build pipelines**: 3 Cloud Build configs — `cloudbuild.production.yaml`, `cloudbuild.staging.yaml`, `cloudbuild.merge-job.yaml`. Cluster DR adicional con `cloudbuild-dr-deploy.yaml`.
- **GitHub Actions**: 4 workflows — `ci.yml`, `security.yml`, `release.yml`, `e2e-staging.yml`.
- **GitLab CI**: `.gitlab-ci.yml` presente como mirror (memoria de proyecto: GitHub es canónico, GitLab semi-roto por cuota).
- **Pre-commit**: Husky → `commit-msg` (commitlint) + `pre-commit` (lint-staged biome + gitleaks).

---

## 2. Arquitectura

### 2.1 Modelo conceptual

Marketplace B2B de logística sostenible Chile. Cinco roles, una PWA, dos canales (web + WhatsApp). Telemetría 24/7 Teltonika Codec8 + driver PWA como fuente complementaria. Gestión documental SII obligatoria (DTE, factura, Carta de Porte, acta de entrega).

### 2.2 Componentes y conexiones

```
       ┌──────────────────────────┐         ┌─────────────────────────┐
       │  apps/web (Vite + React) │         │ WhatsApp Cloud / Twilio │
       │  PWA multirol, 5 roles   │         └──────────┬──────────────┘
       └────────────┬─────────────┘                    │
                    │ HTTPS (Firebase ID token)        │ HTTPS webhook
                    ▼                                   ▼
              ┌──────────────────────────────────────────────────┐
              │      apps/api  (Hono + Drizzle + Postgres)        │
              │  ~152 endpoints en 32 routers, 46 services        │
              │  - Auth (universal RUT, Firebase, OIDC SA-to-SA)  │
              │  - Trip lifecycle / offers / assignments          │
              │  - Documentos (DTE, Carta Porte, KMS sign)        │
              │  - Cobra Hoy (factoring V1)                       │
              │  - Pricing V2, Matching V2, Certificados, Chat    │
              │  - Stakeholder geo aggregations (k-anon)          │
              └─────────┬───────────────┬───────────┬────────────┘
                        │               │           │
                Cloud SQL Postgres  Pub/Sub       GCS+KMS
                (Drizzle, 35 tablas, 38 migr.)  (docs/cert/audio)
                        ▲               │
                        │               ├──► apps/whatsapp-bot (Hono, NLU Gemini)
                        │               ├──► apps/telemetry-processor (Pub/Sub→DB+BQ)
                        │               ├──► apps/sms-fallback-gateway (Hono)
                        │               └──► apps/document-service / matching-engine /
                        │                    notification-service  (STUB - 1 archivo)
                        │
              ┌─────────┴───────────────────────────┐
              │ apps/telemetry-tcp-gateway (GKE)    │ ◄── Teltonika FMC150 (TCP Codec8)
              │ socket TCP 1000+ conexiones         │     cluster primario + DR
              └─────────────────────────────────────┘
```

### 2.3 Integraciones externas declaradas

Identificadas en `apps/api/src/config.ts` + `packages/config/src/schemas/*`:

| Servicio | Uso | Variables |
|---|---|---|
| Firebase Admin / Auth | autenticación end-user, custom tokens demo | `FIREBASE_PROJECT_ID`, `FIREBASE_STORAGE_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS` |
| GCP runtime SA (OIDC SA-to-SA) | inter-Cloud-Run trust | `API_AUDIENCE`, `ALLOWED_CALLER_SA` |
| Cloud KMS | firma de certificados de carbono + PDF signing | `CERTIFICATE_SIGNING_KEY_ID` |
| GCS (3 buckets declarados) | certificados, chat attachments, public assets | `CERTIFICATES_BUCKET`, `CHAT_ATTACHMENTS_BUCKET`, `PUBLIC_ASSETS_BUCKET` |
| Pub/Sub | chat fan-out, telemetría, notifs | `CHAT_PUBSUB_TOPIC` |
| Web Push (VAPID W3C, ADR-016) | notifs browser | `WEBPUSH_VAPID_PUBLIC_KEY`, `WEBPUSH_VAPID_PRIVATE_KEY`, `WEBPUSH_VAPID_SUBJECT` |
| Twilio (WhatsApp + SMS fallback) | templates carrier / tracking / chat-unread | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `CONTENT_SID_OFFER_NEW`, `CONTENT_SID_TRACKING`, `CONTENT_SID_CHAT_UNREAD` |
| Sovos (DTE) | emisión factura electrónica | `SOVOS_API_KEY`, `SOVOS_BASE_URL`, `DTE_PROVIDER` |
| Vertex AI / Gemini (ADC, ADR-037) | NLU / coaching / driver scoring | `GOOGLE_CLOUD_PROJECT` |
| Google Routes API (ADC, ADR-038) | eco-route / ETA público | `GOOGLE_CLOUD_PROJECT` (no API key) |
| Google Workspace impersonation | observability reader cuentas internas | `GOOGLE_WORKSPACE_*` (4 vars: dominio, impersonate, reader SA, pricing) |
| Picovoice (Wave 5) | wake-word "Oye Booster" | **bloqueado** — pendiente approval vendor |
| Observabilidad | OpenTelemetry → OTLP HTTP exporter | Activo |
| Pagos B2B | Factoring V1 "Cobra Hoy" (ADR-029) + Sovos DTE | Activo (escala mínima ADR-032) |

---

## 3. Estructura de carpetas (top 3 niveles)

```
Booster-AI/
├── apps/
│   ├── api/                       # Backend Hono — 105 src files / 94 test files
│   │   ├── src/{config,env,main,server}.ts
│   │   ├── src/{db,middleware,routes,services,jobs,types}/
│   │   ├── drizzle/               # 38 migraciones + schema.ts (35 tablas)
│   │   ├── scripts/
│   │   └── test/{unit,integration,helpers}/
│   ├── web/                       # PWA Vite+React — 130 src files / 106 test files
│   │   ├── src/{App,main,router,sw}.tsx + 61 rutas en src/routes/
│   │   ├── src/components/{auth,chat,cobra-hoy,login,map,observability,offers,
│   │   │                   onboarding,profile,scoring,voice}/
│   │   ├── e2e/                   # 1 spec Playwright (perfil-validacion) + fixtures
│   │   └── nginx.conf.template
│   ├── whatsapp-bot/              # webhook Meta + NLU Gemini — 10 src / 6 test
│   ├── telemetry-tcp-gateway/     # TCP Codec8 GKE Autopilot — 8 src / 4 test
│   ├── telemetry-processor/       # Pub/Sub → DB/BQ — 8 src / 4 test
│   ├── sms-fallback-gateway/      # Hono SMS fallback — 6 src / 2 test
│   ├── document-service/          # STUB (1 archivo, 13 LOC)
│   ├── matching-engine/           # STUB (1 archivo, 13 LOC)
│   └── notification-service/      # STUB (1 archivo, 13 LOC)
│
├── packages/                      # 20 paquetes (workspace:*)
│   ├── shared-schemas/            # 39 src / 7 test — Zod domain canónico
│   ├── certificate-generator/     # 10 src / 7 test
│   ├── carbon-calculator/         # GLEC v3.0 — 14 src / 9 test
│   ├── codec8-parser/             # 9 src / 5 test
│   ├── matching-algorithm/        # 7 src / 5 test
│   ├── dte-provider/              # 7 src / 2 test
│   ├── coaching-generator/        # 12 src / 2 test
│   ├── whatsapp-client/           # 6 src / 4 test
│   ├── pricing-engine/            # 5 src / 2 test
│   ├── factoring-engine/          # 5 src / 2 test
│   ├── driver-scoring/            # 4 src / 1 test
│   ├── ui-tokens/                 # 10 src / 1 test
│   ├── logger/                    # 4 src / 2 test (Pino + redaction)
│   ├── config/                    # 8 src / 6 test (schemas Zod env)
│   ├── notification-fan-out/      # 2 src / 1 test
│   ├── ai-provider/               # STUB (1 archivo, 7 LOC)
│   ├── carta-porte-generator/     # STUB (1 archivo)
│   ├── document-indexer/          # STUB (1 archivo)
│   ├── trip-state-machine/        # STUB (1 archivo)
│   └── ui-components/             # STUB (1 archivo)
│
├── infrastructure/                # Terraform GCP — 22 .tf raíz + 3 módulos + k8s/
│   ├── modules/{cloud-run-service,cloud-run-job,iap-bastion}/
│   ├── k8s/                       # manifiestos telemetry GKE (primary + DR)
│   └── *.tf                       # iam, compute, data, networking, security,
│                                  # storage, messaging, monitoring, cloudbuild,
│                                  # crash-traces, telemetry-monitoring, dr-region,
│                                  # wave-3-tls, api-cost-guardrails, scheduling…
│
├── docs/
│   ├── adr/                       # 46 ADRs (001..045, con 3 colisiones históricas)
│   ├── handoff/                   # 15 handoffs fechados + CURRENT.md vivo
│   ├── specs/                     # specs por feature
│   ├── plans/                     # planes por feature
│   ├── runbooks/                  # procedimientos operativos
│   ├── audits/, demo/, legal/, market-research/, research/, transparencia/
│   ├── ci-cd.md, copy-guide.md, pii-handling-stakeholders-consents.md
│
├── .github/workflows/             # ci, security, release, e2e-staging
├── .claude/{commands,ledger,worktrees}/
├── .husky/                        # commit-msg + pre-commit
├── .changeset/
├── skills/                        # 6 skills propios del repo
├── agents/, hooks/, playbooks/, references/, scripts/
│
└── archivos raíz: README.md, CLAUDE.md, AGENTS.md, AUDIT.md (legacy),
                   DESIGN.md, PLAN-PHASE-0.md, biome.json, turbo.json,
                   tsconfig.base.json, vitest.workspace.ts,
                   commitlint.config.cjs, pnpm-workspace.yaml,
                   cloudbuild.{production,staging,merge-job}.yaml,
                   deploy-phase-2.sh
```

---

## 4. Tamaño

### 4.1 LOC global (excluye `node_modules`, `dist`, `coverage`, `.git`, `.terraform`, `.turbo`, `.playwright-mcp`)

- **TS + TSX (apps + packages)**: `124 996` LOC
  - `apps/`: `102 952` LOC (mayoritario)
  - `packages/`: `22 044` LOC
- **TS + TSX (toda la carpeta del proyecto, incluye scripts/hooks)**: `138 659` LOC
- **Terraform `.tf`**: `6 789` LOC (22 archivos raíz)
- **SQL migraciones (`apps/api/drizzle/*.sql`)**: `2 559` LOC en `38` archivos
- **Markdown (`docs/`)**: `102` archivos (incluye 46 ADRs)

### 4.2 Conteo de archivos por tipo (raíz, post-exclusiones)

| Tipo | # archivos |
|---|---|
| `.ts` | 8 114 |
| `.md` | 2 499 |
| `.tsx` | 2 461 |
| `.json` | 1 322 |
| `.sql` | 601 |
| `.tf` | 533 |
| `.yaml/.yml` | 330 |
| `.sh` | 80 |
| `.mjs` | 40 |
| `.html` | 20 |
| `.css` | 20 |

> Los conteos de `.ts/.tsx/.json` incluyen contenido bajo worktrees `.claude/worktrees/*`. El listado "limpio" por app/paquete está en §4.3–§4.4.

### 4.3 LOC + archivos por app (excluyendo `node_modules/dist/coverage/.turbo`)

| App | LOC TS+TSX | Src files | Test files |
|---|---:|---:|---:|
| `apps/api` | 52 496 | 105 | 94 |
| `apps/web` | 44 452 | 130 | 106 |
| `apps/telemetry-processor` | 1 736 | 8 | 4 |
| `apps/telemetry-tcp-gateway` | 1 735 | 8 | 4 |
| `apps/whatsapp-bot` | 1 687 | 10 | 6 |
| `apps/sms-fallback-gateway` | 807 | 6 | 2 |
| `apps/document-service` | 13 | 1 | 0 (stub) |
| `apps/matching-engine` | 13 | 1 | 0 (stub) |
| `apps/notification-service` | 13 | 1 | 0 (stub) |

### 4.4 LOC + archivos por package

| Package | LOC | Src | Test |
|---|---:|---:|---:|
| `shared-schemas` | 4 650 | 39 | 7 |
| `certificate-generator` | 3 023 | 10 | 7 |
| `carbon-calculator` | 2 322 | 14 | 9 |
| `codec8-parser` | 2 154 | 9 | 5 |
| `matching-algorithm` | 2 044 | 7 | 5 |
| `coaching-generator` | 1 672 | 12 | 2 |
| `dte-provider` | 1 389 | 7 | 2 |
| `whatsapp-client` | 1 035 | 6 | 4 |
| `pricing-engine` | 786 | 5 | 2 |
| `ui-tokens` | 743 | 10 | 1 |
| `factoring-engine` | 634 | 5 | 2 |
| `driver-scoring` | 551 | 4 | 1 |
| `config` | 385 | 8 | 6 |
| `logger` | 364 | 4 | 2 |
| `notification-fan-out` | 257 | 2 | 1 |
| `ai-provider` (stub) | 7 | 1 | 0 |
| `carta-porte-generator` (stub) | 7 | 1 | 0 |
| `document-indexer` (stub) | 7 | 1 | 0 |
| `trip-state-machine` (stub) | 7 | 1 | 0 |
| `ui-components` (stub) | 7 | 1 | 0 |

### 4.5 Tests

- `272` archivos de test (`*.test.ts/.test.tsx/.integration.test.ts`) en apps+packages.
- `422` archivos de source no-test en apps+packages.
- LOC en tests: `53 117` (≈42% del LOC total apps+packages → ratio tests/code saludable).
- 1 spec Playwright e2e (`apps/web/e2e/perfil-validacion.spec.ts`) + fixtures — **superficie e2e mínima en repo**, flagged.

---

## 5. Superficies

### 5.1 Frontend (`apps/web`)

- **Framework**: React 18 + Vite 6 + TanStack Router (file-based) + TanStack Query + Tailwind 4 + Tremor + Zustand + react-hook-form + Zod. PWA via `vite-plugin-pwa` (Workbox 7, estrategia `injectManifest` — ADR-019).
- **61 archivos en `src/routes/`** = 33 pages + 28 test files (cobertura por ruta ~85%).

Páginas principales (ruta = filename, sin tildes):

| Ruta | Rol | Propósito |
|---|---|---|
| `index.tsx` | público | landing |
| `login.tsx` | público | login email/password (legacy) |
| `login-conductor.tsx` | conductor | login RUT + clave numérica |
| `onboarding.tsx` | shipper/carrier | post-signup |
| `cargas.tsx` / `carga-track.tsx` | shipper | publicar / trackear viaje |
| `ofertas.tsx` | carrier | inbox de ofertas |
| `asignacion-detalle.tsx` | carrier/driver | detalle assignment |
| `conductor.tsx` / `conductor-configuracion.tsx` | conductor | dashboard + setup |
| `conductores.tsx` / `vehiculos.tsx` / `vehiculo-live.tsx` / `flota.tsx` | carrier | management |
| `liquidaciones.tsx` | carrier | factoring V1 / cobranza |
| `cobra-hoy-historial.tsx` / `legal-cobra-hoy.tsx` | carrier | factoring UX + términos |
| `certificados.tsx` | shipper/stakeholder | huella de carbono |
| `cumplimiento.tsx` | shipper | DTE + Carta de Porte |
| `sucursales.tsx` | shipper | branches |
| `stakeholder-zonas.tsx` | stakeholder | geo k-anon |
| `perfil.tsx` | end-user | profile + validación |
| `platform-admin*.tsx` (4) | admin | matching, observability, site-settings, cobra-hoy |
| `admin-cobra-hoy.tsx` / `admin-dispositivos.tsx` | admin | operaciones |
| `public-tracking.tsx` | público | tracking por UUID |
| `demo.tsx` | público | demo subdomain |
| `legal-terminos.tsx` | público | T&C |

- **Componentes**: 42 archivos `.tsx` no-test en `src/components/` raíz + subcarpetas por dominio (`auth, chat, cobra-hoy, login, map, observability, offers, onboarding, profile, scoring, voice`).
- **Service Worker**: `src/sw.ts` con test (`sw.test.ts`).

### 5.2 Backend (`apps/api`)

- **Framework**: Hono 4 sobre `@hono/node-server`, Drizzle ORM 0.45 + `pg` 8, Firebase Admin 13, OpenTelemetry SDK 0.218 (auto-instrumentations), Pino 9.
- **32 routers** en `src/routes/` → **~152 handlers** (conteo de `.get|.post|.put|.delete|.patch`).
- **46 services** en `src/services/` (orquestación y dominio aplicado).
- Composición en `src/server.ts` con tres tiers de middleware:
  - Públicos: `/health`, `/feature-flags`, `/webpush/vapid-public-key`, `/public/tracking`, `/demo/login`.
  - OIDC SA-to-SA: `/trip-requests/*` (audience + caller SA).
  - Firebase ID token (+ userContext en la mayoría): `/me`, `/me/*`, `/empresas/*`, `/trip-requests-v2/*`, `/assignments/*`, `/certificates/*`, `/admin/*`, `/vehiculos/*`, `/conductores/*`, `/sucursales/*`, `/documentos/*`, `/cumplimiento/*`, `/chat/*`, `/cobra-hoy/*`.

Top routers por #handlers:

| Router | Handlers |
|---|---:|
| `admin-observability.ts` | 12 |
| `documentos.ts` | 11 |
| `assignments.ts` | 10 |
| `vehiculos.ts` / `site-settings.ts` / `me.ts` | 9 |
| `offers.ts` | 8 |
| `trip-requests-v2.ts` | 7 |
| `sucursales.ts` / `me-consents.ts` / `conductores.ts` / `cobra-hoy.ts` / `chat.ts` / `admin-stakeholder-orgs.ts` | 6 |
| `webpush.ts` / `admin-matching-backtest.ts` / `admin-dispositivos.ts` | 4 |
| `certificates.ts` / `admin-seed.ts` / `admin-jobs.ts` | 3 |

### 5.3 Otros servicios (`apps/*`)

- **`apps/whatsapp-bot`** (1 687 LOC) — webhook Meta + Gemini NLU. Activo, sender Twilio compartido con `api`.
- **`apps/telemetry-tcp-gateway`** (1 735 LOC) — TCP Codec8 server, GKE Autopilot (primario + DR). Wave 3 v2 operativo desde 2026-05-12 (memoria).
- **`apps/telemetry-processor`** (1 736 LOC) — consumer Pub/Sub, dedup/enrich, escribe a Postgres + BigQuery + GCS.
- **`apps/sms-fallback-gateway`** (807 LOC) — Hono fallback SMS Twilio.
- **`apps/document-service` / `matching-engine` / `notification-service`** — placeholder de 13 LOC cada uno (no implementados; sus capacidades están actualmente *inlined* en `apps/api` o en `packages/`).

### 5.4 Base de datos

- **Engine**: Cloud SQL Postgres (vía `pg` + Drizzle).
- **35 tablas** declaradas en `apps/api/src/db/schema.ts` (conteo de `pgTable(`), todas en español snake_case (regla CLAUDE.md). Ejemplos: `planes`, `empresas`, `usuarios`, `organizaciones_stakeholder`, `zonas_stakeholder`, `memberships`, `vehiculos`, `sucursales_empresa`, `documentos_vehiculo`, `documentos_conductor`, `posiciones_movil_conductor`, `conductores`, `zones`, `trips`, `offers`, `assignments`, `trip_events`, `trip_metrics`, `stakeholders`, `consents`, …
- **38 migraciones** en `apps/api/drizzle/` (2 559 LOC). El handoff CURRENT.md flaggea un orphan resuelto en PR #274 (G2-G4 + ADR-044 — migration journal integrity guard).
- **Drift schema/domain** documentado: `domain/trip.ts` (inglés) ↔ `db/schema.ts` (español) — resolución pendiente en ADR-042.

### 5.5 Infra GCP (Terraform)

Recursos confirmados en `infrastructure/*.tf`:

- **Compute**: `google_container_cluster` (GKE Autopilot telemetría, primary + DR), Cloud Run (vía módulo), `google_compute_global_address` (LB + private services), `google_compute_subnetwork`.
- **Networking**: `google_dns_managed_zone`, addresses, VPC, private services.
- **Data**: BigQuery datasets (`audit`, `esg_analytics`, `matching`, `observatory`, `telemetry`, `crash_events`), Firestore default DB, Cloud SQL (`engineers_cloudsql_*`).
- **Storage**: GCS buckets (certificados + chat attachments + public assets + crash traces + others).
- **Messaging**: Pub/Sub topics + subscriptions (crash, chat, telemetry).
- **Security**: Cloud KMS keys (certificados + crash traces), Secret Manager (vía Terraform).
- **IAM**: SAs (`cloud_run_runtime`, `observability_workspace_reader`, `github_deployer`, `db_bastion`), Workload Identity Federation (GitHub→GCP, ADR-020), custom roles, IAM humana versionada.
- **Cloud Build**: `worker_pool` (primary + DR), triggers.
- **Monitoring**: alert policies (gemini rate, routes API daily volume + rate, crash trace persistence failures), logging metrics, log exclusions.

---

## 6. Integraciones externas (resumen consolidado)

| Categoría | Servicio | Estado |
|---|---|---|
| Auth | Firebase Auth + custom tokens demo | Activo |
| Auth | Universal RUT + clave numérica (Wave 4) | Activo en prod desde 2026-05-13 |
| GCP runtime | Cloud Run + GKE Autopilot + Cloud SQL + Firestore + BigQuery + GCS + KMS + Pub/Sub + Secret Manager | Activo |
| AI | Vertex AI / Gemini (ADC, ADR-037) | Activo |
| Maps | Google Routes API (ADC, ADR-038) | Activo |
| Workspace | Google Workspace impersonation (observability) | Activo |
| Mensajería | Twilio (WhatsApp + SMS + sender compartido) | Activo |
| Mensajería | Meta Cloud (whatsapp-bot direct) | Activo (ADR-006 + ADR-025) |
| DTE | Sovos (multi-vendor strategy ADR-024) | Activo |
| Telemetría hw | Teltonika FMC150 — alianza directa (memoria) | Activo |
| Web Push | VAPID W3C (ADR-016) | Activo |
| Voz | Picovoice (Wave 5 wake-word) | **Bloqueado** — pendiente approval vendor |

---

## 7. Cobertura aproximada de tests

### 7.1 Coverage publicado (`apps/*/coverage/coverage-summary.json`)

| App | Lines | Stmts | Funcs | Branches |
|---|---:|---:|---:|---:|
| `apps/api` | 83.88% | 83.73% | 86.12% | 75.01% |
| `apps/web` | 84.06% | 84.13% | 83.02% | 77.85% |
| `apps/telemetry-tcp-gateway` | 93.51% | 93.51% | 94.73% | 78.00% |
| `apps/telemetry-processor` | 100% | 100% | 100% | 95.45% |
| `apps/sms-fallback-gateway` | 95.08% | 95.16% | 100% | 93.61% |
| `apps/whatsapp-bot` | 88.41% | 88.62% | 81.81% | 80.00% |

- Coverage gate en CI desde PR #232 (2026-05-16): 80/80/80/80 enforzado en cada `packages/*` no-stub + bash gate en CI valida summaries.
- Apps fuera del gate (stub o sin tests): `document-service`, `matching-engine`, `notification-service`.

### 7.2 Test infra

- **Vitest** (unit + integration) raíz vía `vitest.workspace.ts`. `apps/api` añadió `vitest.integration.config.ts` con `globalSetup` que corre migraciones reales (PR #271/#272) — infra creada precisamente para evitar mocks que mienten (handoff CURRENT.md §T0/T1).
- **Playwright** sobre `apps/web` para e2e + `@axe-core/playwright` para a11y. Hoy hay **solo 1 spec real en repo** (perfil-validacion). El resto del flujo e2e se ejecuta en `e2e-staging.yml` workflow contra staging.
- **lint adicional**: `scripts/lint-rls.mjs` (RLS Postgres) + `apps/api/scripts/check-no-concurrent-in-integration.mjs`.

---

## 8. Estado general

- **Tipo de proyecto**: monorepo pnpm + Turborepo, TypeScript end-to-end (`strict + noExplicitAny:error` vía Biome), cloud-native GCP, IaC 100% Terraform (incluye IAM humana).
- **Edad**: kick-off 2026-04-23. HEAD a 2026-05-17 → **~24 días calendario**, **416 commits**.
- **Actividad reciente** (commits/día, últimos 18 días):

  ```
  04-30 → 18    05-01 → 18    05-02 → 32    05-03 → 25
  05-05 → 34    05-07 → 46    05-08 → 23    05-09 → 34
  05-10 → 74    05-11 →  7    05-12 → 12    05-13 → 36
  05-14 →  3    05-16 → 22    05-17 → 17
  ```

  Pico: 2026-05-10 (74 commits, IaC hardening sprint). Patrón consistente con sesiones intensas Claude + ciclo spec→plan→build.

- **Madurez funcional (según handoffs)**: Waves 1–6 mergeadas. Auth universal activo en prod. Demo subdomain operativo. D11 (stakeholder geo aggregations) **en bloqueo controlado** T8-T12 mientras se construye infra de integration tests (T0 PASS 2026-05-17 ~09:10 UTC, T1 mergeado #271/#272).
- **Disciplina visible**:
  - 46 ADRs en 24 días → decisiones documentadas. 3 colisiones de numeración históricas (028/034/035). Disciplina "un número por archivo" desde ADR-040.
  - 38 migraciones SQL con journal integrity guard (ADR-044) tras orphan detectado en `0009_stakeholder_access_log.sql`.
  - Coverage gate activo en CI (PR #232) bloquea regresión <80%.
  - Hooks pre-commit con gitleaks.
  - CURRENT.md actualizado tras cada merge significativo (vivo, no snapshot estático).
- **Riesgos visibles desde inventory** (lista no exhaustiva, base para las pasadas siguientes):
  1. **3 apps stub** (`document-service`, `matching-engine`, `notification-service`) y **5 packages stub** (`ai-provider`, `carta-porte-generator`, `document-indexer`, `trip-state-machine`, `ui-components`) — superficie declarada en ADRs/README pero sin código. Riesgo de drift entre arquitectura documentada y arquitectura real.
  2. **e2e UI raquítico en repo**: 1 spec Playwright. El gating real ocurre en `e2e-staging.yml` post-deploy — no en PR.
  3. **Drift schema↔domain** (CURRENT.md §c): trip states en inglés vs español. Pendiente ADR-042.
  4. **Coverage branches bajo objetivo en `apps/api`** (75.01% vs gate 80%) — posible gap de tests de error paths.
  5. **`.gitlab-ci.yml` mirror** con CI semi-roto (memoria) — riesgo de divergencia silenciosa.
  6. **Picovoice bloqueado** — Wave 5 con UI inerte detrás de flag, dependencia externa sin ETA.
  7. **Archivos raíz heredados**: `AUDIT.md` (15 KB), `PLAN-PHASE-0.md` (47 KB) y `DESIGN.md` (11 KB), todos del 2026-05-05 — pueden estar desactualizados frente a `docs/handoff/CURRENT.md`.

---

## 9. Próximas pasadas sugeridas

Con el inventory cerrado, las pasadas focalizadas que mejor explotan este snapshot son:

1. **Backend (`apps/api`)** — 152 endpoints / 46 services / 35 tablas — auditoría de contratos, auth tiers, manejo de errores, RLS, branches coverage.
2. **Frontend (`apps/web`)** — 33 pages / 42 componentes / SW / PWA / a11y — checklist UI-UX del contrato + verificación reactiva.
3. **Infra + seguridad** — 22 .tf raíz + 3 módulos + manifiestos K8s + 4 workflows GitHub + 3 Cloud Build + IAM/KMS/Secret Manager + Workload Identity.
4. **DB & migraciones** — 38 .sql + 35 tablas + integrity guard (ADR-044) + drift schema/domain.
5. **Packages compartidos** — calidad de los 20, con foco en stubs (¿se eliminan o se implementan?), `shared-schemas` (39 archivos), `carbon-calculator` (GLEC v3.0), `matching-algorithm`, `dte-provider`, `whatsapp-client`.
6. **Tests e2e + integration** — gap de Playwright + nueva infra integration (T0/T1) + RLS lint.
7. **Documentación viva** — 46 ADRs (3 colisiones), 102 .md en docs, CURRENT.md vs raíz legacy (`AUDIT.md`, `PLAN-PHASE-0.md`, `DESIGN.md`).

---

**inventory listo**.
