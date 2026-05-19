# 01_ARCHITECTURE — Mapeo arquitectónico read-only (Booster AI)

**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Subagent**: `explore-architecture` (model: haiku)
**Fecha de auditoría**: 2026-05-19
**Branch auditada**: `chore/ci-integration-drift-scripts` (HEAD `5d025f1`)
**Modo**: read-only — no se modificó ningún archivo fuente

---

## 1. Estructura de carpetas

Árbol anotado, máximo 4 niveles por rama. Símbolos:
`A` app productiva · `a` app skeleton (logger-only main.ts) · `P` package con código · `p` package stub (placeholder PACKAGE_NAME) · `D` docs · `I` infra · `S` scripts/tooling · `M` metadata.

```
booster-ai/                                       M  monorepo root
├── CLAUDE.md                                     M  contrato de trabajo agente
├── AGENTS.md                                     M  contrato cross-tool
├── README.md                                     M
├── package.json                                  M  pnpm@9.15.4, node>=22, scripts root
├── pnpm-workspace.yaml                           M  apps/* packages/* scripts/load-test scripts/repo-checks
├── pnpm-lock.yaml                                M  473KB
├── turbo.json                                    M  pipeline build/dev/lint/typecheck/test/test:coverage/test:e2e/db:migrate/clean
├── tsconfig.base.json                            M  strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
├── biome.json                                    M  1.9.4 schema, noExplicitAny=error, noConsole=error
├── commitlint.config.cjs                         M  Conventional Commits + 'security' type
├── vitest.workspace.ts                           M  defineWorkspace([apps/*, packages/*])
├── .nvmrc                                        M  contenido: "22"
├── .gitleaks.toml                                M  allowlist para Firebase web key + GMaps key públicas en cloudbuild.production.yaml
├── .trivyignore                                  M
├── cloudbuild.production.yaml                    I  Cloud Build pipeline prod (15KB)
├── cloudbuild.staging.yaml                       I  Cloud Build pipeline staging (3KB)
├── cloudbuild.merge-job.yaml                     I  Cloud Build job de merge
├── deploy-phase-2.sh                             S  script bash one-off
├── .husky/                                       M
│   ├── pre-commit                                M  gitleaks + lint-staged + ADR numbering + drift-classification gate + spec-canonical-drift
│   └── commit-msg                                M  commitlint --edit
├── .github/                                      M
│   ├── workflows/
│   │   ├── ci.yml                                I  lint + typecheck + test (≥80%/75%/80%) + drift-checks + build
│   │   ├── security.yml                          I  gitleaks + npm audit (HIGH+) + CodeQL + Trivy fs/config + SBOM cyclonedx
│   │   ├── release.yml                           I  Changesets + GCP WIF deploy a prod (manual approval)
│   │   └── e2e-staging.yml                       I  Playwright + axe-core nightly + on-PR si toca apps/web|apps/api
│   ├── dependabot.yml                            M  npm semanal + github-actions semanal + docker por cada app
│   ├── CODEOWNERS                                M  default `@boosterchile` (placeholder)
│   ├── ISSUE_TEMPLATE/                           M  bug_report, feature_request, incident
│   └── pull_request_template.md                  M
│
├── apps/                                         9 apps (vs CLAUDE.md que lista 8: +sms-fallback-gateway)
│   ├── api/                                      A  Hono backend principal — 101 ts/tsx, 26.493 LOC
│   │   ├── src/
│   │   │   ├── main.ts                           A  entrypoint Hono via @hono/node-server
│   │   │   ├── server.ts                         A  factoría del Hono app
│   │   │   ├── config.ts, env.ts                 A  config Zod-validated
│   │   │   ├── db/{client,migrator,schema}.ts    A  Drizzle + pg, schema=2210 LOC
│   │   │   ├── middleware/                       A  auth, firebase-auth, require-platform-admin, user-context
│   │   │   ├── routes/                           A  37 routers Hono (admin-*, auth-*, me-*, cargas, ofertas, etc.)
│   │   │   ├── services/                         A  60+ servicios (matching, eco-route, certificados, cobra-hoy, ...)
│   │   │   ├── jobs/                             A  backfill-certificados, merge-duplicate-users
│   │   │   └── types/                            A
│   │   ├── drizzle/                              A  migrations + meta/_journal.json
│   │   ├── scripts/                              A
│   │   └── test/{unit,integration,load,helpers}/ A
│   ├── web/                                      A  React PWA multi-rol — 231 ts/tsx, 28.185 LOC
│   │   ├── src/
│   │   │   ├── main.tsx                          A  ReactDOM.createRoot + QueryClient + RouterProvider
│   │   │   ├── router.tsx                        A  TanStack Router manual (38+ rutas registradas)
│   │   │   ├── App.tsx, styles.css, sw.ts        A  Service Worker manual (Workbox InjectManifest)
│   │   │   ├── routes/                           A  ~30 páginas (admin, conductor, cargas, ofertas, ...)
│   │   │   ├── components/{auth,chat,cobra-hoy,login,map,observability,offers,onboarding,profile,scoring,voice}/  A
│   │   │   ├── hooks/                            A  ~20 hooks TanStack Query (use-*.ts)
│   │   │   ├── services/                         A
│   │   │   └── lib/                              A  api-client, firebase, rut, polyline, password, freshness
│   │   ├── e2e/                                  A  Playwright specs
│   │   ├── public/                               A  PWA icons + manifest
│   │   └── playwright.config.ts                  A  chromium + mobile-chrome + webkit + mobile-safari
│   ├── telemetry-tcp-gateway/                    A  TCP server Teltonika Codec8 — 5 ts/tsx
│   │   └── src/{main,config,connection-handler,imei-auth,pubsub-publisher}.ts
│   ├── telemetry-processor/                      A  Pub/Sub consumer + persist BQ/SQL/GCS — 6 ts/tsx
│   │   └── src/{main,config,persist,persist-green-driving,persist-crash-trace,crash-trace-adapters}.ts
│   ├── whatsapp-bot/                             A  Hono webhook Meta + xstate FSM — 14 ts/tsx
│   │   └── src/{main,config,routes,services,conversation}/
│   ├── sms-fallback-gateway/                     A  Hono Twilio inbound SMS — 4 ts/tsx
│   │   └── src/{main,config,parser,twilio-signature}.ts
│   ├── document-service/                         a  SKELETON — solo logger.info('starting (skeleton)') + TODO
│   ├── matching-engine/                          a  SKELETON — solo logger.info + TODO
│   └── notification-service/                     a  SKELETON — solo logger.info + TODO
│
├── packages/                                     21 packages workspaces (en pnpm-workspace.yaml: apps/*, packages/*, scripts/load-test, scripts/repo-checks)
│   ├── shared-schemas/                           P  38 archivos · Zod canónico
│   │   └── src/
│   │       ├── domain/                           P  18 Zod schemas dominio (assignment, cargo-request, driver, empresa, membership, offer, organizacion-stakeholder, plan, stakeholder, telemetry, transportista, trip-event, trip-metrics, trip, user, vehicle, zona-stakeholder, zone)
│   │       ├── primitives/{chile,geo,ids}.ts     P
│   │       ├── events/{telemetry,trip}-events.ts P
│   │       ├── aggregations/, avl-ids/           P
│   │       └── {auth,common,onboarding,profile,site-settings,trip-request,trip-request-create,whatsapp}.ts  P
│   ├── carbon-calculator/                        P  13 archivos · GLEC v3.0 + certificación
│   ├── coaching-generator/                       P  10 archivos · live evals
│   ├── ui-tokens/                                P  9 archivos · design tokens
│   ├── certificate-generator/                    P  9 archivos · PDF firmado KMS+signpdf
│   ├── codec8-parser/                            P  8 archivos · parser Teltonika
│   ├── config/                                   P  7 archivos · env Zod schemas
│   ├── matching-algorithm/                       P  6 archivos · src/v2/* multifactor
│   ├── dte-provider/                             P  6 archivos · adapters SII
│   ├── whatsapp-client/                          P  5 archivos · Twilio Content Templates
│   ├── pricing-engine/                           P  4 archivos
│   ├── factoring-engine/                         P  4 archivos
│   ├── logger/                                   P  3 archivos · Pino + redactores PII
│   ├── driver-scoring/                           P  3 archivos
│   ├── notification-fan-out/                     P  1 archivo · formatters puros WhatsApp Content Templates
│   ├── ai-provider/                              p  STUB — export const PACKAGE_NAME = ... // TODO implementar según ADRs
│   ├── trip-state-machine/                       p  STUB
│   ├── carta-porte-generator/                    p  STUB
│   ├── document-indexer/                         p  STUB
│   └── ui-components/                            p  STUB
│
├── infrastructure/                               I  Terraform — flat (NO main.tf, NO environments/)
│   ├── *.tf (18 archivos)                        I  api-cost-guardrails, backend, cloudbuild, compute, crash-traces, data, dr-region, iam, logging-exclusions, messaging, monitoring, networking, org-policies, outputs, project, scheduling, security, storage, telemetry-monitoring, variables, versions, wave-3-tls
│   ├── terraform.tfvars.example                  I
│   ├── terraform.tfvars.local                    I  ¡presente en repo! (revisar P3)
│   ├── apply-plan.tfplan                         I  binario tfplan checked-in (revisar P3)
│   ├── modules/                                  I  cloud-run-job, cloud-run-service, iap-bastion (3 módulos)
│   └── k8s/                                      I  cert-manager-issuers, telemetry-tcp-gateway[-dr].yaml, cloudbuild-dr-{check,deploy}.yaml
│
├── scripts/                                      S
│   ├── repo-checks/                              S  workspace package (@booster-ai/repo-checks)
│   │   ├── drift-inventory.mjs                   S  T1.1 ADR-043 — compara domain Zod ↔ schema Drizzle
│   │   ├── spec-canonical-drift.mjs              S  H-S1a-2 — compara spec markdown ↔ Drizzle pgEnum/Zod
│   │   ├── check-adr-numbering.mjs               S
│   │   └── *.test.mjs                            S
│   ├── load-test/                                S  workspace package · k6 telemetry-gateway.ts
│   ├── db/, sql/                                 S
│   ├── lint-rls.mjs                              S  Row-Level Security linter
│   ├── deploy-telemetry-gateway.sh               S
│   └── smoke-test-wave-3-tls.sh                  S
│
├── docs/                                         D
│   ├── adr/                                      D  50 ADRs (001..048, con colisiones legacy 028/034/035 — ver ADR-046)
│   ├── archive/, audits/, compliance/, demo/     D
│   ├── handoff/                                  D  CURRENT.md (estado vivo)
│   ├── legal/, market-research/, plans/          D
│   ├── research/, runbooks/, specs/              D
│   └── transparencia/                            D
│
├── .specs/                                       M  6 specs (audit-2026-05-14, production-readiness, s0-housekeeping, s1-drift-coverage-e2e, stubs-decision, tripstate-alignment)
├── skills/                                       M  6 skills (adding-cloud-run-service, carbon-calculation-glec, empty-leg-matching, incident-response, using-agent-skills, writing-adrs)
├── agents/                                       M
├── playbooks/, references/, hooks/               M
├── .changeset/                                   M  Changesets config (commit:false, baseBranch:main, access:restricted)
├── .claude/                                      M  agents, commands, ledger (audit working dir)
├── .private/                                     M  out-of-band
├── .playwright-mcp/                              M
├── audit-outputs/                                M  productos de esta auditoría
└── node_modules/                                 M
```

