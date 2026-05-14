# Booster AI — Inventory de auditoría full-stack

**Fecha**: 2026-05-14
**Branch**: `claude/frosty-darwin-0fc803` (worktree)
**Tag más reciente**: `pre-audit-2026-05-14`
**Alcance**: lectura 100% — sin modificar código del proyecto.

Esta inventory es el ancla para las siguientes pasadas focalizadas (seguridad, calidad, deuda, performance, etc.). No emite juicios, solo describe.

---

## 1. Stack tecnológico

### Runtimes y package manager

- **Node.js**: `>=22.0.0` (`engines.node` en root `package.json`, `.nvmrc` pin a 22 LTS).
- **pnpm**: `>=9.0.0` — `packageManager: "pnpm@9.15.4"` (corepack).
- **Turborepo**: `^2.9.8` para orquestar `dev / build / lint / typecheck / test / test:e2e / test:coverage / db:migrate / clean`.
- **TypeScript**: `^5.8.2` (strict mode + `noExplicitAny: error` vía Biome).
- **Linter/formatter**: `@biomejs/biome ^1.9.4`.
- **Husky**: `^9.1.7` + `lint-staged ^15.4.3` + `commitlint ^19.6.1` (conventional commits) + `gitleaks` en pre-commit.
- **Changesets**: `@changesets/cli ^2.27.11`.

### Backend (`apps/api`)

- **Framework HTTP**: Hono `^4.12.18` + `@hono/node-server ^1.13.7` + `@hono/zod-validator ^0.7.6`.
- **ORM**: Drizzle ORM `^0.45.2` sobre `pg ^8.13.1` (PostgreSQL).
- **Migraciones**: `drizzle-kit ^0.31.10`. 38 migraciones SQL bajo `apps/api/drizzle/` (`0000_initial.sql` → `0028_event_type_conductor_asignado.sql`, con varias `0029..` posteriores).
- **Cache / red**: `ioredis ^5.4.2`.
- **Auth**: `firebase-admin ^13.7.0` (Firebase Auth como IdP) + middleware propio (`firebase-auth.ts`, `auth.ts`, `user-context.ts`).
- **Validación**: `zod ^3.25.76` + `@hono/zod-validator`.
- **Logging**: `pino ^9.5.0` + `pino-http ^10.3.0` (wrapper `@booster-ai/logger`).
- **Observabilidad**: `@opentelemetry/{api,sdk-node,exporter-trace-otlp-http,auto-instrumentations-node,resources,semantic-conventions}`.
- **GCP SDKs**: `@google-cloud/pubsub ^4.10.0`, `@google-cloud/storage ^7.13.0`, `@google-cloud/kms ^4.5.0`.
- **Google APIs**: `googleapis ^171.4.0`, `google-auth-library ^10.6.2`.
- **PDF / firma**: `pdf-lib ^1.17.1`, `@signpdf/{signpdf,placeholder-plain,utils} ^3.2.4`, `node-forge ^1.3.1`.
- **Web Push**: `web-push ^3.6.7`.
- **Bundler producción**: `tsup ^8.5.1`; dev con `tsx ^4.19.2`.

### Frontend (`apps/web`)

- **Build/dev**: Vite `^6.2.0` + `@vitejs/plugin-react ^4.3.4`.
- **UI**: React `^18.3.1` / `react-dom ^18.3.1` + Tailwind CSS `^4.0.0` (`@tailwindcss/vite ^4.0.0`) + `tailwind-merge ^2.5.5` + `clsx ^2.1.1`.
- **Router**: TanStack Router `^1.169.2` (`@tanstack/react-router`) — definición programática en `apps/web/src/router.tsx`, no file-based.
- **State server-side**: TanStack Query `^5.100.9`.
- **State client-side**: Zustand `^5.0.2`.
- **Formularios**: React Hook Form `^7.75.0` + `@hookform/resolvers ^3.10.0` + Zod (compartido).
- **PWA**: `vite-plugin-pwa ^0.21.1` + `workbox-{core,routing,strategies,precaching,expiration,window} ^7.3.0`. Service worker en `apps/web/src/sw.ts`.
- **Persistencia local**: `idb ^8.0.0` (IndexedDB).
- **Iconos**: `lucide-react ^0.469.0` (sin emojis, alineado con UI checklist).
- **Charts/dashboards**: `@tremor/react ^3.18.7`.
- **Maps**: `@vis.gl/react-google-maps ^1.5.0`.
- **Firebase cliente**: `firebase ^12.10.0`.
- **Testing UI**: Vitest `^4.0.18` + `@vitest/coverage-v8 ^4.0.18` + Testing Library (`@testing-library/{react,jest-dom,user-event}`), `jsdom ^26.0.0`.
- **E2E**: Playwright `^1.49.1` + `@axe-core/playwright ^4.11.3` (a11y dentro de E2E).

