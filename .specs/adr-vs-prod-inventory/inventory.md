# Inventario ADR-vs-realidad-de-prod

**Estado**: Iniciado 2026-05-29 con el hallazgo #1 (proceso de deploy). El resto del inventario (cruce de ADR-001..050 + CURRENT.md contra evidencia verificada de prod) está **pendiente de su propio spec** — NO ejecutado todavía (directiva PO).

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

---

## Cursor de progreso

- **Últimos ADR verificados: ADR-001 + ADR-002** (2026-05-29).
- **Siguiente: ADR-004.** Orden restante: 004, 005, 006, …, 050, luego CURRENT.md. (Nota: **003 ausente**; colisiones 028/034/035 per ADR-046.)
- **Findings ROJO acumulados:** Finding #1 (pipeline deploy, **alto** — gate ya aplicado + reconciliado, vector cerrado) · ADR-001 retention-lock GCS (**medio**, trackeado H3 Draft, no externo).
- **Sesión 2026-05-29 agotándose** (sesión muy larga: hotfix vector + gate deploy + canary + arranque inventario). Retomar barrido desde ADR-004 en sesión fresca.

## Findings ya conocidos de la sesión (a confirmar en su ADR correspondiente)

- Boundary "protege" admission → **era falso** (`/empresas/onboarding` auto-provisionaba dueño; **cerrado** por PR #398, desplegado a prod 2026-05-29). Confirmar al llegar al ADR de auth (ADR-001 Zero-Trust / relacionados).
- Flujo signup-approval "existe/funciona" → **parcial/roto** (conflicto 409; email solo-logging; flag OFF). Ver `.specs/_followups/onboarding-flow-redesign.md`.
- Blocking function "está desplegada" → **nunca se desplegó** (Gen 1 muerto). Ver `.specs/sec-001-h1-2-google-blocking-c/`.