**Volúmenes**: 695 archivos `.ts/.tsx` en `apps + packages` (incluye tests). LOC no-test ≈ 71.860.

---

## 2. Entrypoints y comandos detectados

### Scripts root (`package.json`)

| Script | Comando | Pipeline (turbo si aplica) |
|---|---|---|
| `dev` | `turbo run dev` | persistent, cache=false |
| `build` | `turbo run build` | dependsOn `^build`, outputs `dist/**`, `build/**`, `.next/**` |
| `lint` | `biome check . && pnpm lint:rls` | + linter custom RLS |
| `lint:fix` | `biome check --write .` | |
| `lint:rls` | `node scripts/lint-rls.mjs` | linter custom Row-Level Security |
| `format` / `format:check` | `biome format [--write] .` | |
| `typecheck` | `turbo run typecheck` | `tsc --noEmit` por workspace |
| `test` | `turbo run test` | `vitest run --passWithNoTests` |
| `test:e2e` | `turbo run test:e2e` | Playwright en `apps/web` |
| `test:coverage` | `turbo run test:coverage` | `coverage-v8`, emite `coverage-summary.json` |
| `ci` | `pnpm lint && typecheck && test && build` | gate local |
| `security:scan` | `gitleaks detect ...` | full repo |
| `security:scan-staged` | `gitleaks protect --staged` | pre-commit |
| `prepare` | `husky` | post-install |