### Otros apps (Node 22 + tsup + Vitest todos)

- `apps/whatsapp-bot` — Hono + `ioredis` + `xstate` + `@booster-ai/whatsapp-client`.
- `apps/telemetry-tcp-gateway` — TCP server puro (sin Hono), `@google-cloud/pubsub`, `drizzle-orm`, `pg`, parser Codec8.
- `apps/telemetry-processor` — Consumer Pub/Sub, BigQuery, Storage, persistencia Postgres.
- `apps/sms-fallback-gateway` — Hono webhook Twilio + Pub/Sub.
- `apps/matching-engine`, `apps/notification-service`, `apps/document-service` — placeholders con sólo `main.ts` (sin deps externas declaradas; lógica vive en `apps/api` o en `packages/*`).

### Packages compartidos (workspace)

- `shared-schemas`, `logger`, `config`, `ai-provider`, `trip-state-machine`, `codec8-parser`, `pricing-engine`, `matching-algorithm`, `carbon-calculator`, `whatsapp-client`, `dte-provider`, `carta-porte-generator`, `certificate-generator`, `coaching-generator`, `document-indexer`, `driver-scoring`, `factoring-engine`, `notification-fan-out`, `ui-tokens`, `ui-components`.

### Infraestructura

- **IaC**: Terraform — 28 archivos `.tf` (6 789 LOC) bajo `infrastructure/` cubriendo: `project`, `iam`, `data` (Postgres/Redis/BigQuery), `messaging` (Pub/Sub), `compute` (Cloud Run + GKE Autopilot), `networking` (VPC, Cloud Armor, LB), `security`, `storage`, `monitoring`, `telemetry-monitoring`, `crash-traces`, `dr-region`, `wave-3-tls`, `api-cost-guardrails`, `scheduling`, `cloudbuild`, `logging-exclusions`, `org-policies`. Módulos reusables: `cloud-run-service`, `cloud-run-job`, `iap-bastion`.
- **K8s** (`infrastructure/k8s/`): manifests sólo para `telemetry-tcp-gateway` (Cloud Run cierra TCP idle ≤1 min) en regiones primary + DR + cert-manager issuers.
- **CI/CD**: GitHub Actions (`ci.yml`, `security.yml`, `release.yml`, `e2e-staging.yml`) + Cloud Build (`cloudbuild.production.yaml`, `cloudbuild.staging.yaml`, `cloudbuild.merge-job.yaml`, y dos bajo `k8s/` para DR).
- **Dockerfiles**: 6 (`api`, `web`, `whatsapp-bot`, `telemetry-tcp-gateway`, `telemetry-processor`, `sms-fallback-gateway`).

---

## 2. Arquitectura

