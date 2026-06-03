# Inventario ADR-vs-realidad-de-prod

**Estado**: Iniciado 2026-05-29 con el hallazgo #1 (proceso de deploy). Barrido empírico ADR-por-ADR **en ejecución** (directiva PO): ADR-001, 002, 004, 005, 006, 007 verificados al 2026-06-02; cursor en **ADR-008** (ver §Cursor de progreso). Cada afirmación material se cruza contra evidencia verificada de prod (gcloud read-only) + repo.

**Propósito**: cazar afirmaciones del sistema sobre sí mismo que no se sostienen contra prod. Gatillado porque esta sesión encontró 4 desfases narrativa-vs-realidad; el #4 (deploy) es de proceso y el más grave. Disciplina: evidencia-sobre-narrativa dirigida hacia adentro. Cada fila: afirmación (fuente) → realidad verificada → estado 🟢/🟡/🔴 → método de verificación.

---

## Finding #1 — Proceso de deploy: "staging auto + prod manual approval" — 🔴 ROJO

### Afirmación (narrativa)

- **CLAUDE.md §Deploy**: *"Staging automático vía Cloud Build trigger en merge a `main`. Producción: manual approval en Cloud Build. Monitoreo 2h post-deploy."*
- **`.github/workflows/release.yml:59,66-73`** (comentarios): *"Deploy production — manual approval requerida"* + `environment: name: production # Requires manual approval via GitHub Environments`.

### Realidad verificada (2026-05-29)

**Ningún staging existe, y merge→`main` despliega a PROD sin gate de aprobación humana, con verificación de canary que es no-op.**