### Entrypoints por app

| App | Entrypoint | Runtime / framework | Build |
|---|---|---|---|
| `api` | `src/main.ts` | Hono 4 + `@hono/node-server` | `tsup` |
| `web` | `src/main.tsx` | React 18 + Vite 6 + TanStack Router | `vite build` |
| `telemetry-tcp-gateway` | `src/main.ts` | Node `net` server custom TCP (Codec8) | `tsup` |
| `telemetry-processor` | `src/main.ts` | Pub/Sub subscriber | `tsup src/main.ts --format esm --clean` |
| `whatsapp-bot` | `src/main.ts` | Hono + xstate 5 | `tsup` |
| `sms-fallback-gateway` | `src/main.ts` | Hono webhook Twilio | `tsup` |
| `document-service` | `src/main.ts` | SKELETON (solo logger) | `tsup` |
| `matching-engine` | `src/main.ts` | SKELETON | `tsup` |
| `notification-service` | `src/main.ts` | SKELETON | `tsup` |

**Frontend mount + routing**: `apps/web/src/main.tsx:25-29` monta `RouterProvider` envuelto en `QueryClientProvider`. El router (`apps/web/src/router.tsx`) **NO** usa file-based routing automático — registra cada ruta manualmente importándola desde `./routes/<name>.js`. Hay **`@tanstack/router-plugin` instalado** como devDep pero el routing efectivo es manual. **38+ rutas registradas** (admin-*, conductor-*, cargas, ofertas, public-tracking, stakeholder-*, etc.).

### Scripts por app (relevantes)

- `apps/api`: `test:integration:lint` (ESLint custom para tests integration), `test:integration` (vitest con config separada), `load-test:smoke` (k6 sobre `test/load/smoke.k6.js`).
- `apps/api/scripts/check-no-concurrent-in-integration.mjs`: ESLint custom para forzar tests integration secuenciales.
- `apps/telemetry-tcp-gateway`: `smoke-test` (`tsx scripts/smoke-test.ts`).
- `apps/web`: `test:e2e` (Playwright 4 proyectos: chromium, mobile-chrome, webkit, mobile-safari).
- `packages/coaching-generator`: `eval:live` (`tsx scripts/run-live-evals.ts`) — evaluación de LLMs.

---

## 3. Módulos y dependencias internas

### Tabla cruzada apps × packages