```
                       ┌───────────────────────────────────────────┐
                       │            usuarios / canales             │
                       │  WhatsApp · Web PWA · Email · FCM · SMS   │
                       └───────────────────────────────────────────┘
                                          │
              ┌──────────────────┬────────┴────────┬──────────────────┐
              ▼                  ▼                 ▼                  ▼
       apps/whatsapp-bot   apps/web (PWA)   apps/sms-fallback-     apps/notification-
       (Hono+xstate)       (Vite+React+TS)  gateway (Hono+Pub/Sub)  service (placeholder)
              │                  │                 │                  │
              └────────┬─────────┴────────┬────────┘                  │
                       ▼                  ▼                           │
                                apps/api (Hono)                       │
                            ┌──────────────────────┐                  │
                            │ middleware           │                  │
                            │  · Firebase Auth     │                  │
                            │  · userContext       │                  │
                            │  · cronAuth          │                  │
                            │  · CORS / sec hdr    │                  │
                            └──────────────────────┘                  │
                                       │                              │
                                       ▼                              │
                            ┌──────────────────────┐                  │
                            │ Drizzle ORM (pg)     │                  │
                            └──────────────────────┘                  │
                                       │                              │
                  ┌────────────────────┼────────────────────┐         │
                  ▼                    ▼                    ▼         ▼
        Cloud SQL Postgres    Redis (ioredis)        Pub/Sub topics  Twilio (SMS)
        (multi-tenant via RLS)                       · chat
                                                     · telemetry
                                                     · notifications
                                                     · cobra-hoy
                                                                 │
                                                                 ▼
                                       ┌─────────────────────────────────────┐
                                       │ apps/telemetry-tcp-gateway (GKE)    │
                                       │   ← Teltonika Codec8 TCP            │
                                       ▼                                     │
                                  Pub/Sub raw-telemetry                      │
                                       │                                     │
                                       ▼                                     │
                                apps/telemetry-processor                     │
                          (dedup, enrich, persist → BigQuery + PG + GCS)     │
                                                                             ▼
                                                              Cloud KMS (firma certificados)
                                                              Cloud Storage (DTE, PDF, attachments)
                                                              BigQuery (telemetría, billing export)
                                                              Cloud Monitoring (métricas custom)
                                                              Google Workspace Admin SDK (seat usage)
                                                              googleapis / Routes API (eco-routing)
                                                              Sovos / DTE provider (factura SII)
                                                              Web Push (VAPID) · Firebase FCM
```

Observaciones de arquitectura:

- **Multi-tenant** con RLS — existe `scripts/lint-rls.mjs` (`pnpm lint:rls`) que se ejecuta junto al `pnpm lint`.
- **Auth**: 3 vectores — Firebase Auth (web), driver RUT/clave numérica (`auth-driver`, `auth-universal`), service-to-service via `ALLOWED_CALLER_SA` / `INTERNAL_CRON_CALLER_SA`.
- **Modo demo** (`DEMO_MODE_ACTIVATED`): seed espejo (migración `0024_demo_seed_espejo.sql`) + ruta `/demo` + login bypass (`demo-login.ts`).
- **DR region** separada en `dr-region.tf` + manifests `k8s/cloudbuild-dr-{check,deploy}.yaml`.

---

## 3. Estructura de carpetas (top 3 niveles)

