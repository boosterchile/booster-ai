# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-07-24 (**📡 Semana de telemetría en vivo mergeada + triage de 8 PRs rezagados.** En `main`: CAN live (#612), historial de traza vehículo+carga (#615), temp ambiente + flag sensor (#616/#617, migr 0051), duración de movimiento + datetime (#618), privacidad tracking + TTL de token (#621, migr 0052), filtro **null-island** GPS (#622), seed de carga sintética PLFL57 (#620, ejecutado en prod), y CI (#619 gate Trivy, #623 ryuk flake). **#624** [ABIERTO, MERGEABLE] = rebase de **#598** — distancia real híbrida F0-0 paso 1, migr **0053**, `cargarPingsVentana` preserva el filtro de #622; sigue draft/paso-1 + gate PO para el backfill. **Triage de los 8 rezagados EJECUTADO** (6 agentes, reporte en `~/Downloads/triage-8-prs-2026-07-24.md`): los **8 originales cerrados sin merge** — 6 reviven como PR fresco: **#630** (ex-#516, booleanFlag) ya **MERGEADO** (`26f9862`, sin deploy: `release.yml` es dispatch-only) y 5 **abiertos sin mergear** (#598→**#624**, #511→**#626**, #526→**#627**, #596→**#628**, #513→**#629**); y 2 cerrados definitivos (**#426** el `/signup` ya vive en main vía `/solicitar-acceso`, falta solo el sitio de contenido · **#256** base fantasma; ambas features con followup en `.specs/_followups/`). Infra #626/#627/#628 → una sola ventana de `terraform apply`. Ver §Sesión 2026-07-24.) **Antes [2026-07-18]**: (**🔒 lint-rls a 3 capas (#609) + 🧰 migración pnpm 10 (#610) — dos PRs abiertos sin mergear**: **#609** [`feat/lint-rls-services-jobs`] extiende el gate RLS (`scripts/lint-rls.mjs`, defense-in-depth IDOR, ADR-028) de solo `routes/` a `routes+services+jobs` + matcher de raw SQL; 28 `// rls-allowlist:` transcritas del censo multi-tenant 2026-07-14 [0 IDOR reales, 0 findings sin clasificar], test co-located node:test rojo→verde [15: 8/7 → 17/17], coverage 97.69/90/100, cero runtime. **#610** [`feat/migrate-pnpm-10`, **ADR-075 Proposed**] hace `pnpm-workspace.yaml` la **fuente única** de los 13 security pins + 2 onlyBuiltDependencies, elimina el campo `pnpm` de `package.json`, sube `packageManager` + 5 workflows de CI a `pnpm@10.34.4` [engines `>=10.0.0`] → el WARN "pnpm field no longer read" desaparece; validado con pnpm 10 [corepack, el Homebrew local es 9.15.4] + node 24: `pnpm audit` 0 vulns, pins idénticos, lockfile byte-idéntico, `pnpm ci` verde. **#609 y #610 no comparten archivos** [merge en cualquier orden]; #609 solapa con #598 [DRAFT telemetría] en 2 archivos de `services/` → rebase si #598 mergea primero. Ambos esperan aprobación/merge del PO. Ver §Sesión 2026-07-18.) **Antes [2026-07-01]**: (**📊 Datadog en GKE (infra+logs, sin APM) + limpieza de la lane de release**: se agregó observabilidad Datadog al único workload GKE (`telemetry-tcp-gateway`) con alcance **infra + logs**, **sin APM Datadog** — decisión del PO [ADR-071, Decisión 1 = C]. Motivo: `ddtrace` por SSI exportaría spans **fuera** del `RedactingSpanExporter` [fuga de credenciales bearer del stream Teltonika] y duplicaría la auto-instrumentación OTel; los traces del gateway **se quedan en OTel→Cloud Trace**. Manifests consistentes con ADR-065 [CR versionado + `kubectl`, no provider TF k8s]; secret `datadog-api-key` en GSM [source-of-truth, contenedor en `security.tf`, versión la puebla el owner], **no montado en Cloud Run** → no toca el preflight de INC-2026-06-19. `setup-datadog.sh` reescrito como runbook que lee la key de GSM y no reinicia el gateway. **PR [#554](https://github.com/boosterchile/booster-ai/pull/554) mergeado** [squash `79ad26c`; 21 checks verdes; terraform fmt/validate OK]. **Activación real = cloud-ops del owner** [`terraform apply` del contenedor → poblar `datadog-api-key` → correr `setup-datadog.sh`], NO pasa por release.yml. **Limpieza de la lane de release**: se rechazaron 3 gates de `production` no-op vía API pending_deployments [#554 `79ad26c`, #552 `11fd1a4`, y un **zombie de #496 `796c0c3` colgado en `waiting` desde 2026-06-18 ~13d**] → lane **100% limpia** [0 waiting/in_progress/queued]. Lección: los gates zombie se apilan por semanas; barrer `--status waiting` y rechazar los no-op. `infrastructure/**` NO está en `paths-ignore`. Ver §Sesión 2026-07-01. ℹ️ **Nota de continuidad**: el hueco 2026-06-20→06-30 [stale desde el 06-19] quedó **reconstruido** desde `git log` + memorias en §Ventana 2026-06-22→06-30 [24 PRs #528–#551 mergeados]. ⚠️ **Cluster abierto sin mergear**: el batch del barrido `_followups` **#509–#527** [19 PRs del 06-22] + #425–#428 + #493–#494 **siguen ABIERTOS** hoy — verificar vs código vivo antes de re-trabajar [muchos ya-hechos]. #552/#553 [versionado de plugins, 07-01 pre-sesión] también en main. Ver [[followups-sweep-2026-06-22]], [[claude-md-merge-conflict-automerge-2026-07]].) · **Detalle de sesiones ≤ 2026-06-22 archivado** en `docs/handoff/2026-07-24-snapshot-current-2026-05-a-06.md`.
**Anterior**: 2026-06-05 (**Cierre del leg Google de SEC-001 H1.2 por boundary + reaper** [ADR-057] — deploy prod SUCCESS + `terraform apply` [reaper paused] + dry-run validado [scanned=14, 0 acciones]; **SC-1.2.2 Google leg = MET**; fix CodeQL `js/incomplete-sanitization` en `escapeCell`. PRs **#402→#405**. Ver §Sesión 2026-06-05.) · **2026-06-03**: App Check reCAPTCHA v3 PR #401 mergeado (⚠️ NO activar enforcement hasta ver tráfico verificado post-deploy) + DEFINE epic entorno dev ADR-055 DRAFT + hilo gitleaks abierto — ver §Sesión 2026-06-03.
**Documento vivo**: este archivo refleja el estado del proyecto. ✅ **NOTA 2026-06-06**: todo el trabajo de las sesiones 06-04→06-06 está **mergeado a `main`** (PRs #402→#413); la rama de la última sesión (`ci/drift-dedicated-reader-sa`, #413 squasheado como `2fce2df`) ya está integrada y puede borrarse. Para snapshots históricos ver `docs/handoff/YYYY-MM-DD-*.md`.
**Plan de referencia**: [`.specs/production-readiness/roadmap.md`](../../.specs/production-readiness/roadmap.md) (S0 cerrado, S1a Bloque A cerrado, pickup S1b) + [`docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`](../plans/2026-05-12-identidad-universal-y-dashboard-conductor.md) (plan histórico waves 1-6)

---

## Sesión 2026-07-24 — semana de telemetría en vivo + triage de 8 PRs rezagados

> Semana de shipping sobre telemetría/tracking + housekeeping de CI, y un triage read-only de los 8 PRs que quedaron rezagados. Todo lo de esta semana ya está en `main`; los rezagados tienen veredicto pero la decisión (rebase/merge/cerrar) es del PO.

### Mergeado esta semana (todo en `main`)
- **#612** CAN LVCAN en vivo (fuel/RPM/vel) — capa 0+1.
- **#615** historial de traza vehículo + carga (capa 2): `obtener-traza-vehiculo/carga`, `distanciaTotalKm`/`haversineKm`/`downsampleTraza`, km CAN (Δ83/87).
- **#616** temperatura ambiente en vivo (Google Weather); **#617** flag `tiene_sensor_temperatura` (migr **0051** — distingue sin-sensor de 0 °C real).
- **#618** duración de **MOVIMIENTO** (no span, excluye paradas/apagones) + link "Recorrido" + filtros `datetime-local` en el historial.
- **#619** gate Trivy solo HIGH/CRITICAL + pin de action a SHA (v0.36.0); **#623** `TESTCONTAINERS_RYUK_DISABLED` en el job integration (flake del pull de ryuk desde Docker Hub que tumbaba CI — runner efímero → cleanup irrelevante).
- **#620** seed SQL de carga sintética PLFL57 (`scripts/db/seed-carga-sintetica-plfl57.sql`) — desbloquea el historial POR CARGA (#615 estaba vacío: 0 cargas entregadas). Ejecutado en prod (carga `SYN-PLFL5701` viva; empresa Van Oosterwyk se activó/revirtió para verificar).
- **#621** privacidad tracking público: corte de `position`/`progress` en estados no-activos (allowlist `asignado`/`en_proceso`) + TTL/revocación del token (migr **0052** `tracking_token_expira_en`; `computeTokenExpiry`).
- **#622** filtro **"null island"** (lat/lng=0, GPS sin fix) en el read path — `services/coordenada-gps.ts` (`esCoordenadaGpsValida` + `coordenadaGpsValidaSql`) aplicado a traza/cobertura/get-public-tracking/ubicacion/flota/assignments/trip-requests. Arreglaba la traza de KZXB64 (recta Chile→Golfo de Guinea, 18.029 km). Carbono y `/telemetria` (vista cruda) NO tocados a propósito.
- Migraciones vivas nuevas: **0051** (sensor temp), **0052** (tracking TTL). Próxima libre: **0053**.

### #624 — distancia real híbrida (F0-0 paso 1), rebase de #598 — **ABIERTO, MERGEABLE**
Rebase de #598 sobre main actual (**#598 cerrado** apuntando a #624). Escribe `metricas_viaje.distancia_km_real` híbrida (Σ observado haversine gap<60 s + Σ huecos por Routes API por-tramo gap≥60 s) + endpoint admin de backfill (dry-run, platform-admin) + tabla `bitacora_backfill_distancia` (migr **0053**). Resoluciones del rebase: renumerar migración 0051→0053; el loader extraído `cargarPingsVentana` ahora **aplica el filtro null-island de #622** (sin regresión para cobertura/métricas/backfill). Evidencia: api **1847/1847**, cert-generator 89/89, typecheck/biome/build. **Draft/paso-1** (emisiones aún modeladas = deuda paso 2). Orden del plan: #597 (merged) → **#624** → correr backfill → liberar candado de retención de `telemetria_puntos`. El backfill re-deriva certs ya emitidos → **gate PO** (impacto legal/ESG).

### Triage de los 8 PRs rezagados — **EJECUTADO 2026-07-24** (6 agentes de verificación; reporte en `~/Downloads/triage-8-prs-2026-07-24.md`)
El PO decidió sobre los 8: **los 8 originales quedaron CERRADOS sin merge**; los 6 rescatables reviven como PR fresco (rebase/rehecho desde main), los 2 irrescatables se cerraron definitivamente. De los 6 sucesores, **solo #630 está mergeado**; los otros 5 siguen abiertos esperando merge del PO.

| Original (cerrado) | Veredicto | Sucesor | Nota |
|---|---|---|---|
| **#598** distancia real híbrida | RESCATAR | **#624** ABIERTO | migr **0053**; draft/paso-1 + gate PO para el backfill (ver arriba) |
| **#511** consumer alerta safety-p0 | RESCATAR | **#626** ABIERTO | bug vivo (`telemetry-monitoring.tf:638` label = skeleton); requiere apply del owner |
| **#526** hardening Secret Manager (INC-2026-06-19) | RESCATAR | **#627** ABIERTO | mount directo de placeholder-validado-por-formato; gate PO + apply |
| **#596** desacopla SLOs/monitoring | RESCATAR | **#628** ABIERTO | enabler Fase A; `slo.tf` acoplaba por `module.service_*` |
| **#513** reconnect chat SSE | RESCATAR | **#629** ABIERTO (BLOCKED) | loop 401/403 vivo (`use-chat-stream.ts`); bundlea fix web (SSE) + api (rate-limit-pin) |
| **#516** booleanFlag de @booster-ai/config | REHACER | **#630** ✅ **MERGEADO** (`26f9862`) | rehecho fresco: 2 archivos, api 1814/1814, 24 checks verdes. El original conflictuaba contra el `release.yml` reescrito a dispatch-only. **Sin deploy** — el merge a main ya no dispara release (dispatch-only desde 2026-07-10) |
| **#426** sitio público + /signup (ADR-067) | **CERRAR** | — (followup) | el `/signup` gateado YA vive en main vía `/solicitar-acceso` + backend SEC-001; falta solo el sitio de contenido `apps/marketing` → build fresco content-only, no rebase. ⚠️ su spec y **ADR-067 NO están en main** (viven solo en la rama, que no se borró; el número 067 quedó libre en la numeración). Followup: `marketing-site-content-only.md` |
| **#256** UI cards reales (T11) | **CERRAR** | — (followup) | base fantasma: apilado sobre #255 (cerrado sin merge), deps ausentes en main (endpoint T8 abortado + ruta T10), diff real vs main = 1157 archivos que revertirían trabajo vivo. La feature NO está hecha (`ZONAS_DEMO` sigue mockeado en main) → rehacer bajo D11 v2. Followup: `stakeholder-cards-datos-reales-d11-v2.md` |

**Infra (#626/#627/#628):** conviene agruparlos en una sola ventana de `terraform apply` del owner post-merge. Memorias: [[trivy-gate-severity-unset-2026-07]], [[plfl57-itinerario-vs-carga-sintetica-2026-07]], [[capa2-historial-traza-carga-gap-2026-07]].

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

---

## Snapshots archivados

El detalle de sesiones anteriores (2026-06-22 hacia atrás, hasta 2026-05-17) se archivó en [`2026-07-24-snapshot-current-2026-05-a-06.md`](./2026-07-24-snapshot-current-2026-05-a-06.md). Snapshots más viejos (2026-05-05 → 05-24) viven como archivos `docs/handoff/2026-05-*.md`.

