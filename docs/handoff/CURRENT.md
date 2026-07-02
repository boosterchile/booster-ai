# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-07-01 (**📊 Datadog en GKE (infra+logs, sin APM) + limpieza de la lane de release**: se agregó observabilidad Datadog al único workload GKE (`telemetry-tcp-gateway`) con alcance **infra + logs**, **sin APM Datadog** — decisión del PO [ADR-071, Decisión 1 = C]. Motivo: `ddtrace` por SSI exportaría spans **fuera** del `RedactingSpanExporter` [fuga de credenciales bearer del stream Teltonika] y duplicaría la auto-instrumentación OTel; los traces del gateway **se quedan en OTel→Cloud Trace**. Manifests consistentes con ADR-065 [CR versionado + `kubectl`, no provider TF k8s]; secret `datadog-api-key` en GSM [source-of-truth, contenedor en `security.tf`, versión la puebla el owner], **no montado en Cloud Run** → no toca el preflight de INC-2026-06-19. `setup-datadog.sh` reescrito como runbook que lee la key de GSM y no reinicia el gateway. **PR [#554](https://github.com/boosterchile/booster-ai/pull/554) mergeado** [squash `79ad26c`; 21 checks verdes; terraform fmt/validate OK]. **Activación real = cloud-ops del owner** [`terraform apply` del contenedor → poblar `datadog-api-key` → correr `setup-datadog.sh`], NO pasa por release.yml. **Limpieza de la lane de release**: se rechazaron 3 gates de `production` no-op vía API pending_deployments [#554 `79ad26c`, #552 `11fd1a4`, y un **zombie de #496 `796c0c3` colgado en `waiting` desde 2026-06-18 ~13d**] → lane **100% limpia** [0 waiting/in_progress/queued]. Lección: los gates zombie se apilan por semanas; barrer `--status waiting` y rechazar los no-op. `infrastructure/**` NO está en `paths-ignore`. Ver §Sesión 2026-07-01. ℹ️ **Nota de continuidad**: el hueco 2026-06-20→06-30 [stale desde el 06-19] quedó **reconstruido** desde `git log` + memorias en §Ventana 2026-06-22→06-30 [24 PRs #528–#551 mergeados]. ⚠️ **Cluster abierto sin mergear**: el batch del barrido `_followups` **#509–#527** [19 PRs del 06-22] + #425–#428 + #493–#494 **siguen ABIERTOS** hoy — verificar vs código vivo antes de re-trabajar [muchos ya-hechos]. #552/#553 [versionado de plugins, 07-01 pre-sesión] también en main. Ver [[followups-sweep-2026-06-22]], [[claude-md-merge-conflict-automerge-2026-07]].) **Antes [2026-06-19]**: (**🚚 F4 repositorio documental de terceros — sub-fases 4a/4b shippeadas + INC-2026-06-19 resuelto + ADR-070 Accepted**: cerró el frente F4 del pivote documental. Booster **recibe/archiva** DTE de terceros (Guía de Despacho 52 / Factura 33), extrae el TED (PDF417→`<DD>`) **best-effort**, retiene 6a desde `fecha_emision`. **4b worker TED** [PR [#501](https://github.com/boosterchile/booster-ai/pull/501)] con ancla **estricta** de retención [`retention_until = CASE WHEN fecha_emision IS NULL THEN <nuevo>::date ELSE retention_until END` — sin `GREATEST`; `created_at` solo fallback; nunca acorta lo ya anclado] + fix poison-pill de fecha-imposible en `parseTedDd` [valida día real, no solo regex]. **manual-entry O-3** [#502] deja de pisar una retención anclada cuando no se envía fecha + valida día de calendario real [nuevo primitivo `isoCalendarDateSchema`]. **Infra** [#503] cablea `TRANSPORT_DOCUMENTS_BUCKET` en `service_api` + **retira los secretos DTE huérfanos** [ADR-069] + **ADR-070 → Accepted** [sign-off legal de custodia por el PO]. **🔴→✅ INCIDENTE INC-2026-06-19** [SEV-2, **sin impacto a usuarios**]: el `terraform apply` de #503 creó el secret `content-sid-safety-alert` con su placeholder `ROTATE_ME_*` y lo montó en `service_api` → el api rechaza el arranque [`CONTENT_SID_SAFETY_ALERT` valida `^HX[a-fA-F0-9]+$`]; Cloud Run mantuvo la revisión sana [00407] sirviendo y bloqueó deploys. **Recovery por el PO** [pobló v2 con el SID real + redeploy → rev `00365-9x9` sana, 100% tráfico]. **Preflight check** `scripts/repo-checks/check-validated-secret-placeholders.mjs` [#504, + post-mortem] que ataja el patrón antes del apply. **Gate C-7 validado** [#505] contra `formato_dte_202602.pdf` **v2.5 2026-02** [provisto por el owner, byte-idéntico al validado] — mapeo del `<DD>` tag-por-tag sin discrepancias [catálogo `<TD>` 33/34/52/56/61 sin cambios; emisor/receptor correctos]. ✅ `terraform plan` desde `main` = **No changes** [drift main↔prod cerrado]. **PRs [#501](https://github.com/boosterchile/booster-ai/pull/501)→[#505](https://github.com/boosterchile/booster-ai/pull/505) mergeados.** Ver §Sesión 2026-06-19.) **Antes [2026-06-14]**: (**🧩 CONSOLIDACIÓN de los 3 sub-agents locales → `booster-skills@0.3.0`** [ADR-064, Accepted]: tras el retiro de agent-rigor (ADR-060) los 3 archivos en `agents/` quedaron huérfanos. Resueltos sin duplicar lo que superpowers/booster-skills ya cubren — `security-auditor`→módulo compliance Chile en `booster-skills:security-scanner`; `sre-oncall`→nuevo sub-agent SRE pre-merge; `code-reviewer`→retirado (ADR-check plegado en `booster-stack-conventions` paso 7; review genérico=superpowers). `booster-skills` 6→7 sub-agents, **release [`v0.3.0`](https://github.com/boosterchile/booster-skills/releases/tag/v0.3.0)** [PR booster-skills#2]. En `booster-ai`: `agents/` **eliminado**, CLAUDE.md §Capas adicionales actualizado, stub `migrate-booster-agents` cerrado (Done), **ADR-064** (número confirmado por el guard — la cadena ADR del día fue 051→060→064 por colisiones). PyYAML cazó un bug que `claude plugin validate` no vio (colon-space en la description de sre-oncall). **PR [#466](https://github.com/boosterchile/booster-ai/pull/466) mergeado** [squash `768a4cc`]. Solo governance/tooling. Ver §Sesión 2026-06-14 (cont.).) **Antes (mismo día)**: (**🔧 MIGRACIÓN capa de disciplina: `agent-rigor` → `superpowers`** [ADR-060, Accepted]: se retira el plugin bespoke `agent-rigor` (motor bash sin tests, gate de enforcement no operativo de facto) y se adopta `superpowers` (`obra/superpowers`, MIT, marketplace oficial) como Capa 1 de disciplina genérica. `booster-skills` se mantiene como Capa 2 y **ya está en 0.2.0** con los mecanismos rescatables convertidos en skills [`definicion-de-terminado`, `tdd-dominio-critico`] + ledger observacional sin gates. Docs vivos actualizados: `CLAUDE.md`, `AGENTS.md`, `README.md` y el stub `migrate-booster-agents`. ⚠️ El ADR se preparó como "051" pero ese número ya estaba ocupado [`051-pii-redaction-logger`] → el guard `check-adr-numbering` bloqueó la colisión → renumerado al siguiente libre **060** (el repo iba por 059, no por 050 como sugería la estructura del CLAUDE.md). **PR [#464](https://github.com/boosterchile/booster-ai/pull/464) mergeado** [squash `91eccb1`, 21/21 checks SUCCESS]. Solo docs/governance — sin cambios de código/runtime/CI/deploy. Ver §Sesión 2026-06-14.) **Antes [2026-06-07]**: (**🔴→✅ INCIDENTE Redis TLS resuelto y CERRADO en prod**: signup-request daba 503 / rate-limit fail-closed porque el replace de Memorystore en cost-opt [ADR-058] rotó la CA y rompió el handshake TLS — ioredis usaba `tls:{}` sin pinnear la CA. **Fix CA-pinning shippeado** [PR #420 `d504811`, rev `00374-loh` 100%; verificados SC-2 signup→202, SC-3 logs limpios, rate-limit→429] + endurecido `whatsapp-bot` [quitado `rejectUnauthorized:false`]. Verificación E2E Playwright gateada [#422], cierre docs [#421], follow-up paths-ignore [#423]; gate no-op de #422 rechazado → lane de release libre. **PRs #420→#423 mergeados.** 4 follow-ups abiertos. Ver §Sesión 2026-06-07 incidente. Antes hoy: **handoff al día (#414, #416)** + **`release.yml` deja de disparar deploy en pushes docs-only** [`paths-ignore` denylist falla-seguro, #415] — **filtro validado end-to-end** [SC-1 docs-only→0 runs por #416; SC-2 código→dispara por #415; follow-up cerrado #417]. Antes [2026-06-06]: **Optimización de costos GCP cerrada 100% — 6/6 palancas aplicadas a prod** [ADR-058] + **DNS endpoint del gateway primary** [ADR-059] + **drift SEC-001 reconciliado** [decomiso SC-G7 + T4] + **IAM Owner drift resuelto** [phantom de tfvars, NO swap, #411] + **drift check de Terraform en CI live+verde** [SA dedicado `terraform-drift@`, #412/#413]. ✅ `terraform plan` global = **No changes**. PRs **#406→#417** mergeados a `main`. Ver §Sesión 2026-06-06.)
**Anterior**: 2026-06-05 (**Cierre del leg Google de SEC-001 H1.2 por boundary + reaper** [ADR-057] — deploy prod SUCCESS + `terraform apply` [reaper paused] + dry-run validado [scanned=14, 0 acciones]; **SC-1.2.2 Google leg = MET**; fix CodeQL `js/incomplete-sanitization` en `escapeCell`. PRs **#402→#405**. Ver §Sesión 2026-06-05.) · **2026-06-03**: App Check reCAPTCHA v3 PR #401 mergeado (⚠️ NO activar enforcement hasta ver tráfico verificado post-deploy) + DEFINE epic entorno dev ADR-055 DRAFT + hilo gitleaks abierto — ver §Sesión 2026-06-03.
**Documento vivo**: este archivo refleja el estado del proyecto. ✅ **NOTA 2026-06-06**: todo el trabajo de las sesiones 06-04→06-06 está **mergeado a `main`** (PRs #402→#413); la rama de la última sesión (`ci/drift-dedicated-reader-sa`, #413 squasheado como `2fce2df`) ya está integrada y puede borrarse. Para snapshots históricos ver `docs/handoff/YYYY-MM-DD-*.md`.
**Plan de referencia**: [`.specs/production-readiness/roadmap.md`](../../.specs/production-readiness/roadmap.md) (S0 cerrado, S1a Bloque A cerrado, pickup S1b) + [`docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`](../plans/2026-05-12-identidad-universal-y-dashboard-conductor.md) (plan histórico waves 1-6)

---

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
- **Wave 4 (deploys reales, parar en gate)**: #428 (onboarding, colisión migración 0040→renumerar), #516 (dedup booleanFlag, toca release.yml), #511 (fix consumer safety-p0, `terraform apply`), #256 (web stakeholder-zonas UI), #526 (**hardening INC-2026-06-19**, infra+workflows, sign-off + apply), #426 (marketing, al final).
- **Rebase (CONFLICTING)**: #515 (paths-ignore test-only, toca release.yml), **#509** (lint 62→0 — colisionó en `rate-limit-pin.test.ts` con #425/#522 ya mergeados).
- **#343** (tsup entry harden-demo-accounts): diff revisado, **aditivo/bajo riesgo, pendiente OK del PO** — no mergeado.
- **#513** excluido (CI rojo).

**🔴 Hallazgo P0 en `terraform plan` (revisión de #520) — NO aplicar #520 como está:**
`#520` mueve `REDIS_PASSWORD` a Secret Manager pero **NO excluyó `redis-auth` del `for_each` del placeholder** (a diferencia de `database-url`). Resultado: en un `terraform apply` se crean **dos** versiones — `redis_auth` (auth_string real) **y** `placeholder["redis-auth"]` = `ROTATE_ME_REDIS_AUTH_PLACEHOLDER`. El módulo montea `version = "latest"` (`modules/cloud-run-service/main.tf:60`) → si el placeholder queda como latest, los **7 services** reciben `REDIS_PASSWORD=ROTATE_ME…` → **Redis AUTH falla** (rate-limit fail-closed, conversation store, OIDC cache) — repite el patrón del incidente Redis 2026-06-07 / INC-2026-06-19. El comentario en `compute.tf:22` ("NO es un placeholder → sin riesgo") es **incorrecto**. **Fix**: excluir `redis-auth` del `for_each` (como `database-url`) o pinnear el mount a la version `redis_auth`. Follow-up pendiente.

**🟠 Drift de infra sin aplicar (el `terraform plan` da 16 add / 15 change / 0 destroy):** además de #520, hay infra mergeada-sin-aplicar: **#554** (`datadog-api-key`), **#530** (SLOs + burn-rate alerts + monitoring services, 06-22), **#535** (cron `cobrar_memberships_mensual`, 06-22). `main` está adelante de prod en IaC. **Requiere `terraform apply` del owner** — pero **NO aplicar hasta corregir el defecto de #520** (arriba), o excluir #520 del apply con `-target`.

**Estado final:** `main` HEAD `68ced39` (#521), **CI success**. **Prod sana**: rev `221793c` sirviendo 100%, health 200, 0% 5xx, P95 ~28ms. **Lane de release limpia** (0 waiting/in_progress/queued; se rechazaron todos los gates no-op de Wave 3). PRs de handoff de la sesión: #555/#556 mergeados; #557 cerrado (superseded por este resumen).

---

## Ventana 2026-06-22 → 06-30 — reconstrucción del hueco (24 PRs #528–#551 mergeados)

> ⚠️ **Reconstruido a posteriori** desde `git log` de `main` + memorias (no desde un log de sesión vivo). El detalle fino del *porqué* de cada PR está en las memorias enlazadas; acá va el mapa de lo que **aterrizó en `main`**. El handoff no cubría este tramo (venía stale en 06-19).

### 2026-06-22 — cierre de gaps rojo/amarillo (batch #528–#536 mergeado)

Barrido de cierre de brechas de la auditoría/inventario. **Todos mergeados a `main`:**

| PR | Qué |
|---|---|
| #528 | chore(repo): cierre gaps rojo/amarillo — inventario + triage + remueve `ai-provider` |
| #529 | feat(stakeholder): endpoint k-anon de agregaciones geo de zonas (cierra B2) |
| #530 | feat(infra): SLOs formales + burn-rate alerts (F-13/SC-20); DLQ sms-fallback N/A (F-10) |
| #531 | feat(observability): spans OTel de negocio en operaciones de dominio del api |
| #532 | ci(security): Trivy gate **bloqueante** en HIGH/CRITICAL |
| #533 | fix(security): resuelve 4 alertas CodeQL high de code-scanning |
| #534 | docs(runbooks): runbooks operacionales por servicio (SC-21) |
| #535 | feat(pricing): cron mensual de cobro de membership fees v2 (gap B5) |
| #536 | docs: corrige cabos sueltos (gateway README stale + usage demo-dry-run) |

> ⚠️ **Batch distinto que NO mergeó**: el barrido de `_followups` **#509–#527** (19 PRs, mismo 06-22) sigue **ABIERTO** hoy (07-01). No confundir con #528–#536. Detalle en [[followups-sweep-2026-06-22]] (~30 de 47 stubs cerrados por PR/ya-hecho/moot; el tail es no-agent-resolvable: Docker, cloud-ops del owner, legal/PO).

### 2026-06-22→23 — crisis de la lane de release + deploy de transport-documents

| PR | Qué |
|---|---|
| #537 / #538 | ci(release): `workflow_dispatch` para re-disparar deploy manual (#538 re-hace #537) |
| #539 | ci(release): **resetea la concurrency group** para destrabar la lane (dead-lock) |
| #540 / #541 | fix(api): deps runtime de `transport-documents` en Docker build + `pnpm deploy` |
| #542 | ci: docker build + smoke del api (cacha fallos de contenedor pre-merge) |

- **Dead-lock de la lane** (memoria [[ci-release-paths-ignore-2026-06]]): el lock trabado **no** se liberó cancelando/re-disparando; el fix real fue **renombrar la concurrency group** (#539). Quedó `workflow_dispatch` en `main` (#537/#538) para re-disparar deploy sin push.
- **transport-documents** (memoria [[api-bundled-pkg-runtime-deps-2026-06]]): el api bundlea workspace packages; sus deps externas van en 3 lugares o el deploy rompe en capas. Costó 2 fixes (#540/#541); CI no corría el docker build → #542 lo agregó como gate pre-merge.

### 2026-06-24 — tooling SDD / ledger de retoma

| PR | Qué |
|---|---|
| #543 | chore(goal): remover referencias a `agent-rigor` del runbook |
| #544 | chore(sdd): anclar el ledger de retoma en `docs/sdd` vía symlink |
| #545 | chore(goal): ledger robusto en worktrees (`--git-common-dir`) + limpieza |
| #546 | ci(release): excluir `scripts/` de `paths-ignore` (no dispara deploy) |

> #546 corrige el gotcha de la memoria: `scripts/` **no** estaba en `paths-ignore` → merges de scripts disparaban release runs que colgaban el gate.

### 2026-06-25 — medición de huella sobre el segmento real (F1+F2)

| PR | Qué |
|---|---|
| #547 | docs(spec): medición de huella de carbono sobre el segmento real (F1+F2) |
| #548 | docs(plan): plan de implementación (F1+F2) |
| #549 | feat(carbon): columnas opt-in de huella (empresa + override viaje), Task 1 |
| #550 | docs(plan): L13 a inglés total + migración hand-written |

Arranca el epic de medición de huella; #549 es la primera tarea de implementación (columnas opt-in). Spec/plan en `.specs/medicion-huella-segmento/` (ahí quedó el autosave `plan.md.save` que esta sesión dejó sin trackear).

### 2026-06-30 — #551

`chore(repo): alinear docs a Node 24 y quitar alias muerto ai-provider` — cierre de higiene de docs (memoria [[node-version-pin-24-jsdom-2026-06]]: el repo fija Node 24).

> 🧠 Memorias de esta ventana: [[followups-sweep-2026-06-22]], [[ci-release-paths-ignore-2026-06]], [[api-bundled-pkg-runtime-deps-2026-06]], [[safety-alert-template-2026-06]], [[node-version-pin-24-jsdom-2026-06]].

---

## Sesión 2026-06-19 — F4 repositorio documental (4a/4b) + INC-2026-06-19 + ADR-070 Accepted + C-7

> Cierre del frente **F4** del pivote documental (Booster receptor/archivador de DTE de terceros, ADR-069/ADR-070). Worker TED 4b, fix O-3 en manual-entry, cableo de infra, un incidente de prod resuelto, y la validación del gate C-7 contra el formato SII vigente. **PRs #501→#505 mergeados a `main`.**

### Qué shippeó (todo en `main`)

| PR | Qué | Commit (squash) |
|---|---|---|
| [#501](https://github.com/boosterchile/booster-ai/pull/501) | Worker TED 4b: consume `document.uploaded` → rasteriza (pdfium WASM) → decodifica PDF417 (zxing) → parsea `<TED><DD>` → persiste en `documentos_transporte`. Best-effort (si falla, `fallido`, documento conservado, cierre no bloqueado). | `371375d` |
| [#502](https://github.com/boosterchile/booster-ai/pull/502) | Fix O-3 en `manual-entry`: no pisa una retención ya anclada a `fecha_emision` válida; valida día de calendario real (`isoCalendarDateSchema`). | `dd8a360` |
| [#503](https://github.com/boosterchile/booster-ai/pull/503) | Infra: `TRANSPORT_DOCUMENTS_BUCKET` en `service_api`; retira secretos `dte-provider-*` (ADR-069); **ADR-070 → Accepted**. | `8073d68` |
| [#504](https://github.com/boosterchile/booster-ai/pull/504) | Post-mortem INC-2026-06-19 + preflight `check-validated-secret-placeholders.mjs`. | `ecb3910` |
| [#505](https://github.com/boosterchile/booster-ai/pull/505) | Gate C-7: mapeo del `<DD>` validado vs formato SII vigente. | `e1c2464` |

### Invariante de retención (O-3) — decisión del PO

`retention_until` ancla **estricto a la emisión**: `CASE WHEN fecha_emision IS NULL THEN <fecha_emision+6a>::date ELSE retention_until END`. **Sin `GREATEST`** (revertido el primer diseño); `created_at+6a` solo fallback cuando no hay `<FE>`; **nunca se acorta** una retención ya anclada a una `fecha_emision` válida. En Postgres el RHS de un UPDATE lee la fila pre-update, así que el `CASE` discrimina por la `fecha_emision` previa. Validado con tests behavioral pglite + revisión adversarial. `ENABLE_RETENTION_PURGE=false`.

### 🔴→✅ INCIDENTE INC-2026-06-19 (SEV-2, sin impacto a usuarios)

- **Causa raíz**: el `terraform apply` de #503 creó `content-sid-safety-alert` con su placeholder `ROTATE_ME_CONTENT_SID_SAFETY_ALERT_PLACEHOLDER` y `service_api` lo monta como `CONTENT_SID_SAFETY_ALERT`, que el api valida con `^HX[a-fA-F0-9]+$` (`apps/api/src/config.ts`). El placeholder no matchea → `parseEnv` "Refusing to start" → la revisión nueva falla el startup probe.
- **Por qué no se cayó prod**: Cloud Run no enruta tráfico a una revisión que no llega a READY; siguió sirviendo la revisión sana previa (00407, que NO montaba el secret). El daño fue **bloquear deploys**.
- **Recovery (lo hizo el PO, son credenciales)**: pobló `content-sid-safety-alert` v2 con el SID real (`HX…`) + redeploy → rev `booster-ai-api-00365-9x9` sana, 100% tráfico, con `TRANSPORT_DOCUMENTS_BUCKET=booster-ai-494222-documents-prod`.
- **Prevención**: preflight `check-validated-secret-placeholders` (#504) que falla el apply si un secret validado por formato queda placeholder y está montado en un service. Post-mortem en `docs/incidents/INC-2026-06-19-content-sid-placeholder-startup.md`. **Action items pendientes** (del post-mortem): A5 cablear el preflight como gate pre-apply en el flujo de deploy; A3 aplicar terraform scoped (no barrer drift ajeno); A6 corregir comentarios engañosos en `security.tf`/`compute.tf` ("placeholder degrada a solo-push" — es falso); A7 mount condicional + derivar el set validado de los `.regex` de config.
- **Estado final**: `terraform plan` desde `main` = **No changes** → drift main↔prod cerrado.

### Gate C-7 — mapeo TED validado vs SII

Validado contra **`formato_dte_202602.pdf` v2.5 2026-02**, provisto por el owner desde su Drive (byte-idéntico al que se descargó por URL; el portal SII está reorganizado y los aliases estables dan 404). Mapeo del `<DD>` tag-por-tag (RE=emisor, RR=receptor, RSR=razón social del receptor, FE=AAAA-MM-DD ancla de retención, MNT entero CLP; catálogo `<TD>` 33/34/52/56/61 sin cambios). El spelling compacto sale del Instructivo ANEXO 2 (2009) que el formato vigente referencia. **Sin discrepancias, sin cambios de código.** Detalle en `.specs/repositorio-documental-transporte/c7-mapeo-ted.md`.

### Notas operacionales

- **gcloud CLI con token stale**: las ops de credenciales/prod (poblar secrets, redeploy) las corre el **owner**; el agente verifica read-only vía **ADC + REST** (gcloud CLI de usuario falla reauth no-interactivo). Memoria: `gcloud-cli-stale-auth-adc-2026-06`.
- **4c (stub `XmlIntercambioIngestor`)**: explícitamente **diferido**, no arrancado.

---

## Sesión 2026-06-14 (cont.) — Consolidación de los 3 sub-agents locales → booster-skills@0.3.0 (ADR-064)

> Continuación directa de la migración a superpowers. ADR-060 retiró `agent-rigor`, dejando huérfanos los 3 archivos en `agents/` raíz (antes "extendían" agent-rigor). Esta sesión los consolidó en el plugin de dominio y los borró del repo. Ejecución del spec `.specs/consolidate-agents-v0.3.0/spec.md` (decisiones del PO).

### Decisiones del PO (2026-06-14) y destino de cada override

| Override local | Destino | Razón |
|---|---|---|
| `security-auditor` | **Extender `booster-skills:security-scanner`** (módulo compliance Chile, secciones 13–16) | OWASP/secrets/SQLi ya estaban en security-scanner; lo único valioso = Ley 19.628, SII/DTE, RBAC por rol, consent ESG. Un solo agente de seguridad. |
| `sre-oncall` | **Nuevo sub-agent `booster-skills:sre-oncall`** | Lente SRE *pre-merge* (observabilidad, rollback, SLO, capacity). Distinto de la skill `incident-response` (*durante* incidente). Sin equivalente. |
| `code-reviewer` | **Retirado.** ADR-compliance plegado en `booster-skills:booster-stack-conventions` (paso 7) | Review genérico ya lo da `superpowers`. Único bit único = ADR-compliance. |

`booster-skills`: 6 → **7 sub-agents**; skills siguen en 9 (booster-stack-conventions enriquecido).

### Parte A — `booster-skills` v0.3.0 (shippeada)

- **PR [`boosterchile/booster-skills#2`](https://github.com/boosterchile/booster-skills/pull/2)** mergeado (squash `a065bab`) → tag + **[release `v0.3.0`](https://github.com/boosterchile/booster-skills/releases/tag/v0.3.0)**.
- `security-scanner` extendido (compliance Chile + anti-rationalizations + refs), nuevo `sre-oncall`, paso 7 ADR-compliance en `booster-stack-conventions`, manifests 0.2.0→0.3.0, CHANGELOG `[0.3.0]`, README reframe `agent-rigor`→`superpowers` (+ conteos corregidos a 9 skills/7 sub-agents — estaban stale desde v0.2.0).
- **Validación**: `claude plugin validate .` ✔ + PyYAML sobre frontmatters (7 agents, 9 skills). ⚠️ **PyYAML cazó un bug real** que `claude plugin validate` NO detectó: la `description` de `sre-oncall` traía `incident-response: este` (colon-space) → rompía el parseo YAML → entrecomillada (texto sin cambios).

### Parte B — `booster-ai` (este repo)

- **PR [#466](https://github.com/boosterchile/booster-ai/pull/466)** mergeado (squash `768a4cc`).
- Borrados `agents/{code-reviewer,security-auditor,sre-oncall}.md` (directorio `agents/` eliminado).
- `CLAUDE.md` §Capas adicionales: tabla de 3 overrides → nota de consolidación; árbol de estructura y "Conservados" sin `agents/`.
- **[ADR-064](../adr/064-consolidate-local-subagents-into-booster-skills.md)** (Accepted) registra la consolidación. **Número confirmado por el guard `check-adr-numbering`, no hardcodeado** — el repo iba por 063 (la cadena ADR del día fue 051→060→064 por colisiones de numeración).
- Stub `migrate-booster-agents-to-plugin-v0.2.0.md` cerrado (**Status = Done**).
- `README.md`: quita `agents/` del árbol; rango ADR `001..064`.

### Scope guard respetado

No se recreó `code-reviewer` como sub-agent; no se tocaron ADRs históricos ni otras `.specs/`; no se duplicó contenido OWASP/secrets; no se creó un agente de compliance separado. Único trabajo fuera de la lista literal del spec (reportado al PO): actualizar los dos `README.md` (plugin + repo) que el cambio dejaba incoherentes/colgando.

---

## Sesión 2026-06-14 — Migración de la capa de disciplina: agent-rigor → superpowers (ADR-060)

> Cambio de **governance/tooling**, sin código de producto. El PO había swapeado los plugins (`/plugin list` ya mostraba `superpowers` + `booster-skills@0.2.0`, sin `agent-rigor`) y dejó preparados un nuevo `CLAUDE.md` y un ADR en `~/Claude/Projects/Agentes/migracion-superpowers/`. Esta sesión materializó la migración en el repo y la mergeó.

### Contexto

ADR-049 había adoptado una arquitectura de 3 capas con `agent-rigor` como Capa 1 (disciplina genérica). Una auditoría 2026-06-14 encontró que su enforcement era **ficción de facto** (gate "leíste CLAUDE.md" = código muerto por `PostToolUse` solo cableado a Write/Edit nunca Read; escape-valve anti-drift en deadlock; 3 listas de vocabulario divergentes; ~520 líneas de bash sin tests). Se reemplaza por `superpowers` (moldeo conductual + auto-triggering + subagent-driven-development con review de dos etapas) y se rescatan los mecanismos con valor real como **contenido de skill** en `booster-skills`, no como motor bash.

### Discrepancias encontradas antes de ejecutar (ambas resueltas)

1. **Los `cp`/`git checkout -b`/`git add` que se habían tipeado NO surtieron efecto**: el repo estaba en `main`, limpio, sin staged, sin ADR nuevo, y `CLAUDE.md` seguía 100% en agent-rigor. La premisa "ya se hizo en CLAUDE.md" no se cumplía → se hizo la migración completa desde cero (no solo AGENTS.md/README.md).
2. **Colisión de numeración ADR**: el ADR venía como "051" pero `051-pii-redaction-logger.md` (Accepted, 2026-05-24) ya lo ocupaba. El guard de pre-commit `check-adr-numbering` bloqueó el commit (correcto). El repo va por **ADR-059** (no 050 como sugería la estructura del CLAUDE.md). Renumerado al siguiente libre = **ADR-060**, actualizando ~15 referencias en los 4 archivos. Las colisiones legacy toleradas siguen siendo solo 028/034/035 (ADR-046).

### Cambios (5 archivos, solo docs/governance)

| Archivo | Cambio |
|---|---|
| **`docs/adr/060-superpowers-replaces-agent-rigor.md`** | Nuevo ADR (**Accepted**) — supersede **parcialmente** ADR-049 (solo Capa 1). Contexto (4 defectos de agent-rigor), decisión, consecuencias, criterios de validación |
| **`CLAUDE.md`** | Capa 1 = superpowers; booster-skills 0.2.0 (9 skills); tabla de responsabilidades; los 3 sub-agents `agents/` pasan de "extienden agent-rigor" a **standalone** |
| **`AGENTS.md`** | Plugin recomendado `agent-rigor` → `superpowers` |
| **`README.md`** | Plugins `agent-rigor` → `superpowers`; rango ADR `001..060` |
| **`.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`** | Nota post-ADR-060: agent-rigor retirado, agents standalone, y `booster-skills@0.2.0` **ya está ocupada** → la consolidación futura debe apuntar a **≥ 0.3.0** (el PO re-evalúa versión destino) |

**Fuera de scope (deliberado, por instrucción del PO)**: no se tocaron ADRs históricos (incl. ADR-049, que solo se referencia — convención "se supersede, no se edita") ni otras specs en `.specs/`. ⚠️ **Residual conocido**: otros docs no-vivos (`docs/handoff/` históricos, `docs/ci-cd.md`, `docs/lessons-learned/`, `docs/plans/`, `docs/plugins/REPORTE-…`) aún mencionan `agent-rigor` como **registro histórico** y se dejan intactos a propósito.

### Cierre

- **PR [#464](https://github.com/boosterchile/booster-ai/pull/464) mergeado** a `main` (squash `91eccb1`), 2 commits (migración + flip `Proposed`→`Accepted`). Rama `chore/adr-051-superpowers-migration` borrada (conservó el nombre "051" por trazabilidad pese a que el ADR es 060).
- **Evidencia**: pre-commit verde (gitleaks, Biome, **check-adr-numbering OK**, spec-drift) + **21/21 checks de CI/Security SUCCESS** sobre el merge commit actualizado. `main` local sincronizado.
- **Sin impacto operacional**: cero cambios de código, runtime, CI de producto o deploy. No toca la lane de `release.yml` (cambio docs/governance; `paths-ignore` cubre `docs/**`, `.specs/**`, `*.md`).

---

## Sesión 2026-06-07 (incidente) — Redis TLS roto por la rotación de CA del replace de cost-opt

> Reporte del PO: "no puedo crear usuarios" en `app.boosterchile.com`. Resultó ser un incidente de infra, no un bug de la pantalla. Ciclo DEFINE→SHIP completo + deploy a prod verificado.

### Diagnóstico (dos cosas distintas)

1. **Self-registration cerrado por diseño** (SEC-001): no hay form público de registro; `/login` es solo login RUT+clave; `signup-request` flag OFF. **Rumbo A elegido por el PO**: dejarlo cerrado, arreglar solo Redis.
2. **Regresión real**: `POST /api/v1/signup-request` → **503** (`Retry-After:30` = `rate-limit-signup` fail-closed). Logs: `rate-limit-pin: Redis error — "unable to verify the first certificate"` (Node `UNABLE_TO_VERIFY_LEAF_SIGNATURE`). **Causa raíz**: el replace de la instancia Memorystore en cost-opt (ADR-058, 06-06) rotó la **CA privada por-instancia**; ioredis conectaba con `tls:{}` (valida contra el bundle público del sistema, que NO la incluye) → handshake falla → **todos los paths Redis caen** (rate-limit-pin + rate-limit-signup + ObservabilityCache). Login NO usa Redis → seguía vivo. El handoff de cost-opt no lo vio porque solo chequeó `/health` (no toca Redis).

### Fix (PR [#420](https://github.com/boosterchile/booster-ai/pull/420) `d504811`)

- Helper compartido `buildRedisTlsOptions` en `@booster-ai/config`: pinea el server CA (`REDIS_CA_CERT`), mantiene validación de cadena, deshabilita `checkServerIdentity` (conexión por IP). **NUNCA** `rejectUnauthorized:false`. `requireCa` falla-ruidoso en prod.
- API (server.ts + observability/{cache,factory}) usan el helper.
- **`apps/whatsapp-bot`**: portado desde `tls:{rejectUnauthorized:false}` (MITM, mismo boundary) — hallazgo del REVIEW (devils-advocate P0 + security-auditor).
- `infrastructure/compute.tf`: `REDIS_CA_CERT = join("\n", server_ca_certs[*].cert)` (TODOS los certs, robustez ante rotación) en `common_env_vars` → propaga a los 7 services.
- **REVIEW**: devils-advocate (DO_NOT_APPROVE inicial → 2 P0 resueltos) + security-auditor (0 bloqueantes). 3 follow-ups: `redis-tls-integration-test`, `redis-tls-cn-pinning`, `redis-password-to-secret-manager`.

### Deploy (orden obligatorio por el guard `requireCa`)

1. `terraform apply` de `REDIS_CA_CERT` (7 services in-place, 0 add/destroy; plan post-apply = No changes).
2. Merge #420 → `release.yml` → gate `production` aprobado por el PO → canary → 100%.
- ⚠️ **Cola de release.yml otra vez**: el run (`27100872770`, `d504811`) quedó ~15 min `pending` con 0 jobs porque un run viejo parado en **su** gate de producción retenía el lock de `concurrency` (`cancel-in-progress:false`). El PO **rechazó** ese run viejo (Failure, sin desplegar) → liberó la cola → el nuestro avanzó. Cancelar runs sigue siendo **403** para el agente/PAT (solo UI). El `deploy-production` figura `cancelled` en GitHub (artefacto del patrón canary) pero **prod quedó 100% en `00374-loh`** con el fix.

### Verificación en prod (rev `00374-loh` 100%)

- **SC-2**: `signup-request` → **202** `{"ok":true}` (ya no 503).
- **SC-3**: **0** `unable to verify the first certificate` post-deploy.
- **Rate-limit restaurado**: 6 intentos seguidos → `202 202 429 429 429 429` (429, no 503 fail-closed → Redis OK + `incr` opera).
- `terraform plan` global post-deploy = **No changes**.

### Verificación E2E con Playwright (#422)

A pedido del PO se verificó el path Redis desde el browser. El login universal RUT+clave
(`/auth/login-rut`) **NO** usa Redis; el único path Redis observable es el `rate-limit-pin`
de `/login/conductor` → `POST /auth/driver-activate`. Test chromium vs prod: **1 passed**;
secuencia real `401×5 → 429` (`retry-after:900`, `x-ratelimit-scope:rut`) — el 429 solo sale
del rate-limit funcionando sobre Redis. Commiteado **gateado** (`RUN_PROD_SMOKE=1`, no corre
en CI porque pega a prod) en `apps/web/e2e/redis-ratelimit-smoke.spec.ts`.

### Cierre del incidente

- **PRs**: **#420** (fix `d504811`) → **#421** (cierre docs: spec Shipped + ship + handoff) →
  **#422** (smoke Playwright gateado) → **#423** (follow-up paths-ignore). Todos mergeados a `main`.
- ⚠️ **Efecto colateral de #422**: al ser un `.spec.ts` bajo `apps/web/e2e/` (no es docs), el
  merge disparó un `release.yml` no-op (run `27103863227`) que quedó `waiting` en el gate. El PO
  lo **rechazó** (Failure) → liberó el lock de `concurrency`. Lane de release **libre** (0 runs
  activos). Trackeado en follow-up `release-paths-ignore-test-only-changes`.
- **Estado final**: fix al 100% en prod y verificado (API + Playwright); `main` limpio;
  `terraform plan` global = No changes; lane de release libre.
- **Follow-ups abiertos (4)**: [`redis-tls-integration-test`](../../.specs/_followups/redis-tls-integration-test.md),
  [`redis-tls-cn-pinning`](../../.specs/_followups/redis-tls-cn-pinning.md),
  [`redis-password-to-secret-manager`](../../.specs/_followups/redis-password-to-secret-manager.md),
  [`release-paths-ignore-test-only-changes`](../../.specs/_followups/release-paths-ignore-test-only-changes.md).
- **Pendiente operativo**: whatsapp-bot toma el código nuevo (sin `rejectUnauthorized:false`) en
  su próximo deploy normal — hoy sigue con imagen vieja + la env `REDIS_CA_CERT` ya presente.

> 🧠 Memoria: [[redis-tls-ca-pinning-2026-06]] — cualquier replace/rotación de Memorystore re-rota la CA; pinear `server_ca_certs` y verificar una **op real de Redis** (no solo `/health`) tras tocar la instancia.

---

## Sesión 2026-06-06 — Optimización de costos GCP (ADR-058) + DNS endpoint gateway (ADR-059) + reconciliación drift SEC-001/IAM + drift check CI

> Sesión larga (06-05 tarde → 06-06). Ejecución cloud **real** con `terraform apply -target` por palanca, cada una aislada y verificada (health 200 + signup-flow 200 tras cada apply). **Cero impacto en SEC-001/IAM salvo donde fue intencional.** Cierre: `terraform plan` global = **No changes**.

### 💰 Optimización de costos — 6/6 palancas aplicadas a prod (ADR-058)

DEFINE→SHIP completo: spec + plan + ADR-058 (riesgos aceptados por el PO) + REVIEW (REQUEST_CHANGES resuelto: `tfvars.example` fix, verify fix, followup stub, nota dr-region). PRs **#406** (código costos) y **#407** (docs SEC-001). El verify reveló que el plan venía **contaminado** con 9 cambios no relacionados (drift prod-vs-main de SEC-001 boundary-closure + swap IAM humana) → se aislaron y resolvieron por separado (ver abajo). Palancas aplicadas una por una con `-target`:

| Palanca | Cambio en prod | Método | Verificación |
|---|---|---|---|
| **A3** flags Cloud SQL | `log_temp_files 0→-1`, quita `log_connections/disconnections` | update in-place, sin downtime | REGIONAL intacto (D aislado vía `cloudsql_high_availability=true` en tfvars local) |
| **A2** min instances API | `min_instance_count 1→0` | update API service | Redis aislado (pin STANDARD_HA en tfvars); health 200 |
| **B1+C** gateway primary/DR a cold | deploy 1/1 + HPA minReplicas 1 (primary), deploy 0/0 + HPA eliminado (DR) | **bloqueado por red a clusters privados → ADR-059** (ver abajo) | kubectl vía `--dns-endpoint` |
| **A1** Redis tier | `STANDARD_HA→BASIC` (**replace**, 6m5s) + 7 Cloud Run services con nuevo `REDIS_HOST` | ventana baja OK del PO | BASIC READY `172.25.0.3:6378`; api/health 200, signup-flow 200 (auth recuperada) |
| **D** Cloud SQL disponibilidad | `REGIONAL→ZONAL` update in-place (5m35s restart) | backup on-demand pre-zonal SUCCESSFUL previo | ZONAL RUNNABLE, IP privada sin cambio; health 200 |
| **A4** CUD (committed use) | **NO comprada** | 0 commitments activos verificados; Recommender API no habilitado | re-evaluar ~**2026-09** con baseline post-opt |

Cierre: `ship.md` cost-opt → **6/6 palancas** (PR #409, 2026-06-06).

### 🌐 ADR-059 — DNS endpoint del gateway primary (desbloqueo de B1/C)

B1/C requerían `kubectl` contra clusters GKE **privados**; ni la laptop del PO ni el pool tenían IP autorizada. Resuelto habilitando `dns_endpoint_config.allow_external_traffic` en el cluster `telemetry` primary (apply in-place) → `kubectl --dns-endpoint` alcanza el master vía IAM. El cluster DR ya lo tenía (#194). PR **#408** (DNS endpoint + pipelines CD del gateway primary; aplica B1/C).

### 🔧 Reconciliación drift SEC-001 (#410) — decomiso SC-G7 + T4

El drift detectado en el verify se reconcilió con `terraform apply -target` (7 recursos, **IAM excluido**):
- **Decomiso SC-G7**: Cloud Function `before_create` + buckets `auth_blocking` destruidos (residuales del leg Google ya cerrado por boundary en ADR-057).
- **T4**: logging metric `auth_is_demo_blocked` + alert creados (antes ausentes → posible hueco).
- **`helloTest`** (Cloud Function `us-east1`, FAILED, artefacto de debug `helloHttp`, no en TF ni repo) **eliminada**. Sin functions restantes.

### 🔑 IAM Owner drift (#410/#411) — era un phantom, NO se mutó prod

El plan mostraba un swap `human_owners group:admins@ → user:dev`. Investigación: en prod `roles/owner = group:admins@boosterchile.com` (único, correcto); el swap venía de un **valor stale en el `tfvars` local**. **Decisión (#411)**: corregir el tfvars local a `group:admins@` → `plan -target=human_owners = No changes`. Phantom eliminado **sin tocar prod**. Además se destruyeron **2 bindings no-Owner** residuales del decomiso (`compute_default_storage_viewer`, `github_deployer cloudfunctions.viewer`). Análisis documentado en PR #411 (precaución: NO aplicar el swap).

> 🧠 Memoria actualizada: [[prod-drift-sec001-iam-2026-06]] — el patrón "drift en el plan = phantom de tfvars local, validar antes de aplicar" se confirmó aquí.

### 🛡️ Drift check de Terraform en CI (#412/#413) — live + verde

Para detectar drift prod-vs-main de forma continua se creó el workflow `.github/workflows/terraform-drift.yml` (cron diario 11:17 UTC + dispatch), corriendo `terraform plan -detailed-exitcode`. Trayectoria:
1. **#412** (`e928295`): workflow + prereqs (var `TF_BILLING_ACCOUNT`, fix de diffs perpetuos: idp declares + dashboard `ignore_changes`). Primer run (`27072203124`) **falló (exit 1, NO drift real)**: `roles/viewer` insuficiente para `redis.instances.getAuthString` + IAP `getIamPolicy`, y la var billing no resolvía. La **lógica del workflow era correcta** (marcó fallo, no falso verde).
2. **#413** (`2fce2df`, opción C): **SA dedicado read-only** `terraform-drift@` (viewer + securityReviewer + serviceUsageConsumer + **custom role** con `redis.getAuthString`/`iap`/`storage.getIamPolicy`). Revocado el `viewer` del deployer; `billing` con `ignore_changes`. Validado impersonando: plan completo = No changes exit 0.
3. **Run `27073895910` = VERDE en CI real** (conclusion=success; plan exit 0 = No changes). **Drift check operativo end-to-end.**

### Estado al cierre

- ✅ `terraform plan` global = **No changes** (drift IAM/SEC-001/costos = limpio; solo 2 diffs perpetuos benignos idp+dashboard, gestionados con `ignore_changes`).
- ✅ PRs **#406→#413** mergeados a `main`. ADRs **058** (right-sizing pre-comercial) y **059** (DNS endpoint).
- ✅ Vector Google de SEC-001 H1.2 totalmente cerrado (boundary en #402-#405 + decomiso de residuales acá).
- ⚠️ **Único residual (decisión humana)**: un release/deploy run (`27073359900`) quedó **`pending` ~21 min** en GitHub Actions (0 jobs, 0 Cloud Build) pese a aprobación registrada — issue de cola de runners / concurrency en `release.yml`, **no accionable por el agente** (403). El deploy es **no-op** (imagen idéntica, merge infra-only); la API está **sana (200)** en su revisión actual. Recomendado: revisar la UI de Actions y re-run o cancelar (no hay app que shipear).
- 🌿 Rama de trabajo `ci/drift-dedicated-reader-sa` (`917f481`) ya integrada en `main` (#413 squash `2fce2df`); borrada.

### Cierre de jornada — handoff al día + `release.yml` deja de disparar en docs-only

Trabajo de mantenimiento posterior al cierre de cost-opt/drift:

- **Handoff actualizado (#414, `bf8e842`)**: `CURRENT.md` estaba 3 días atrás (llegaba al 06-03); reconstruido desde los ledgers 06-04→06-06 + `git log` (esta sección + §2026-06-05). Rama `ci/drift-dedicated-reader-sa` borrada (local + ref remota stale podada).
- **🔧 `release.yml` ya no dispara deploy en pushes docs-only (#415, `6f88393`)** — ciclo DEFINE→SHIP completo (`.specs/ci-release-skip-docs-only/`). Se agregó `paths-ignore` (**denylist falla-seguro**: lo no listado siempre despliega) al trigger `on.push`: `docs/**`, `.specs/**`, `references/**`, `playbooks/**`, `*.md`.
  - **Motivo**: cada merge docs-only (handoff, specs) disparaba un deploy **no-op** que se colgaba en `pending` por cola de runners y ensuciaba la lane de `concurrency` (`cancel-in-progress:false`). 4 de los últimos 5 runs de `release.yml` eran docs/infra-doc no-op.
  - **⚠️ Clave**: NO se usa `**/*.md` a propósito — matchearía `.changeset/*.md` y rompería el release de Changesets. `*.md` (un solo `*`) es root-only y no cruza `/`.
  - **REVIEW devils-advocate**: APPROVE_WITH_RESERVATIONS, **0 P0**. Reservas resueltas (strawman job-level, fila Changesets fase B, R3 reclasificado).
  - **✅ Filtro validado end-to-end** (follow-up [`_followups/verify-release-paths-ignore-post-merge.md`](../../.specs/_followups/verify-release-paths-ignore-post-merge.md) **CERRADO**, #417): **SC-2** (con-código → dispara) por el merge de #415 (`6f88393`, toca `.github/`) → creó run `27076264007`; **SC-1** (docs-only → 0 runs) por el merge de #416 (`40a349a`, solo `CURRENT.md`) → **NO** creó run de `release.yml`.
- **Handoff del cierre de jornada (#416, `40a349a`)** + **cierre del follow-up de verificación (#417, `1f1b199`)**: ambos docs-only; #416 fue además la prueba en vivo de SC-1.
- **Runs no-op de release cancelados** (`27075451377` de #414, `27076264007` de #415) desde la UI de Actions. ⚠️ **Aprendizaje operativo**: cancelar runs de Actions **no es accionable** ni por el agente ni por el PAT de `gh` (ambos HTTP 403) — solo desde la UI web. Con el `paths-ignore` ya no debería ser necesario.

---

## Sesión 2026-06-05 — Cierre del leg Google de SEC-001 H1.2 por boundary + reaper (ADR-057)

> DEFINE→SHIP completo del cierre del último vector pendiente de SEC-001 H1.2 (signup Google). **Deploy a prod SUCCESS.**

- **Enfoque**: en vez de re-desplegar la blocking function Gen 2 (abandonada por deprecación, ver sesión 2026-05-29), se cierra el leg Google **por boundary + reaper** (ADR-057): el control vive en el boundary ADR-001 + un reaper que limpia cuentas Google huérfanas.
- **Fix CodeQL incluido**: alerta `js/incomplete-sanitization` en `escapeCell` resuelta (de SHIP-prep volvió a BUILD para corregirla — disciplina de ciclo respetada).
- **SHIP**: deploy prod **SUCCESS** + `terraform apply` (**reaper en `paused`** — no corre solo) + **dry-run validado** (`scanned=14`, **0 acciones** → no había huérfanas que limpiar). **SC-1.2.2 Google leg = MET.**
- PRs **#402** (`d867bdf` cierre por boundary + reaper, ADR-057) → **#403** (spec → Merged) → **#404** (corrobora 3 follow-ups + nuevo `tfvars.example` stale post-deploy) → **#405** (spec → Shipped: deploy + apply + dry-run validado). Artefactos en `.specs/sec-001-h1-2-google-boundary-closure/`.

---

## Sesión 2026-06-03 — App Check (feat/app-check) + DEFINE epic entorno dev + hilo gitleaks abierto

> **Cero ejecución cloud en esta sesión salvo lecturas read-only de gcloud.** Se escribió código de App Check (en rama propia) y documentos de definición (ADR/spec). No se creó proyecto, no se tocó billing/IAM, no se refactorizó Terraform.

### 🔐 Firebase App Check con reCAPTCHA v3 — **PR #401 MERGEADO a `main`** · deploy pendiente gate de aprobación

Integrado en `apps/web` (Vite + SDK modular). Init de App Check entre `initializeApp` y `getAuth`, con `ReCaptchaV3Provider` + `isTokenAutoRefreshEnabled: true`. Site key vía `VITE_RECAPTCHA_SITE_KEY` (required, Zod en `env.ts`). Debug token gateado por `import.meta.env.DEV` (eliminado por tree-shaking en prod — verificado contra el bundle).

- 🔗 **PR #401 MERGEADO** (squash, 2026-06-03): https://github.com/boosterchile/booster-ai/pull/401. **`feat/app-check` borrada.**
- ⏳ **Deploy pendiente del PO**: `release.yml` corrida **#26903303075** (`pending`) → frena en el GitHub Environment `production` (`required_reviewers`). **No avanza a canary hasta aprobación humana.** *(Aparte: corrida vieja #26661217929 del 2026-05-29 quedó en `waiting` sin accionar.)*
- 🔴 **Orden crítico post-deploy**: aprobar gate → canary → dejar pasar tráfico real → ver en App Check → Métricas que el grueso aparezca **verificado** → **recién entonces** activar enforcement. Activarlo con métricas en 0/0 = outage. Ver `.specs/_followups/app-check-enforcement-activation.md`.
- **REVIEW formal ejecutado** (cooling-off 11 h): code-reviewer + security-auditor + devils-advocate. Encontraron **1 bloqueante real**: `VITE_RECAPTCHA_SITE_KEY` required pero **no cableada en el deploy** → el bundle de prod llevaba `undefined` → la PWA **no booteaba para ningún usuario** (mecanismo **runtime**, NO build-time como reportaron los 3 agentes; corregido empíricamente: `vite build` sin la var da EXIT 0). **Resuelto**: cableada en `Dockerfile` + `cloudbuild.production.yaml` (build-arg + substitution `_VITE_RECAPTCHA_SITE_KEY` = `6Lc5Bwot…`, pública). + 2 fixes de calidad (quitar `as unknown as`, test del invariante debug-token).
- **Fix CI incluido en el PR**: `e2e-staging.yml` corría `playwright install --with-deps chromium webkit` y **el install de webkit colgaba 30 min → timeout** (5+ noches de nightlies cancelados + el check rojo de #401). Movido a `container: mcr.microsoft.com/playwright:v1.59.1-noble` (browsers preinstalados). a11y verde + nightlies destrabados. NO se tocó `BASE_URL` (los e2e se skipean sin `E2E_USER_*` → verde por skip; apuntar a prod era innecesario).
- **REVIEW formal ejecutado** (cooling-off 11 h): code-reviewer + security-auditor + devils-advocate. Encontraron **1 bloqueante real**: `VITE_RECAPTCHA_SITE_KEY` required pero **no cableada en el deploy** → el bundle de prod llevaba `undefined` → la PWA **no booteaba para ningún usuario** (mecanismo **runtime**, NO build-time como reportaron los 3 agentes; corregido empíricamente: `vite build` sin la var da EXIT 0). **Resuelto**: cableada en `Dockerfile` + `cloudbuild.production.yaml` (build-arg + substitution `_VITE_RECAPTCHA_SITE_KEY` = `6Lc5Bwot…`, pública). + 2 fixes de calidad (quitar `as unknown as`, test del invariante debug-token).
- **Evidencia final**: 8/8 tests, typecheck + Biome limpios, build con var → site key inlineada en bundle ✓, debug flag 0 escrituras en prod.
- Artefactos: `.specs/app-check-recaptcha/{spec,verify,review}.md`.
- **Debug token local DIFERIDO al epic de dev** (decisión PO 2026-06-03, opción B): requiere `.env.local` que bootee con config Firebase; se descartó apuntar a prod → se hará contra el proyecto de dev cuando exista (ADR-055). Anotado en `dev-environment-separation §6`.
- **Enforcement**: NO activar hasta ver tráfico verificado post-deploy. Trackeado en [`.specs/_followups/app-check-enforcement-activation.md`](../../.specs/_followups/app-check-enforcement-activation.md). *(Verificado esta sesión: métricas App Check en 0/0 **porque el código aún no está desplegado** — el reloj arranca post-merge+deploy.)*
- ⚠️ `apps/web/.env.local` (gitignored) quedó con **solo** la reCAPTCHA key + placeholders; **revertido** de los valores de prod que se habían puesto por error.

### 🏗️ DEFINE — Epic entorno de desarrollo separado (ADR-055 DRAFT + spec)

Origen: al configurar el dev local de App Check se descubrió que `.env.local` apuntaba a **prod** (`booster-ai-494222` + `api.boosterchile.com`) → riesgo de tocar datos reales desde local. El PO eligió la dirección **proyecto Firebase/GCP de dev dedicado** (vs. emuladores, vs. no construir).

- **ADR**: [`docs/adr/055-separate-development-environment.md`](../adr/055-separate-development-environment.md) — **DRAFT, NO Accepted**.
- **Spec**: [`.specs/dev-environment-separation/spec.md`](../../.specs/dev-environment-separation/spec.md) — Draft.
- **Estado verificado**: infra **flat single-project** (solo `booster-ai-494222`); **NO existen** `environments/{dev,staging,prod}/` ni workspaces → ⚠️ **discrepancia CLAUDE.md-vs-realidad** (CLAUDE.md los menciona; no existen). Org `boosterchile.com`, billing `019461-C73CDE-DCE377` (la misma de prod).
- **4 decisiones ABIERTAS (sin resolver)**: (a) nombre/ID del proyecto (`booster-ai-dev`?); (b) estructura Terraform (módulo+environments vs. workspaces vs. tfvars); (c) alcance de réplica (todo prod vs. subset Auth+Firestore+API); (d) división de labor cloud + acciones gated (`gcloud projects create`, billing, Firebase/Identity Platform/APIs, IAM/org-policies, site key reCAPTCHA de dev) — **ninguna se ejecuta hasta sesión futura con autorización explícita**.

### 🩹 Hilo gitleaks — ABIERTO, no perder (tema separado del entorno dev)

Verificación empírica de las claves `AIza…` del repo (gcloud read-only, `services api-keys describe`):

- ✅ **Maps key** (`eb016256`): **verificada** — referrer restringido a `https://app.boosterchile.com/*`. Segura para allowlist.
- 🔴 **Firebase web key** (`2bcd204b`): `browserKeyRestrictions: {}` — **ninguna restricción a nivel de key**. Su seguridad depende de **App Check enforcement + Firebase Security Rules**, **AÚN NO verificadas en Firebase Console** (lo hace el PO).
- ⏳ **Allowlist `.gitleaks.toml` de las `AIza…`: PENDIENTE** de esa verificación. Los **2 falsos positivos verdes** ya allowlisteados (fixtures logger `generate.mjs`+`adversarial-100.json` + región GCP en evidencia SEC-001) están en **`stash@{0}` sobre `chore/working-tree-hygiene`**, sin commitear, esperando cerrar la decisión Firebase para un solo commit limpio.

### 📋 Inventario ADR-vs-prod — ✅ COMPLETO (2026-06-03)

**Barrido completo ADR-001→054 + CURRENT.md** (008-054 esta sesión, vía agentes paralelos read-only + spot-check de los 🔴). 003 ausente; colisiones 028/034/035 ambas cubiertas; ADR-055 = dev-env DRAFT auto-escrito, N/A. Detalle en [`.specs/adr-vs-prod-inventory/inventory.md`](../../.specs/adr-vs-prod-inventory/inventory.md).

**Veredicto global**: el núcleo técnico/transaccional implementado tiene **alta fidelidad** (infra, KMS, Pub/Sub, Web Push, SSE, pricing/factoring, matching v1/v2, RBAC, auth-universal, site-settings, ADC migrations — varias verificadas live en GCP; en pricing/auth el código va **por delante** del ADR). Los gaps son: features aspiracionales (010-012 landing/admin-modules/observatorio), componentes a-construir (NLU/Gemini, carta-porte), microservicios skeleton, y **3 drifts/residuales que valen acción**:

| 🔴 | Tipo | Acción |
|---|---|---|
| **ADR-020** GitLab ficticio (CI real = GitHub Actions) | doc/contrato | follow-up → ADR superseding |
| **ADR-049** `.claude/settings.json` inexistente (CLAUDE.md afirma que declara plugins) | doc/contrato | follow-up → crear archivo o corregir CLAUDE.md |
| **ADR-052/054** signup residual | seguridad/operativo — **YA trackeado** | vector cerrado (hotfix `EMPRESA_SELF_ONBOARDING_ENABLED=false`); blocking-fn OFFLINE es **por diseño** (PO eligió Alt G); abierto en `google-boundary-closure` (Draft) + `onboarding-flow-redesign` (P1) |

Stubs dejados: [`_followups/adr-020-supersede-gitlab-to-github-actions.md`](../../.specs/_followups/adr-020-supersede-gitlab-to-github-actions.md) · [`_followups/adr-049-claude-md-settings-json-reconcile.md`](../../.specs/_followups/adr-049-claude-md-settings-json-reconcile.md) · [`_followups/signup-residual-consolidation-adr-052-054.md`](../../.specs/_followups/signup-residual-consolidation-adr-052-054.md) (consolida + corrige el encuadre del residual signup).

---

## Sesión 2026-06-02 — Transición multi-máquina + higiene working tree + gitleaks + inventario ADR-004→007

### 🔀 Adopción de workflow multi-máquina (origin = única fuente de verdad)

A partir de esta sesión el PO deja de trabajar desde el Mac Mini (con el repo en el **pendrive** `/Volumes/Pendrive128GB`) y continúa desde el **MacBook Pro**. Decisión operativa:

- **GitHub `origin` (`boosterchile/booster-ai`) es la única fuente de verdad.** El pendrive deja de ser el medio de trabajo.
- **Cada máquina trabaja desde su propio clon** en disco interno (no en el pendrive).
- **Disciplina**: `git pull` al empezar · **`git push` tras CADA avance** (no solo al cerrar). Nada de trabajo acumulado sin respaldo en origin.
- El PR agrupado (higiene + inventario + lo que venga) se hará cuando el trabajo sustantivo esté completo, **para gastar una sola corrida de canary**. No mergear a `main` por avances parciales.

### 🧹 Higiene de working tree (4 commits)

El árbol tenía cambios sin commitear de sesiones previas. Diagnosticados y resueltos en commits atómicos (todos en la rama `chore/working-tree-hygiene`):

| Commit | Cambio | Naturaleza |
|---|---|---|
| `83f2195` | `chore(infra): terraform fmt` en 4 `.tf` (crash-traces, messaging, networking, telemetry-monitoring) | Whitespace-only; `terraform fmt -check` ahora exit 0. Cero semántica. |
| `231ff50` | `chore(repo): ignorar booster-skills/` | El clon embebido del plugin (repo propio) ya no contamina `git status`. |
| `87ca24b` | `docs(inventory): versionar adr-vs-prod-inventory` | Trabajo activo antes untracked. |
| `a38157f` | `docs(sec-001): audit trail specs google-blocking-c (SUPERSEDED) + boundary-closure` | Specs históricos retenidos como trazabilidad. |

### 🔐 gitleaks instalado en el Mac Mini (NO viaja a otras máquinas)

El pre-commit venía avisando `WARN: gitleaks no instalado` hace varias sesiones y **se saltaba el escaneo de secretos silenciosamente**. Instalado `gitleaks 8.30.1` vía Homebrew y **verificado activo** (commit de prueba: el WARN desapareció, el hook ahora corre `gitleaks protect --staged` de verdad — se ve "scanned ~X KB … no leaks found" en cada commit posterior).

> ⚠️ **Esto es local al Mac Mini.** En el MacBook Pro hay que repetir `brew install gitleaks` (ver §SETUP MACBOOK), o el hook volverá a saltarse el escaneo silenciosamente.

### 📋 Inventario ADR-vs-prod avanzado: ADR-004 → ADR-007 (gcloud read-only empírico)

Retomado desde el cursor (ADR-004) con la misma disciplina: verificación empírica de cada afirmación material, prod read-only, 🟡 lo no verificable (no inventar 🟢), 🔴 lo afirmado-pero-falso. Detalle completo en [`.specs/adr-vs-prod-inventory/inventory.md`](../../.specs/adr-vs-prod-inventory/inventory.md). Resumen:

| ADR | Resultado | Destacado |
|---|---|---|
| **004** Uber-like + 5 roles | 2🟢 +1🟢(existencia) · 1🟡 · **1 🔴** | **🔴 NUEVO**: `packages/trip-state-machine` es un **stub de 7 líneas** (`TODO: implementar`), **sin XState** — pese a que ADR-004/005 lo afirman como el lifecycle implementado. La lógica de estados SÍ existe pero **dispersa inline en `apps/api/src/services/`** (liquidar-trip, asignar-conductor, confirmar-entrega, offer-actions…), lo que **viola la regla de arquitectura de CLAUDE.md** ("prohibido lógica inline en services"). Medio, **no externo** (deuda arquitectónica, no agujero de seguridad). |
| **005** Telemetría IoT | 3🟢 · 3🟡 | **Cierra los 2 🟡 de ADR-001**: Firestore `FIRESTORE_NATIVE` en `southamerica-east1` (match exacto) + BigQuery datasets vivos (dataset se llama `telemetry`, no `booster_telemetry`). DLQ existe como `pubsub-dead-letter` genérico (no `telemetry-events-dlq`). |
| **006** WhatsApp Meta | 3🟢 · 2🟡 | whatsapp-bot/client + ai-provider + `whatsapp-inbound-events` + 4 secrets (+`verify-token` extra) vivos. Twilio→Meta diferido a **ADR-025**. |
| **007** Gestión documental Chile | 2🟢 · 2🟡 · **1 🔴** | **🔴 re-confirma el retention-lock**: ADR-007 línea 189 promete textualmente "no se puede eliminar ni siquiera por admin", pero el bucket `documents-prod` tiene `isLocked=false` (la afirmación más explícita del mismo hallazgo de ADR-001). Provider DTE Bsale→**ADR-024** (Sovos). CMEK + keyring `booster-ai-keyring` ✓. |

**Cursor del inventario: retomar desde ADR-008.** Orden estricto 008→050 + CURRENT.md. Verificaciones diferidas a su ADR: Twilio→Meta (ADR-025), provider DTE (ADR-024), Routes API ADC (ADR-038).

**Findings 🔴 acumulados del inventario** (todos medios, ninguno externo/explotable):
1. Finding #1 pipeline deploy (alto) — **ya cerrado** sesión 2026-05-29 (gate `required_reviewers`).
2. Retention-lock GCS DTE (medio) — `isLocked=false`; trackeado `.specs/sec-h3-dte-retention-lock/` (Draft). Re-confirmado en ADR-007.
3. **NUEVO** trip-state-machine stub + lógica inline (medio) — deuda arquitectónica narrativa-vs-realidad.

### 📝 Los dos 🔴 documentados como specs accionables (2026-06-02 — NO ejecutados)

Ambos 🔴 quedan documentados como specs versionados para resolverse con tiempo desde el MacBook. **Ninguno se ejecutó; no se tocó prod ni infra — solo se escribieron specs.**

| Finding | Spec (path) | Estado | Naturaleza |
|---|---|---|---|
| trip-state-machine stub + lógica inline | [`.specs/arch-trip-state-machine-refactor/spec.md`](../../.specs/arch-trip-state-machine-refactor/spec.md) | Draft — pendiente priorizar | Refactor de **ciclo completo** (extraer lógica inline de `apps/api/src/services/` → máquina XState en el package, según ADR-004). Estándar profesional, no parche. |
| retention-lock DTE | [`.specs/sec-h3-dte-retention-lock/spec.md`](../../.specs/sec-h3-dte-retention-lock/spec.md) (**actualizado**, no nuevo) | Draft — **decisión PO pendiente** | Spec PREPARA la decisión (trade-off completo §0: gana cumplimiento SII inmutable; arriesga irreversibilidad). La decisión la toma el PO **fresco, fuera de presión**. NADA de tocar bucket/Terraform. |

### 🖥️ SETUP MACBOOK — configurar una sola vez en el MacBook Pro

Para continuar el trabajo desde el MacBook Pro (disco interno, **NO** pendrive):

1. **Clonar el repo a disco interno** (ej. `~/dev/booster-ai`, no `/Volumes/...`):
   ```bash
   git clone https://github.com/boosterchile/booster-ai.git ~/dev/booster-ai
   cd ~/dev/booster-ai
   git checkout chore/working-tree-hygiene   # rama con el trabajo de hoy
   ```
2. **Toolchain vía Homebrew**:
   ```bash
   brew install gitleaks node pnpm
   # gitleaks: imprescindible o el pre-commit salta el escaneo de secretos en silencio
   # node: respetar .nvmrc (v22) — usar nvm/fnm si se prefiere gestor de versiones
   ```
   Luego `pnpm install` en la raíz del monorepo.
3. **GitHub CLI**: `gh auth login` (para PRs/merges/deploys; recordar: CI/CD canónico es GitHub, no GitLab).
4. **Google Cloud — re-autenticar** (los comandos del inventario y queries prod lo necesitan):
   ```bash
   gcloud auth login                          # credenciales de usuario (gcloud CLI: run/sql/redis/storage/kms describe)
   gcloud auth application-default login       # ADC (túnel psql headless + client libs)
   gcloud config set project booster-ai-494222
   ```
5. **Re-autenticar las MCP de Google Cloud** (BigQuery + Compute Engine) en Claude Code — su auth no viaja entre máquinas.
6. **Restaurar la memoria persistente de Claude** (no viaja por git — vive en `~/.claude/...`, fuera del repo). Respaldada en Drive `dev@boosterchile.com` → `Mi unidad/claude-memory/booster-ai/`, vía el script `~/.claude/sync-booster-memory.sh` (creado 2026-06-07).
   ```bash
   # con el Drive dev@boosterchile.com montado y sincronizado:
   ~/.claude/sync-booster-memory.sh pull    # Drive -> ~/.claude/.../memory/
   ```
   - El script no viaja solo por git tampoco; copialo/recrealo en la máquina nueva (vive en `~/.claude/`).
   - **Disciplina cross-máquina** (como `git push`/`pull`, pero para memorias): `…/sync-booster-memory.sh push` al **cerrar** sesión en una máquina, `pull` al **abrir** en otra. Aditivo por defecto (nunca borra); `--mirror` para espejo fiel. `status` para ver diffs.

> Una vez configurado: `git pull` de `main` trae todo el trabajo (el código vive 100% en `origin/main`); las memorias se restauran con el paso 6. La rama histórica `chore/working-tree-hygiene` ya está mergeada a `main`.

### Estado de la rama `chore/working-tree-hygiene` (en origin)

Commits al cierre de esta sesión (todos pusheados a `origin`, **sin mergear a `main`**):
- `83f2195` `231ff50` `87ca24b` `a38157f` — higiene (fmt, gitignore, inventario inicial, specs SUPERSEDED).
- `ed815ce` — inventario ADR-004 + 005.
- `167ff51` — inventario ADR-006 + 007.
- (+ este handoff CURRENT.md).

---

## Sesión 2026-05-29 — Vector auto-onboarding cerrado en prod + gate de deploy + inventario ADR-vs-prod

### Pivote: Sprint 2c (Google blocking function) ABANDONADO

Sprint 2c-A/B/C construían una Identity Platform blocking function (`beforeCreate`) para gatear el self-signup Google. Quedó bloqueado (Gen 1 builds muertos por deprecación; Gen 2 requería un spike que muta prod). Durante la evaluación D-vs-G se verificó que el handler (`apps/auth-blocking-functions/src/handler.ts`) era **deny-puro** (sin provisioning, solo lectura de allowlist) → su invariante podía vivir en el boundary ADR-001. Specs marcados SUPERSEDED:
- `.specs/sec-001-h1-2-google-blocking-c/spec.md` (migración Gen 2) → SUPERSEDED.
- `.specs/sec-001-h1-2-google-boundary-closure/spec.md` → premisa corregida (ver abajo).
- `.specs/sec-001-h1-2-google-blocking-c/alt-d-vs-g-comparison.md` (decisión PO: G + reaper).

### 🔒 Vector de seguridad VIVO encontrado y CERRADO en prod

Devils-advocate (sobre el spec boundary-closure) + verificación contra código revelaron: **`POST /empresas/onboarding` → `onboardEmpresa` (`services/onboarding.ts`) no tenía gate de aprobación** — cualquier usuario Firebase autenticado podía crear `users`+`empresa`+`membership rol='dueno' status='activa'`. Ruta sobre `firebaseAuthMiddleware` sin `userContext`; Google `signInWithPopup` vivo; blocking function nunca desplegada. **Cualquiera podía auto-promoverse a dueño activo sin aprobación.**

**Forense prod read-only (2026-05-29):** `solicitudes_registro` vacía; los **7 dueños activos** (2 cuentas PO, piloto Van Oosterwyk, Barvan + Nova Qualitas [externas legítimas, PO confirmó mantener], 2 demo) se crearon 05-02→05-12, **antes** del flujo de aprobación (~05-26). **Cero explotación.**

**Fix (PR [#398](https://github.com/boosterchile/booster-ai/pull/398) `afdb933`):**
- Flag `EMPRESA_SELF_ONBOARDING_ENABLED` (`booleanFlag(false)` — kill switch, OFF es el estado seguro).
- Gate de ruta: 403 `onboarding_disabled` **antes de cualquier escritura** cuando el flag está OFF.
- Defensa en profundidad (service layer): `onboardEmpresa` requiere `authorizedBy: 'self_service' | 'admin_provisioned'` y rechaza self_service con flag OFF.
- Backstop conductual (no parser estático — rechazado por DA como teatro): test flag-off→403 sin escrituras.
- Los 7 dueños existentes intactos (no se re-onboardean; 409 intacto).

**Promovido a prod por canary observado por el PO** (revisión `00355-beg` 100%; `signup_probe` 204/204 sano post-100%; smoke principal `/empresas/onboarding` sin auth → 401, binario nuevo vivo). El 403 autenticado quedó cubierto por integration tests + lectura de código + el 401 (la app usa RUT+clave numérica, no Google → token headless impráctico).

### 🚪 Hallazgo de proceso: merge→main auto-desplegaba a PROD sin approval — GATE CREADO

Al promover el fix se descubrió que **no existe staging** (solo servicios prod; `cloudbuild.staging.yaml` muerto; `release.yml` removió `deploy-staging`) y que **merge a `main` auto-disparaba el canary de PRODUCCIÓN sin gate de aprobación humana** (el GitHub Environment `production` tenía solo `branch_policy`, cero `required_reviewers`). Contradecía CLAUDE.md ("staging auto + prod manual approval"). Es el **finding #1** del inventario.

**Cerrado (PR [#399](https://github.com/boosterchile/booster-ai/pull/399) `4edd3b1`):**
- Aplicado `required_reviewers=boosterchile` (`prevent_self_review=false`) en GitHub Environment `production` (vía `gh api`, no es archivo de repo). **Verificado conductualmente**: el merge de #399 dejó `deploy-production` en "Waiting for approval", ya no auto-despliega.
- CLAUDE.md §Deploy reconciliado con la realidad (no staging; merge→release.yml→aprobación→canary 1%→30min→100%; `canary-verify` es placebo `exit 0`, `signup_probe` es la única señal real).
- Eliminada la regla de horario de viernes (decisión PO: riesgo vía gate + observación canary, no calendario).

**Mecanismo de promoción observada usado** (el pipeline auto-avanza 1%→100% sin pausa nativa): aprobación humana en GitHub → `route-canary` 1% → **cancel del build para congelar** → observación `signup_probe` → GO 100% del PO → `update-traffic --to-latest` manual. Nota: solo la API se promovió (cancel fue antes de deploy-web/whatsapp/telemetry/sms; cambio es API-only). El run `deploy-production` en GitHub figura `failure` por el cancel intencional; prod SÍ está al 100% nuevo.

### Inventario ADR-vs-prod iniciado (el "alto")

`.specs/adr-vs-prod-inventory/inventory.md` — verificación empírica (no narrativa) de cada afirmación material de ADRs vs prod. Progreso:
- **Finding #1** (pipeline deploy) 🔴 ALTO — **cerrado** esta sesión (gate).
- **ADR-001** (stack): 8 🟢 (WIF sin keys, secrets en Secret Manager, OIDC s2s, Cloud Run x8, GKE prod+DR, Cloud SQL pg16, Redis 7.2, Pub/Sub) · 1 🟡 (Firestore/BigQuery no verificados) · **1 🔴 MEDIO**: bucket DTE `documents-prod` tiene CMEK + período 6 años pero **`retention_policy.isLocked=false`** → retención SII no inmutable (insider con `storage.buckets.update`). Trackeado en `.specs/sec-h3-dte-retention-lock/` (Draft); lock irreversible. No explotable externo.
- **ADR-002**: superseded by ADR-049, supersesión verificada en el repo 🟢.
- **Cursor: retomar desde ADR-004.** Orden estricto 001→050 + CURRENT.md.

### Pendientes / parqueado para próximas sesiones

1. **Continuar inventario ADR-vs-prod desde ADR-004** (cursor en el doc).
2. **🔴 Retention Lock GCS DTE** (`sec-h3-dte-retention-lock` Draft) — decisión aparte (lock irreversible).
3. **PR-2** del hotfix onboarding: route-audit doc (`evidence/route-boundary-audit.md`) + `forensic-blast-radius.md` + web 403-handling check (P2-6).
4. **Followup `onboarding-flow-redesign`** (`.specs/_followups/`): conflicto 409 approve↔onboarding, email real, flip de flags, estrategia demo/app (*conocer Booster* vs *dueño operativo*).
5. **🟡** Verificar Firestore + BigQuery (ADR-001). **2h watch** post-deploy del `signup_probe` si se desea cubrir formalmente.
6. **Servicios no-API** (web/whatsapp/telemetry/sms) siguen en revisiones previas (el canary del fix solo promovió API; inocuo, cambio API-only) — re-desplegar en el próximo deploy normal.

---

## Sesión 2026-05-28 — CI/CD outage 28h resolved + canary lane unblocked

### Descubrimiento

T8 prep gcloud check (verificar `SIGNUP_REQUEST_FLOW_ACTIVATED` prod + canary status) reveló: 15 Cloud Build runs consecutivos FAILURE desde 2026-05-27 15:46Z hasta 2026-05-28 19:14Z (28 h, primer build fallido inmediatamente después de merge de T3 PR #384). Root cause: **dos defectos shipping juntos en T3** + un tercer defecto en T13 enmascarado.

| Defecto | Quién shippeó | Cómo se manifestó | Fix |
|---|---|---|---|
| `cloudbuild.production.yaml:460` `--gen2=false` syntax inválida (gcloud boolean flags rechazan `=value`) | T3 PR #384 (2026-05-27 17:00Z) | `deploy-auth-blocking` exit code 2 → Cloud Build cancela todos los demás steps in-flight | T3-fix PR #392 — `--no-gen2` (forma documentada de force Gen 1) |
| `cloudbuild.production.yaml` auth-blocking 3 steps sin substitution gate, ejecutan en cada merge a main | T3 PR #384 | Bloqueó api/web/whatsapp/telemetry deploys por 28 h | T3-fix PR #392 — gate `_AUTH_BLOCKING_DEPLOY: 'false'` default; T6 runbook §2 Step 2 pasa `=true` para T8 manual |
| `cloudbuild.production.yaml:184` `canary-signup-${_COMMIT_SHA}` tag (14+40=54 chars) + service `booster-ai-api` (14) = 68 > 46 Cloud Run hard limit | T13 PR Sprint 2b (2026-05-26) — nunca corrió end-to-end por enmascaramiento de T3 | `deploy-canary` step error: `traffic tag ... and service name ... together are too long` | T13-fix PR #393 — option-B inline short SHA `${FULL_SHA:0:12}` en bash; sin substitución nueva, sin release.yml change |

### PRs shipped (2 cycles compressed solo-dev en single session)

| PR | Commit | Foco | DA verdict inicial | DA-resolved verdict |
|---|---|---|---|---|
| [#392](https://github.com/boosterchile/booster-ai/pull/392) | `f744ef0` | T3-fix cloudbuild `--no-gen2` + auth-blocking gate + state-drift guard (`gcloud functions describe \|\| exit 1` antes de deploy) | BLOCK_MERGE (2 P0 + 4 P1) | APPROVE post-resolutions commit `8ed4d8f` |
| [#393](https://github.com/boosterchile/booster-ai/pull/393) | `11aab26` | T13-fix canary tag length — option-B inline 12-char short SHA en `entrypoint: bash` para `deploy-canary` + `route-canary` + `canary-verify` | BLOCK_MERGE (1 P0 + 3 P1) | APPROVE post-resolutions commit `6cb2345` |

Ambos PRs:
- Spec amendment a plan existente (T3-fix → `.specs/sec-001-h1-2-google-blocking-b/plan.md`; T13-fix → `.specs/sec-001-cierre/plan-sprint-2b.md`).
- Squash merge a `main`.
- Cooling-off solo-dev §6.1 waiver explícito en session ledger (justificación: P0 CI/CD broken 28h outage).
- Build-gate (`Sprint 2c-B build gate (ADR-052 Accepted)`) bypassed vía documented escape-hatch (`gh workflow run sprint-2c-build-gate.yml -f force=true`) — circular dep: gate requiere ADR-052 Accepted, ADR-052 requiere canary, canary requiere estas fixes. Tracked en `.specs/_followups/sprint-2c-b-gate-bypasses.md`.

### Devils-advocate hardening lessons (BOTH PRs blocked initial drafts)

T3-fix DA v5 P0 findings que se materializaron en código:
- `env:` block + `$$VAR` pattern era redundante → cambiado a direct `${_AUTH_BLOCKING_DEPLOY}` Cloud Build substitution con comentario inline prohibiendo reintroducir el pattern.
- "PR's own Cloud Build = empirical proof" era ficción (cloudbuild.production.yaml solo corre en main, no PR branches) → rewrote verification path con (a) post-merge auto-build observation como única evidencia dispositive.
- Rollback claim "revert this PR" era anti-rollback (reintroduce el 28h outage) → rewrote como "forward-fix only".
- State-drift guard (`gcloud functions describe || exit 1`) ahora previene gcloud de CREATE outside terraform state si T8 Step 1 no corrió.

T13-fix DA v1 P0 que se materializó en código:
- Placeholder default `_COMMIT_SHA_SHORT: '0000000000aa'` era el mismo anti-pattern que T3-fix rechazó. Eliminado completamente vía option-B inline: cada canary step convertido a `entrypoint: bash`, computa `FULL_SHA='${_COMMIT_SHA}'; SHORT_SHA="$${FULL_SHA:0:12}"`, usa `$${SHORT_SHA}` en tag. No substitución nueva, no release.yml change, no T6 runbook addition.

### Followups creados (2 P1 nuevos)

| Followup | Priority | Trigger |
|---|---|---|
| [`.specs/_followups/cloudbuild-substitution-canonicalization.md`](../../.specs/_followups/cloudbuild-substitution-canonicalization.md) | Escalated P2 → **P1** | T13-fix segundo amendment en 48h (T3-fix fue primero). Rule violation: amendment >1 file. **Third amendment is now blocked** hasta producir process ADR. Tracking 2 items: (1) `_AUTH_BLOCKING_DEPLOY` strict-match brittleness (typo `True`/`1`/`yes` → silent SKIP); (2) amendment-vs-sub-spec exception note. |
| [`.specs/_followups/cloud-run-canary-tag-cleanup.md`](../../.specs/_followups/cloud-run-canary-tag-cleanup.md) | **P1** | DA v1 P1 finding. Cloud Run retiene canary tags en revisions inactivas; cadencia daily deploys → quota hit (1000 revisions/service) en semanas. Tres opciones (A clean-up en deploy-api step; B scheduled job; C rotating stable tag). Triggering condition P0 documentada. |

### Estado operacional post-session

| Lane | Pre-session | Post-session |
|---|---|---|
| Cloud Build auto-trigger main | 100% FAILURE 28h | T3-fix verificado: 3 auth-blocking steps echo SKIP con verbatim `_AUTH_BLOCKING_DEPLOY='false'`, builds + pushes SUCCESS. T13-fix pending verification via build `8f4ec780` (WORKING al cierre de sesión). |
| Sprint 2b T13 canary lane | DONE 2026-05-26 pero nunca corrió end-to-end por enmascaramiento | T13-fix mergeado; primer build `8f4ec780` post-merge debe ejecutar `deploy-canary` con tag `canary-signup-<12-char-sha>` (40 chars combined ≤ 46). Wall-clock ~35-40 min incluyendo 30-min canary-sleep. |
| ADR-052 Status (Sprint 2b PR2) | Proposed | Proposed (sin cambio — flip requiere canary success + 2h watch) |
| ADR-054 Status (Sprint 2c-B) | Proposed | Proposed (sin cambio — flip requiere 7d watch post-T13 ADR-054, separate de T13 Sprint 2b) |
| `SIGNUP_REQUEST_FLOW_ACTIVATED` prod env | **Absent** (default `false`) | Sin cambio. Per amendment A3 v3.4 + plan §Pre-conditions, flip programado post-canary success. |
| Sprint 2c-B T8 (terraform apply T4+T5) | Blocked on ADR-052 Accepted (circular dep via T3 syntax bug) | Unblocked en cuanto ADR-052 flippee post-canary success + 2h watch. |

### Verification path pendiente

1. Build `8f4ec780` `deploy-canary` SUCCESS (1-3 min después de start 22:42:55Z).
2. `canary-sleep` 30 min.
3. `canary-verify` placeholder exit 0 (real MQL pendiente, tracked separately).
4. `deploy-api` routes 100% to latest.
5. 2 h watch sin alertas `signup_probe_failure`.
6. PO manual: `git commit -am "docs(adr-052): Accepted post-canary success cloudbuild run 8f4ec780"` (~2 LOC).
7. T8 cloudbuild submit con `--substitutions=_AUTH_BLOCKING_DEPLOY=true,_COMMIT_SHA=$(git rev-parse HEAD)` — auth-blocking lane ahora ejecuta normalmente con state-drift guard activo.
8. Sprint 2c-B T9 → T14c cierre operacional.

### Drift incidents ledger

| Item | Estado | Detalle |
|---|---|---|
| `sql_database_instance.main.ipv4_enabled` (heredado 2026-05-26) | Resolved 2026-05-26 | Reverted via `terraform apply -target` |
| T3 PR #384 cloudbuild `--gen2=false` + missing gate | Resolved 2026-05-28 via PR #392 | Surfaced en T8 prep |
| T13 canary tag 46-char limit | Resolved 2026-05-28 via PR #393 | Surfaced una vez T3-fix restauró ejecución downstream |
| Two amendments en 48h activaron escalation clause | P1 active | `cloudbuild-substitution-canonicalization.md` ahora P1; tercer amendment blocked hasta process ADR |

### Acciones pendientes (operacional)

1. **Watch build `8f4ec780`** — esperar deploy-canary SUCCESS y full pipeline green.
2. **2h watch post-canary** — observar Cloud Monitoring `signup_probe` sin alertas.
3. **Flip ADR-052 Status → Accepted** — separate commit `~2 LOC` post-watch success (per plan-sprint-2b §4).
4. **Sprint 2c-B T8 execution** — runbook `docs/qa/google-blocking-function-runbook.md` §2 Step 1 (`terraform apply -target=google_cloudfunctions_function.before_create`) → Step 2 (`gcloud builds submit ... _AUTH_BLOCKING_DEPLOY=true`) → Step 3 verify → Step 4 wire IdP.
5. **No third amendment** — escalation rule activa.

---

## SEC-001 cierre — spec Approved (2026-05-24)

Sesión de smoke E2E sobre `demo.boosterchile.com` reveló regresión backend: `POST /demo/login` → 404 silencioso porque `DEMO_MODE_ACTIVATED=false` en Cloud Run prod. Investigación trazó la causa a la rama abandonada `feat/security-blocking-hotfixes-2026-05-14` (22 commits sin PR; literal `<DEMO_SEED_PASSWORD literal eliminado en T8>` seguía en main HEAD en `apps/api/src/services/seed-demo.ts:86` + `seed-demo-startup.ts:142`; sin middleware enforcement; sin docs/qa; H2 `/auth/driver-activate` sin rate-limit; H3 bucket DTE `is_locked=false`). El `terraform apply` que apagó el flag se ejecutó desde esa rama → **drift IaC**: state Cloud Run diverge de main.

### Artefactos producidos en sesión 2026-05-24

| Path | Estado | LOC |
|---|---|---|
| [`.specs/sec-001-cierre/spec.md`](../../.specs/sec-001-cierre/spec.md) | **Approved** (v3.2) | 514 |
| [`.specs/sec-001-cierre/review.md`](../../.specs/sec-001-cierre/review.md) | 4 rondas devils-advocate | 272+ |
| [`.specs/sec-h3-dte-retention-lock/spec.md`](../../.specs/sec-h3-dte-retention-lock/spec.md) | Draft (spec hermano, split per O-5) | 140 |
| `.claude/ledger/2026-05-24_6f2f4fcd-da5a-46e9-9ea8-f22edbb59dde.jsonl` | 96 entries (auditoría completa) | — |

### Trayectoria devils-advocate (4 rondas, 0 P0 final)

| Ronda | Versión | P0 | P1 | P2 | Verdict |
|---|---|---|---|---|---|
| 1 | v1 | 6 | 8 | 3 | DO_NOT_APPROVE |
| 2 | v2 | 3 | 7 | 3 | APPROVE_WITH_RESERVATIONS |
| 3 | v3 | 2 | 4 | 3 | APPROVE_WITH_RESERVATIONS |
| 4 | v3.1 | 1 | 4 | 3 | APPROVE_WITH_RESERVATIONS_FINAL |
| — | **v3.2** | 0 | 0 | 3 residual | **PO Approved** |

### Alcance del spec

- **H1.0–H1.6**: demo mode flag + recreación de 4 UIDs (post-disclosure account replacement per SP-800-63) + middleware enforcement + TTL claim + monitoring 90d.
- **H1.2 expandido (O-1 in-scope)**: migración signup público `createUserWithEmailAndPassword` + `sendPasswordResetEmail` + Google provider + 11 métodos más a flow via Admin SDK con admin-approval gate. Self-signup Identity Platform OFF AMBOS providers.
- **H2**: rate-limit `/auth/driver-activate` (5/15min/RUT + IP-based 30/15min + fail-closed Redis).
- **H3 split**: `.specs/sec-h3-dte-retention-lock/` cubre bucket DTE retention lock SII Chile (irreversibilidad documentada). Mergea ANTES de H1.6.
- **H4 in-scope (O-12)**: PII redaction en `@booster-ai/logger` (compliance Ley 19.628).

### Decisiones PO documentadas en spec §13 (8)

| # | Decisión |
|---|---|
| O-1 | H1.2 in-scope con migration signup a Admin SDK first |
| O-5 | H3 split a spec hermano |
| O-11 | Recreate UIDs (new emails `demo-2026-*`) per SP-800-63 |
| O-12 | H4 PII redaction in-scope |
| O2-3 sub-1 | Perf budget realista ≤5ms cached / ≤200ms uncached |
| O2-3 sub-2 | Fail-closed (503 Retry-After:30) ante Firebase/Redis fail |
| OQ9 | settings.json renombrado a settings.audit.json (hook stale) |
| Final | Approve v3.2 + arranca /plan next-session |

### Deuda definida (tracked en spec §13 + review.md para /plan)

| Item | Tipo | Status |
|---|---|---|
| P1-R4-1: Google fallback orphan Firebase users (`auth.deleteUser` cleanup) | task /plan | abierto |
| P1-R4-2: Memorystore HA como SC concreto Terraform | task /plan | abierto |
| P1-R4-3: `normalizePhone` helper + ref `two-factor.ts` corregida | task /plan | abierto |
| P1-R4-4: Drizzle migration ordering pre seed-demo-startup | task /plan | abierto |
| P2-R4-1..3: enumeration timing oracle / UID migration en logs / drift TODO IaC | residual aceptado | doc |
| P2-R3-1..3: similares de round 3 | residual aceptado | doc |

### Sprint 1 cerrado (2026-05-25) — 14 tasks shipped

12 PRs mergeados a `main` en ventana 2026-05-24 → 2026-05-25:

| Task | PR | Commit | Foco |
|---|---|---|---|
| T0a drift reconcile (flag flip) | [#315](https://github.com/boosterchile/booster-ai/pull/315) | `a899e14` | variables.tf default true→false |
| T0b HCL import (secrets hotfix) | [#316](https://github.com/boosterchile/booster-ai/pull/316) | `172e345` | 145 LOC import abandoned branch, 0 destroys |
| Incidente SMS fallback gateway | [#317](https://github.com/boosterchile/booster-ai/pull/317) | `aa1cf4b` | WEBHOOK_PUBLIC_URL fix (17d outage) |
| T2 normalizePhone helper | [#318](https://github.com/boosterchile/booster-ai/pull/318) | `c0bfd6e` | shared-schemas chile primitives |
| T4 PII redaction core | [#319](https://github.com/boosterchile/booster-ai/pull/319) | `d9571bf` | email/RUT/JWT/password redaction |
| T5 PII redaction phone | [#320](https://github.com/boosterchile/booster-ai/pull/320) | `512195f` | extends T4 via T2 normalizePhone |
| T6 PII fixtures + thresholds + ADR-051 | [#322](https://github.com/boosterchile/booster-ai/pull/322) | `d7380d5` | FP=0/1000, FN=1/100 |
| T11 maintenance page | [#323](https://github.com/boosterchile/booster-ai/pull/323) | `c4e7026` | demo.boosterchile.com conditional render |
| T7 Secret Manager env mount | [#324](https://github.com/boosterchile/booster-ai/pull/324) | `396edf0` | DEMO_SEED_PASSWORD en compute.tf |
| T7.5 init script + CI gate WIF | [#325](https://github.com/boosterchile/booster-ai/pull/325) | `f3b21e6` | check-secret-version-exists job |
| T8 seed-demo lee env | [#326](https://github.com/boosterchile/booster-ai/pull/326) | `5af2548` | literal eliminado del repo |
| T7.5 evidence post-apply | [#327](https://github.com/boosterchile/booster-ai/pull/327) | `8ab57ba` | secret v2 + Cloud Run revision rotation |
| T1 Redis HA verify (no-op) | [#328](https://github.com/boosterchile/booster-ai/pull/328) | `a9f6296` | state ya STANDARD_HA confirmado |
| T3 STRICT_MIGRATION_ORDERING | [#329](https://github.com/boosterchile/booster-ai/pull/329) | `e68c67a` | gating fail-closed startup |
| T9 rate-limit-pin base | [#330](https://github.com/boosterchile/booster-ai/pull/330) | `9d1b2e5` | per-RUT 5/15min |
| T10 rate-limit IP + fail-closed | [#331](https://github.com/boosterchile/booster-ai/pull/331) | `7fa4c8d` | IP 30/15min + 503 + cascade docs |

### Evidencia operacional Sprint 1

- **Estado prod** verificado 2026-05-25:
  - `POST /demo/login` → **404** (flag OFF preservado, SC-1.0.2).
  - `demo.boosterchile.com/demo` → **200** maintenance page (SC-INT-1).
  - Secret `demo-seed-password` versions: v1 placeholder + v2 random (32B base64).
  - Cloud Run api revision `00304-4sf` Ready+Healthy con `DEMO_SEED_PASSWORD=secretRef:latest` + `REDIS_HOST` mounteado.
  - `git grep -F 'BoosterDemo2026' -- docs/ apps/ infrastructure/ packages/` → **0 matches** (SC-1.4.4).
- **terraform plan** post-apply T7+T7.5: residual = 1 cosmetic dashboard (monitoring_dashboard JSON formatting; pre-existente al SEC-001).
- **Evidence archivos**: `.specs/sec-001-cierre/sprint-1-evidence/` (T0 + T1 + T7.5 + Sprint 1 index).

### Sprint 1 dimensiones cubiertas

| Sub-fase | SCs | Status |
|---|---|---|
| **H1.0** demo mode flag default false | SC-1.0.1, SC-1.0.2 | ✅ T0 |
| **H1.4** Secret Manager seed password | SC-1.4.1, SC-1.4.2, SC-1.4.3, SC-1.4.4 | ✅ T7+T7.5+T8 |
| **H2** rate-limit `/auth/driver-activate` | SC-H2.1, SC-H2.1b, SC-H2.1c, SC-H2.2, SC-H2.4 | ✅ T1+T9+T10 |
| **H4** PII redaction logger | SC-H4.1, SC-H4.4 | ✅ T4+T5+T6 |
| **INT-1** maintenance page demo subdomain | SC-INT-1 | ✅ T11 |
| **P1-R4-2** Memorystore HA verified | round 4 closure | ✅ T1 |
| **P1-R4-3** normalizePhone helper | round 4 closure | ✅ T2 |
| **P1-R4-4** Drizzle migration ordering | round 4 closure + P0-4 gating | ✅ T3 |
| **P0-A** strict gate exact-1-diff (round 2) | gate enforcement | ✅ T0a/T0b sequence |
| **P0-B** STRICT_MIGRATION_ORDERING gating | outage prevention | ✅ T3 |
| **P0-C** T7.5.1 WIF viewer grant | CI gate fail-closed loudly | ✅ T7.5 + apply |
| **P0-5** secret init CI gate | seed-demo precondition | ✅ T7.5 + verified verde post-apply |
| **SC-1.2.5** rate-limit cascade docs | layering Cloud Armor+Redis | ✅ T10 |

### Sprint 2a cerrado (2026-05-25) — 12/12 tasks shipped + vector cerrado en prod

Sprint 2a cubrió **H1.1 (post-disclosure account replacement per ADR-053 + NIST SP 800-63)**: recreación de 4 cuentas demo + retirement de UIDs viejas comprometidas, con infraestructura de monitoreo TTL + middleware enforcement + integration test fail-closed Redis. 8 PRs mergeados a `main` en ventana ~14h:

| Task | PR | Commit | Foco |
|---|---|---|---|
| T0 CI integration job + setup-global migrator | [#333](https://github.com/boosterchile/booster-ai/pull/333) | — | DB+Redis service containers + migrator inline |
| T0.5 branch protection gh-api | — (PO direct) | — | `ci-success` required check + enforce_admins |
| T7a ADR-053 Proposed + plan v3.3 amendment | [#334](https://github.com/boosterchile/booster-ai/pull/334) | `21f8bab` | spec generador_carga rename |
| T1 Drizzle migration cuentas_demo | [#335](https://github.com/boosterchile/booster-ai/pull/335) | `bc573db` | 0038_cuentas_demo + domain schema |
| T2 4 Secret Manager secrets + init script | [#336](https://github.com/boosterchile/booster-ai/pull/336) | `451a3a2` | demo-account-password-{persona}-2026 |
| T3 seed-demo DB-driven + per-persona env | [#337](https://github.com/boosterchile/booster-ai/pull/337) | `dc031ec` | reads `DEMO_ACCOUNT_PASSWORD_<SUFFIX>_2026` |
| T4 harden-demo-accounts service + CLI | [#338](https://github.com/boosterchile/booster-ai/pull/338) | `a1290ac` | recreateAll + retire + retireOldBatch + renew + RUNBOOK |
| T5 demo-expires middleware + cache-warm + landing pre-warm | [#339](https://github.com/boosterchile/booster-ai/pull/339) | `974b0b8` | TTL claim enforce + perf budget P95 200ms |
| T6a demo TTL alerter cron + log-based metrics + alert | [#340](https://github.com/boosterchile/booster-ai/pull/340) | `e3e99e2` | conditional-counter pattern + Cloud Scheduler 06:00 |
| T6b demo-accounts.md per-UID table + alerts refs | [#341](https://github.com/boosterchile/booster-ai/pull/341) | `2dd16a1` | runbook 212 LOC |
| Fix STRICT_MIGRATION_ORDERING block (terraform apply unblock) | [#342](https://github.com/boosterchile/booster-ai/pull/342) | `c117474` | env_vars not secrets |
| Tsup entry harden-demo + terraform apply 2026-05-25 evidencia | [#344](https://github.com/boosterchile/booster-ai/pull/344) | `9956ded` | build/api + apply evidence |
| T4 + T7b cierre evidence + ADR-053 Accepted | [#345](https://github.com/boosterchile/booster-ai/pull/345) | `10c0c17` | one-shot retire evidence + per-UID table |
| T8 Redis fail-closed integration via testcontainers | [#346](https://github.com/boosterchile/booster-ai/pull/346) | `bb115c2` | 3 scenarios SC-1.1.2c + SC-H2.1b + MIT license audit |

### Evidencia operacional Sprint 2a

- **Vector compromised passwords PR#206 (disclosure 2026-05-10 → audit 2026-05-14) CERRADO en prod 2026-05-25T20:42Z**.
- **terraform apply 2026-05-25T17:55Z** (post-#342 fix): Cloud Run revision `booster-ai-api-00320-nhd` serving 100% traffic con 4 secrets + 4 env_vars + Cloud Scheduler + 2 log-based metrics + 1 alert policy.
- **`init-demo-secrets-2026.sh`** ejecutado: 4 secrets version 1 (random base64 16B).
- **`harden-demo-accounts.mjs --recreate`** ejecutado desde Cloud Shell ~19:48Z: created:4 skipped:0 durationMs=4537. 4 UIDs nuevas activas:
  - generador_carga `GtVtmajwdtU6UARYQDykP8AW1Vx2`
  - transportista `4DDODougqUXNkm7jTZJgkJKs5z2`
  - stakeholder `1h10ASeyeUSP18B7IKLXveZCxt82`
  - conductor `P4fuEB3HIzOAqr4m4X1vJjA7cam1`
- **`harden-demo-accounts.mjs --retire-old-batch`** ejecutado 2026-05-25T20:42:54Z: retired:4 failed:[] durationMs=3435. 4 UIDs viejas (nQSqGqVC..., Uxa37UZP..., s1qSYAUJ..., Gg9k3gIP...) disabled + audit logs emitted (log-based metric `sec001/demo_uid_retired` cuenta +4).
- **Window-of-overlap ~50min** (19:48Z recreate → 20:42Z retire). Bien dentro SLA 4h post-deploy-approval.
- **Evidence dir**: `.specs/sec-001-cierre/sprint-2a-evidence/` (terraform-apply + t4-one-shot-retire + t8-license-audit + t0-5-branch-protection).

### Sprint 2a dimensiones cubiertas

| Sub-fase | SCs | Status |
|---|---|---|
| **H1.1** post-disclosure account replacement (ADR-053) | SC-1.1.1, SC-1.1.2, SC-1.1.2c, SC-1.1.3, SC-1.1.4, SC-1.1.5 | ✅ T1+T2+T3+T4+T8 |
| **H1.3** is-demo middleware enforcement | SC-1.3.1, SC-1.3.2, SC-1.3.4 | ✅ T5 |
| **H2.1b** real Redis fail-closed validation | SC-H2.1b | ✅ T8 |
| **H1.x ops** TTL alerter + Cloud Monitoring | SC-1.x.1, SC-1.x.2 | ✅ T6a+T6b |
| **CI gating** integration tests (DB+Redis) | gate enforcement | ✅ T0+T0.5 |
| **ADR lifecycle** post-disclosure replacement | ADR-053 Proposed→Accepted | ✅ T7a+T7b |

### Sprint 2b H1.2 PR2 CERRADO (2026-05-26) — 9/9 tasks shipped + 3 terraform applies prod

Sprint 2b cubrió **H1.2 (migración signup público → Admin SDK admin-approval gate)** end-to-end: ADR-052 + DB schema + endpoint público + admin UI + Terraform IdP flip + canary deploy infra + drift discovery & resolution. **10 PRs mergeados a `main` (9 features + 1 hotfix) en sesión single-day**:

| Task | PR | Commit | Foco |
|---|---|---|---|
| T6 ADR-052 Proposed + signup-paths-audit | [#351](https://github.com/boosterchile/booster-ai/pull/351) | `dcfb588` | 14 Firebase Auth methods inventoried; alternatives + status-transition criteria |
| T7 Drizzle migration solicitudes_registro + pgEnum + domain | [#352](https://github.com/boosterchile/booster-ai/pull/352) | `d634626` | 0039 migration + signupRequestSchema canónico |
| T8 POST /api/v1/signup-request + rate-limit + liveness | [#353](https://github.com/boosterchile/booster-ai/pull/353) | `8f8b281` | 5/15min/IP + fail-closed 503 + email enumeration defense |
| T9a integration happy + enumeration + rate-limit | [#354](https://github.com/boosterchile/booster-ai/pull/354) | `d8d8a52` | testcontainers Redis + TEST_DATABASE_URL |
| T9b integration fail-closed Redis + cloud-armor cascade | [#355](https://github.com/boosterchile/booster-ai/pull/355) | `b85835b` | testcontainers stop mid-test + docs §signup-request layer |
| T10 admin UI + approve/reject service + feature flag | [#356](https://github.com/boosterchile/booster-ai/pull/356) | `4854703` | Admin SDK createUser + flag gated 503 + 5-state UI |
| T11 Terraform IdP self-signup OFF + doc | [#357](https://github.com/boosterchile/booster-ai/pull/357) | `7f5a563` | `client.permissions.disabled_user_signup` + Google residual tracked |
| T9c negative matrix per-method (5 creation paths) | [#358](https://github.com/boosterchile/booster-ai/pull/358) | `e9f869e` | contract test scope-reduced per amendment A2 v3.4 |
| T13 canary deploy + signup-probe + Terraform traffic ignore | [#359](https://github.com/boosterchile/booster-ai/pull/359) | `c54bcd6` | 5-step canary cloudbuild + uptime 60s + alert 2-consecutive |
| Hotfix signup_probe alert aggregation reducer | [#360](https://github.com/boosterchile/booster-ai/pull/360) | `23e7554` | DOUBLE-typed metric incompatibility (live patch reconciliation) |

### Evidencia operacional Sprint 2b H1.2

- **`terraform apply` 2026-05-26 19:42Z** — `google_identity_platform_config.default.client.permissions.disabled_user_signup: false → true`. Verified via Admin API curl:
  ```json
  { "client_permissions": { "disabledUserSignup": true } }
  ```
- **`terraform apply` 2026-05-26 19:55Z** — `google_monitoring_uptime_check_config.signup_probe` (60s sobre `/health/signup-flow`) + `google_monitoring_alert_policy.signup_probe_failure` (2 consecutive failures). Confirmed via Monitoring REST API.
- **`terraform apply` 2026-05-26 20:25Z** — `google_sql_database_instance.main.settings.ipConfiguration.ipv4Enabled: true → false`. Reverted manual drift introduced 2026-05-25 20:13Z. Evidence: 0 conexiones desde public IPs en 7-day log scan (sólo `[local]`, `127.0.0.1`, `10.8.0.x` Cloud SQL Auth Proxy + VPC connector). PRIMARY IP `34.176.157.71` deallocated.
- **`module.service_api` lifecycle update** — `terraform plan -target` post-drift-revert: **No changes. Your infrastructure matches the configuration.** El refactor del módulo cloud-run-service (dynamic traffic block + `ignore_changes = [..., traffic]`) es structurally no-op para state actual.
- **Evidence ledger**: `.claude/ledger/2026-05-26_3796e944-c02a-4ba0-8de4-316149db2ddd.jsonl` (eventos `phase_enter`/`pre_build_articulation`/`artifact_produced`/`phase_exit`/`pr_opened`/`pr_merged`/`terraform_applied` para cada task).

### Drift incident — `sql_database_instance.main.ipv4_enabled` (2026-05-26 investigation)

Discovered durante `terraform plan` post-T11 apply. Investigation findings + resolution:

| Aspecto | Detalle |
|---|---|
| Quién | `dev@boosterchile.com` (cuenta Felipe) |
| Cuándo | 2026-05-25 20:13Z (6 PATCH operations en 5 min) |
| Qué | enabled `ipv4Enabled: true` en prod via Cloud SQL Admin API directo |
| Estado .tf | `infrastructure/data.tf:136` siempre fue `false` desde initial commit (verified via `git log -L`) |
| Usage evidence | 0 conexiones desde public IPs en 7-day Cloud SQL connection log scan (filtered: only `[local]`, `127.0.0.1`, `10.8.0.x`) |
| Authorized networks | `[]` vacío (sin allowlist; ninguna IP externa puede conectar aunque el bind esté activo) |
| Resolution | Path C: investigated → no usage → reverted via `terraform apply -target` (42s, idempotente). Post-apply: 0 errors, conexiones internas continúan normales |

### Sprint 2b H1.2 dimensiones cubiertas

| Sub-fase | SCs | Status |
|---|---|---|
| **H1.2 SC-1.2.0** inventario exhaustivo Firebase Auth paths | SC-1.2.0 | ✅ T6 (signup-paths-audit.md) |
| **H1.2 SC-1.2.1** signup-request endpoint + admin-approval gate + Admin SDK createUser | SC-1.2.1 | ✅ T7+T8+T10 |
| **H1.2 SC-1.2.2 email/password leg** Identity Platform `disabled_user_signup=true` | SC-1.2.2 | ✅ T11 + applied prod |
| **H1.2 SC-1.2.2 Google leg** ~~TRACKED_RESIDUAL~~ → **MET** (boundary + reaper, ADR-057 supersede ADR-054) | spec amendment A4 2026-06-04 | ✅ boundary-closure Stream A (T1/T2/T7/T8/T9); followup cerrado/superseded. Gates operacionales: 1er run destructivo (`REAPER_DESTRUCTIVE=true` + sign-off PO), `terraform plan` per-env, decisión PO por INERT (T4) |
| **H1.2 SC-1.2.3** synthetic monitor signup-probe + canary 30min antes de full deploy | SC-1.2.3 | ✅ T13 + applied prod |
| **H1.2 SC-1.2.4** integration tests negative matrix per-method (5 creation paths) | SC-1.2.4 (amendment A2 v3.4) | ✅ T9c |
| **H1.2 SC-1.2.5** rate-limit + email enumeration defense + fail-closed + cascade docs | SC-1.2.5 | ✅ T8+T9a+T9b |
| **ADR-052** signup migration Admin SDK gate | Proposed → Accepted pending T13 canary success + 2h watch | 🟡 Proposed |

### Acciones pendientes para cerrar SEC-001 H1.2 completamente

1. **Próximo deploy api real** corre canary sequence end-to-end (`deploy-canary --no-traffic → route-canary --to-tags=...=1 → canary-sleep 30min → canary-verify → deploy-api --to-latest`). Wall-clock ~32-35 min. Observar Cloud Build UI primer corrida.
2. **Post-canary success + 2h watch** sin alertas `signup_probe_failure` → separate commit ADR-052 Status flip:
   ```bash
   # Edit docs/adr/052-signup-migration-admin-sdk-gate.md línea 3:
   #   Proposed (2026-05-26; T6 Sprint 2b H1.2 PR2). ...
   # → Accepted (post-canary run <CLOUDBUILD_BUILD_ID> + 2h watch <DATE>)
   git commit -am "docs(adr-052): Accepted post-canary success cloudbuild run <BUILD_ID>"
   ```
3. **Flip `SIGNUP_REQUEST_FLOW_ACTIVATED=true`** post-Sprint-2b ship + canary verification (currently default `false` → admin UI shows "Coming soon"). Spec §7.5 rollback path.
4. **Sprint 2c BlockingFunction** para cerrar Google leg residual (`signInWithPopup`). Stub: `.specs/_followups/sprint-2c-google-blocking-function.md`.

### Items remaining del SEC-001 originally-scoped (no urgentes — vector primario cerrado)

- **H1.5**: forensia + audit logs filtering (round 4 P2-R4-2). 14-day window scan + Cloud Logging filter + Pub/Sub topic + Cloud Function password-spray-incident-trigger.
- **H1.6**: reactivación demo (flag flip `DEMO_MODE_ACTIVATED=true`) + TTL claim + 90d monitoring. Depende de `sec-h3-dte-retention-lock` mergeado (per SC-1.6.5).
- **H3 spec hermano** (`sec-h3-dte-retention-lock`): plan independiente cuando PO esté listo.

### Próximo paso

`/agent-rigor:plan` para Sprint 2c (Google Blocking Function) cuando PO esté listo, O cierre operacional permanente del SEC-001 H1.2 una vez ADR-052 esté `Accepted`. Recomendado fresh session.

Pendiente operacional post-Sprint 2b:
- **Cosmetic drift residual** (heredado Sprint 1): `google_monitoring_dashboard.telemetry_overview` JSON formatter (sin impacto runtime).
- **Otros drifts no-aplicados** detectados durante T13 plan: `google_logging_metric.auth_is_demo_blocked` + `google_monitoring_alert_policy.auth_is_demo_blocked_anomaly` (H1.3 observability — probablemente shipped en main pero nunca `terraform apply`). Tracked como follow-up IaC reconciliation; no-bloqueante.
- **#STAGING-ENV**: backlog tracking para crear segundo GCP project con infra paralela. Bloquea el flip prod de `STRICT_MIGRATION_ORDERING=true`.
- **Silent-window guard alert** para `sec001/demo_uid_retired` (baseline ahora >0 post-Sprint-2a T4): tracked como follow-up post-operational.
- **TTL renovación próxima**: 2026-06-17 (cron T6a `demo-account-ttl-alert` debería emitir `demo.ttl_low` -7d).

---

## Refactor sistema de desarrollo Booster — CERRADO (2026-05-21, PR-2 [#312](https://github.com/boosterchile/booster-ai/pull/312) merged)

Misión global del refactor: integrar plugins de Claude Code para reemplazar el sistema local de skills + commands + agents disperso. **3 PRs secuenciales**, todos cerrados.

### Cierre por PR

| PR | Repo | Cambio | Estado |
|---|---|---|---|
| PR-1 | `boosterchile/booster-skills` | Publicación inicial v0.1.0 del plugin (7 skills + 6 agents) — `arquitecto-maestro`, `adding-cloud-run-service`, `carbon-calculation-glec`, `empty-leg-matching`, `incident-response`, `booster-stack-conventions`, `booster-deploy-cloud-run` | ✅ Cerrado 2026-05-20 |
| PR-2 | `boosterchile/booster-ai` | Cleanup local + adopción 3-capas — borrar `.claude/{commands,agents,skills}/`, `skills/`, `hooks/` + CLAUDE.md v3 + ADR-049 + ADR-050 + docs/plugins/REPORTE | ✅ [#312](https://github.com/boosterchile/booster-ai/pull/312) merged 2026-05-21 (squash commit `9127b44`) |
| PR-3 | `boosterchile/booster-ai` (futuro) | Migración `docs/specs/` → `.specs/<feature-slug>/` (path canónico agent-rigor) | 🔲 Pendiente — no urgente |

### Sistema operativo de desarrollo (post-refactor)

3 capas con responsabilidades claras:

| Capa | Componente | Scope | Repo |
|---|---|---|---|
| 1 | `agent-rigor@0.2.0` | Disciplina senior-engineering generalista (ciclo + hooks + sub-agents + ledger) | `boosterchile/best-skill-claude` |
| 2 | `booster-skills@0.1.0` | Dominio + stack + auditoría Booster (7 skills + 6 sub-agents) | `boosterchile/booster-skills` |
| 3 | `.claude/` local minimal | settings declara plugins; ledger preserva historial; worktrees parallel | este repo |
| 3b | `agents/` raíz | 3 overrides locales Booster (`code-reviewer`, `security-auditor`, `sre-oncall`) — extienden agent-rigor con compliance Chile, ADR Booster discipline, SLOs GCP | este repo |

Path canónico de specs: `.specs/<feature-slug>/{idea,spec,plan,verify,review,ship}.md` (definido por agent-rigor).

### Decisión arquitectónica + replicabilidad

- **[ADR-049](../../docs/adr/049-claude-code-plugin-system-adoption.md)** documenta la adopción del sistema de plugins (supersede ADR-002) + §Replicabilidad con procedimiento de 5 pasos para crear plugin equivalente en otro proyecto.
- **[ADR-050](../../docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md)** documenta tabla de mapping path antiguo → namespacing nuevo para resolver referencias en ADRs históricos (001, 011) sin editarlos (respeta ADR-046 §1).
- **[`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`](../plugins/REPORTE-migracion-booster-skills-v0.1.0.md)** es el ejemplo trabajado completo de creación de plugin (audit trail con decisiones, bugs encontrados, validaciones aplicadas).

### Audit trail completo

Trazabilidad del refactor: `.specs/integrate-booster-skills-plugin/` contiene:
- `spec.md` v4 (final aprobada) + 3 versiones rechazadas (v1, v2 cascade-of-errors, v3 canonical-but-incomplete)
- `plan.md` v3 + v2 preservado
- `verify.md` v2 (31 PASS / 0 FAIL / 4 EXTERNAL) + v1 preservado
- `review.md` (round 1 + round 2 con verdict APPROVED post mini-round 3)
- `ship.md` con 12-point checklist adaptado a chore meta-work
- `evidence/` con `/plugin list` output, snapshots tree antes/después, git-status, orphan-refs-check
- `verify.sh` ejecutable (146 LOC, 23 SCs verificables)

Métricas del ciclo: 4 iteraciones de spec, 3 iteraciones de plan, 2 rondas de review (mini-round 3 inline), 4 waivers justificados (T4 LOC, 13 modules touched, 2 cooling-offs), 15 decisiones PO registradas en ledger.

### Follow-ups post-PR-2 (no bloqueantes)

| Follow-up | Stub | Trigger |
|---|---|---|
| Migrar `agents/{code-reviewer,security-auditor,sre-oncall}.md` al plugin booster-skills v0.2.0 con compliance Chile (Ley 19.628, SII/DTE, modelo Uber-like + Sustainability Stakeholder) | [`.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`](../../.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md) | Próximo PR que toque cualquiera de los 3 archivos, O publicación v0.2.0 por otro motivo |
| Castellanizar headers de 28 ADRs históricos (`Status`/`Date` → `Estado`/`Fecha` para consistencia post-ADR-049) | [`.specs/_followups/castellanizar-adr-headers.md`](../../.specs/_followups/castellanizar-adr-headers.md) | Sprint cleanup documental, bajo prioridad |
| Configurar branch protection rule en GitHub para enforce squash merge (PR-2 dependió de manual `--squash` por ausencia de regla) | [`.specs/_followups/github-branch-protection-squash.md`](../../.specs/_followups/github-branch-protection-squash.md) | Inmediato (post-PR-2): mitiga riesgo de typos en main si futuro PR usa `--merge` o `--rebase` |

### Estado del repo post-refactor

- `.claude/`: minimal — solo `ledger/`, `settings.json`, `settings.local.json`, `worktrees/`, `staging/` (gitignored)
- `agents/`: 3 overrides Booster documentados como capa local
- `docs/adr/`: 050 ADRs (último ADR-050)
- `.specs/`: 7 features activas (audit-2026-05-14, integrate-booster-skills-plugin, production-readiness, s0-housekeeping, s1-drift-coverage-e2e, stubs-decision, tripstate-alignment) + `_followups/` (3 stubs)
- `CLAUDE.md` v3: 335 líneas con §Integración con plugins + §Reglas no-negociables del stack Booster + §Capas adicionales locales del proyecto + §Estructura del repo v3

---

## Sprint S1a drift schema/domain — CERRADO (2026-05-18, firma PO Opción A)

Sub-sprint: [`.specs/s1-drift-coverage-e2e/plan-s1a.md`](../../.specs/s1-drift-coverage-e2e/plan-s1a.md). Cierre formal en [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) — **gate APPROVED_BY_PO 2026-05-18, Opción A con 3 condiciones vinculantes** (ver §11).

**S1a Bloque A complete; Bloque B deferred to S2 con sub-spec tripstate-alignment como pre-requisito.**

### Cierre por tarea (Bloque A)

| Task | PR | LOC (+/-) | Estado |
|---|---|---|---|
| T1.1 — Inventario drift schema/domain + pre-commit hook | [#293](https://github.com/boosterchile/booster-ai/pull/293) | +736/-2 | ✅ Merged |
| T1.2 — Caso 5 `tripEventTypeSchema` (alinea 2 valores SQL) | [#294](https://github.com/boosterchile/booster-ai/pull/294) | +242/-15 | ✅ Merged |
| T1.3-discovery — Discovery broader pre-reclasificación | [#295](https://github.com/boosterchile/booster-ai/pull/295) | +205/-0 | ✅ Merged |
| T1.3 — Caso 1 `cargoRequestStatusSchema` → Clase I + annotación | [#296](https://github.com/boosterchile/booster-ai/pull/296) | +86/-32 | ✅ Merged |
| T1.5 — Integration tests Pattern A + B + H-S1a-1 partial cov | [#297](https://github.com/boosterchile/booster-ai/pull/297) | +168/-1 | ✅ Merged |
| Spec/plan v2 + reviews (pre-S1a) | [#292](https://github.com/boosterchile/booster-ai/pull/292) | +968/-0 | ✅ Merged |

**Baseline drift final**: 1 A (resuelta) + 1 I (annotada) + 1 B+ (diferida) + 0 C + 6 H = **0 drift estructural accionable**.

### Bloque B — diferido a S2 (firma PO Opción A + 3 condiciones, [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11)

T1.6 (XState scaffold) + T1.7a/b/c/d (wiring 3 services + followup doc) **no ejecutadas**. Ejecutan en S2 (lane paralela a S1b).

**Condición 1**: sub-spec `.specs/tripstate-alignment/spec.md` con acceptance material (§boundary-translation con 17 TS / 5 machine / 9 SQL mapping + §scope cut + §SCs measurable + §risks ≥3 reales + gate explícito). El trigger de avance es **completitud de las 5 sub-bullets + gate `APPROVED_BY_PO` del sub-spec**, no calendario. Sin eso, S2 sigue bloqueado y el spec quedó como artefacto administrativo.

**Condición 2**: spike `spike/tripstate-machine-exploration` permitido como exploración, NO mergeable. Sirve solo como insumo del sub-spec. Ejecutar T1.6/T1.7 disfrazado de spike sería laundering C disfrazado de A.

**Condición 3**: tras merge de PR #298, S1a está cerrado. `tripstate` work posterior vive en sub-spec / plan-s2 / spike — no en "todavía estamos cerrando S1a".

Razones del PO para descartar B (mezcla concerns S1b worse off) y C (sprint discipline + sub-spec necesaria independiente del timing + estimado optimista) en §11.

### Taxonomía drift extendida (deliverable durable)

ADR-043 define A/B/C; el triage T1.1 + discovery T1.3 amplió a:
- **Clase H** — Falso positivo heurístico (script reporta divergencia pero SQL existe con naming distinto).
- **Clase I** — Intentional pre-materialization (TS schema deliberadamente antes que SQL counterpart, con dependencias estructurales documentadas en ADRs vivos).

Ambas son **categorías operacionales del proyecto Booster AI**, no modificaciones al ADR-043. Tracking en [`inventory-classification.md`](../../.specs/s1-drift-coverage-e2e/inventory-classification.md) §Nomenclatura.

### Follow-ups no bloqueantes (heredados)

| Follow-up | Sprint objetivo | Tracking |
|---|---|---|
| T1.0.heuristic-improvement (mejorar `normalizeForMatch`) | S2 | `plan-s1a.md` §T1.0 |
| T1.x.parser (`@drift-status` parsing en drift-inventory script) | S2 (post-T1.0) | `plan-s1a.md` §T1.x.parser |
| Sub-spec `.specs/tripstate-alignment/` (caso 8) | S2 — pre-requisito de Bloque B (avance gated por readiness, no calendario) | `inventory-classification.md` Caso 8 + `s1a-cierre.md` §6 |
| H-S1a-1 segunda mitad (`.parse()` en boundaries HTTP/DB/queue) | S2 o S3 | `spec.md` §12.5 |
| Bloque B (XState scaffold + wiring) | S2 (lane paralela a S1b) — recomendación Opción A `s1a-cierre.md` §9, pendiente firma PO | `s1a-cierre.md` §6 |

---

---

## Sprint S0 production-readiness — CERRADO (2026-05-18)

Sprint maestro: [`.specs/s0-housekeeping/spec.md`](../../.specs/s0-housekeeping/spec.md) + [`.specs/s0-housekeeping/plan.md`](../../.specs/s0-housekeeping/plan.md) (Approved 2026-05-17).

### Cierre por tarea

| # | Tarea | PR | Cubre SC-S0 | Estado |
|---|---|---|---|---|
| T1 | ADR-043 metodología drift schema/domain | [#278](https://github.com/boosterchile/booster-ai/pull/278) | .1 | ✅ Merged |
| T2 | Archivar `AUDIT.md`/`PLAN-PHASE-0.md`/`DESIGN.md` a `docs/archive/` | [#280](https://github.com/boosterchile/booster-ai/pull/280) | .2 | ✅ Merged |
| T3 | `scripts/repo-checks/check-adr-numbering` + workspace + pre-commit hook | [#281](https://github.com/boosterchile/booster-ai/pull/281) | .3 | ✅ Merged |
| T4 | ADR-046 colisiones históricas (028,034,035) TTL perpetuo | [#282](https://github.com/boosterchile/booster-ai/pull/282) | .4 | ✅ Merged |
| T5 | Eliminar `.gitlab-ci.yml` — GitHub canonical | [#283](https://github.com/boosterchile/booster-ai/pull/283) | .5 | ✅ Merged |
| T6 | RFP auditor GLEC v3.0 + `docs/compliance/` scaffold | [#284](https://github.com/boosterchile/booster-ai/pull/284) | .6 (doc) | ✅ Merged · ⚠️ envíos PO pendientes |
| T7 | RFP vendor pentest pre-launch + shortlist por categoría | [#285](https://github.com/boosterchile/booster-ai/pull/285) | .7 (doc) | ✅ Merged · ⚠️ envíos PO pendientes |
| T8 | ADR-047 load testing tool (k6) + smoke scaffold | [#286](https://github.com/boosterchile/booster-ai/pull/286) | .8 | ✅ Merged |
| T9a | ADR-048 microservices extraction strategy (conceptual) | [#287](https://github.com/boosterchile/booster-ai/pull/287) | .9a | ✅ Merged |
| T10 | Outreach cliente piloto + `.private/` gitignored | [#288](https://github.com/boosterchile/booster-ai/pull/288) | .10 (doc) | ✅ Merged · ⚠️ dry-run + envíos PO pendientes |
| T11 | Wrap CURRENT.md (este PR) | _pending_ | .11 | ⏩ In progress |

11/11 tareas materializadas. **3 SCs cierran a nivel doc + acción PO** (.6 GLEC, .7 pentest, .10 piloto) — los envíos reales corren en lanes externas paralelas, no bloquean el cierre del sprint.

### ADRs nuevos producidos (4)

| ADR | Título | Decisión clave | Consecuencia sobre roadmap |
|---|---|---|---|
| [043](../adr/043-drift-schema-domain.md) | Drift schema ↔ domain — metodología | SQL canónico (español); domain alinea. Clasificación A/B/C por migración. | S1 ejecuta el inventario detallado + migration; tests integration sobre infra T1+T2. |
| [046](../adr/046-historical-adr-numbering-collisions.md) | Historical ADR numbering collisions (028/034/035) | **TTL perpetuo** — las 3 colisiones legacy no se renumeran. Flag `--allow-legacy` permanente en pre-commit. | Disciplina "un número por archivo" desde ADR-040 enforced. Modificaciones a allowlist requieren supersede ADR. |
| [047](../adr/047-load-testing-tool-k6.md) | Load testing tool: k6 | k6 + scripts JS + OTEL nativa. **Reversible hasta S8**. | S8 ejecuta suite real (50 RPS sostenido api, 200 RPS pico, 1000+ TCP gateway). Smoke actual es throwaway. |
| [048](../adr/048-microservices-extraction-strategy.md) | Microservices extraction strategy | Strangler con mirroring **staging** + cutover prod con flag por endpoint + monolito fallback 2 sem. Split T9b/T9c diferido. | S3/S4 ejecutan extracción; cada microservicio produce sub-ADR. T9b (budget USD/sem) en S2; T9c (criterios drill) en spec S3. |

### Sub-spec dependiente

- [`.specs/stubs-decision/spec.md`](../../.specs/stubs-decision/spec.md) — **Approved 2026-05-17**. 8 decisiones binarias: eliminar `ai-provider` + `document-indexer`; promover `trip-state-machine` (S1) + `ui-components` parcial (S2) + 3 apps (S3/S4) + `carta-porte-generator` (S4).

### Velocity check (SC-S0.28 spec maestra)

- Estimación: 8–10 días lane Felipe (post devils-advocate v2).
- Real: 11 PRs producidos en **~5 horas de sesión** (densidad alta porque la mayoría son doc-only o scaffolds; el único código real fue T3 ~110 LOC).
- **Conclusión**: velocity observada >> 0.7× nominal en este sprint. Sin replan formal de S1-S13. Re-evaluar al cierre de S1 (tarea pendiente: `docs/handoff/<fecha>-velocity-check-post-S2.md`).

### Lanes externas activadas

| Lane | Activada por | Fecha esperada respuesta | Owner |
|---|---|---|---|
| **GLEC audit** (cubre SC-23 post-Impl) | T6 — RFP a SGS Chile / Bureau Veritas Chile / DNV LATAM | Respuestas vendors: ≤2 sem; contrato firmado: ≤4 sem; certificado: ≤8 sem post-firma | **PO acción**: enviar emails con template `docs/compliance/glec-rfp.md` §7.2 |
| **Pentest pre-launch** (cubre SC-24) | T7 — RFP a 3 categorías de vendor (Global EMEA / Boutique LATAM / Pentest-as-a-Service) | Respuestas: ≤2 sem; contrato: ≤4 sem; audit final: ≤6 sem post-firma | **PO acción**: enviar emails con template `docs/audits/security-rfp.md` §7.2 |
| **Cliente piloto** (cubre SC-27a) | T10 — shortlist 5+5 prospects en `.private/piloto-prospects.md` | Respuestas: variable (warm 1-2 sem, cold 2-4 sem); contrato firmado: en sprint S13 | **PO acción**: dry-run shortlist + envíos con template `.private/` §"Mensaje template" |

### Objections devils-advocate cerradas en S0

| Obj | Severidad | Status | Cubierta por |
|---|---|---|---|
| O-1 | P0 | ✅ Closed | Split T9a/T9b/T9c en ADR-048 |
| O-2 | P0 | ✅ Closed | SC-S0.1 acotado a metodología (sin enumeración) |
| O-3 | P0 | ✅ Closed | SC-S0.10 reforzado con criterios fit + dry-run PO + irreversibilidad |
| O-4 | P0 | ✅ Closed | OQ-S0.1 resuelta (privada) + OQ-S0.2 verificada por agente |
| O-5 | P0 | ✅ Closed | Estimación movida a 8-10 días; orden re-secuenciado |
| O-8 | P1 | ✅ Closed | ADR-046 TTL perpetuo explícito |
| O-9 | P1 | ✅ Closed | ADR-047 reversibilidad hasta S8 explícita |

### Open questions remaining (post-S0)

- **OQ-S0.3** — Reapuntar remote `origin` (sigue GitLab) a GitHub o eliminar. NO bloquea S1; decisión PO antes de S2.
- **SC-S0.9b** (en S2) — Medir tráfico actual de `notify-*.ts`, `matching*.ts`, `documentos.ts` para producir tabla USD/sem budget mirroring.
- **SC-S0.9c** (en spec S3) — Criterios concretos de rollback drill para primer microservicio (`notification-service`).

---

## Pickup point S1b (branches coverage + Playwright + sharding)

**Plan**: [`.specs/s1-drift-coverage-e2e/plan-s1b.md`](../../.specs/s1-drift-coverage-e2e/plan-s1b.md) (Approved 2026-05-18) — arranque **condicional** a firma PO sobre `s1a-cierre.md` §9.

**Scope S1b**:

- **T1.8** — Identificar branches uncovered + lista nombrada (≥10 error paths reales).
- **T1.9a..T1.9j** — Tests añadidos por path; meta: `apps/api` branches coverage ≥80% (actual: 75.01%).
- **T1.10** — 4 specs Playwright críticos en CI por PR (shipper-publica-carga, carrier-acepta-oferta, login-universal-rut-clave-numerica, public-tracking-via-link) + axe-core (0 violations P0/P1) + sharding + path-based filter en `ci.yml` (cubre SC-29 ≤10 min p95 CI).

**Cubre SCs maestros**: SC-2 (parcial), SC-4, SC-15 (parcial 4/8), SC-16 (parcial), SC-29.

**Bloque B Sprint S1** (XState `trip-state-machine` + wiring): **diferido** a sub-spec `.specs/tripstate-alignment/` cuando arranque T1.x dedicado (ver `s1a-cierre.md` §6 — pendiente firma PO).

**Acción inmediata PO** (S1a firma ya aplicada; S1b listo para arrancar):

1. **Enviar RFP GLEC** (template en `docs/compliance/glec-rfp.md` §7.2). Razón: lead time auditor 4-8 sem.
2. **Enviar RFP pentest** (template en `docs/audits/security-rfp.md` §7.2). Razón: lead time vendor 4-6 sem.
3. **Dry-run + envíos cliente piloto** (`.private/piloto-prospects.md`). Razón: lead time outreach piloto el más largo.
4. **Decidir OQ-S0.3** (qué hacer con remote `origin` GitLab).

**Próxima sesión de agente** (post-merge #298): `/spec tripstate-alignment` siguiendo Condición 1 de [`s1a-cierre.md`](../../.specs/s1-drift-coverage-e2e/s1a-cierre.md) §11. Avance gated por readiness (5 sub-bullets + gate `APPROVED_BY_PO` del sub-spec), no calendario.

---

## Bloqueo D11 v2 T8-T12 (2026-05-17)

**Estado al cierre de sesión 2026-05-17 ~09:10 UTC**:

- D11 v2 T8 implementado en `fix/d11-t8-stakeholder-zonas-endpoint` con test unit-mocked → **NO mergeable** por violación de CLAUDE.md §1/§2 (test no ejerce el SQL real).
- Pivote a spec + plan separados para crear infra de integration testing en `apps/api`.

**Avance de la sesión** (PR [#267](https://github.com/boosterchile/booster-ai/pull/267), 4 commits docs-only):

| Artefacto | Status | Path |
|---|---|---|
| Spec test-integration-infra-apps-api | **Approved** (PO 2026-05-17 ~08:35 UTC) | [`docs/specs/2026-05-17-test-integration-infra-apps-api.md`](../specs/2026-05-17-test-integration-infra-apps-api.md) |
| Spec devils-advocate review | complete (6 P0 + 11 P1 + 7 P2) | [`docs/specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../specs/2026-05-17-test-integration-infra-apps-api-devils-advocate.md) |
| Plan v2 con 9 tasks (T0..T6) | **Approved** (PO 2026-05-17 ~09:05 UTC) | [`docs/plans/2026-05-17-test-integration-infra-apps-api.md`](../plans/2026-05-17-test-integration-infra-apps-api.md) |
| Plan devils-advocate review | complete (7 P0 + 6 P1 + 5 P2 — 12/13 P0+P1 abordados) | [`docs/plans/2026-05-17-test-integration-infra-apps-api-devils-advocate.md`](../plans/2026-05-17-test-integration-infra-apps-api-devils-advocate.md) |
| Plan D11 v2 (T8-T12 BLOCKED) | actualizado | [`docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md`](../plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md) |

**T0 — PASS (2026-05-17 ~09:10 UTC)**:

Mediciones contra Postgres@16 local (brew, `booster_test_prototype`):

- Run 1 cold (DROP+CREATE+migrate): **472 ms** (<30 s objetivo)
- Run 2 full reset: 115 ms
- Run 3 in-place sin DROP: **4 ms** (<5 s objetivo)
- Sin errores; 36/36/36 migrations consistentes

Evidencia completa: [`2026-05-17-t0-prototype-test-db-output.md`](2026-05-17-t0-prototype-test-db-output.md). El script `apps/api/scripts/prototype-test-db.ts` queda untracked (no se mergea por diseño T0).

**Hallazgo colateral**: `0009_stakeholder_access_log.sql` existe en disco pero NO está en `meta/_journal.json` (37 .sql vs 36 entradas journal). La tabla `stakeholderAccessLog` está declarada en `schema.ts:1406`. En prod la tabla probablemente NO existe. Task separada flagueada (no bloquea T1). Justifica retroactivamente la decisión PO de exigir T0 antes de T1.

**Pickup point próxima sesión — T1**:

Próxima sesión arranca con T1 del plan v2: `vitest.integration.config.ts` + scripts + setup.integration + helper test-db + test ref `SELECT 1`. Acceptance enumerada en plan §T1 (LOC ~95). Sin bloqueos de T0.

**Cómo arrancar próxima sesión**:

```bash
cd /Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/naughty-sinoussi-c8ddf8
git pull github fix/d11-t8-stakeholder-zonas-endpoint
# Verificar Postgres local sigue corriendo: pg_isready -h localhost
# Si no: brew services start postgresql@16
# Leer plan v2: docs/plans/2026-05-17-test-integration-infra-apps-api.md
# Arrancar T1: vitest.integration.config.ts + setup.integration.ts + helpers/test-db.ts + health-db.integration.test.ts
```

**Trabajo preservado en working tree** (no commit, untracked):
- `apps/api/src/routes/stakeholder.ts` (115 LOC) — reusable post-infra.
- `apps/api/test/unit/stakeholder-zonas-route.test.ts` (94 LOC) — descartable.
- `apps/api/src/server.ts` (+7 LOC) — wire de la route.

---

## (a) Waves 1-6 — estado de merge

Las seis waves del plan de identidad universal + dashboard conductor están **completas y mergeadas en `main`**.

| Wave | Alcance | PRs mergeados | Fecha cierre |
|---|---|---|---|
| **Wave 1** | Conductor identity + split dashboard (`/app/conductor` vs `/app/conductor/configuracion`) + migration 0029 + sweep español neutro | [#179](https://github.com/boosterchile/booster-ai/pull/179), [#189](https://github.com/boosterchile/booster-ai/pull/189) (smoke script) | 2026-05-13 |
| **Wave 2** | Tests + sweep i18n argentinismos → neutro | Integrado en [#179](https://github.com/boosterchile/booster-ai/pull/179) (+24 specs) | 2026-05-13 |
| **Wave 3** | Stakeholder organizations + ADR-034 (entidad XOR con empresas, migrations 0030/0031) + zonas filtradas por región + UI miembros | [#180](https://github.com/boosterchile/booster-ai/pull/180) → [#198](https://github.com/boosterchile/booster-ai/pull/198) (reabierto), [#199](https://github.com/boosterchile/booster-ai/pull/199) (zonas), [#203](https://github.com/boosterchile/booster-ai/pull/203) (UI miembros) | 2026-05-13 |
| **Wave 4** | Auth universal RUT + clave numérica + ADR-035 (foundation → UI selector → rotación clave → activación flag) | [#181](https://github.com/boosterchile/booster-ai/pull/181) (foundation 1/3), [#185](https://github.com/boosterchile/booster-ai/pull/185) (UI 2/3), [#187](https://github.com/boosterchile/booster-ai/pull/187) (rotación 3/3), [#190](https://github.com/boosterchile/booster-ai/pull/190) (`AUTH_UNIVERSAL_V1_ACTIVATED=true` en prod) | 2026-05-13 |
| **Wave 5** | Wake-word "Oye Booster" foundation + ADR-036 — service stub, flag `WAKE_WORD_VOICE_ACTIVATED=false` | [#183](https://github.com/boosterchile/booster-ai/pull/183) (foundation 1/2). **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186)) cerrado sin merge** — wire real bloqueado por Picovoice (ver §c). | 2026-05-13 (foundation) |
| **Wave 6** | Research cultura conductor chileno + guion entrevistas (input para refinamientos UI y Wave 5) | [#182](https://github.com/boosterchile/booster-ai/pull/182) | 2026-05-13 |

**Soporte transversal mergeado el mismo día**:
- [#184](https://github.com/boosterchile/booster-ai/pull/184) — bump `@opentelemetry/*` a 0.218 (cierra 4 HIGH vulns, desbloquea `npm audit` en CI).
- [#191](https://github.com/boosterchile/booster-ai/pull/191) — GCP cost efficiency TRL 10 (right-sizing + log exclusion, ADR-034/035).
- [#192](https://github.com/boosterchile/booster-ai/pull/192) — handoff con orden de merge consolidado.

**Verificación**: `gh pr list --state merged --search "wave" --limit 50` (ejecutado 2026-05-16).

### Mergeados 2026-05-16 (post-handoff inicial)

- [#166](https://github.com/boosterchile/booster-ai/pull/166) (commit `b5d1f18`, 22:26 UTC) — `docs(telemetry): Wave 3 v2 — preload CA root + ADR-040`. Rebased sobre main, ADR renumerado de 033→040 por colisión con `033-matching-algorithm-v2`. `npm audit (HIGH+)` resuelto vía bump OpenTelemetry de #184. Files: `docs/adr/040-wave-3-tls-ca-preload-fmc150.md` (+90), `docs/handoff/2026-05-11-wave-3-incidente-rollback.md` (+180), `docs/research/teltonika-fmc150/INSTRUCTIVO-WAVE-3.md` (±37/2), `docs/runbooks/wave-2-3-deploy.md` (±24/2).
- [#226](https://github.com/boosterchile/booster-ai/pull/226) (commit `641288d`, 22:26 UTC) — `docs(handoff): snapshot CURRENT.md estado proyecto 2026-05-16` (primera versión de este documento, +130 líneas).
- [#227](https://github.com/boosterchile/booster-ai/pull/227) (commit `d5e2e06`, 22:34 UTC) — `docs(handoff): actualizar CURRENT.md post-merge #166 + #226`. Reduce el documento a 1 PR abierto (#164), agrega la sección "Mergeados 2026-05-16" y "Housekeeping ADRs", clarifica que #164 no contiene archivo ADR todavía (solo spec) y recomienda ADR-041.
- [#228](https://github.com/boosterchile/booster-ai/pull/228) (commit `fa03246`, 22:53 UTC) — `docs(runbooks): plantillas /goal v2 con lessons de la sesion 2026-05-16`. Añade `docs/runbooks/goal-templates.md` (+255 líneas) con los aprendizajes operativos del flujo `/goal` aplicado a esta sesión.
- [#229](https://github.com/boosterchile/booster-ai/pull/229) (commit `c8ce2a3`, 23:05 UTC) — `docs(handoff): refresh CURRENT.md post-merge #227 + #228`. Segunda iteración del documento aplicando Plan 1 v2 vía `/goal` (9 min, 12.6k tokens, 0 errores fácticos — validó las plantillas v2 en producción).
- [#164](https://github.com/boosterchile/booster-ai/pull/164) (commit `2429f86`, 23:14 UTC) — `docs(spec): D11 stakeholder geo aggregations — cards + drill-down + ADR-033`. Spec D11 formalizada en `main` tras 5 días en DRAFT. Habilita `/plan` y `/build` cuando el PO decida. Files: `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` (+136 líneas).

### Mergeados 2026-05-16/17 (post-coverage batch)

Sesión nocturna dedicada a cobertura de tests por package + housekeeping.

| PR | SHA | UTC | Título | Files |
|---|---|---|---|---|
| [#230](https://github.com/boosterchile/booster-ai/pull/230) | `786a5b3` | 23:17 | `docs(handoff): cierre sesion 2026-05-16 — 0 PRs abiertos` | `docs/handoff/CURRENT.md` (+12/−34) |
| [#231](https://github.com/boosterchile/booster-ai/pull/231) | `94155fe` | 23:22 | `refactor(d11-spec): renumerar ADR-033→041 y migration 0027→0034` | `docs/specs/…-d11.md` (±8/8), `docs/handoff/CURRENT.md` (±3/6) |
| [#232](https://github.com/boosterchile/booster-ai/pull/232) | `48c3d04` | 23:52 | `chore(coverage): infra de coverage en 15 packages + floor baseline` | 15 × `vitest.config.ts` + 15 × `package.json` + `pnpm-lock.yaml` |
| [#233](https://github.com/boosterchile/booster-ai/pull/233) | `fa301d3` | 23:58 | `test(ui-tokens): cobertura 100/100/100/100` | `tokens.test.ts` (+207), `vitest.config.ts` (±5/9) |
| [#234](https://github.com/boosterchile/booster-ai/pull/234) | `96e10c5` | 00:07 | `test(logger): cobertura 93/92/100/93 — createLogger + redaction` | `createLogger.test.ts` (+129), `redaction.test.ts` (+52) |
| [#235](https://github.com/boosterchile/booster-ai/pull/235) | `4a758e6` | 00:13 | `test(config): cobertura 100/100/100/100 — parseEnv + 5 schemas` | `parseEnv.test.ts` + 5 × `schemas/*.test.ts` (+243 total) |
| [#236](https://github.com/boosterchile/booster-ai/pull/236) | `09dc62f` | 00:19 | `test(whatsapp-client): cobertura 95/91/86/97 — WhatsAppClient HTTP` | `client.test.ts` (+156) |
| [#237](https://github.com/boosterchile/booster-ai/pull/237) | `5bd0228` | 00:39 | `test(certificate-generator): cobertura 97.82/80.15/100/97.82` | 5 × test (`ca-self-signed`, `emitir-certificado`, `firmar-kms`, `firmar-pades`, `storage`) + ajuste `generar-pdf-base.test.ts` (+734) |
| [#238](https://github.com/boosterchile/booster-ai/pull/238) | `ba0ee10` | 00:50 | `test(shared-schemas): cobertura 98.53/87.5/94.11/98.52` | `all-schemas.test.ts` (+428) |
| [#239](https://github.com/boosterchile/booster-ai/pull/239) | `756e9b4` | 01:06 | `fix(certificate-generator): CO2e ASCII en section title (subscript crash)` | `generar-pdf-base.ts` (±7/2), `generar-pdf-base.test.ts` (+34) — fix de bug descubierto en #237 + regression test (cert-gen subió a 99.63/82.53/100/99.63) |
| [#240](https://github.com/boosterchile/booster-ai/pull/240) | `a1419a2` | 01:18 | `docs(runbooks): sanity check zero anti-Stop-hook-loop` | `goal-templates.md` (±16/2) |
| [#241](https://github.com/boosterchile/booster-ai/pull/241) | `def7e64` | 01:46 | `docs(handoff): refresh CURRENT.md post-coverage batch` | `docs/handoff/CURRENT.md` (+23/−2) |
| [#242](https://github.com/boosterchile/booster-ai/pull/242) | `21a3d37` | 02:15 | `docs(runbooks): terse post-abort en sanity check zero` | `goal-templates.md` (±3/1) |
| [#243](https://github.com/boosterchile/booster-ai/pull/243) | `69534d3` | 02:21 | `docs(runbooks): embeber terse-post-abort en /goal text de Plans 3-5` | `goal-templates.md` (+10/0) |

**Resultado coverage**: los 15 packages no-stub pasan **≥80/80/80/80** (statements/branches/functions/lines). Lowest: certificate-generator branches=80.15%. Stubs (`ai-provider`, `carta-porte-generator`, `document-indexer`, `trip-state-machine`, `ui-components`) siguen exemptados hasta tener lógica real (PO-aprobado).

---

## (b) PRs abiertos — 9 (D11 BUILD review formal)

D11 BUILD ejecutado autónomamente vía `/goal` el 2026-05-17 (12 tasks DONE, ~$5-10 USD). Review formal con sub-agentes (`code-reviewer`, `devils-advocate`, `security-auditor`, `ux-designer`) reveló **bugs CRITICAL de privacy + violación de contrato agent-rigor + LOC waivers excedidos 2-3×**. Plan v1 BLOCKED, pivote a Opción 2 (`originComunaCode` mapping).

| PR | Task | Status |
|---|---|---|
| [#246](https://github.com/boosterchile/booster-ai/pull/246) | T1 ADR-041 | SUPERSEDE — pendiente ADR-042 |
| [#247](https://github.com/boosterchile/booster-ai/pull/247) | T2 Zod+Drizzle | REQUEST_CHANGES — `numeric` ↔ `z.number()` mismatch |
| [#249](https://github.com/boosterchile/booster-ai/pull/249) | T4 k-anonymity | REQUEST_FIX privacy CRITICAL |
| [#250](https://github.com/boosterchile/booster-ai/pull/250) | T5 hora+pico | REQUEST_CHANGES naming + k-anon |
| [#251](https://github.com/boosterchile/booster-ai/pull/251) | T6 tipo+combustible | MERGE post-T5 fix |
| [#252](https://github.com/boosterchile/booster-ai/pull/252) | T7 puntoEnBoundingBox | REQUEST_CHANGES NaN |
| [#253](https://github.com/boosterchile/booster-ai/pull/253) | T8 abort doc | OPEN — reset a abort-doc-only (`7b2a18e`) |
| [#255](https://github.com/boosterchile/booster-ai/pull/255) | T10 UI drill-down | REQUEST_CHANGES blocked-by-T9-v2 |
| [#256](https://github.com/boosterchile/booster-ai/pull/256) | T11 UI cards | REQUEST_CHANGES + SPLIT blocked-by-T8-v2 |
| [#257](https://github.com/boosterchile/booster-ai/pull/257) | T12 perf | REVERT_DONE_MARK — test tautológico |

**Cerrados sin merge**: #254 (T9, REJECT — privacy bugs heredados).

**Mergeado**: #248 (T3 migration zonas_stakeholder + seed, commit `2843e69`).

**Hallazgos sistémicos**:
1. Helper k-anonymity (#249) tiene 1 CRITICAL (quasi-identifier strings leak) + 3 HIGH. Es el ÚNICO control técnico privacy → prioridad #1.
2. Schema drift `domain/` ↔ `db/`: `domain/trip.ts` tiene state values en inglés (`delivered`, etc.); `db/schema.ts` divergió a español (`entregado`). ADR-042 resolverá.
3. "DONE" sin evidencia: T8 marcado DONE auto-resolviendo abort, T12 marcado DONE con test placeholder tautológico.

**Trazabilidad**: [`docs/handoff/2026-05-17-d11-review-plan.md`](2026-05-17-d11-review-plan.md) + comments en GitHub por PR.

---

## Housekeeping ADRs

**D11 numeración ya alineada con `main`**: el spec en `docs/specs/2026-05-11-stakeholder-geo-aggregations-d11.md` referencia **ADR-041** y **migration 0034** (siguientes libres). El título del PR original #164 menciona "ADR-033" — quedó como artefacto histórico del merge commit, sin impacto en el contenido del spec.

`main` arrastra colisiones históricas de numeración ADR en 028 (`dual-source-data-model-teltonika-vs-maps` + `rbac-auth-firebase-multi-tenant-with-consent-grants`), 034 (`gcp-cost-efficiency-2026-05` + `stakeholder-organizations`) y 035 (`auth-universal-rut-clave-numerica` + `trl10-mantener-ha-recortar-ruido`). No se tocan retroactivamente (los hashes son referenciados externamente). A partir de **ADR-040** se aplica la disciplina de "un número por archivo".

---

## (c) Blockers vigentes

### Picovoice approval

- **Estado**: PENDIENTE. Consola Picovoice respondió *"Thank you for your interest. Our team will review it shortly."* — sin ETA comprometido por el vendor.
- **Cuenta**: creada por Felipe (`dev@boosterchile.com`).
- **Bloquea**:
  - Acceso al modelo custom `oye-booster-cl.ppn` (entrenamiento del wake-word).
  - Provisión de `PICOVOICE_ACCESS_KEY` (Secret Manager + variable Cloud Run).
  - Wire real en `apps/web/src/services/wake-word.ts` (reemplazar `StubWakeWordController` por `PorcupineWakeWordController`).
  - Activación del flag `WAKE_WORD_VOICE_ACTIVATED=true` en prod.
- **Estado UI**: foundation Wave 5 ([#183](https://github.com/boosterchile/booster-ai/pull/183)) mergeado con UI inerte (flag OFF por default). Cero impacto visible para usuarios.
- **PR 2/2 ([#186](https://github.com/boosterchile/booster-ai/pull/186))** cerrado sin merge — se rehará cuando la approval llegue y el modelo esté disponible.

### Samples de voz Van Oosterwyk

- **Estado**: PENDIENTE coordinación con cliente.
- **Requerimiento**: 3 conductores reales × ~5 min de audio limpio cada uno, idealmente distribución regional:
  - 1 norteño (Antofagasta / Iquique)
  - 1 centro (RM / V Región)
  - 1 sureño (Bío Bío hacia el sur)
- **Pipeline**: subida al training pipeline de Picovoice → ~24h training → output `oye-booster-cl.ppn` (~50 KB) → commit a `apps/web/public/wake-word/`.
- **Dependencia mutua con Picovoice approval**: el upload de samples requiere acceso al Console post-approval. Los dos bloqueantes están encadenados.
- **ETA conjunto realista**: ~1 semana desde el momento en que llegue approval + samples estén grabados.

---

## Apuntadores rápidos

- **Auth universal activo en prod** desde 2026-05-13 ([#190](https://github.com/boosterchile/booster-ai/pull/190)): `app.boosterchile.com` muestra selector RUT + clave numérica. Usuarios legacy (Google / email+password) ven `<RotarClaveModal/>` bloqueante en próximo login.
- **Demo Corfo** agendada para lunes 2026-05-18 con Wave 1 + auth universal listos (hoy es 2026-05-16, faltan 2 días).
- **Subdominio `demo.boosterchile.com`** operativo desde 2026-05-13 ([#206](https://github.com/boosterchile/booster-ai/pull/206)) — 4 personas click-to-enter sin formulario.
- **Issue [#194](https://github.com/boosterchile/booster-ai/issues/194)** (DR deploy) resuelto por [#210](https://github.com/boosterchile/booster-ai/pull/210) (habilitación DNS endpoint cluster DR).
- **Coverage gate activo en CI desde 2026-05-16** ([#232](https://github.com/boosterchile/booster-ai/pull/232)): cada `packages/*` no-stub emite `coverage-summary.json` y vitest enforza thresholds 80/80/80/80 in-config. El bash gate del workflow CI valida los summaries y bloquea merge si alguno cae bajo umbral. Esto cierra el hueco de "CI silenciosamente pasa porque ningún package emite cobertura".
- **Próximos handoffs fechados** se siguen creando como `docs/handoff/YYYY-MM-DD-<topic>.md`; este `CURRENT.md` se actualiza tras cada cambio de estado significativo (merge de PR mayor, deploy a prod, blocker resuelto, blocker nuevo).