```
.
├── .changeset/
├── .claude/
│   ├── commands/
│   └── ledger/
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── workflows/         # ci.yml, security.yml, release.yml, e2e-staging.yml
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   └── pull_request_template.md
├── .husky/
├── .specs/
│   └── audit-2026-05-14/  # ← este folder
├── agents/                # personas reutilizables (locales del repo)
├── apps/
│   ├── api/               # backend principal (Hono + Drizzle + PG)
│   │   ├── drizzle/       # 38 migraciones SQL
│   │   ├── scripts/
│   │   ├── src/           # config / db / env / jobs / main / middleware / routes / server / services / types
│   │   └── test/          # unit/ + setup.ts (~90 tests)
│   ├── document-service/  # placeholder (sólo main.ts)
│   ├── matching-engine/   # placeholder
│   ├── notification-service/ # placeholder
│   ├── sms-fallback-gateway/ # Hono + Pub/Sub + Twilio webhook
│   ├── telemetry-processor/  # Pub/Sub consumer → BQ/PG/GCS
│   ├── telemetry-tcp-gateway/# GKE TCP server Teltonika Codec8
│   ├── web/               # PWA multi-rol (Vite+React+TanStack)
│   │   ├── e2e/           # Playwright (perfil-validacion.spec.ts + fixtures)
│   │   ├── public/
│   │   ├── src/           # App.tsx / main.tsx / router.tsx / sw.ts + components/hooks/lib/routes/services + styles.css
│   │   └── test/          # setup.ts
│   └── whatsapp-bot/      # Hono + xstate
├── docs/
│   ├── adr/               # 41 ADRs (001..039 + duplicados de número en 028 y 034/035)
│   ├── audits/
│   ├── demo/
│   ├── handoff/           # 10 handoffs fechados (último 2026-05-13)
│   ├── legal/
│   ├── market-research/
│   ├── plans/
│   ├── research/
│   ├── runbooks/
│   ├── specs/
│   ├── transparencia/
│   ├── ci-cd.md
│   ├── copy-guide.md
│   └── pii-handling-stakeholders-consents.md
├── hooks/
├── infrastructure/        # 28 ficheros .tf + modules/ + k8s/
├── packages/              # 20 packages compartidos (workspace:*)
├── playbooks/
├── references/
├── scripts/               # db/ + sql/ + load-test/ + lint-rls.mjs + smoke-test-wave-3-tls.sh + deploy-telemetry-gateway.sh
├── skills/                # adding-cloud-run-service, carbon-calculation-glec, empty-leg-matching, incident-response, using-agent-skills, writing-adrs
├── AGENTS.md
├── AUDIT.md               # auditoría previa 2026-05-01
├── CLAUDE.md
├── DESIGN.md
├── PLAN-PHASE-0.md
├── README.md
├── biome.json
├── cloudbuild.{merge-job,production,staging}.yaml
├── commitlint.config.cjs
├── deploy-phase-2.sh
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── turbo.json
└── vitest.workspace.ts
```

---

## 4. Tamaño (LOC y nº de archivos)

Excluido: `node_modules`, `dist`, `build`, `.next`, `coverage`, `.turbo`, `.git`. Conteo con `wc -l`.

| Lenguaje / artefacto | Ficheros | LOC     |
| -------------------- | -------: | ------: |
| TypeScript `.ts`     |      487 |  85 724 |
| TSX `.tsx`           |      166 |  36 021 |
| Markdown `.md`       |      140 |  22 773 |
| YAML `.yaml`/`.yml`  |       18 |  15 737 |
| Terraform `.tf`      |       28 |   6 789 |
| SQL `.sql`           |       38 |   2 698 |
| JSON                 |       68 |   2 197 |
| Scripts `.mjs`       |        3 |     963 |
| Shell `.sh`          |        4 |     579 |
| CSS                  |        1 |     126 |
| HTML                 |        1 |      17 |
| CJS                  |        1 |      30 |

**Totales relevantes**:

- Código TS/TSX productivo (`src/**`, excluyendo tests): **398 ficheros · ~71 117 LOC**.
- Tests TS/TSX (`*.test.*`, `*.spec.*`, `test/`, `tests/`, `e2e/`): **255 ficheros · ~50 628 LOC**.
- Ratio test-LOC / src-LOC ≈ **0.71** (alto, consistente con coverage gate ≥80%).
- Documentación markdown (~22 k LOC) supera al SQL+Terraform sumados → repo "doc-first".

---

## 5. Superficies

### 5.1 Frontend — rutas (`apps/web/src/router.tsx`, definición programática TanStack Router)

41 rutas declaradas (`createRoute`). Paths capturados con `getPath`:

**Públicas / pre-login**

- `/` — landing/index
- `/login`
- `/login/conductor`
- `/demo`
- `/legal/terminos`
- `/legal/cobra-hoy`
- `/tracking/$token` — tracking público con token efímero

**Onboarding**

- `/onboarding`

**App autenticada (`/app/*`)**