Marcado `X` si la app declara `"@booster-ai/<pkg>": "workspace:*"` en `dependencies` (productivas, no dev).

| Package \\ App | api | web | telemetry-tcp-gateway | telemetry-processor | whatsapp-bot | sms-fallback-gateway | document-service | matching-engine | notification-service |
|---|---|---|---|---|---|---|---|---|---|
| shared-schemas | X | X | X | X | X | X | X | X | X |
| logger | X | — | X | X | X | X | X | X | X |
| config | X | — | X | X | X | X | X | X | X |
| ui-tokens | — | X | — | — | — | — | — | — | — |
| ui-components (stub) | — | — | — | — | — | — | — | — | — |
| ai-provider (stub) | — | — | — | — | — | — | — | — | — |
| trip-state-machine (stub) | — | — | — | — | — | — | — | — | — |
| carta-porte-generator (stub) | — | — | — | — | — | — | — | — | — |
| document-indexer (stub) | — | — | — | — | — | — | — | — | — |
| codec8-parser | — | — | X | X | — | — | — | — | — |
| matching-algorithm | X | — | — | — | — | — | — | — | — |
| carbon-calculator | X | — | — | — | — | — | — | — | — |
| pricing-engine | X | — | — | — | — | — | — | — | — |
| factoring-engine | X | — | — | — | — | — | — | — | — |
| driver-scoring | X | — | — | — | — | — | — | — | — |
| dte-provider | X | — | — | — | — | — | — | — | — |
| certificate-generator | X | — | — | — | — | — | — | — | — |
| coaching-generator | X | — | — | — | — | — | — | — | — |
| notification-fan-out | X | — | — | — | — | — | — | — | — |
| whatsapp-client | X | — | — | — | X | — | — | — | — |

**Edges intra-packages**:

- `whatsapp-client → logger` (única dependencia interna entre packages)
- Todos los demás packages: **0 dependencias internas**. Cada package es hoja del grafo.

**Dependencias circulares**: 0 detectadas. Metodología: inspección de `dependencies/devDependencies` con prefijo `@booster-ai/` en los 30 `package.json` del workspace + búsqueda `from '../../apps/'` en `packages/` (0 matches). Grafo es DAG.

**Observaciones de acoplamiento**:

- `apps/api` consume **13** packages internos (alto fan-in hacia api). Es el monolito funcional.
- `apps/web` consume **2** packages (shared-schemas + ui-tokens). No usa `ui-components` (stub).
- Las 3 apps skeleton (`document-service`, `matching-engine`, `notification-service`) declaran las mismas 3 deps (`config`, `logger`, `shared-schemas`) sin codificar nada — son scaffolding para extracción futura desde `apps/api`. ADR-048 (microservices-extraction-strategy) documenta este patrón.
- `notification-fan-out` declara en su comentario de cabecera el rationale: "los formatters puros viven acá; la orquestación DB vive en `apps/api/src/services/notify-offer.ts` que importa de acá. Esto evita el círculo package → app sin sacrificar tipado fuerte de Drizzle." Diseño consciente del límite app↔package.

---

## 4. Tooling de calidad activo

### Versiones detectadas (root `package.json`)

| Tool | Versión declarada | Notas |
|---|---|---|
| Node | `>=22.0.0` (engines) | `.nvmrc=22`. CI/CD usa **24** (drift, ver §6). |
| pnpm | `9.15.4` (packageManager) | engines `>=9.0.0` |
| Turborepo | `^2.9.8` | |
| TypeScript | `^5.8.2` | strict máximo en `tsconfig.base.json` |
| Biome | `^1.9.4` | `noExplicitAny=error`, `noConsole=error` (allow warn/error), `useImportType=error`, `useNodejsImportProtocol=error`, `useSortedClasses` (nursery, warn) |
| Husky | `^9.1.7` | `prepare: husky` |
| lint-staged | `^15.4.3` | `biome check --write` sobre staged ts/tsx/js/jsx/json/md |
| commitlint | `^19.6.1` | Conventional Commits + tipo extra `security` |
| Changesets | `^2.27.11` | `baseBranch:main`, `access:restricted`, `commit:false`, `updateInternalDependencies:patch` |

### Hooks Husky

- `pre-commit` (`.husky/pre-commit`): cinco etapas en orden:
  1. `gitleaks protect --staged` (bloqueante; warning si binario no instalado localmente).
  2. `npx lint-staged` → `biome check --write --no-errors-on-unmatched`.
  3. `node scripts/repo-checks/check-adr-numbering.mjs --allow-legacy 028,034,035` (colisiones documentadas en ADR-046).
  4. Si hay archivos staged en `packages/shared-schemas/src/domain/`, bloquea si `.specs/s1-drift-coverage-e2e/inventory-classification.md` tiene `gate: PENDING_PO`.
  5. Si hay archivos staged en `.specs/**.md`, `docs/**.md`, `apps/api/src/db/schema.ts`, o `packages/shared-schemas/src/domain/*.ts`: `node scripts/repo-checks/spec-canonical-drift.mjs --quiet`.
- `commit-msg`: `npx --no-install commitlint --edit`.

### Pipeline turbo

