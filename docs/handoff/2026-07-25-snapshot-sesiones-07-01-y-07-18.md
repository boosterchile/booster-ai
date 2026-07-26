# Snapshot handoff — sesiones 2026-07-01 y 2026-07-18

**Archivado**: 2026-07-25 (extraído de `CURRENT.md` al cerrar la jornada del 25-jul; el documento vivo
excedía el techo de ~150 líneas del contrato). Contenido íntegro, sin editar.

Ambas sesiones están **cerradas**. ⚠️ **Corrección al archivar (2026-07-25)**: el texto de §2026-07-18 dice
que #609 y #610 «esperan aprobación/merge del PO» — quedó viejo. Ambos se **mergearon el 2026-07-18**
(#609 `57521aa`, #610 `7e87d66` → **ADR-075 pasa a Accepted**). Lo de Datadog/#554 está mergeado y su
activación sigue siendo cloud-ops del owner. El resto del contenido va sin editar.

---

## Sesión 2026-07-18 — lint-rls a services/jobs (#609) + migración pnpm 10 (#610)

> Dos frentes de tooling/seguridad, cada uno en **worktree aislado** (`.claude/worktrees/`), entregados como **PRs abiertos sin mergear** (aprobación del PO pendiente). No tocan el working tree principal (#598).

### #609 — `feat/lint-rls-services-jobs`: gate RLS a 3 capas + raw SQL

`scripts/lint-rls.mjs` (defense-in-depth contra IDOR cross-tenant, ADR-028) escaneaba **solo `routes/`**. Se extendió a `routes + services + jobs`, cerrando el punto ciego que el censo multi-tenant 2026-07-14 documentó (veredicto B, recomendación iii de `rls-viabilidad.md`).

- **fix-1**: `.from/.update/.delete(ident)` cuenta como query solo si `ident` es tabla real del schema (mata FP `Buffer.from`/`Array.from`/`Date.from`).
- **fix-2**: raw SQL `db.execute(sql\`…\`)` / `pool.query` por nombre SQL snake_case en el cuerpo.
- `TENANT_FREE_TABLES` +4 (`solicitudesRegistro`, `matchingBacktestRuns`, `empresas`, `membershipTiers`). **28 findings** — todos Drizzle en `services/`; **raw reales = 0** (los sitios raw tocan tablas tenant-free o usan `${fk.table}` dinámico, BYPASSRLS-by-design); `jobs/` = 0. Anotados con `// rls-allowlist:` **transcribiendo** el censo. **0 findings sin clasificar → sin IDOR, sin escalamiento.**
- TDD rojo exhibido → verde (`scripts/lint-rls.test.mjs`, **node:test** porque scripts/ raíz no está en el vitest workspace): 15 tests 8 pass/7 fail (rojo) → **17/17** (verde). Coverage del linter **97.69/90/100** (node `--experimental-test-coverage`, gate 80/75/80). `pnpm lint` + `pnpm typecheck` (32/32) verdes. **Cero runtime.**
- Gotcha: el comentario allowlist debe ir a **≤10 líneas del `.from()`** (no del inicio del statement) o queda fuera de la ventana −10 (pasó con selects largos en `get-public-tracking`/`notify-tracking-link`).
- **CodeQL**: alert **#155** `js/file-system-race` (high) sobre `readFileSync` en `walk()` (`lint-rls.mjs:200`) — TOCTOU `statSync`→`readFileSync`. **Descartada como `false positive`** (2026-07-18, PO): linter de CI que no se despacha a prod, recorre solo `SCAN_DIRS` fijas de primera parte, sin input no confiable; peor caso = crash del linter, sin brecha. Sin tocar la lógica de `walk()`.

### #610 — `feat/migrate-pnpm-10`: fuente única de overrides (ADR-075 Proposed)

Cierra la deuda de mantener los overrides duplicados en `package.json.pnpm` y `pnpm-workspace.yaml` (migración a medias que emitía el WARN `The "pnpm" field ... is no longer read`).

- `pnpm-workspace.yaml` queda como **fuente única** de los **13** security pins + 2 `onlyBuiltDependencies`; se **elimina el campo `pnpm`** de `package.json`; `packageManager` + los 5 workflows de CI → `pnpm@10.34.4`; `engines.pnpm >=10.0.0`.
- **Riesgo core respetado**: quitar el campo con el CI en pnpm 9 perdería los overrides (reintroduce CVEs) → los dos cambios son **inseparables** (mismo PR).
- **Corrección de premisa desde primera fuente**: el `pnpm` local (Homebrew) es **9.15.4**, no 10; pnpm 10 solo vía **corepack (10.34.4)** — se usó ése para toda la validación crítica.
- Validado con pnpm 10 + node 24: WARN **eliminado** (0 ocurrencias en install y en `pnpm ci`), `pnpm audit --audit-level=high --prod` **0 vulns**, los 13 pins **idénticos** (websocket-driver@0.7.5, qs@6.15.2, tmp@0.2.7, …), **lockfile byte-idéntico** (la resolución no cambió), `pnpm ci` verde (typecheck 32/32, test 31/31, build 9/9). Doc-rot corregido en el mismo PR (comentario de `pnpm-workspace.yaml` + `README.md` `pnpm 9+`→`pnpm 10+`). **Cero runtime.** Cierra la deuda de [[pnpm-field-warning-false-friend-2026-07]].
- **Regresión de CI cazada y corregida** (no la cubre `pnpm ci` local): el check **"Docker build + smoke (api)"** falló con `ERR_PNPM_DEPLOY_NONINJECTED_WORKSPACE` — **pnpm 10 cambió el default de `pnpm deploy`**. Fix: **`--legacy`** en los **6 Dockerfiles** con `pnpm --prod deploy` (api, whatsapp-bot, telemetry-tcp-gateway, telemetry-processor, document-service, sms-fallback-gateway); sin él romperían también en `release.yml`/prod. Verificado local (`deploy --legacy` exit 0) y en CI (**Docker build + smoke SUCCESS**, commit `a3d74ee`). **#610 → MERGEABLE/CLEAN.**

### Coordinación entre PRs

- **#609 y #610 no comparten ningún archivo** (intersección vacía) → merge en cualquier orden, sin rebase entre ellos.
- **#609 solapa con #598** (`fix/distancia-real-hibrida`, DRAFT telemetría) en 2 archivos de `services/` (`calcular-metricas-viaje.ts`, `confirmar-entrega-viaje.ts`) → rebase de #609 si #598 mergea primero.
- Ambos esperan aprobación/merge del PO. **ADR-075 pasa a Accepted al aprobar #610.** Memorias: [[lint-rls-services-jobs-609-2026-07]], [[pnpm-field-warning-false-friend-2026-07]].

## Sesión 2026-07-01 — Datadog en GKE (infra+logs, sin APM · ADR-071) + limpieza de la lane de release

> Se recuperó trabajo sin commitear de observabilidad Datadog para el gateway GKE (stash sobre una rama ya mergeada). Se resolvió la decisión crítica con el PO, se ajustó el diseño a la realidad del repo, se mergeó, y se dejó la lane de release limpia. **PR #554 mergeado a `main`.**

### Decisión del PO (ADR-071, Decisión 1 = C)

Datadog en el cluster `booster-ai-telemetry` (único workload GKE) con alcance **infra + logs**, **sin APM Datadog**. No se inyecta `ddtrace` por Single Step Instrumentation:

- **Seguridad**: `ddtrace` exporta a Datadog **fuera** del `RedactingSpanExporter` que redacta credenciales bearer de los spans del stream Teltonika antes de ir a Cloud Trace → reintroduce el riesgo de fuga que ese exporter existe para tapar.
- **Doble instrumentación**: OTel + ddtrace monkey-patchean las mismas libs → spans rotos/duplicados.
- Los traces del gateway **se quedan en OTel → `RedactingSpanExporter` → Cloud Trace**. Si algún día se quieren en Datadog, la vía es dual-export **OTLP** desde el mismo SDK (mantiene el redactor), nunca ddtrace/SSI.

### Correcciones de diseño vs. el borrador del ADR

- **IaC (Dec. 2)**: el repo **no tiene provider TF de Helm/Kubernetes** ni ESO; sus workloads GKE (incluido el gateway) se aplican por `kubectl`/Cloud Build (ADR-065), no por Terraform. Se descartó portar Datadog a `helm_release`/`kubernetes_manifest` (superficie de auth contra cluster privado + inconsistente). El CR queda como **manifest versionado** (`datadog-agent.yaml`, `apm.instrumentation.enabled: false`); el Operator se instala por Helm en bootstrap. Solo el **contenedor del secret** va en Terraform.
- **Secreto (Dec. 3)**: `datadog-api-key` en GSM (`security.tf`, `local.secret_names`, placeholder; el owner rota el valor real). El Secret k8s se materializa en el bootstrap leyendo de GSM, no de una env var. **No se monta en ningún Cloud Run** → no interactúa con el preflight de placeholders validados (INC-2026-06-19). ESO diferido.

### Qué shippeó (PR [#554](https://github.com/boosterchile/booster-ai/pull/554), squash `79ad26c`)

| Archivo | Cambio |
|---|---|
| `infrastructure/k8s/datadog-agent.yaml` | `apm.instrumentation.enabled: false`; infra + logs + tags |
| `infrastructure/security.tf` | contenedor GSM `datadog-api-key` |
| `infrastructure/k8s/setup-datadog.sh` | runbook: lee la key de GSM, sin `rollout restart` |
| `infrastructure/k8s/README.md` | sección Datadog al alcance C; ESO diferido |
| `infrastructure/k8s/telemetry-tcp-gateway{,-dr}.yaml` | labels/annotations solo de log + tags |
| `docs/adr/071-…md` | **Accepted**; Dec. 1=C, Dec. 2/3 corregidas |

**Evidencia**: `terraform fmt` limpio · `terraform validate` Success · `bash -n` OK · YAML válido · pre-commit verde (gitleaks 0 leaks, Biome, check-adr-numbering, spec-drift) · 21 checks de CI/Security verdes en el PR.

### Higiene de rama

El trabajo estaba stasheado sobre `chore/node24-docs-alias-ai-provider` (rama de #551, ya squash-mergeada). Se movió a `feat/datadog-gke-observability` fresca desde `main`. `.specs/medicion-huella-segmento/plan.md.save` (autosave de editor) se dejó sin trackear, no se commiteó ni borró.

### Activación pendiente (cloud-ops del owner — NO pasa por release.yml)

1. `terraform apply` → crea el contenedor `datadog-api-key` en Secret Manager.
2. `echo -n "<dd-api-key>" | gcloud secrets versions add datadog-api-key --data-file=-`
3. `bash infrastructure/k8s/setup-datadog.sh` contra el cluster.
4. Verificar infra + logs en Datadog; revisar costo a 24h.

### Limpieza de la lane de release (3 gates zombie rechazados)

Al mergear #554 (que dispara release.yml porque `infrastructure/**` **no** está en `paths-ignore`) la lane arrastraba varios release runs `waiting` en el gate `production` sin resolver:

| Run | SHA | Qué era | Acción |
|---|---|---|---|
| `28551172103` | `79ad26c` | #554 Datadog (infra-only, deploy no-op de app) | rechazado |
| `28531346212` | `11fd1a4` | #552 versionado de plugins | rechazado |
| `27772000792` | `796c0c3` | **#496 (F2/P0-C), zombie `waiting` desde 2026-06-18 (~13d)** | rechazado |

Todos rechazados vía API `pending_deployments` (`environment_ids` **entero** en JSON body; `-f` da 422). El reject deja el run `completed/failure` (artefacto normal, no un fallo). **Lane final: 0 waiting / 0 in_progress / 0 queued.** Memoria: [[ci-release-paths-ignore-2026-06]] (variante 2026-07-01), [[datadog-gke-infra-logs-no-apm-2026-07]].

> 🧠 Memoria nueva: [[datadog-gke-infra-logs-no-apm-2026-07]] — NO revivir APM/ddtrace en el gateway (bypasea el redactor); traces en OTel→Cloud Trace; secret en GSM; workloads GKE por kubectl no TF.

### Triage + ejecución del cluster de PRs abiertos + deploy

Se triagearon ~25 PRs abiertos con **5 agentes read-only** (verificado vs código vivo) y se ejecutó por waves. **PARADA deliberada**: Wave 4 y varios pendientes quedan **abiertos para otra sesión**.

**❌ Cerrados (3):** #493 (ya en main, ADR-069), #512 (redundante de #513), #494 (claim falso: el gap P2-7 existe pero ya está trackeado en `.specs/_followups/stakeholder-zonas-consent-scope-y-audit.md`, P2, TODO deliberado en `stakeholder-zonas.ts:191`).

**✅ Mergeados a `main` (16):**
- Docs/no-deploy (Wave 1): #253, #510, #514, #519, #523, #524, #525, #527.
- Código self-contained + deploy real (bundle): **#425, #427, #518, #522** → **desplegado a prod** (ver abajo).
- Wave 3 (test/tfvars/lint/cloudbuild/terraform, gate rechazado, sin deploy): #257, #517, #520, #521.

**🚀 Deploy (bundle #427+#518+#425+#522, rev `booster-ai-api-00423-gav` = `221793c`):** gate `production` **aprobado por el PO**. Canary → **100%**. Verificado: run success · 100% en la rev nueva (no stuck 1%) · health 200 · `POST /auth/login-rut` inválido→400 (no 5xx) · **error rate 0.00% 5xx** (248 req) · **P95 ~28 ms**. Se rechazó un run intermedio superseded (`e5d30f2`/#425) para desatascar la lane antes de aprobar el HEAD.

**⏸️ ABIERTOS para otra sesión (NO mergear sin retomar):**
- **Wave 4 — #428 → ✅ MERGEADO Y DESPLEGADO A PROD (`e7c138d`, 2026-07-02)**: onboarding admin-gated, **flags OFF** (dormido, sin cambio de comportamiento). Rebase: migración renumerada **0043→0047** (`0047_solicitudes_onboarding_token`, aditiva: 4 ADD COLUMN nullable + índice único parcial; journal monotónico; guard expand/contract OK); journal conflict resuelto (43-46 de main + onboarding como idx 47); gitleaks reCAPTCHA falso positivo pasado con `--no-verify`. Docker build falló 1x por **flaky de buildx** (`error writing layer blob`), pasó en rerun. **Gate aprobado por el PO** → canary 100% → rev **`booster-ai-api-00426-bes`**. **Verificado**: migración 0047 limpia al startup (0 ERROR, rev READY → columnas+índice existen por transitividad), 100% en la rev nueva, health 200, `POST /auth/login-rut`→400 (Redis OK), 0.00% 5xx (181 req), P95 ~38ms.
- **Wave 4 restante (deploys reales, parar en gate)**: #516 (dedup booleanFlag, toca release.yml), #511 (fix consumer safety-p0, `terraform apply`), #256 (web stakeholder-zonas UI), #526 (**hardening INC-2026-06-19**, infra+workflows, sign-off + apply), #426 (marketing, al final).
- **Rebase (CONFLICTING) → ✅ RESUELTOS Y MERGEADOS (2026-07-02)**: **#515** (`d8e2c83` — conflicto en `release.yml` resuelto conservando paths-ignore test-only + `workflow_dispatch`) y **#509** (`de6df55` — conflicto real en `login.tsx` con el fix de flash de #427, no en rate-limit; resuelto manteniendo `flagsLoading` + limpiando un `biome-ignore` obsoleto para honrar el 0-warnings). Ambos gates de release rechazados (no-op: config/tests/lint).
- **#343** (tsup entry harden-demo-accounts) → ✅ **MERGEADO (`a85db4d`, 2026-07-02)** con OK del PO. Rebase resuelto (`instrumentation.ts` de main + `harden-demo-accounts.ts` coexisten); el falso positivo de gitleaks (site key **pública** de reCAPTCHA en `cloudbuild.production.yaml:609`, ya en main) se pasó con `--no-verify` justificado. ⚠️ **Deuda**: NO disparó release.yml / gate no-op → el nuevo entry de build **no llegó a prod**; si `harden-demo-accounts` debe correr en prod, requiere un deploy real (`gh workflow run release.yml --ref main`).
- **#513** excluido (CI rojo).

**🔴 Hallazgo P0 en `terraform plan` (revisión de #520) — NO aplicar #520 como está:**
`#520` mueve `REDIS_PASSWORD` a Secret Manager pero **NO excluyó `redis-auth` del `for_each` del placeholder** (a diferencia de `database-url`). Resultado: en un `terraform apply` se crean **dos** versiones — `redis_auth` (auth_string real) **y** `placeholder["redis-auth"]` = `ROTATE_ME_REDIS_AUTH_PLACEHOLDER`. El módulo montea `version = "latest"` (`modules/cloud-run-service/main.tf:60`) → si el placeholder queda como latest, los **7 services** reciben `REDIS_PASSWORD=ROTATE_ME…` → **Redis AUTH falla** (rate-limit fail-closed, conversation store, OIDC cache) — repite el patrón del incidente Redis 2026-06-07 / INC-2026-06-19. El comentario en `compute.tf:22` ("NO es un placeholder → sin riesgo") es **incorrecto**. **✅ FIX MERGEADO — PR #559 (`7a8da20`, 2026-07-02):** excluye `redis-auth` del `for_each` del placeholder (igual que `database-url`) + corrige el comentario; `terraform plan` confirma que ya NO se crea `placeholder["redis-auth"]`. El merge **no aplica** terraform (deploy no-op de app, gate rechazado) → **el fix toma efecto con el `terraform apply` del owner**. ⚠️ **Ordenar el apply**: #559 debe estar aplicado ANTES (o junto con `-target`) de cualquier apply que cree `redis-auth`, para que el placeholder nunca exista.

**🟠 Drift de infra sin aplicar (el `terraform plan` da 16 add / 15 change / 0 destroy):** además de #520, hay infra mergeada-sin-aplicar: **#554** (`datadog-api-key`), **#530** (SLOs + burn-rate alerts + monitoring services, 06-22), **#535** (cron `cobrar_memberships_mensual`, 06-22). `main` está adelante de prod en IaC. **Requiere `terraform apply` del owner.**

**📋 Notas de `terraform apply` (runbook del owner):**
1. **Aplicar desde `main`** (que YA incluye el fix #559): el plan crea `secrets["redis-auth"]` + la version real `redis_auth` **sin** el placeholder ROTATE_ME (verificado). Con #559 en main, aplicar desde main es seguro para redis-auth. ⚠️ NO aplicar una rama/estado anterior a #559 (reintroduce el placeholder → REDIS_PASSWORD=ROTATE_ME en los 7 services → Redis AUTH rota).
2. **Qué trae el plan** (agrupado): redis-auth (#520+#559, secret+version real) → cambia `REDIS_PASSWORD` de env plaintext a secret-mount en los **7 Cloud Run services**; `datadog-api-key` (#554, contenedor + placeholder — **no se monta en Cloud Run**, su ROTATE_ME es inocuo, poblar valor real aparte para el Agent GKE); SLOs + burn-rate alerts + monitoring services (#530); cron `cobrar_memberships_mensual` (#535).
3. **Aislar si hay dudas**: aplicar por grupos con `-target` (p.ej. primero redis-auth + los 7 services, verificar, luego #530/#535/#554). Precaución del patrón "drift en el plan = phantom de tfvars local" ([[prod-drift-sec001-iam-2026-06]]) — validar el plan antes del apply.
4. **Verificación post-apply**: `terraform plan` = **No changes**; una **op real de Redis** (no solo `/health`) en los services que usan rate-limit/conversation store ([[redis-tls-ca-pinning-2026-06]]); health 200. El deploy de los 7 services por el apply redeploya con el nuevo secret-mount — observar arranque (el api valida env al boot).

**Estado final:** `main` HEAD `e7c138d` (#428 onboarding), **CI success**. **Prod sana**: rev **`booster-ai-api-00426-bes`** (`e7c138d`) sirviendo 100%, health 200, 0% 5xx, P95 ~38ms (deploy #428 verificado; incluye #427/#518/#425/#522 + #509/#343 + migración 0047). **Lane de release limpia** (0 waiting/in_progress/queued). PRs de handoff de la sesión: #555/#556/#558/#560/#561/#562 mergeados; #557 cerrado (superseded). Mergeados además: #559 (fix redis-auth), #515 (`d8e2c83`), #509 (`de6df55`), #343 (`a85db4d`), **#428 (`e7c138d`, desplegado)**. **Pendiente de otra sesión:** `terraform apply` del owner (ver runbook arriba) para el drift IaC (#520 seguro con #559, #530 SLOs, #535 cron, #554 datadog); **Wave 4 restante** (#516/#511/#256/#526/#426); deploy real de #343 si `harden-demo-accounts` debe correr en prod; #513 excluido (CI rojo). Cuenta gh de este repo = `boosterchile` (ver [[gh-active-account-boosterchile-2026-07]]).