- `/app` — root del rol
- `/app/ofertas`
- `/app/perfil`
- `/app/conductor`, `/app/conductor/configuracion`
- `/app/vehiculos`, `/app/vehiculos/nuevo`, `/app/vehiculos/$id`, `/app/vehiculos/$id/live`
- `/app/conductores`, `/app/conductores/nuevo`, `/app/conductores/$id`
- `/app/sucursales`, `/app/sucursales/nueva`, `/app/sucursales/$id`
- `/app/cargas`, `/app/cargas/nueva`, `/app/cargas/$id`, `/app/cargas/$id/track`
- `/app/asignaciones/$id`
- `/app/flota`
- `/app/cumplimiento`
- `/app/certificados`
- `/app/cobra-hoy/historial`
- `/app/liquidaciones`
- `/app/stakeholder/zonas`

**Admin / platform-admin**

- `/app/admin/dispositivos`
- `/app/admin/cobra-hoy`
- `/app/platform-admin`, `/app/platform-admin/matching`, `/app/platform-admin/site-settings`, `/app/platform-admin/observability`

### 5.2 Backend — montajes de Hono (`apps/api/src/server.ts`) y endpoints

**Montajes principales** (verificados en `server.ts`):

| Mount path                      | Router file                              | Middleware aplicado                            |
| ------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| `/`                             | `health.ts`                              | (público)                                      |
| `/feature-flags`                | `feature-flags.ts`                       | (público)                                      |
| `/trip-requests`                | `trip-requests.ts`                       | `authMiddleware`                               |
| `/trip-requests-v2`             | `trip-requests-v2.ts`                    | `firebaseAuth` + `userContext`                 |
| `/offers`                       | `offers.ts`                              | `firebaseAuth` + `userContext`                 |
| `/me`                           | `me.ts` + subroutes (consents, push, clave numérica, cobra-hoy, liquidaciones) | `firebaseAuth` |
| `/empresas`                     | `empresas.ts`                            | `firebaseAuth`                                 |
| `/assignments`                  | `assignments.ts` + chat + cobra-hoy      | `firebaseAuth` + `userContext`                 |
| `/admin/jobs`                   | `admin-jobs.ts`                          | `cronAuthMiddleware`                           |
| `/admin/cobra-hoy`              | `admin-cobra-hoy.ts`                     | `firebaseAuth` + `userContext`                 |
| `/admin/stakeholder-orgs`       | `admin-stakeholder-orgs.ts`              | `firebaseAuth` + `userContext`                 |
| `/admin/site-settings`          | `site-settings.ts`                       | `firebaseAuth` + `userContext`                 |
| `/admin/liquidaciones`          | `admin-liquidaciones.ts`                 | `firebaseAuth` + `userContext`                 |
| `/admin/matching`               | `admin-matching-backtest.ts`             | `firebaseAuth` + `userContext`                 |
| `/admin/seed`                   | `admin-seed.ts`                          | `firebaseAuth` + `userContext`                 |
| `/admin/observability`          | `admin-observability.ts`                 | `firebaseAuth` + `userContext`                 |
| `/admin/dispositivos-pendientes`| `admin-dispositivos.ts`                  | `firebaseAuth` + `userContext`                 |
| `/vehiculos`, `/conductores`, `/sucursales`, `/documentos`, `/cumplimiento` | respectivos routers | `firebaseAuth` + `userContext` |
| `/certificates`                 | `certificates.ts`                        | middleware específico para tokens públicos     |
| `/public`                       | `public-site-settings` (subset)          | (público)                                      |

**Volumen agregado**: 31 ficheros en `apps/api/src/routes/` → **159 handlers `.get/.post/.put/.patch/.delete(...)`**.

Top 10 routers por cantidad de handlers:

```
13  documentos.ts
12  vehiculos.ts
12  admin-observability.ts
10  assignments.ts
 9  site-settings.ts
 9  me.ts
 8  offers.ts
 7  trip-requests-v2.ts
 7  chat.ts
 6  sucursales.ts
```

**Services orquestadores** (`apps/api/src/services/`): ~50 ficheros (matching, factoring, certificates, DTE, eco-route, cobra-hoy, observability, onboarding, etc.) + subfolder `observability/`.

### 5.3 Backend secundario