- `globalDependencies`: `.env`, `tsconfig.base.json`, `biome.json` (cualquier cambio invalida cache global).
- `globalEnv`: `NODE_ENV`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`.
- `build`, `typecheck`, `test`, `test:coverage` declaran `dependsOn: ['^build']` (asegura builds upstream).
- `test:e2e` y `dev` y `db:migrate` tienen `cache: false`.

### Vitest

- Workspace declarativo en `vitest.workspace.ts` con `defineWorkspace(['apps/*', 'packages/*'])`.
- Cada workspace puede tener su `vitest.config.ts` propio (api: integration adicional con `vitest.integration.config.ts`).
- Coverage threshold: definido **en CI**, no en `vitest.config.ts` global (ver `.github/workflows/ci.yml:14-17`).

### Playwright

- Único en `apps/web/playwright.config.ts`. 4 proyectos: chromium · mobile-chrome (Pixel 5) · webkit · mobile-safari (iPhone 13). `retries:2` en CI, `forbidOnly`, reporter `html+json+github`. Trace+screenshot+video `retain-on-failure`.

### Gitleaks

- `.gitleaks.toml`: hereda default + allowlist explícita para `cloudbuild.production.yaml` (Firebase Web Key + Google Maps Key son **públicas por diseño** — protegidas por Firebase Security Rules + HTTP referrer restriction).

### Coverage gates (CI)

- `COVERAGE_MIN_LINES=80`, `COVERAGE_MIN_BRANCHES=75`, `COVERAGE_MIN_FUNCTIONS=80`. Evaluación en script inline del job `test` que recorre todos los `coverage-summary.json` y falla si alguno está por debajo.

---

## 5. CI/CD presente

### GitHub Actions workflows (`.github/workflows/`)

| Workflow | Trigger | Jobs |
|---|---|---|
| `ci.yml` | push main + PR a main | setup → lint (Biome+format:check) → typecheck → test+coverage gate → drift-checks (drift-inventory + spec-canonical-drift) → build → ci-success final gate |
| `security.yml` | push main + PR a main + cron `0 3 * * 1` + manual | gitleaks (history full depth) · pnpm audit `--audit-level=high --prod` · CodeQL `javascript-typescript` query suite `security-and-quality` · Trivy fs+config SARIF upload · CycloneDX SBOM con `@cyclonedx/cdxgen` (no `cyclonedx-npm` por incompatibilidad con `workspace:*`) |
| `release.yml` | push main | Changesets PR/publish · deploy-production via `google-github-actions/auth@v2` (Workload Identity Federation, sin SA keys) → `gcloud builds submit --config=cloudbuild.production.yaml --region=southamerica-west1 --substitutions=_COMMIT_SHA=...` · smoke test 3-retry sobre `/health` |
| `e2e-staging.yml` | cron nightly + manual + PR si toca `apps/web/**\|apps/api/**` | Playwright + axe-core a11y · upload reports + a11y-violations |

### Cloud Build configs (root)

- `cloudbuild.production.yaml` (15KB): pipeline prod, contiene Firebase Web API Key + Maps Key inline (allowlisted en gitleaks).
- `cloudbuild.staging.yaml`: pipeline staging.
- `cloudbuild.merge-job.yaml`: job custom merge.
- `infrastructure/k8s/cloudbuild-dr-{check,deploy}.yaml`: pipelines DR region.

### Infraestructura Terraform

- `infrastructure/` es **flat** (sin `main.tf` ni `environments/{dev,staging,prod}/` como afirma `CLAUDE.md`). 18 archivos `.tf` separados por dominio:
  - Core: `project.tf`, `backend.tf`, `data.tf`, `versions.tf`, `variables.tf`, `outputs.tf`.
  - Compute/Run: `compute.tf`, `cloudbuild.tf`, `scheduling.tf`, `dr-region.tf`.
  - Network/Sec: `networking.tf`, `security.tf`, `iam.tf`, `org-policies.tf`.
  - Data/Msg: `storage.tf`, `messaging.tf`.
  - Observability/Cost: `monitoring.tf`, `logging-exclusions.tf`, `api-cost-guardrails.tf`, `telemetry-monitoring.tf`.
  - Feature-specific: `crash-traces.tf`, `wave-3-tls.tf`.
- Módulos: `cloud-run-job`, `cloud-run-service`, `iap-bastion` (3 vs los 5 declarados por CLAUDE.md: faltan `gke-telemetry`, `pubsub-topic`, `firestore`, `secret`).
- **K8s** (workload de telemetría TCP): `infrastructure/k8s/` con manifests pegados (no Helm/Kustomize) — primario `telemetry-tcp-gateway.yaml`, DR `telemetry-tcp-gateway-dr.yaml` + cert-manager.
- Single GCP project: `booster-ai-494222`. Job `deploy-staging` removido por nota en `release.yml:84-91`: "Un staging real requiere un segundo GCP project con infra paralela (backlog #STAGING-ENV)." Esto **contradice** la presencia de `cloudbuild.staging.yaml`.

### Dependabot

- `npm` semanal con grouping inteligente (typescript-ecosystem, testing, hono, drizzle, react, biome, opentelemetry). Majors ignorados (PR separado manual).
- `github-actions` semanal.
- `docker` semanal por cada una de 8 apps (omite `sms-fallback-gateway` y `apps/api/Dockerfile` solo si existe).

---

## 6. Boundaries y violaciones detectadas

### 6.1 Boundary: domain canónico en `packages/shared-schemas/src/domain/`

**Regla CLAUDE.md**: "Toda tabla Drizzle debe coincidir con un schema del domain."

**Estado**: `packages/shared-schemas/src/domain/` contiene 18 archivos Zod (no Drizzle). `apps/api/src/db/schema.ts` contiene 35 `pgTable(...)` definitions. Existen drift scripts (`scripts/repo-checks/drift-inventory.mjs`) activos en pre-commit y CI que enforzan la alineación documentada en ADR-043.

**0 violaciones detectadas** por inspección sintáctica directa en esta auditoría. Metodología: el agente verificó (i) `shared-schemas` no define `pgTable` (`grep -rEn "pgTable" packages/shared-schemas/`: 0 matches); (ii) `db/schema.ts` importa solamente `import type { SiteConfig } from '@booster-ai/shared-schemas';` (línea 1); (iii) los 35 `pgTable` mapean a nombres SQL en español snake_case (validado por sampling: `apps/api/src/db/schema.ts:438` `plans = pgTable('planes', ...)`, `:1806` `membershipTiers = pgTable('membership_tiers', ...)`, `:2128` `configuracionSitio = pgTable('configuracion_sitio', ...)`). Validación profunda de equivalencia Drizzle↔Zod queda delegada al script `drift-inventory.mjs` (out of scope de este subagent — el subagent de schemas la cubrirá).

### 6.2 Boundary: algoritmos en `packages/`

**Regla CLAUDE.md**: "Algoritmos viven en `packages/`. `apps/api/src/services/` orquesta DB/transacciones; las funciones puras (scoring, formatters, builders) viven en el package correspondiente. Prohibido escribir lógica de matching o cálculo de carbono inline en services."

**Hallazgos**:

- **OK — emisiones**: `apps/api/src/services/eco-route-preview.ts:4` y `apps/api/src/services/calcular-metricas-viaje.ts:6` importan `calcularEmisionesViaje` desde `@booster-ai/carbon-calculator` (no la implementan inline). Coincide con el patrón.
- **OK — matching v2**: `apps/api/src/services/matching.ts` importa de `@booster-ai/matching-algorithm` (líneas 2-13). `matching-v2-lookups.ts` y `matching-v2-weights.ts` en `apps/api/src/services/` son orquestadores de DB que delegan al package.
- **VIOLACIÓN P2 — haversine duplicado y exportado desde un service**: `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75` define **e exporta** `export function haversineKm(...)` — pura función matemática. Importada después por:
  - `apps/api/src/services/actualizar-factor-matching.ts:6`
  - `apps/api/src/services/get-public-tracking.ts:33`

  Es un algoritmo puro (Math.sin/cos/atan2/sqrt) que debería vivir en `packages/matching-algorithm/` o un nuevo `packages/geo-utils/`. No aparece duplicado en `packages/` (grep `haversine` en `packages/`: 0 matches), pero la regla explícita prohíbe escribir algoritmos en `services/`. **Boundary leak**: cualquier app fuera de `apps/api` que necesite haversine tendría que importar desde `apps/api/src/services/...`, lo que rompe el monorepo.

  Cita: `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75`.

### 6.3 Boundary: cero deuda técnica (CLAUDE.md Principio 1)

- **`any` en producción**:
  - `apps/api/src/db/migrator.ts:115` — `db: any` con `// biome-ignore lint/suspicious/noExplicitAny: drizzle types` (excepción justificada y permitida).
  - 4 ocurrencias en `apps/web/src/components/profile/TwoFactorSection.test.tsx:73,123,138,151` — son tests (`*.test.tsx`), permitido por override Biome (`biome.json:130-139`).
  - **Total**: 0 violaciones reales. La regla `noExplicitAny=error` se respeta.
- **`console.*` en producción**:
  - `packages/coaching-generator/src/evals/runner.ts:119` — **en comentario** (`/* ...console.log o write a file...*/`), no es código ejecutable. 0 violaciones reales.
- **Secretos en repo**: No se detectaron en este pase (delegado a subagent de seguridad). `.gitleaks.toml` explicita allowlist para Firebase/Maps web keys.
- **Tests por feature**: gate de coverage 80%/75%/80% se ejecuta en CI (`ci.yml`). Threshold no está en `vitest.config` global → si una app no emite `coverage-summary.json` (porque no corrió tests), el bucle `for f in $(find ...)` puede dar 0 archivos y "pasar" trivialmente. **Hallazgo P3** del gate de coverage para subagent CI.
- **Infra manual**: `infrastructure/apply-plan.tfplan` (binario tfplan) y `infrastructure/terraform.tfvars.local` están **checked-in al repo** (visibles en `git ls-files` indirecto vía `find`). Posible filtración de valores locales. **Hallazgo P2** — derivado a subagent de seguridad para clasificar contenido.

### 6.4 Boundary: stub packages (CLAUDE.md prohíbe "features sin tests" + AGENTS.md "Estándar profesional")

**5 packages stub** + **3 apps skeleton** = 8 placeholders productivos sin implementación, todos importables en el workspace y reportados como nodos del grafo de deps:

| Stub | Tipo | Status |
|---|---|---|
| `packages/ai-provider` | package | export PACKAGE_NAME + TODO según ADRs |
| `packages/trip-state-machine` | package | placeholder · ADR-004 (state machine) lo referencia |
| `packages/carta-porte-generator` | package | placeholder · ADR-007 lo referencia |
| `packages/document-indexer` | package | placeholder · ADR-007 lo referencia |
| `packages/ui-components` | package | placeholder · ADR-008 lo referencia, web NO lo usa |
| `apps/document-service` | app | logger.info('starting (skeleton)') |
| `apps/matching-engine` | app | logger.info('starting (skeleton)') |
| `apps/notification-service` | app | logger.info('starting (skeleton)') |

Estos paquetes pasan `typecheck` y `test --passWithNoTests` trivialmente, contribuyendo a falsos verdes en CI. La `.specs/stubs-decision/` existe → hay una spec activa para resolver. ADR-048 (microservices-extraction-strategy) documenta el plan de extracción de las 3 apps skeleton desde `apps/api`. **Hallazgo P2** transversal.

### 6.5 Otras observaciones de boundary

- **`apps/web` no consume `@booster-ai/logger`**: usa `apps/web/src/lib/logger.ts` propio (browser-side). Consistente: Pino no aplica directo al browser.
- **`apps/web` no consume `@booster-ai/config`**: usa `apps/web/src/lib/env.ts`. Consistente: la app web no debería leer envs server-side.
- **TanStack Router file-based**: el plugin está instalado pero no se usa. Routing es manual (`apps/web/src/router.tsx`). ADR-008 dice "file-based routing type-safe"; práctica actual difiere. **Hallazgo P3** para subagent frontend.

---

## 7. Hallazgos transversales

Observaciones que otros subagents deberían tomar como input.

### H-ARCH-01 (P1) — Drift Node version: `.nvmrc=22` vs CI=24

- `.nvmrc` contiene literalmente `22\n`. `package.json` engines: `"node": ">=22.0.0"`. ADR-001: "Node.js 22 LTS, inalterable sin nuevo ADR que lo supersede".
- Workflows GitHub Actions hardcodean **Node 24**:
  - `.github/workflows/ci.yml:18` `NODE_VERSION: '24'` (afecta 6 jobs).
  - `.github/workflows/security.yml:57,150` `node-version: '24'`.
  - `.github/workflows/release.yml:21` `NODE_VERSION: '24'`.
  - `.github/workflows/e2e-staging.yml:34` `node-version: '24'`.
- **Impacto**: Dev local corre Node 22 (LTS), CI corre Node 24 (Current). Comportamiento puede diverger en runtime APIs y CI puede dar falso verde para issues que aparecerán en Cloud Run (que con `engines: >=22` puede correr cualquier major ≥22 dependiendo del runtime image). Falta ADR que justifique cambio o corrección de los workflows.
- **Acción sugerida**: subagent CI/CD debe priorizarlo; reconciliar a 22 (alineado a ADR-001) o crear ADR que supersede.

### H-ARCH-02 (P1) — Estructura Terraform NO coincide con `CLAUDE.md`

- `CLAUDE.md:74-90` declara:
  ```
  infrastructure/
  ├── main.tf
  ├── modules/{gke-telemetry, cloud-run-service, pubsub-topic, firestore, secret}/
  └── environments/{dev, staging, prod}/
  ```
- Realidad:
  - **No existe `infrastructure/main.tf`**.
  - **No existen `environments/dev/staging/prod/`**.
  - Módulos: `cloud-run-job`, `cloud-run-service`, `iap-bastion` (3, no 5). Faltan `gke-telemetry`, `pubsub-topic`, `firestore`, `secret`.
  - Estructura efectiva: 18 `.tf` planos en raíz de `infrastructure/`.
- **Impacto**: `CLAUDE.md` es el contrato del agente; si describe un estado falso, el agente puede tomar decisiones equivocadas (ej. asumir multi-env Terraform cuando es single-project). Esto afecta a todos los subagents subsiguientes.
- **Acción sugerida**: subagent docs/observability debe proponer PR para alinear `CLAUDE.md` o reestructurar Terraform.

### H-ARCH-03 (P1) — 8 stubs productivos sin enforcement de "skeleton banner" en CI

- 5 packages stub + 3 apps skeleton (ver §6.4). Hacen tests `--passWithNoTests` y typecheck trivial. Cualquier `pnpm test` reporta verde sin que estos paquetes tengan implementación, contradiciendo Principio 1 ("Sin features sin tests").
- ADR-048 (microservices-extraction-strategy) documenta el plan para las 3 apps skeleton. Para los 5 packages stub no se halló ADR ni spec activa que fije fecha de implementación (revisado: `.specs/stubs-decision/` existe pero el contenido es out-of-scope del subagent).
- **Acción sugerida**: subagent specs debe leer `.specs/stubs-decision/` y reportar gate decision; subagent CI debe considerar añadir check que falla si un package exporta solo `PACKAGE_NAME` y nada más.

### H-ARCH-04 (P2) — Algoritmo `haversineKm` en `apps/api/src/services/`

- `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75`. Re-importado por dos servicios más. Es algoritmo puro sin acceso a DB, debería vivir en un package.
- **Acción sugerida**: subagent boundaries puede confirmar; refactor candidate hacia `packages/matching-algorithm/src/geo/haversine.ts` o nuevo `packages/geo-utils/`.

### H-ARCH-05 (P2) — Estado `staging` ambiguo

- `cloudbuild.staging.yaml` existe en root y `apps/web/playwright.config.ts` referencia `vars.STAGING_URL` desde `e2e-staging.yml`.
- `release.yml:84-91` declara explícito: "el job deploy-staging se removió temporalmente. La infra Terraform sólo crea el entorno `prod`."
- **Acción sugerida**: subagent CI/CD debe clarificar si staging existe como entorno deployable o solo como configuración latente.

### H-ARCH-06 (P2) — Binarios/state Terraform en git

- `infrastructure/apply-plan.tfplan` (tfplan binario): puede contener nombres de recursos, IPs, ARNs.
- `infrastructure/terraform.tfvars.local`: nombre sugiere overrides locales — posibles credenciales o IDs sensibles.
- `infrastructure/.terraform/terraform.tfstate` (estado parcial local): podría tener outputs reales.
- **Acción sugerida**: subagent seguridad debe inspeccionar contenido y reportar P0/P1 si hay valores sensibles; default `.gitignore` debería excluir `*.tfplan`, `*.tfstate*`, `*.tfvars.local`.

### H-ARCH-07 (P3) — Coverage gate puede ser no-op silencioso

- En `.github/workflows/ci.yml:106-126`, el chequeo de coverage hace `find . -name coverage-summary.json` y itera. Si un package no genera el archivo (porque `--passWithNoTests` y no hay tests), no es evaluado. La regla "≥80% bloqueante desde el primer PR" puede romperse sin que CI lo note.
- **Acción sugerida**: subagent CI/CD revisar; el chequeo debería listar el set esperado de workspaces y fallar si alguno NO emitió summary.

### H-ARCH-08 (P3) — TanStack Router manual vs file-based declarado en ADR-008

- ADR-001 (sección Frontend [v2]) y ADR-008 declaran "TanStack Router · File-based routing type-safe". Realidad: `apps/web/src/router.tsx` importa cada ruta manualmente (38+ líneas de imports). El plugin `@tanstack/router-plugin` está instalado pero no genera el route tree.
- **Acción sugerida**: subagent frontend debe verificar si fue decisión deliberada (escapar boilerplate, ergonomía) o drift no documentado.

### H-ARCH-09 (P3) — CODEOWNERS placeholder

- `.github/CODEOWNERS:21` usa `@boosterchile` como handle placeholder ("IMPORTANTE: reemplazar `@boosterchile` abajo con tu username real..."). Si el handle no existe en GitHub, las reglas de protección de branch dependientes de CODEOWNERS no aplican.
- **Acción sugerida**: subagent governance (si aplica) o CI debe verificar via `gh api`.

### H-ARCH-10 (P3) — `.specs/audit-2026-05-14/` existe en repo

- Hay un spec previo de auditoría con fecha `2026-05-14`. Esta auditoría podría compararse/diferenciarse de ella. Out of scope del subagent arquitectura — anotado para el orquestador.

---

## Resumen ejecutivo

- **Apps reales**: 6 funcionales (api, web, telemetry-tcp-gateway, telemetry-processor, whatsapp-bot, sms-fallback-gateway) + 3 skeletons logger-only.
- **Packages reales**: 15 con implementación + 5 stubs placeholder `PACKAGE_NAME`-only + 1 workspace especial (`scripts/repo-checks`) + 1 (`scripts/load-test`).
- **Grafo de deps**: DAG limpio, sin ciclos. `apps/api` es el monolito que importa 13/21 packages. `apps/web` consume solo `shared-schemas + ui-tokens`. Una única edge intra-packages: `whatsapp-client → logger`.
- **CI/CD**: 4 workflows (ci, security, release, e2e-staging) + 3 Cloud Build pipelines (production, staging, merge-job) + Terraform flat + K8s yamls manuales para DR telemetry.
- **Hallazgos críticos**: 3 P1 (Node 22↔24 drift, Terraform tree drift vs CLAUDE.md, 8 stubs sin enforcement) + 3 P2 (haversine fuera de package, staging ambiguo, binarios Terraform en git) + 4 P3 (coverage gate no-op silencioso, router manual vs file-based, CODEOWNERS placeholder, audit-2026-05-14 spec previa).

**Metodología**: lectura directa de 30 `package.json`, 4 workflows, 18 `.tf`, ADR-001 + ADR-043 + ADR-048, scripts repo-checks, y muestreo de `apps/api/src/{db/schema,services,routes}/` y `apps/web/src/{router,routes,components}/`. Solo lectura; ningún archivo fuente fue modificado.
