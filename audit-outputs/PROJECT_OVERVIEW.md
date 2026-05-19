# PROJECT_OVERVIEW — Booster AI

**Tipo**: Síntesis arquitectónica consolidada (read-only, derivada de los 6 reportes).
**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Branch auditada**: `chore/ci-integration-drift-scripts` @ `5d025f1`
**Fecha**: 2026-05-19

> Síntesis de `01_ARCHITECTURE.md` + secciones operacionalmente relevantes de `02..06`. Para detalle por dimensión leer los reportes individuales bajo `audit-outputs/`.

---

## 1. Identidad del producto y estado de madurez

**Booster AI** es la reescritura greenfield de Booster 2.0 (plataforma B2B logística sostenible) con objetivo **TRL 10** (sistema certificado y listo para despliegue comercial). Stack establecido por `docs/adr/001-stack-selection.md` (v2, 2026-04-23).

| Métrica | Valor empírico |
|---|---|
| Apps totales | **9** (`apps/{api, web, telemetry-tcp-gateway, telemetry-processor, whatsapp-bot, sms-fallback-gateway, document-service, matching-engine, notification-service}`) |
| Apps funcionales | **6** (las 3 últimas son skeletons logger-only) |
| Packages totales | **21** workspaces |
| Packages con código real | **15** + 5 stubs `PACKAGE_NAME`-only + 1 `repo-checks` + 1 `load-test` |
| Archivos `.ts/.tsx` (apps+packages) | **695** (incluye tests) |
| LOC no-test | **~71.860** |
| ADRs vivos | **50** (001..048 + colisiones 028/034/035 documentadas en ADR-046) |
| Specs activos | 6 (`audit-2026-05-14`, `production-readiness`, `s0-housekeeping`, `s1-drift-coverage-e2e`, `stubs-decision`, `tripstate-alignment`) |
| Workflows CI | 4 (`ci`, `security`, `release`, `e2e-staging`) |
| Hallazgos de auditoría | **25 recomendaciones**: 1 P0 + 14 P1 + 10 P2 (ver `06_REFACTOR_PRIORITIES.md`) |

**Estado de adopción del contrato**: `CLAUDE.md` del repo declara vigencia desde el primer commit. Audit confirma adherencia material a 6 de 7 principios rectores; **principio §6 (Observabilidad)** está declarado pero no cableado (P0).

---

## 2. Stack canónico (verificado vs ADR-001)