- **`apps/whatsapp-bot`** — Hono webhook (`routes/`) + máquina `xstate` (`conversation/`) + servicios (`services/`).
- **`apps/telemetry-tcp-gateway`** — TCP listener Codec8 + auth IMEI + publisher Pub/Sub. Despliegue GKE Autopilot (no Cloud Run).
- **`apps/telemetry-processor`** — Pub/Sub consumer + adaptadores crash-trace / green-driving + persistencia.
- **`apps/sms-fallback-gateway`** — Hono webhook Twilio (firma + parser).
- **`apps/document-service`**, **`apps/matching-engine`**, **`apps/notification-service`** — sólo `main.ts` (placeholders; lógica viva en `apps/api` + `packages/*`).

---

## 6. Base de datos e integraciones externas

### 6.1 Persistencia primaria

- **PostgreSQL** (Cloud SQL) — declarado en Drizzle (`apps/api/src/db/schema.ts`, 2 159 LOC).
- **34 tablas** + **40+ enums** detectados. Tablas principales:
  `planes, empresas, usuarios, memberships (membresias), organizaciones_stakeholder, vehicles (vehiculos), sucursales_empresa, documentos_vehiculo, documentos_conductor, posiciones_movil_conductor, conductores, zones (zonas), trips (viajes), offers (ofertas), assignments (asignaciones), trip_events (eventos_viaje), trip_metrics (metricas_viaje), stakeholders, consents (consentimientos), stakeholder_access_log, whatsapp_intake_drafts, pending_devices, telemetry_points, green_driving_events, chat_messages, push_subscriptions, membership_tiers, carrier_memberships, liquidaciones, facturas_booster_clp, shipper_credit_decisions, adelantos_carrier, matching_backtest_runs, configuracion_sitio`.
- **38 migraciones** SQL (`0000_initial.sql` → `0028_event_type_conductor_asignado.sql` y siguientes), incluyendo seed de demo (`0024`), pricing v2 (`0015`), factoring (`0017`, `0018`), compliance documentos (`0026`), backtest matching (`0027`).
- Naming bilingüe documentado en `PLAN-PHASE-0.md` y `CLAUDE.md` (TS camelCase inglés ↔ SQL snake_case español).

### 6.2 Otros datastores

- **BigQuery** — telemetría y billing export (`@google-cloud/bigquery` en `telemetry-processor` + `apps/api/observability`).
- **Cloud Storage** — buckets configurados (`CERTIFICATES_BUCKET`, `CHAT_ATTACHMENTS_BUCKET`, `PUBLIC_ASSETS_BUCKET`, retención DTE 6 años).
- **Redis** (Memorystore) — `ioredis` para `apps/api` y `apps/whatsapp-bot` (rate-limit, locks, cache).
- **Cloud KMS** — firma de certificados PDF (`@google-cloud/kms`, ADR-015).
- **IndexedDB** — `idb ^8.0.0` en `apps/web` para PWA offline.

### 6.3 Mensajería / async

- **Pub/Sub** — topics: `chat-messages`, raw telemetry, notifications, cobra-hoy (variables `CHAT_PUBSUB_TOPIC`, etc.). Consumers: `telemetry-processor`, `sms-fallback-gateway`, `notification-service` (placeholder).

### 6.4 Integraciones externas (terceros)

- **Firebase Auth** (`firebase-admin` server, `firebase` client) — IdP universal.
- **Firebase Cloud Messaging (FCM)** — push notifications móvil.
- **Web Push (VAPID)** — push navegador (ADR-016).
- **Twilio** — SMS fallback + WhatsApp legacy (ADR-025, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `CONTENT_SID_*`).
- **WhatsApp Cloud API (Meta)** — canal primario (ADR-006, package `@booster-ai/whatsapp-client`).
- **Google Maps / Routes API** — eco-routing (`@vis.gl/react-google-maps` cliente, `googleapis` server, ADR-014/038).
- **Google Workspace Admin SDK** — observability seat usage (vars `GOOGLE_WORKSPACE_*`).
- **Gemini / Vertex AI** — NLU WhatsApp y coaching (`packages/ai-provider`, `packages/coaching-generator`, ADR-037).
- **Sovos** (DTE provider Chile) — vars `SOVOS_API_KEY`, `SOVOS_BASE_URL` (ADR-024).
- **Teltonika FMS150** — devices Codec8 vía TCP (ADR-005).
- **Cloud Armor** — WAF + DDoS (referencias en networking/security).
- **OpenTelemetry / Cloud Trace** — instrumentación.