1. **No existe entorno staging.** `gcloud run services list` en `southamerica-west1`/`us-central1`/`us-east1`: solo servicios prod (`booster-ai-api`, `-web`, `-whatsapp-bot`, `-matching-engine`, `-notification-service`, `-telemetry-processor`, `-document-service`, `-sms-fallback-gateway`). **No hay `booster-ai-api-staging` ni ningún `*-staging`.**
2. **El job `deploy-staging` fue removido.** `release.yml:61-64` (comentario): el job deploy-staging se quitó; la infra Terraform sólo crea el entorno `prod`; un staging real requiere un segundo GCP project (backlog #STAGING-ENV); hasta entonces el flujo declarado es "CI verde → approval → prod". El `cloudbuild.staging.yaml` existe pero **nada lo invoca** (ningún workflow lo referencia; `e2e-staging.yml` apunta a "ambiente real con data real").
3. **Merge→`main` ejecuta `release.yml` → job `deploy-production` → `gcloud builds submit cloudbuild.production.yaml`** apuntando a prod (`booster-ai-api`, `_REGION=southamerica-west1`, `PRODUCTION_URL`/`api.boosterchile.com`). No hay Cloud Build trigger nativo (`gcloud builds triggers list` vacío); el disparo es vía GitHub Actions WIF.
4. **El "manual approval" NO está enforced.** `gh api repos/boosterchile/booster-ai/environments` → environment `production` tiene **`protection_rules: 1`, tipo `branch_policy` únicamente — CERO `required_reviewers`.** El `environment: production` solo restringe la rama de origen, no exige revisor humano. Por eso el build arrancó ~1 min post-merge sin que nadie aprobara.
5. **El canary lane no protege con verificación automática.** `cloudbuild.production.yaml`: `deploy-canary` (`--no-traffic`) → `route-canary` (`--to-tags=…=1` → **1% del tráfico prod**) → `canary-sleep` (`sleep 1800` = **30 min**) → `canary-verify` → `deploy-api` (`--to-latest` = **100%**). **`canary-verify` (líneas 255-272) es un placeholder que siempre `exit 0`** ("real MQL check pendiente"). La única cobertura real durante el canary es el synthetic monitor `signup_probe` (cada 60s) + alert policy → page → decisión humana de rollback (no automática).

**Neto**: cualquier merge a `main` — incluido un typo de docs o un bump de dependencia — auto-despliega a producción vía canary (1% → 30 min → 100%) **sin gate de aprobación humana** y con un `canary-verify` que no valida nada. Lo opuesto a lo que afirma CLAUDE.md.

### Evidencia de esta sesión

- Merge de PR-1 #398 (squash `afdb933`, 2026-05-29 18:39:52Z) disparó el build de prod **`5906a5b6`** en `southamerica-west1` a las 18:40 (canary pipeline completo). **Cancelado en 0/26 steps** (nada desplegado; prod intacto) para honrar la instrucción PO "prod la apruebo yo".
- `gh run list --workflow=release.yml` → run `26655471595` (sha `afdb933`) `deploy-production` corrió **sin pausa de approval** y quedó `conclusion: failure` solo porque cancelé el Cloud Build que había submiteado.

### Método de verificación (reproducible)

| Sub-finding | Comando / archivo |
|---|---|
| No staging service | `gcloud run services list --project=booster-ai-494222 --region=<R>` (3 regiones) |
| deploy-staging removido | `.github/workflows/release.yml:61-64` |
| merge→prod via release.yml | `.github/workflows/release.yml:7-9,66-95` + build `5906a5b6` substitutions |
| Sin required_reviewers | `gh api repos/boosterchile/booster-ai/environments` → `production.protection_rules` |
| canary-verify no-op | `cloudbuild.production.yaml:229-272` (`exit 0` placeholder) |

### Impacto / riesgo

- **Proceso**: no hay barrera humana entre un merge y producción. Un merge accidental o un PR no revisado a fondo llega a prod automáticamente.
- **Verificación**: el gate de calidad del canary (`canary-verify`) es ficticio; la promoción a 100% ocurre tras 30 min pase lo que pase en las métricas (salvo que un humano vea la alerta `signup_probe` y haga rollback manual).
- **Para este hotfix**: el fix (gate, flag OFF) está mergeado en `main` pero **NO desplegado** — el vector sigue abierto en prod. Desplegarlo requiere correr el pipeline de prod, decisión + momento que define el PO (probablemente canary observado, no viernes tarde; aplica regla CLAUDE.md "no deploy prod viernes 16:00+ sin waiver").

### Acciones candidatas (NO ejecutar sin decisión PO — fuera del scope de este hallazgo)

- Configurar `required_reviewers` en el GitHub Environment `production` (enforce real del approval que la narrativa ya promete).
- Implementar el check MQL real en `canary-verify` (que hoy es `exit 0`), o gatear la promoción a 100% en una señal real.
- Resolver #STAGING-ENV (segundo GCP project) o documentar honestamente que el flujo es prod-canary directo y ajustar CLAUDE.md.
- Decidir reconciliación: o se hace cumplir la narrativa (approval + staging), o se corrige CLAUDE.md para reflejar la realidad. (Decisión PO.)

---

## Barrido ADR 001→050 (orden estricto, verificación empírica)

Iniciado 2026-05-29. Leyenda: 🟢 VERDE (verificado vivo) · 🟡 AMBAR (parcial / no verificable read-only este pase) · 🔴 ROJO (afirmado pero no real).

### ADR-001 — Selección del stack (Accepted v2)

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| Runtime Node 22, pnpm 9, Turborepo, TS 5.8, Biome, Hono 4, Drizzle, Pino, OTel, Zod, Vitest | `package.json`: `packageManager pnpm@9.15.4`, `engines node>=22`; `.nvmrc=22`; deps `hono ^4.12.18`, `drizzle-orm ^0.45.2`, `@opentelemetry/* `, `vitest ^4`, `biome.json` presente | 🟢 trivial | `node -e require(package.json)` + grep deps + `cat .nvmrc` | bajo |
| CI/GCP vía **Workload Identity Federation, NUNCA SA JSON keys** (lección SEC-2026-04-01) | `release.yml:80` usa `workload_identity_provider`; sin `credentials_json`/`service_account_key`. **0 SA JSON keys en el repo** | 🟢 | `grep release.yml` + `grep -rl '"private_key"\|"type":"service_account"' --include=*.json` → vacío | alto |
| Secretos en **Secret Manager** (único repositorio auditado) | `database-url`, `demo-account-password-*` viven en Secret Manager (leídos en sesión) | 🟢 | `gcloud secrets list` + `secrets versions access` | alto |
| Server-to-server **OAuth/OIDC, no API keys** | `/trip-requests/*` usa `createAuthMiddleware` (verifica `aud` + `allowedCallerSa`) — SA-OIDC, no API key | 🟢 | `apps/api/src/middleware/auth.ts` (Finding pipeline §audit) | alto |
| 8 apps en **Cloud Run** (api, web, matching-engine, telemetry-processor, notification-service, whatsapp-bot, document-service) | Cloud Run lista 8 servicios: los 7 + `sms-fallback-gateway` (añadido post-ADR vía incidente SMS) | 🟢 | `gcloud run services list` | medio |
| **GKE Autopilot** para telemetry-tcp-gateway | Clusters `booster-ai-telemetry` (sa-west1, RUNNING) + `booster-ai-telemetry-dr` (us-central1, RUNNING) | 🟢 (modo Autopilot específico no re-confirmado) | `gcloud container clusters list` | medio |
| **Cloud SQL PostgreSQL 16** | `booster-ai-pg-07d9e939` `POSTGRES_16` RUNNABLE | 🟢 | `gcloud sql instances list` | medio |
| **Memorystore Redis 7** | `booster-ai-redis` `REDIS_7_2` READY | 🟢 | `gcloud redis instances list` | medio |
| **Pub/Sub** topics (telemetry/trip/whatsapp-inbound/notification/vehicle-availability-events) | Los 5 presentes + ~9 más (document-events, crash-traces, eco-score, dead-letter, etc.) | 🟢 | `gcloud pubsub topics list` | bajo |
| Object Storage con CMEK + **Retention Lock**, retención **6 años** (DTE, SII Chile) | `documents-prod`: CMEK ✓ (`documents-cmek`), público bloqueado ✓, retención `189216000s = 6.0y` ✓, **pero `retention_policy.isLocked = false`** → retención **NO inmutable** (un admin con `storage.buckets.update` puede acortarla/borrarla). `crash-traces-prod`: 7y, también sin lock. | 🔴 | `gcloud storage buckets describe gs://booster-ai-494222-documents-prod --format="value(retention_policy.isLocked,retention_policy.retentionPeriod,default_kms_key)"` | **medio** (compliance SII; insider con permiso storage.update; NO explotable externo). Trackeado: `.specs/sec-h3-dte-retention-lock/` (Draft) + `infrastructure/storage.tf:145` comentario "CAMBIAR A true MANUALMENTE". |
| Firestore (hot sync) + BigQuery (cold analytics) desplegados | NO verificado este pase (`gcloud bigquery` no es comando; Firestore no consultado) | 🟡 | pendiente: `bq ls` + `gcloud firestore databases list` | bajo |

**Resumen ADR-001**: 8 🟢 · 1 🟡 · 1 🔴 (retention-lock, medio, ya trackeado en H3 Draft).

### ADR-002 — Adopción framework Agent Skills (**Superseded by ADR-049**)

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| ADR superseded por ADR-049; el skill-framework local (`skills/`, `.claude/commands/`, `.claude/agents/`, `hooks/`) fue **eliminado del repo** y reemplazado por plugins (agent-rigor + booster-skills) | Repo (main): **0 archivos trackeados** en `skills/`, `.claude/agents/`, `.claude/skills/`; `.claude/commands` y `hooks/` ausentes. (Existen localmente pero **gitignored** = cruft/cache de plugin, fuera del repo.) `.claude/settings.json` declara `agent-rigor` + `booster-skills`; `agents/` tiene los 3 overrides (code-reviewer, security-auditor, sre-oncall) | 🟢 | `git ls-files skills/ .claude/agents/ .claude/skills/` → 0; `git status --porcelain` → vacío; `grep settings.json`; `ls agents/` | bajo (meta-proceso; supersesión real en el repo) |

**Resumen ADR-002**: 1 🟢 (supersesión verificada en el repo).

### ADR-004 — Modelo Uber-like con 5 roles y matching carrier-based (Accepted v2)

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| Packages `trip-state-machine`, `matching-algorithm`, `pricing-engine`, `notification-fan-out` | Las 4 carpetas existen en `packages/` | 🟢 (existencia) | `ls packages/<pkg>` | bajo |
| Apps `matching-engine`, `notification-service` (Cloud Run) | Existen en repo (`apps/`) + servicios `booster-ai-matching-engine`, `-notification-service` vivos en Cloud Run sa-west1 | 🟢 | `ls apps/` + `gcloud run services list` | medio |
| Trip lifecycle como **máquina de estados XState** en `packages/trip-state-machine` (validation checklist: "El trip lifecycle es una máquina XState con transiciones verificables") | **`packages/trip-state-machine/src/index.ts` = stub de 7 líneas** (`TODO: implementar según ADRs relacionados`; export `PACKAGE_NAME`). **Cero XState** (`dependencies: {}`, 0 refs en src). La lógica de transiciones SÍ existe pero **dispersa inline en `apps/api/src/services/`** (`liquidar-trip.ts`, `asignar-conductor-a-assignment.ts`, `confirmar-entrega-viaje.ts`, `offer-actions.ts`, `reportar-incidente.ts`…) + `packages/shared-schemas/src/domain/trip.ts`/`trip-event.ts` | 🔴 | `wc -l + cat packages/trip-state-machine/src/index.ts`; `grep xstate` → 0; `grep -rlE 'offered_to_carrier\|driver_assigned\|...' apps packages` | **medio** (no es agujero de seguridad; es deuda arquitectónica + narrativa-vs-realidad: el package prometido es placeholder y la lógica vive inline en services, lo que **viola la regla de arquitectura de CLAUDE.md** "prohibido escribir lógica … inline en services" y el anti-patrón "flags ad-hoc en BD" que el propio ADR-004 dijo evitar). No externo. |
| Eventos de trip → Pub/Sub topic `trip-events` | Topic `trip-events` vivo en prod; publicado/consumido desde múltiples services (`trip-requests-v2.ts`, `confirmar-entrega-viaje.ts`, `emitir-certificado-viaje.ts`…) | 🟢 | `gcloud pubsub topics list` + `grep -rl trip-events apps` | bajo |
| 4 roles con UI diferenciada en `apps/web`; multi-rol (carrier unipersonal); matching ofrece a carriers no a drivers; tablas `SustainabilityStakeholder` + `ConsentGrant` + `stakeholder_access_log` | No verificado conductualmente este pase (read-only; requeriría ejercitar UI + inspección de schema/queries) | 🟡 | pendiente: revisar `apps/web` rutas por rol + `packages/shared-schemas/src/domain` stakeholder/consent | medio |

**Resumen ADR-004**: 2 🟢 + 1 🟢(existencia) · 1 🟡 · **1 🔴** (trip-state-machine stub + lógica inline; medio, deuda arquitectónica no-externa).

### ADR-005 — Telemetría IoT a escala (Accepted v2)

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| `apps/telemetry-tcp-gateway` (GKE Autopilot) + `apps/telemetry-processor` (Cloud Run) + `packages/codec8-parser` | Las 3 carpetas existen; `booster-ai-telemetry-processor` vivo en Cloud Run; clusters GKE `booster-ai-telemetry` + `-dr` RUNNING (verificado ADR-001) | 🟢 (modo Autopilot específico no re-confirmado) | `ls apps/ packages/` + `gcloud run/container` | medio |
| Pub/Sub `telemetry-events` (+ DLQ `telemetry-events-dlq`) | `telemetry-events` vivo + 4 topics derivados (`-safety-p0`, `-security-p1`, `-trip-transitions`, `-eco-score`). **DLQ con nombre `telemetry-events-dlq` NO existe**; hay un `pubsub-dead-letter` genérico compartido | 🟡 | `gcloud pubsub topics list` | bajo (DLQ existe, nombre difiere del ADR) |
| **Firestore** modo Native, región `southamerica-east1` (cierra 🟡 de ADR-001) | `projects/booster-ai-494222/databases/(default)` = `FIRESTORE_NATIVE`, `southamerica-east1`. **Match exacto** | 🟢 | `gcloud firestore databases list` | bajo |
| **BigQuery** dataset `booster_telemetry` tabla `events` particionada por día (cierra 🟡 de ADR-001) | BigQuery desplegado: datasets `telemetry`, `esg_analytics`, `matching`, `audit`, `billing_export`, `observatory`. **Dataset existe pero se llama `telemetry`, no `booster_telemetry`** (partición/tabla `events` no inspeccionada este pase) | 🟢 (con nota de naming) | `bq ls` | bajo |
| Redis `vehicle:{id}:position` TTL 5min (last-known position O(1)) | `booster-ai-redis` `REDIS_7_2` READY (ADR-001); comportamiento de la key/TTL no ejercitado read-only | 🟡 | `gcloud redis instances list` (infra) | bajo |
| ETA vía **Routes API v2 OAuth ADC, no API key** | Diferido a **ADR-038** (Routes API ADC migration) — se verifica allí | 🟡 | pendiente ADR-038 | medio |

**Resumen ADR-005**: 3 🟢 (1 con nota naming) · 3 🟡 (DLQ naming, Redis TTL conductual, Routes API → ADR-038). **Cierra los 2 🟡 de ADR-001** (Firestore + BigQuery ahora verificados desplegados).

### ADR-006 — WhatsApp Business Meta Cloud API como canal primario (Accepted)

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| `apps/whatsapp-bot` (Cloud Run webhook) + `packages/whatsapp-client` + NLU vía `packages/ai-provider` (Gemini) | Carpetas existen; `booster-ai-whatsapp-bot` vivo en Cloud Run sa-west1 | 🟢 | `ls apps/ packages/` + `gcloud run services list` | medio |
| Pub/Sub topic `whatsapp-inbound-events` | Topic vivo en prod | 🟢 | `gcloud pubsub topics list` | bajo |
| Secret Manager: `whatsapp-app-secret`, `whatsapp-access-token`, `whatsapp-phone-number-id`, `whatsapp-business-account-id` | Los 4 existen **+ extra** `whatsapp-webhook-verify-token` | 🟢 | `gcloud secrets list` | alto |
| Meta Cloud API **directo, sin Twilio/intermediarios** | No re-verificado aquí; existe `booster-ai-sms-fallback-gateway` + MCP Twilio conectada (canal SMS distinto). La migración Twilio→Meta se decide en **ADR-025** — verificar allí | 🟡 | pendiente ADR-025 | medio |
| Cloud Armor rate+geo (solo IPs Meta) · Cloud Scheduler rotación token · HMAC signature verify · NLU intents | No verificado conductualmente read-only este pase | 🟡 | pendiente: revisar `infrastructure/*.tf` (armor/scheduler) + `apps/whatsapp-bot` (HMAC) | medio |

**Resumen ADR-006**: 3 🟢 · 2 🟡 (Twilio→Meta vía ADR-025; armor/scheduler/HMAC/NLU conductual). Sin 🔴.

### ADR-007 — Gestión documental obligatoria Chile (DTE/SII) (Accepted)

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| `apps/document-service` + `packages/dte-provider`, `carta-porte-generator`, `document-indexer` | Carpetas existen; `booster-ai-document-service` vivo en Cloud Run sa-west1 | 🟢 | `ls apps/ packages/` + `gcloud run services list` | medio |
| Pub/Sub `document-events` + bucket `documents-prod` con **CMEK** | `document-events` vivo; bucket con `default_kms_key = …/booster-ai-keyring/cryptoKeys/documents-cmek` ✓; keyring `booster-ai-keyring` existe | 🟢 | `gcloud pubsub topics list` + `gcloud storage buckets describe` + `gcloud kms keyrings list` | alto |
| **Object Retention Lock de 6 años "no se puede eliminar ni siquiera por admin hasta expiración"** (ADR-007 §Retención, línea 189) | Bucket: `retentionPeriod = 189216000s = 6.0y` ✓ **pero `isLocked` vacío (= false)**. La promesa textual de inmutabilidad anti-admin es **falsa**: un principal con `storage.buckets.update` puede acortar/quitar la política. **Mismo 🔴 que ADR-001, re-confirmado con la afirmación más explícita.** | 🔴 | `gcloud storage buckets describe gs://…-documents-prod --format="value(retention_policy.isLocked,...)"` → isLocked vacío | **medio** (compliance SII; insider con storage.update; NO externo). Trackeado `.specs/sec-h3-dte-retention-lock/` (Draft) + `infrastructure/storage.tf` comentario "CAMBIAR A true MANUALMENTE". |
| Provider DTE: **Bsale recomendado** ("decisión final pendiente de benchmarking") | Superseded por **ADR-024** (Sovos + multi-vendor). Verificar provider real allí | 🟡 | pendiente ADR-024 | medio |
| Tabla `documents` (Postgres) · `document_events` (BigQuery) · Document AI Expense Parser · Cloud Function on-upload OCR | No verificado este pase (read-only; requiere inspección schema/Document AI processors/Functions) | 🟡 | pendiente: `gcloud functions list` + `gcloud documentai processors list` + schema | bajo |

**Resumen ADR-007**: 2 🟢 · 2 🟡 (provider→ADR-024; documents/Document AI/Function) · **1 🔴** (retention-lock, mismo de ADR-001/H3, re-confirmado con la afirmación textual más fuerte).

### ADR-008 — PWA Multi-Rol en `apps/web` (Accepted)

> Nota: ADR de **frontend** → verificación mayormente contra el código (no infra). gcloud expiró este pase → deploy no confirmado empíricamente.

| Afirmación material | Realidad verificada | Estado | Método de verificación | Riesgo si falsa |
|---|---|---|---|---|
| **PWA robusta** (vite-plugin-pwa/Workbox + Service Worker + manifest + icons) | `vite-plugin-pwa@0.21.1` + `workbox-*@7.3` en `package.json`; `src/sw.ts` existe; `public/icons/`; manifest generado por VitePWA en `vite.config.ts`. Build muestra "PWA v0.21.2 injectManifest". | 🟢 | `grep vite-plugin-pwa vite.config.ts` + `ls src/sw.ts public/icons` | bajo |
| Frontend consolidado en `apps/web`, **UI por rol** (5: shipper/carrier/driver/admin/stakeholder) | Una sola `apps/web` ✓. La estructura `src/roles/<rol>/` del ADR era **"Boceto"** — la realidad es **file-based router** (`src/routes/` plano: `conductor`, `flota`, `cargas`, `certificados`, `cumplimiento`, `admin-*`, etc.). Intención (UIs por rol) cumplida; layout difiere del sketch. | 🟢 | `ls src/ src/routes/` (no existe `src/roles/`) | bajo |
| **TanStack Router** type-safe | `@tanstack/react-router@1.169.2` + `src/router.tsx`. | 🟢 | `grep @tanstack/react-router package.json` | bajo |
| Design system: `packages/ui-tokens` + `packages/ui-components` | Ambos packages existen. | 🟢 | `ls packages/ui-tokens packages/ui-components` | bajo |
| **A11y axe-core automatizado en E2E** ("fail si hay violaciones WCAG AA", Tests §) | `@axe-core/playwright@4.11.3` declarado como devDep **pero CERO uso** (sin `injectAxe`/`AxeBuilder`/`checkA11y` en `e2e/` ni `src/`). El job CI "Playwright + axe-core (a11y)" **no corre axe** y su único test (`perfil-validacion.spec.ts`) **se skipea sin `E2E_USER_*`**. Validación a11y automatizada **efectivamente inexistente**. | 🟡 | `grep -rE "injectAxe\|AxeBuilder\|@axe-core" e2e/ src/` → solo la línea del package.json | bajo (gap de validación, no externo). Cross-ref sesión 2026-06-03 (fix e2e webkit). Validación §300-309 son checkboxes `[ ]` sin marcar (aspiracional). |
| **Web Push (VAPID)** vía `notification-service` | Cliente **parcial** existe (`src/lib/web-push.js` + `PushSubscribeBanner.tsx`, con guard "Server sin VAPID → suprimir banner"). Pero `apps/notification-service/src/main.ts` es **skeleton** (`"...starting (skeleton)"` + `TODO: implementar`). Backend de envío push **no implementado**. | 🟡 | `grep web-push/VAPID src/` + `head notification-service/src/main.ts` | bajo (feature no go-live-critical per ADR) |
| Desplegado en prod (Cloud Run web) | **Confirmado vivo** (post reauth gcloud 2026-06-03): `booster-ai-web` en `southamerica-west1` → `https://booster-ai-web-wbfevjot4q-tl.a.run.app`. | 🟢 | `gcloud run services list` | bajo |

**Resumen ADR-008**: 5 🟢 (PWA stack + router + design system + UI por rol + deploy web vivo) · 2 🟡 (axe-core declarado sin integrar; web-push backend skeleton). **Sin 🔴** — gaps narrativa-vs-realidad de bajo riesgo, ninguno externo/explotable.

### ADR-009 — Análisis Competitivo y Diferenciadores (Accepted)

> Nota: ADR **estratégico**. Datos de competidores (Tennders/Uber Freight/CargaRápido/Camiongo), mercado, GTM, volúmenes y posicionamiento **no son verificables contra prod** (fuera de scope del inventario). Lo que SÍ se verifica: la columna "Booster AI (propuesta)" reafirma **capacidades de producto como diferenciadores** → cruce narrativa-vs-realidad.

| Diferenciador afirmado | Realidad verificada | Estado | Método | Riesgo si falsa |
|---|---|---|---|---|
| Trip lifecycle **"18 estados XState + Firestore real-time"** (matriz, línea 21) | `packages/trip-state-machine/src/index.ts` = **stub de 7 líneas, SIN XState** (`grep xstate/createMachine` → nada). Lógica de estados dispersa inline en services (per ADR-004). Firestore real-time sí existe (ADR-005). **"18 estados XState" es falso.** | 🔴 | `wc -l` + `grep -rE "xstate\|createMachine" packages/trip-state-machine/src` | **medio** — re-confirma 🔴 ADR-004, pero acá es **claim externo** (diferenciador competitivo / pitch CORFO-inversores). No explotable; es exposición narrativa. |
| **Matching push automático** (Uber-like) | `packages/matching-algorithm` **real** (330 LOC: scoring, distance, factor-matching, v2/). Algoritmo existe. "Push real-time al carrier" (wiring) no verificado este pase. | 🟢 | `wc -l` + `grep score/distance` | bajo |
| **Carbono GLEC v3.0 + GHG Protocol + ISO 14064 certificable** | `packages/carbon-calculator` **real** (419 LOC, refs GLEC/GHG/CO2/emission). Calculadora implementada, no stub. Certificación auditable end-to-end no auditada a fondo este pase. | 🟢 | `wc -l` + `grep glec/ghg/co2` | bajo |
| **Teltonika Codec8 nativo** | Verificado en ADR-005 (codec8-parser + telemetry-tcp-gateway/processor vivos). "Escalable 10K+" no probado. | 🟢 | cross-ref ADR-005 | bajo |
| **Certificados ESG: PDF firmado KMS + hash SHA-256 + retention 6 años** | KMS keyring `booster-ai-keyring` + CMEK ✓ (ADR-007); retention 6y ✓ **pero `isLocked=false`** (🔴 retention-lock, cross-ref ADR-001/007). Firma PDF + hash no verificados a fondo. | 🟡 | cross-ref ADR-007 | medio (compliance; ya trackeado en H3) |
| **DTE SII + Carta Porte Ley 18.290 nativa** | `document-service` + packages existen (ADR-007 🟢 existencia); provider real → ADR-024. | 🟢 | cross-ref ADR-007 | bajo |
| **Sustainability Stakeholder (5to rol) consent-based scope + audit trail** | Rol presente en rutas (`certificados`, `cumplimiento`). Consent-scope + audit trail no verificados a fondo este pase. | 🟡 | `ls src/routes` | bajo |
| Observatorio urbano + gemelos digitales | Diferido a **ADR-012**. | 🟡 | pendiente ADR-012 | bajo |

**Resumen ADR-009**: estrategia (mayoría fuera de scope). De las capacidades-diferenciador: 4 🟢 (matching, carbono, telemetría, DTE — packages reales) · 3 🟡 (certificados/retention→H3; stakeholder scope; observatorio→ADR-012) · **1 🔴** ("18 estados XState" — falso, re-confirma ADR-004 pero como **claim externo de pitch**, mayor exposición narrativa).

### Barrido ADR-010 → ADR-025 (2026-06-03, 5 agentes paralelos read-only + spot-check de 🔴)

> Verificación contra código + gcloud read-only (proyecto `booster-ai-494222`). Los 🔴 materiales (ADR-020, ADR-022, stubs) fueron spot-checked manualmente. Patrón dominante del tramo: **el núcleo técnico implementado coincide bien con sus ADRs (013-019, 021, 023); los gaps están en ADRs de producto/comercial aspiracional (010-012) y en componentes "a construir" (024-025), más 2 drifts graves de plataforma/factor (020, 022).**

**ADR-010 — Landing comercial boosterchile.com** · **0🟢 · 1🟡 · 4🔴**
100% aspiracional: **no existe** `apps/marketing` (cero deps Next.js), ni `packages/payment-provider` (Flow.cl/Stripe), ni `packages/mdx-content`, ni Cloud Run service `marketing`. Signup comercial autoservicio por rol no existe (el real es onboarding gated por aprobación admin). 🟡: el dominio `boosterchile.com` resuelve (34.36.187.195, misma GCLB que app./www.) pero apunta a la infra existente, no a una landing separada. Status=Accepted no refleja que nada se construyó.

**ADR-011 — Panel admin (rol Admin)** · **1🟢 · 1🟡 · 7🔴**
🟢 la decisión núcleo "admin dentro de `apps/web`" (rutas `platform-admin*` reales). 🔴 casi todos los módulos/features específicos: path real `/app/platform-admin/*` (no `/admin/*`); **no existen** impersonation, broadcasts, tabla `audit_log`, command palette (Cmd+K), package `admin-sdk`. Config NO en Firestore sino Postgres `configuracion_sitio` (superseded por ADR-039). Solo subset de módulos (matching, observability, signup-requests, site-settings, cobra-hoy).

**ADR-012 — Observatorio Urbano + Gemelos Digitales + Eco-Routing** · **0🟢 · 1🟡 · 5🔴**
Roadmap puro (el ADR lo marca fases Q3'26-Q3'27, pero Status=Accepted). **No existe** `apps/eco-routing-service`, ni `apps/digital-twin-simulator` (cero `.py` en repo), ni los 4 packages (traffic-condition-detector, route-alternatives-evaluator, urban-observatory-queries, digital-twin), ni tabla `route_suggestions`, ni rutas `observatory/*`. 🟡 lo único tangible: `services/eco-route-preview.ts` (feature distinta: preview de huella pre-aceptación, no eco-routing real-time) + `stakeholder-zonas.tsx` (skeleton autodeclarado con data mock, piloto Coquimbo).

**ADR-013 — Acceso a DB en 3 capas** · **5🟢 · 0🟡 · 2🔴**
🟢 Cloud SQL `ipv4_enabled=false` (privada), IAM auth `on`, módulos `cloud-run-job` + `iap-bastion` reales, jobs `merge-duplicate-users`/`backfill-certificados`. 🔴 **drift de self-reporting**: el ADR dice "bastion escrito pero NO instanciado" y "connect.sh pendiente IAP" — pero **ambos YA están hechos** (`db-bastion` RUNNING en prod sa-west1-a; `connect.sh` con flujo IAP completo). Decisiones correctas; estado stale.

**ADR-014 — API Key Google Maps (Web PWA)** · **7🟢 · 0🟡 · 0🔴** — Totalmente verificado. Key `eb016256` con referrer `app.boosterchile.com/*` (33 apiTargets), código usa `VITE_GOOGLE_MAPS_API_KEY` vía `@vis.gl/react-google-maps` + fallback, inyectada por cloudbuild. (cross-ref hilo gitleaks: esta es la Maps key verificada.)

**ADR-015 — KMS RSA PKCS#1 4096-SHA256 certificados carbono** · **9🟢 · 0🟡 · 1🔴**
🟢 end-to-end: key `ASYMMETRIC_SIGN`/`RSA_SIGN_PKCS1_4096_SHA256` live en `booster-ai-keyring`, separada de `document-signing` (SHA512), IAM least-privilege, wrapper `firmar-kms.ts` con CRC32C, endpoint público `/verify`. 🔴 sólo cita de línea errónea (endpoint en `routes/certificates.ts:162`, no `server.ts:251-262`). Drift "RSA-PSS" en comentarios ya reconocido como follow-up #8 del ADR.

**ADR-016 — Web Push W3C/VAPID** · **10🟢 · 3🟡 · 0🔴**
🟢 funcional y desplegado: lib `web-push` (no FCM SDK), endpoint `POST /me/push-subscription`, tabla `push_subscriptions`, handlers SW push/notificationclick, VAPID en Secret Manager (2 versiones c/u) + env vars en Cloud Run api. **El path corre 100% en `apps/api`, NO en notification-service skeleton** (el cross-ref no aplica). 🟡 line-refs de schema obsoletas + ruta `/webpush/vapid-public-key` (no `/push/`).

**ADR-017 — SSE para chat realtime** · **4🟢 · 3🟡 · 0🔴**
🟢 núcleo real: endpoint `streamSSE` Hono `GET /assignments/:id/messages/stream`, auth Firebase vía `?auth=`, cliente `use-chat-stream.ts` con backoff exp. 🟡: heartbeat 25s (ADR dice 15s), label UI "En vivo" (no "Conectado"), **redacción del token `auth=` en query no garantizada** (el propio ADR lo marca "⏳ verificar" — vale seguimiento).

**ADR-018 — Pub/Sub chat-messages + subs efímeras** · **7🟢 · 0🟡 · 0🔴**
🟢 verificado en código + **live en prod**: topic `chat-messages` (retención 3600s), `publishChatMessage` fire-and-forget, subs efímeras `chat-sse-{id}-{uuid8}` (filter server-side, TTL 24h, cleanup onAbort), env `CHAT_PUBSUB_TOPIC=chat-messages`, DLQ `pubsub-dead-letter` existe.

**ADR-019 — Workbox v7 + vite-plugin-pwa injectManifest** · **8🟢 · 0🟡 · 0🔴** — Verificado literalmente (cross-ref ADR-008): `strategies:'injectManifest'`, workbox 7.3 (6 pkgs), `src/sw.ts` con precache+runtime caching, skipWaiting/clientsClaim, manifest inline.

**ADR-020 — CI/CD GitLab.com runners** · **1🟢 · 0🟡 · 5🔴** · 🔴🔴 **DRIFT MÁS GRAVE DEL TRAMO**
El ADR afirma textual *"el repo se migró de GitHub a GitLab (`boosterchile-group/booster-ai`) en mayo 2026"* + *"Supersedes: GitHub Actions quedó inerte"* + pipeline en `.gitlab-ci.yml`. **REALIDAD: `origin = github.com/boosterchile/booster-ai`, NO existe `.gitlab-ci.yml`, y el CI corre 100% en GitHub Actions** (`.github/workflows/*` activos — verificado toda la sesión, incl. PR #401). La migración a GitLab **nunca ocurrió o se revirtió sin ADR que lo supersede**. 🟢 sólo el deploy Cloud Run + WIF (mencionado como fuera de scope). **Riesgo: medio** (no externo; confunde onboarding/operación — un dev seguiría instrucciones de un CI inexistente). **Candidato a ADR superseding urgente.**

**ADR-021 — GLEC v3.0 + empty backhaul** · **7🟢 · 1🟡 · 0🔴**
🟢 factores SEC-Chile-2024 coinciden bit-a-bit (diesel TTW 2.70/WTT 0.55/**WTW 3.25**, gasolina/glp/gnc/eléctrico/H₂, híbridos 70%), calibración α LDV/MDV/HDV, módulo `glec/empty-backhaul.ts` real, `versionGlec='v3.0'`. 🟡 "44 tests" desactualizado (hoy 69).

**ADR-022 — Metodología emisiones + factor WTW diesel B5** · **1🟢 · 2🟡 · 5🔴**
🔴 **el factor central 3.21 es FALSO**: el código computa **3.25** (2.70+0.55) y **ADR-021 también dice 3.25** → ADR-022 contradice al código Y al ADR hermano en el número que ambos pretenden gobernar. 🔴 además: ajuste B5 −0.5% no implementado; `methodology_version` semver para emisiones no existe (solo en pricing/factoring); `precision_method` está en `metricas_viaje` (no `trip_requests`); `is_backhaul_optimized` (regla anti-greenwashing) **no existe**. 🟢 sólo los 3 modos (`exacto_canbus`/`modelado`/`por_defecto`). **Riesgo: medio** (precisión de certificados de carbono auditables).

**ADR-023 — Matching v1 greedy capacity-scoring** · **8🟢 · 2🟡 · 0🔴**
🟢 coincide bit-a-bit: scoring `max(0,1−slackRatio·0.1)`, MAX_OFFERS=5/TTL=60, flujo greedy/online en tx (zona→activa→best-fit vehículo `ORDER BY capacityKg ASC LIMIT 1`), tiebreak `localeCompare`, `scoreToInt` [0,1000], backhaul factor separado (no llamado desde runMatching). v2 existe tras flag (ADR-033), v1 sigue default — consistente. 🟡 conteo tests + matching-engine placeholder.

**ADR-024 — Proveedor SII Sovos + multi-vendor** · **3🟢 · 2🟡 · 2🔴**
🟢 `SovosDteAdapter` real (HTTP+Bearer+mappers) + adapter-pattern `DteEmitter` + decisión Sovos-sobre-Bsale. 🔴 **de 6 adapters declarados solo existen 2** (sovos+mock; bsale/defontana/alanube/edicom no); **`carta-porte-generator` es placeholder de 7 líneas** (Carta Porte Ley 18.290 no implementada). 🟡 `DTE_PROVIDER` no cableado a runtime (`document-service` = skeleton); secrets DTE genéricos (no per-carrier multi-tenant del §4).

**ADR-025 — WhatsApp Twilio→Meta + NLU Gemini** · **4🟢 · 0🟡 · 4🔴**
🟢 el ADR diagnostica bien (estado actual = Twilio); cliente Meta (`graph.facebook.com/v20.0` + verifyMetaSignature) existe; FSM XState `conversationMachine` real; secrets Meta (5) + Twilio provisionados. 🔴 **`ai-provider` es placeholder de 7 líneas** → toda la arquitectura NLU/Gemini es vaporware; no existe feature flag `WHATSAPP_BSP_PROVIDER` (cutover sería code-change, no mecanizado); intents carrier (accept_offer/upload_pod) no implementados; `templates.ts` Meta no existe. Cliente Meta `sendText` existe pero **desconectado del bot** (corre solo Twilio).

### Barrido ADR-026 → ADR-050 (2026-06-03, 6 agentes paralelos read-only + spot-check de 🔴 + colisiones 028/034/035)

> Patrón del tramo: **el backend transaccional implementado es de alta fidelidad** (pricing/factoring/matching-v2/auth/RBAC/site-settings reales, con flags y wiring verificados; varios ADRs **sub-reportan** lo construido). Los gaps están en: (a) surfaces stakeholder no cableadas a runtime (041/042), (b) servicios extraídos = skeletons (048), (c) features device-side no verificables (040, 036), (d) **un 🔴 de contrato** (049 settings.json).

**Cluster pricing/revenue — ADR-026, 027, 029, 030, 031, 032** · foundation **REAL**
🟢 `pricing-engine` (289 LOC src + tests) y `factoring-engine` (305 LOC + tests) son implementaciones puras completas, cableadas a services (`liquidar-trip.ts`, `cobra-hoy.ts`) + endpoints reales. Tablas `membership_tiers`/`carrier_memberships`/`liquidaciones`/`facturas_booster_clp`/`adelantos_carrier`/`shipper_credit_decisions` existen con tiers/tarifas **exactos** (12/9/7/5%, $0/15k/45k/120k; factoring 1.5/2.2/3.0/4.5%). **Estado en prod (gcloud)**: `PRICING_V2_ACTIVATED` y `FACTORING_V1_ACTIVATED` default `true` en prod, pero `DTE_PROVIDER` **default `disabled`** → liquidaciones se calculan/persisten en `lista_para_dte` sin DTE SII real + factoring en "modo demo" (coincide con intención ADR-031/032).
🔴 recurrentes (bajo riesgo): **`packages/billing-engine` NO existe** (su lógica `calcularCobroMembership` vive en `pricing-engine/src/cobro-membership.ts`) — afirmado en ADR-026/027/030. Números de migration en los ADRs **falsos** (reales: `0015_pricing_v2.sql`, `0017_factoring_v1.sql`; los ADR citan 0018/0019/0010/0016 — tablas sí existen). ADR-029 status "Proposed / no implementar" **stale** (ya implementado vía ADR-032). ADR-032: endpoint consent `/me/consent/cobra-hoy-v1` (declarado bloqueante de activación) **no existe** aunque el flag igual queda on.

**Auth/RBAC + data-source — ADR-028(RBAC), ADR-028(dual-source), ADR-035(auth-universal)** · **REAL**, código por delante del ADR
🟢 RBAC: Firebase ID tokens + enum `rol_membresia` (6 roles) + `membresias` (UNIQUE usuario/empresa) + `stakeholders`/`consents` (default-deny, expirable, revocable) + header `X-Empresa-Id`. 🔴 (dirección "ADR sub-reporta"): token revocation (`checkRevoked` activo), `log_acceso_stakeholder`, endpoints `/me/consents` — el ADR los marca pendientes pero **ya están construidos** (más seguro de lo documentado). 🟢 dual-source: `route_data_source`/`coverage_pct`/`certification_level`/`uncertainty_factor` en trip_metrics + `derivarNivelCertificacion` en carbon-calculator. 🟢 auth-universal: `/auth/login-rut` + `clave_numerica_hash` (scrypt) + selector 5 tipos, **detrás de flag `auth_universal_v1_activated` default OFF** (coexiste con email/password legacy). 🟡 recovery WhatsApp OTP: columnas en DB pero endpoints no construidos (ADR lo marca PR4 opcional).

**Matching v2 — ADR-033** · **8🟢+** REAL end-to-end detrás de flag
`scoreCandidateV2` (4 componentes, pesos 0.40/0.35/0.15/0.10 suma=1.0), backhaul derivado de DB real (no gameable), flag `MATCHING_ALGORITHM_V2_ACTIVATED` default `false` (v1 sigue default), backtest service + endpoints admin + tabla. 🟡 docstrings citan `matching-v2.ts` inexistente (wire en `matching.ts`+`matching-v2-lookups.ts`).

**Stakeholder — ADR-034(orgs), ADR-041, ADR-042** · orgs REAL; **geo-agg NO cableada a runtime**
🟢 ADR-034: `organizaciones_stakeholder` separada de `empresas`, CHECK XOR membresía, CRUD admin real. 🔴🔴 **ADR-041/042: schema (`zonas_stakeholder` + `comuna_codes`) + migrations + helpers k-anon puros (`aplicarKAnonymity`, k=5 invariante, fail-closed) son REALES y testeados — PERO ningún endpoint HTTP los consume.** Las garantías de privacidad (k-anon server-side, ventana 30d, filtro comuna, gate `insufficient_data`) **existen como piezas pero no en runtime**; la surface `/app/stakeholder/zonas` es skeleton con data mock. El gate dataset-level `insufficient_data` (anti bucket-existence leak, ADR-042 §6 nivel 1) **no existe**. Riesgo: las garantías son aspiracionales en prod (aunque al no haber endpoint, tampoco hay leak activo).

**GCP/infra — ADR-034(gcp-cost), ADR-035(trl10)** · **APLICADO, verificado live** · 10🟢
🟢 right-sizing real: Cloud SQL `db-custom-1-6144` REGIONAL HA, `api` min=1, `web`/`whatsapp-bot`/`telemetry-processor` min=0, **`marketing` eliminado entero** (la realidad superó al ADR). HA preservada: SQL REGIONAL, Redis STANDARD_HA, DR cluster `booster-ai-telemetry-dr` us-central1 RUNNING, log exclusion `gke-control-plane-noise` live. 🟡 billing export BQ + "DR sin gateway" no verificados read-only.

**ADC migrations — ADR-037(Vertex/Gemini), ADR-038(Routes API)** · **EJECUTADO end-to-end** · 10🟢
🟢🟢 **Verificación más fuerte del inventario**: `gcloud api-keys list` ya **NO muestra** las keys Gemini ni Routes (borradas) — solo Maps + Firebase + `Antigravity_Bot`. `gemini-client.ts` y `routes-api.ts` usan ADC (`GoogleAuth` + Bearer + `X-Goog-User-Project`), sin apiKey; SAs con `aiplatform.user` + `serviceUsageConsumer`. **El placeholder `ai-provider` es un red herring**: Gemini vive en `apps/api/src/services/gemini-client.ts` (real, Vertex+ADC). 🟡 único drift: modelo `gemini-2.5-flash` (ADR dice 1.5, retirada por Google Q1-2026).

**Device/voz — ADR-040(TLS FMC150), ADR-036(wake-word)** · no verificable / stub honesto
ADR-040: **4🟡** device-side (FOTA/SMS al FMC150), no observable read-only; `wave-3-tls.tf` existe pero es cert-manager/DNS server-side (ortogonal). ADR-036: stub honesto — SDK Picovoice Porcupine **no instalado** (🔴 vs lectura literal "integrar"), UI wired con copy "próximamente" (🟢), motor `StubWakeWordController` siempre `unavailable`. El ADR lo declara PR1 foundation.

**Ops/tooling — ADR-039(site-settings), ADR-047(k6), ADR-048(microservices)**
🟢 ADR-039: real end-to-end (tabla `configuracion_sitio` JSONB versionado + Zod + rutas draft/publish/rollback/assets + hook con cache 5min+fallback). 🟢 ADR-047: smoke k6 real (`smoke.k6.js` + script pnpm), suite real diferida a S8 (consistente). 🔴 **ADR-048: 100% plan, 0% ejecutado** — los 3 "servicios extraídos" (notification/matching/document) son skeletons de 13 LOC, lógica aún inline en el monolito, **cero flags `*_VIA_MICROSERVICE`**, cero mirroring, cero sub-ADRs/budget/runbook. Consistente con status "Accepted (conceptual; diferido)" pero nada construido.

**Meta/proceso — ADR-043, 044, 045, 046, 049, 050**
🟢 ADR-043: `drift-inventory.mjs` real (corre, reporta **10 divergencias vivas** bajo threshold; 🟡 solo en pre-commit, NO en CI). 🟢 ADR-044: journal guard real (test 7/7, no pre-commit como dice el ADR; journal 40/40 consistente). 🟢 ADR-045: `scripts/db/agent-query.sh` real (IAP+ADC+puerto 5436, coexiste con connect.sh). 🟢 ADR-046: colisiones 028/034/035 reales + `check-adr-numbering` con allowlist exacta en pre-commit. 🔴 **ADR-049: `.claude/settings.json` NO existe** y **nada en `.claude/` está versionado** — CLAUDE.md (§Estructura) y ADR-049 (Capa 3) afirman que el repo declara los plugins a project scope, pero **no lo hace**; los plugins vienen de config global/usuario (`~/.claude`). El cleanup de paths viejos (skills/, .claude/commands/, hooks/) **sí** se hizo (🟢). ADR-050: remapping documentado + cleanup real (🟢), "cero ediciones a ADRs viejos" no re-verificado (🟡).

### Barrido ADR-051 → ADR-054 (2026-06-03, 2 agentes + spot-check) — CIERRE del inventario de ADRs

**ADR-051 — PII redaction en `@booster-ai/logger`** · **8🟢 · 1🟡 · 0🔴**
🟢 redaction real en `packages/logger/src/redaction.ts` (el ADR cita `value-redaction.ts`; el real es `redaction.ts`): redacta email/JWT/RUT(módulo-11)/phone-CL/sensitive-keys, **activo por default** (sin flag, cableado en `createLogger`), markers `[REDACTED:*]`, fixtures `legit-1000`/`adversarial-100` + thresholds FP≤1%/FN≤5% testeados (corren en CI vía test:coverage). 🟡 **el allowlist gitleaks de `generate.mjs`+`adversarial-100.json` está en `stash@{0}` sin commitear** (committed solo cubre los `.test.ts`) → cross-ref hilo gitleaks abierto.

**ADR-052 — Signup → Admin SDK + admin-approval gate** · **7🟢 · 2🟡 · 2🔴** · 🔴 **alto impacto operativo**
🟢 backend real: `POST /api/v1/signup-request` (202 anti-enumeration), service `submitSignupRequest`, tabla `solicitudes_registro` (migration 0039), approve vía Admin SDK `auth.createUser` en tx, flag `SIGNUP_REQUEST_FLOW_ACTIVATED` **ON en prod** (revision 00355-beg), IdP `disabledUserSignup=true` confirmado live. **El conflicto 409 (finding previo) SÍ se arregló** (shadow+202 idéntico). 🔴 **La decisión central NO se ejecutó**: `login.tsx:141-147` sigue llamando `signUpWithEmail` (createUser client-side) **sin gate ni llamada al endpoint nuevo** → con `disabledUserSignup=true`, el signup web queda **roto/huérfano** (`auth/operation-not-allowed`), no migrado. 🔴 **email sigue solo-logging** (`LoggingSignupRequestNotifier`) y el aviso a admins on-submit **ni se invoca** (finding previo NO resuelto).

**ADR-053 — Post-disclosure account replacement (SEC-001 H1.1)** · **6🟢 · 1🟡 · 0🔴**
🟢 verificado **contra Firebase live** (Identity Toolkit read-only): las 4 UIDs viejas `disabled=true`, 4 nuevas `demo-2026-*` activas, passwords en Secret Manager (`demo-account-password-*-2026`), scripts `harden-demo-accounts.ts` + middleware `demo-expires.ts` presentes, one-shot retire ejecutado. 🟡 crons/alertas TTL no verificados.

**ADR-054 — Google blocking function signup gate** · **4🟢 · 2🟡 · 3🔴** · 🔴 **residual de seguridad reconfirmado**
🟢 handler `beforeCreate` completo y mergeado (`apps/auth-blocking-functions/src/handler.ts`: provider check + normalize + lookup `solicitudes_registro estado='aprobado'` + fail-closed), SDK `gcip-cloud-functions@0.2.0`, CI gates sprint-2c presentes, Status=Proposed (honesto). 🔴 **el gate NO está operativo en prod**: la función `beforeCreate` está **OFFLINE** (no sirve tráfico) y la config Identity Platform tiene `blockingFunctions: {}` **vacío** → **el signup Google federated sigue SIN gate** (reconfirma y extiende el finding previo "Gen 1 muerto"; Sprint 2c-B nunca completó deploy+wire). 🔴 el ADR dice `firebase-functions@^3.x` pero el package pin es `^6.6.0` y el handler ni lo importa; 🟡 Gen1/Gen2 ambiguo.

> **CURRENT.md (verificación final)**: sus afirmaciones materiales coinciden con el trabajo de esta sesión ya verificado en vivo (App Check PR #401 mergeado + deploy pendiente gate; gitleaks Maps verificada/Firebase pendiente; deploys Cloud Run; inventario). No requiere re-verificación independiente — es el handoff que refleja lo aquí inventariado.

---

## Cursor de progreso

- ✅ **INVENTARIO COMPLETO (2026-06-03)**: ADR-001, 002, 004→054 verificados + CURRENT.md. (003 ausente; colisiones 028/034/035 ambas cubiertas; **ADR-055 = dev-env DRAFT auto-escrito esta sesión, N/A**). Barrido 004-007 el 2026-06-02; 008-054 el 2026-06-03.
- **Findings 🔴 de seguridad del cierre (051-054):**
  - **ADR-052 (alto impacto operativo)**: la migración de frontend del signup NUNCA se hizo — `login.tsx` sigue con `signUpWithEmail` client-side sin gate; con `disabledUserSignup=true` en prod el signup web queda **roto/huérfano**. Email signup sigue solo-logging + aviso a admins no se invoca. (Backend + flag + IdP gate sí reales; 409 arreglado.)
  - **ADR-054 (residual de seguridad)**: blocking function `beforeCreate` **OFFLINE** + Identity Platform `blockingFunctions: {}` vacío → **Google federated signup SIGUE sin gate**. Handler mergeado pero deploy+wire (Sprint 2c-B) nunca completó. ADR honesto (Status=Proposed).
- **Follow-ups dejados (2026-06-03):** `.specs/_followups/adr-020-supersede-gitlab-to-github-actions.md` · `.specs/_followups/adr-049-claude-md-settings-json-reconcile.md`.
- **Findings 🔴 NUEVOS del tramo 026-050 (2026-06-03):**
  - **ADR-049 settings.json (medio, contrato)**: `.claude/settings.json` NO existe y nada en `.claude/` está versionado; CLAUDE.md §Estructura + ADR-049 afirman que el repo declara los plugins a project scope — **falso** (vienen de `~/.claude` global/usuario). Discrepancia con el contrato del proyecto.
  - **ADR-041/042 geo-agg no cableada (medio)**: helpers k-anon + schema + migrations reales, pero NINGÚN endpoint los consume; garantías de privacidad (k-anon server-side, ventana 30d, comuna, gate `insufficient_data`) aspiracionales en runtime; surface stakeholder = mock. (Sin endpoint ⇒ sin leak activo.)
  - **ADR-048 microservices (bajo)**: 100% plan, 0% ejecutado (skeletons 13 LOC, cero flags cutover). Consistente con status "conceptual/diferido".
  - **billing-engine package inexistente** (ADR-026/027/030) — lógica en pricing-engine; + numeración de migrations falsa en ADRs pricing/factoring (cosmético, tablas existen).
- **Positivos FUERTES verificados live (gcloud)**: ADR-037/038 keys Gemini+Routes **borradas de GCP** (migración ADC ejecutada end-to-end); ADR-034 right-sizing aplicado + `marketing` eliminado; ADR-035 HA preservada (SQL REGIONAL, Redis STANDARD_HA, DR cluster RUNNING); ADR-031/032 flags pricing/factoring on en prod con DTE_PROVIDER=disabled (modo demo intencional); ADR-039 site-settings real end-to-end.
- **Patrón sano del backend transaccional**: pricing/factoring/matching-v2/RBAC/auth-universal **el código va por delante del ADR** (varios ADR sub-reportan lo construido) — opuesto al riesgo narrativa-inflada. Los stubs/vaporware se concentran en: trip-state-machine, ai-provider (NLU), carta-porte-generator, los 3 microservicios skeleton, wake-word.
- **Findings 🔴 NUEVOS del tramo 010-025 (2026-06-03):**
  - **ADR-020 GitLab-vs-realidad (medio, NO externo)**: el ADR describe una migración a GitLab + `.gitlab-ci.yml` + GitHub Actions "inerte" que NUNCA ocurrió — el CI real es 100% GitHub Actions, `origin`=GitHub, sin `.gitlab-ci.yml`. **Candidato a ADR superseding.**
  - **ADR-022 factor diesel 3.21 (medio)**: contradice código (3.25) y ADR-021 (3.25). Afecta precisión de certificados de carbono. Además metodología B5/methodology_version/is_backhaul_optimized no implementadas.
  - **ADR-010/011/012 aspiracionales (bajo, no externo)**: landing comercial (0 implementado), panel admin (solo "dentro de apps/web" real, módulos no), observatorio urbano (roadmap futuro). Status=Accepted no refleja no-ejecución.
  - **Stubs/placeholders confirmados (7 líneas c/u)**: `trip-state-machine` (ADR-004), `ai-provider` (ADR-025 → NLU/Gemini vaporware), `carta-porte-generator` (ADR-024 → Carta Porte no existe). Skeletons: `document-service`, `notification-service`, `matching-engine`.
- **Núcleo técnico SÓLIDO (narrativa≈realidad)**: ADR-013 (DB privada+IAM), 014 (Maps key), 015 (KMS carbono), 016 (Web Push desplegado), 017 (SSE), 018 (Pub/Sub chat live), 019 (Workbox), 021 (factores GLEC bit-a-bit), 023 (matching v1). Los 🔴 acá son drift de doc (line-refs, estado stale), no decisiones falsas.
- **deploy web Cloud Run**: ✅ confirmado vivo (`booster-ai-web` sa-west1) tras reauth gcloud 2026-06-03 — cierra el 🟡 de ADR-008.
- **Gaps ADR-008 (🟡, no externos):** axe-core declarado sin integrar (validación a11y automatizada inexistente; el job CI "Playwright + axe-core" no corre axe); web-push backend (`notification-service`) skeleton.
- **ADR-009 (estratégico)**: capacidades-diferenciador mayormente reales (carbon-calculator 419 LOC, matching-algorithm 330 LOC). **🔴 "18 estados XState"** es FALSO (trip-state-machine stub) — mismo finding raíz que ADR-004 pero aquí como **claim externo de pitch** (mayor exposición narrativa). carbon/matching reales (NO son stubs como trip-state-machine).
- **Verificaciones diferidas a su ADR:** Twilio→Meta (ADR-006 → **ADR-025**); provider DTE Bsale-vs-Sovos (ADR-007 → **ADR-024**); Routes API ADC (ADR-005 → **ADR-038**).
- **Findings ROJO acumulados:** Finding #1 (pipeline deploy, **alto** — gate ya aplicado + reconciliado, vector cerrado) · ADR-001 retention-lock GCS (**medio**, trackeado H3 Draft, no externo) · **ADR-004 trip-state-machine stub + lógica inline en services** (**medio**, deuda arquitectónica narrativa-vs-realidad, no externo — NUEVO 2026-06-02).
- **Cierres colaterales 2026-06-02:** los 2 🟡 de ADR-001 (Firestore + BigQuery) quedan **verificados desplegados** al pasar por ADR-005 (Firestore Native sa-east1 match exacto; BigQuery datasets vivos, dataset se llama `telemetry`).
- **Sesión 2026-06-02** (multi-máquina; continúa desde Mac Mini, próxima desde MacBook Pro). gcloud reauth OK. Barrido 004/005 hecho; retomar desde **ADR-006**.

## Findings ya conocidos de la sesión (a confirmar en su ADR correspondiente)

- Boundary "protege" admission → **era falso** (`/empresas/onboarding` auto-provisionaba dueño; **cerrado** por PR #398, desplegado a prod 2026-05-29). Confirmar al llegar al ADR de auth (ADR-001 Zero-Trust / relacionados).
- Flujo signup-approval "existe/funciona" → **parcial/roto** (conflicto 409; email solo-logging; flag OFF). Ver `.specs/_followups/onboarding-flow-redesign.md`.
- Blocking function "está desplegada" → **nunca se desplegó** (Gen 1 muerto). Ver `.specs/sec-001-h1-2-google-blocking-c/`.