| Capa | Elección verificada | ADR-001 declara | Match |
|---|---|---|---|
| Runtime | Node `>=22.0.0` (engines) + `.nvmrc=22` | Node.js 22 LTS inalterable | ✓ (drift CI=24 — ver §4) |
| Package mgr | pnpm 9.15.4 | pnpm 9 | ✓ |
| Orchestrator | Turborepo 2.9.8 | Turborepo | ✓ |
| Lenguaje | TypeScript 5.8 strict (`noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) | TS 5.8 exclusivo | ✓ |
| Linter | Biome 1.9.4 (`noExplicitAny=error`, `noConsole=error`) | Biome 1.9 | ✓ |
| Backend framework | **Hono 4** | Hono | ✓ |
| DB | **Cloud SQL PostgreSQL + `pg` driver** | Cloud SQL Postgres | ✓ |
| ORM | **Drizzle** | Drizzle | ✓ |
| pgvector | **NO usado** (única extensión activa: `pgcrypto`) | No reservado a pgvector en ADR-001 | ✓ (asunción blueprint incorrecta) |
| Frontend | React 18.3 + Vite 6.2 + **@tanstack/react-router v1.169** (manual, NO file-based) + Tailwind 4 + Tremor + react-hook-form + zod + zustand + TanStack Query + Firebase + workbox + idb | React + Vite + TS, "TanStack Router file-based" | parcial (router manual vs declarado; `idb` + `zustand` declarados sin usar) |
| PWA | `vite-plugin-pwa` + Workbox `InjectManifest` + SW custom (`apps/web/src/sw.ts`) | ADR-008 PWA multi-rol | ✓ |
| Auth | Firebase Admin SDK (`verifyIdToken` con `checkRevoked`) + Google `google-auth-library` SA-to-SA (RS256/ES256+JWKS) | Zero-Trust JWT-based | ✓ |
| Config secrets | `packages/config` Zod-validated + Secret Manager (prod) + ADC (dev local) | Sin `.env` en repo, GCP Secret Manager | ✓ |
| Testing | vitest 4 + Playwright 1.49 + axe-core | No detallado en ADR-001 | ✓ |
| Linter custom | `scripts/lint-rls.mjs` (Row-Level Security) + `scripts/repo-checks/{drift-inventory, spec-canonical-drift, check-adr-numbering}.mjs` | ADR-043 metodología drift | ✓ |
| Pre-commit | husky 9 + lint-staged + commitlint Conventional Commits + gitleaks + 5 stages (drift gate + spec-canonical) | Cero secrets, conv commits | ✓ |
| CI gate coverage | ≥80%/75%/80% lines/branches/functions | Coverage 80% bloqueante day 0 | ✓ (con caveat: gate by-passable — ver §4) |

**Match agregado**: 13/16 verificado completo · 2/16 parcial (router manual, deps web no usadas) · 1/16 drift activo (Node CI).

**Stack supersedido (NO presente)**: `express`, `prisma`, `eslint`, `prettier`, `react-router-dom`, `next` — todos del Booster 2.0 legacy correctamente ausentes (verificado por `02_DEPENDENCIES.md §7`).

---

## 3. Topología de módulos

### 3.1 Grafo de dependencias internas (DAG limpio, 0 ciclos)

- `apps/api` es el monolito funcional: importa **13 de 21 packages internos** (`shared-schemas`, `logger`, `config`, `matching-algorithm`, `carbon-calculator`, `pricing-engine`, `factoring-engine`, `driver-scoring`, `dte-provider`, `certificate-generator`, `coaching-generator`, `notification-fan-out`, `whatsapp-client`).
- `apps/web` consume solo `shared-schemas` + `ui-tokens` (consistente — no usa `logger` Pino ni `config` server-side).
- Telemetría: `telemetry-tcp-gateway` + `telemetry-processor` comparten `codec8-parser` + base packages.
- WhatsApp: `whatsapp-bot` + `apps/api` consumen `whatsapp-client` (única edge intra-packages: `whatsapp-client → logger`).
- 5 packages stub + 3 apps skeleton no son consumidos por nadie productivo (ADR-048 documenta plan de extracción para las 3 apps).

### 3.2 Pasaje de tipos end-to-end (CLAUDE.md §5)

Domain canónico vive en `packages/shared-schemas/src/domain/` (18 Zod schemas: assignment, cargo-request, driver, empresa, membership, offer, organizacion-stakeholder, plan, stakeholder, telemetry, transportista, trip-event, trip-metrics, trip, user, vehicle, zona-stakeholder, zone). `apps/api/src/db/schema.ts` (2.210 LOC, 35 `pgTable`) mapea estos schemas a SQL con naming bilingüe (TS camelCase ↔ SQL snake_case sin tildes). El alineamiento se enforce via `scripts/repo-checks/drift-inventory.mjs` (T1.1 ADR-043) en pre-commit y CI.

**Estado de alineamiento (ADR-043 + S1a)**: 1 caso resuelto + 1 anotado intentional + 1 diferido a S2 + 0 backlog C + 6 falsos positivos heurística = **0 drift estructural accionable** (`docs/handoff/CURRENT.md`).

### 3.3 Boundaries arquitectónicos detectados

| Regla | Estado |
|---|---|
| "Domain canónico en `packages/shared-schemas/src/domain/`" | ✓ 0 violaciones sintácticas |
| "Algoritmos viven en `packages/`" | ⚠ 1 violación: `haversineKm` en `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75` (R-012 P2) |
| "Carrier/Shipper deprecated → Transportista/GeneradorCarga" | ✓ Aliases legacy en uso correcto (R-011 cleanup futuro) |
| "Stakeholder se mantiene como término" | ✓ |

---

## 4. Hallazgos cross-cutting (que aparecen en ≥2 dimensiones)

Cita: `06_REFACTOR_PRIORITIES.md §Cross-cutting findings`. Los 8 hallazgos transversales son la mejor señal de qué tocar primero.

| Cross-cutting | Dimensiones afectadas | Severidad agregada |
|---|---|---|
| **CC-1** OTel + `pino-http` declarados con 0 imports — viola CLAUDE.md §6 | deps + architecture + tech-debt | **P0** (TRL 10 blocker) |
| **CC-2** Bundle frontend inflado (38 rutas eager, 4 deps muertas, Tremor+Maps+Firebase en initial chunk) | perf + deps | P1 |
| **CC-3** 8 stubs (5 packages + 3 apps) by-passan gate coverage 80% silenciosamente | architecture + tech-debt + ci | P1 |
| **CC-4** Node 22 (ADR-001/`.nvmrc`/engines) vs Node 24 (4 workflows hardcodeados) | architecture + reproducibility | P1 |
| **CC-5** `haversineKm` definido en `apps/api/src/services/` (debería estar en package) | architecture + perf + tech-debt | P2 |
| **CC-6** `CLAUDE.md` describe Terraform inexistente + `apply-plan.tfplan` + `terraform.tfvars.local` en git | architecture + security | P1 |
| **CC-7** Bypass total WAF Cloud Armor para `api.boosterchile.com` | security | P1 |
| **CC-8** `pdf-lib` 4 años sin commits, usado por firma de documentos legales con retención 6 años | deps + compliance | P1 |

---

## 5. Estado de seguridad (resumen de `03_SECURITY_FINDINGS.md`)

**0 P0 · 4 P1 · 6 P2**.

Aspectos confirmados como sólidos:
- **0 secrets en cleartext en código fuente**. Las 2 keys `AIza...` en `cloudbuild.production.yaml:312,326` están allowlisteadas en `.gitleaks.toml` y son públicas-por-diseño (Firebase Web + Maps con HTTP referrer restriction).
- **JWT auth solido**: Firebase `verifyIdToken(token, true)` con `checkRevoked` (`apps/api/src/middleware/firebase-auth.ts:87`) + Google `verifyIdToken` para SA-to-SA con JWKS (RS256/ES256, `apps/api/src/middleware/auth.ts:69`).
- **0 SQL injection vectors**: Drizzle parametrizado + `pg.query($1, $2)`. Los 4 `sql.raw` operan sobre constantes hardcodeadas o SQL migrations cargado de disco — sin user-input path.
- **IAM least-privilege**: runtime SA tiene roles custom narrow, `github-deployer` solo impersona runtime SA (no project-wide), DWD sin keys para Workspace reader (`infrastructure/iam.tf:34-235`).
- **Secret Manager canónico via Terraform** (`infrastructure/security.tf:261-299`) con placeholders `ROTATE_ME_*`.
- **Pino PII auto-redaction** (>30 paths: emails, RUTs, tokens, signatures — `packages/logger/src/redaction.ts`).
- **Twilio webhook HMAC verificado** antes de procesar (`apps/whatsapp-bot/src/routes/webhook.ts:58`).

P1 abiertos: (1) nginx sin security headers (R-006), (2) `/public/tracking/:token` sin rate limit per-token (R-025), (3) Cloud Armor WAF bypass total `api.boosterchile.com` (R-015), (4) CORS `credentials:true` sin uso de cookies (R-024).

---

## 6. Estado de performance (resumen de `04_PERFORMANCE_FINDINGS.md`)

**Backend** — 4 hotspots:
1. **B1.1** N+1 en matching (`apps/api/src/services/matching.ts:180-192`) — patrón batch ya existe en `matching-v2-lookups.ts` (R-007).
2. **B1.2** `SELECT COUNT(*)` por record AVL en telemetry-processor (`apps/telemetry-processor/src/persist.ts:114-119`) — crítico antes de escalar flota (R-008).
3. **B5** Pool `pg` sin `idleTimeoutMillis` ni `statement_timeout` (R-009).
4. **B4** Migrations bloqueantes en cold-start (`apps/api/src/main.ts:31`) — debería ser Cloud Run Job pre-deploy (R-021).

**Frontend** — 4 hotspots:
1. **F1.1** Zero code-splitting: 38 rutas eager + Tremor + Recharts + Maps + Firebase en initial chunk (~400-700KB gzip estimado) — `lazyRouteComponent` no usado (R-002).
2. **F4.1** SW solo cachea Google Fonts, sin runtime caching `/api/*` ni imágenes (R-019).
3. **F2.1** Cero `React.memo` en listas con polling 15-30s (R-020).
4. **F5** Web Vitals afectados por LCP/INP en mobile mid-range (consecuencia de F1.1).

---

## 7. Estado de deuda técnica (resumen de `05_TECH_DEBT_REGISTRY.md`)

**0 P0**. El principio Cero Parches day 0 se respeta materialmente.

| Categoría | Conteo prod | Notas |
|---|---|---|
| `any` explícito | 4 | 3 adaptadores a tipos externos defectuosos (`node-forge`, BigQuery SDK, DOM SpeechRecognition) + 1 interno con `biome-ignore` justificado |
| `@ts-expect-error` | 2 | `apps/web/src/sw.ts` por incompat workbox-expiration ↔ `exactOptionalPropertyTypes:true` |
| Marcadores deferred-debt (incluye `[ T O D O ]`, `[ F I X M E ]`, `[ X X X ]`) | 4 | En 3 servicios skeleton + 1 inline |
| `localhost` en prod | 3 | A revisar — algunos pueden ser legítimos en config staging |
| mocks/stubs/fakes en prod | **0** | |
| `console.*` en prod | 1 | Excepción CLI dev tool documentada |
| `@deprecated` con callsites | **0** | Aliases legacy limpios |
| Comentarios de aplazamiento | ~14 | Paráfrasis en TD8; cumplen disciplina semántica pero rompen trazabilidad operativa (R-023) |
| Drift vocabulary en commits 30 días | **0** | 446 commits revisados, historial Conventional Commits limpio |

---

## 8. CI/CD y supply chain

### 8.1 Workflows GitHub Actions

- `ci.yml`: setup → lint (Biome + format) → typecheck → test+coverage gate → drift-checks → build → ci-success.
- `security.yml`: gitleaks (full history) + `pnpm audit --audit-level=high --prod` + CodeQL `security-and-quality` + Trivy fs/config SARIF + CycloneDX SBOM via `@cyclonedx/cdxgen`.
- `release.yml`: Changesets PR/publish + WIF deploy (sin SA keys) → `cloudbuild.production.yaml` → smoke test `/health` 3-retry.
- `e2e-staging.yml`: Playwright + axe-core nightly + on-PR.

**Hallazgo crítico**: las 4 workflows hardcodean Node 24 mientras `.nvmrc=22` y ADR-001 declara 22 LTS (CC-4 / R-004 P1).

### 8.2 Cloud Build

- `cloudbuild.production.yaml` (15KB): pipeline prod completo.
- `cloudbuild.staging.yaml` + `cloudbuild.merge-job.yaml`: configs presentes.
- `release.yml:84-91` declara que el job `deploy-staging` fue retirado del flujo activo; "infra Terraform sólo crea entorno `prod`". Esto contradice la existencia del cloudbuild staging — staging es **ambiguo** (R-A4 / ADR-052).

### 8.3 Terraform (`infrastructure/`)

- **Flat tree**: 18 archivos `.tf` agrupados por dominio (project, networking, security, iam, compute, monitoring, etc.).
- **3 módulos**: `cloud-run-job`, `cloud-run-service`, `iap-bastion`.
- **Single GCP project**: `booster-ai-494222`.
- **K8s en `infrastructure/k8s/`** (manifests pegados, no Helm/Kustomize) para telemetry-tcp-gateway (primary + DR).
- **Drift vs `CLAUDE.md`**: el contrato describe `main.tf` + `environments/{dev,staging,prod}/` + 5 módulos que no existen (R-013 P1).
- **Estado en git**: `apply-plan.tfplan` (binario) + `terraform.tfvars.local` checked-in (R-014 P1, requiere revisión P0 si contenido sensible).

---

## 9. Documentación, ADRs y trazabilidad

- **50 ADRs** vivos en `docs/adr/`, incluyendo metodología drift (043), microservices extraction strategy (048), colisiones legacy (046), GLEC v3.0 (006), etc.
- **6 specs activos** en `.specs/`; `docs/handoff/CURRENT.md` es el documento vivo del estado.
- **CODEOWNERS** placeholder (`@boosterchile`) — necesita reemplazo por handle real (H-ARCH-09 P3).
- **CLAUDE.md ↔ realidad** drift detectado en infrastructure tree (CC-6).

---

## 10. Resumen de salud por dimensión

| Dimensión | Score subjetivo | Bloqueantes TRL 10 |
|---|:-:|---|
| Estructura y boundaries | **8.5/10** | 1 violación menor (haversine) |
| Stack canónico vs ADR-001 | **9/10** | drift Node CI |
| Seguridad | **8/10** | nginx headers + WAF bypass |
| Performance | **7/10** | bundle frontend + N+1 + COUNT(*) AVL |
| Deuda técnica | **9/10** | 0 P0 estructural |
| Observabilidad | **3/10** | **OTel declarado pero no cableado — P0 single-handedly** |
| CI/CD enforcement | **7/10** | coverage gate by-passable + Node drift |
| Documentación / ADRs | **8/10** | drift CLAUDE.md ↔ infra real |

**Veredicto**: Booster AI está cerca de cumplir TRL 10 estructuralmente, pero **necesita cerrar el gap observable como P0** y completar Sprint 1 (10 quick wins) antes de auditoría externa.

---

## 11. Métodología y limitaciones

- Auditoría **static-only**: ningún app fue ejecutado. Estimaciones de Web Vitals son inferenciales.
- **Pgvector** no fue verificable runtime; el reporte concluye "no usado" por ausencia total de imports + extensión SQL.
- `pnpm audit --json` se ejecutó sobre el snapshot actual del `pnpm-lock.yaml`; resultados pueden cambiar tras nuevos releases de upstream.
- **Subagent context isolated**: cada subagent operó con su propio contexto. Cross-cutting findings fueron sintetizados explícitamente por `refactor-advisor` leyendo los 5 reportes producidos.
- **0 modificaciones a código fuente**. Todas las escrituras quedaron bajo `audit-outputs/` y `.claude/` (config sesión).

Para detalle por sección consultar los reportes individuales y `06_REFACTOR_PRIORITIES.md` (que contiene el roadmap accionable).