---

## 7. Cobertura aproximada de tests

### 7.1 Configuración de gates

- **Vitest workspace** (`vitest.workspace.ts`) descubre `apps/*` y `packages/*`.
- **apps/api/vitest.config.ts**: thresholds `lines 80 / functions 75 / branches 75 / statements 80`. Excluye `main.ts`, `server.ts`, `db/client.ts`, `db/migrator.ts`, `db/schema.ts`, `jobs/**`.
- **apps/web/vitest.config.ts**: mismos thresholds. Excluye rutas platform-admin y `/demo` (cubiertas por E2E Playwright manuales pre-release, ADR-011).
- **CI**: `pnpm ci` = `lint && typecheck && test && build`. README declara coverage 80% bloqueante.

### 7.2 Volumen de tests

- **252 ficheros de tests** TS/TSX (≈50 600 LOC).
- **1 spec Playwright E2E** (`apps/web/e2e/perfil-validacion.spec.ts`) + `fixtures.ts` y workflow `e2e-staging.yml`.

Distribución por workspace:

| Workspace                          | Test files |
| ---------------------------------- | ---------: |
| apps/web                           |        107 |
| apps/api                           |         90 |
| packages/carbon-calculator         |          9 |
| apps/whatsapp-bot                  |          6 |
| packages/shared-schemas            |          5 |
| packages/matching-algorithm        |          5 |
| packages/codec8-parser             |          5 |
| apps/telemetry-tcp-gateway         |          4 |
| apps/telemetry-processor           |          4 |
| packages/whatsapp-client           |          3 |
| packages/pricing-engine            |          2 |
| packages/factoring-engine          |          2 |
| packages/dte-provider              |          2 |
| packages/coaching-generator        |          2 |
| packages/certificate-generator     |          2 |
| apps/sms-fallback-gateway          |          2 |
| packages/notification-fan-out      |          1 |
| packages/driver-scoring            |          1 |

Subdistribución `apps/web`: 40 components, 28 routes, 18 hooks, 11 lib, 6 services, 3 sw/router/main.

### 7.3 Lagunas observables (sin ejecutar la suite)

- **Sin tests detectados** en: `packages/{ai-provider, carta-porte-generator, config, document-indexer, logger, trip-state-machine, ui-components, ui-tokens}` y apps `document-service`, `matching-engine`, `notification-service` (estos tres son placeholders).
- **Una sola spec Playwright** — la suite E2E está prácticamente sin cubrir (ADR-011 reconoce que platform-admin se valida manual).
- Coverage real **no se mide aquí** — sólo se inventaría el setup. Las pasadas siguientes pueden ejecutar `pnpm test:coverage` para snapshot real.

---

## 8. Documentación y proceso

- **41 ADRs** en `docs/adr/` (001..039 con dos duplicados de número intencionales: dos `028-*` y dos `034-*`/`035-*`). Cubren stack, naming, IoT, WhatsApp, SII, multi-rol PWA, RBAC, telemetría dual, pricing v2, factoring, matching v1/v2, GLEC, observatorio urbano, KMS, VAPID, SSE chat, Pub/Sub chat, Workbox PWA, CI/CD, RLS DB access, Vertex AI ADC, runtime settings, RUT auth, voice driver.
- **10 handoffs** fechados bajo `docs/handoff/` (último `2026-05-13-cross-projects-audit.md`).
- **CLAUDE.md** vigente (contrato de trabajo) + **AGENTS.md** (cross-tool) + **AUDIT.md** (auditoría previa 2026-05-01) + **DESIGN.md** + **PLAN-PHASE-0.md**.
- **`skills/`** locales: `adding-cloud-run-service`, `carbon-calculation-glec`, `empty-leg-matching`, `incident-response`, `using-agent-skills`, `writing-adrs`.
- **`docs/runbooks/`, `docs/research/teltonika-fmc150/`, `docs/market-research/`, `docs/transparencia/`, `docs/legal/`** — material complementario.

---

## 9. Estado general

- **Tipo de proyecto**: monorepo TypeScript multi-app (pnpm + Turborepo) — backend Hono, frontend Vite/React PWA, microservicios Cloud Run + un workload GKE Autopilot, IaC Terraform completo sobre GCP `booster-ai-494222`.
- **Estado declarado** (README): greenfield, kick-off **2026-04-23**, sucesor de Booster 2.0 archivado.
- **Edad efectiva**: **21 días** (primer commit `4677ddf` 2026-04-24 → último commit `ce0b508` 2026-05-14).
- **Volumen de actividad**:
  - **389 commits** totales.
  - Commits por mes: `2026-04: 34` · `2026-05: 355` (cadencia ≈25 commits/día desde inicio de mayo, con picos de 74 el 2026-05-10 y 47 el 2026-05-13).
  - Autores: `Felipe Vicencio 209` · `Claude/AI 172` · `dependabot 5` · otros 3 → **~46% commits via agente, ~54% humanos**.
  - **417 referencias de branch** (incluye remotes); fuerte uso de feature branches `feat/*`, `fix/*`, `chore/*`, `claude/*`.
  - **3 tags**: `wave-2-deployed-2026-05-07`, `wave-3-server-ready-2026-05-08`, `pre-audit-2026-05-14`.
- **Madurez por área**:
  - Backend (`apps/api`) — **maduro** (159 endpoints, 90 test files, observabilidad completa).
  - Frontend (`apps/web`) — **maduro pero centrado en unit** (107 test files, 1 spec E2E real, exclusiones por ADR-011).
  - Telemetría IoT — **en producción** (tags wave-2 y wave-3 desplegados, manifests K8s, runbooks Teltonika).
  - Apps placeholder (`document-service`, `matching-engine`, `notification-service`) — sólo `main.ts`; lógica vive en `apps/api` + `packages/*`.
  - Infra Terraform — **completo** (28 ficheros, IAM humana incluida, DR region, Cloud Armor, KMS, monitoring).
- **Higiene de calidad declarada** (no verificada en esta pasada): Biome con `noExplicitAny: error`, coverage gate 80/75, gitleaks pre-commit, conventional commits enforced, husky activo.
- **Riesgos visibles a alto nivel** (para focalizar las pasadas siguientes):
  1. Una sola spec Playwright E2E pese a ser una PWA multi-rol con 41 rutas.
  2. ADRs duplicados de número (028 y 034/035) — posible conflicto de referencia cruzada.
  3. Tres apps placeholder declaradas en README como servicios pero sin código — divergencia entre arquitectura aspiracional y real.
  4. `packages/{ai-provider, carta-porte-generator, trip-state-machine, ui-components, ...}` sin tests visibles pese a coverage gate.
  5. Volumen alto de commits AI (172) sugiere superficie grande para revisar consistencia y deuda introducida por agente.

---

## 10. Salida de comandos clave (evidencia)

```
$ git log --reverse --format='%h %ai %s' | head -1
4677ddf 2026-04-24 01:35:30 -0400 feat(thin-slice): whatsapp intake flow end-to-end

$ git log --format='%h %ai %s' | head -1
ce0b508 2026-05-14 09:17:02 -0400 test(observability): coverage branches a 75% (factory + workspace-admin + error paths)

$ git log --format='%H' | wc -l
389

$ git log --format='%ai %an' --since='2026-04-23' | awk '{print $NF}' | sort | uniq -c | sort -rn
 209 Vicencio
 172 AI
   5 dependabot[bot]
   3 Claude)

$ pnpm-workspace.yaml
- apps/*
- packages/*
- scripts/load-test
```

---

**Fin del inventory.** Próxima pasada: a definir (seguridad / calidad / deuda / performance / a11y). Sin modificaciones al árbol del proyecto.
