# Estado actual del proyecto — Booster AI

**Última actualización**: 2026-07-25 (**🚀 Jornada cerrada: 8 PRs a `main`, apply dirigido aplicado y DEPLOY A PROD al 100 %.** Revisión `booster-ai-api-00525-yus`, migr **0053** aplicada, health 200, 0 errores — run [`30168603524`](https://github.com/boosterchile/booster-ai/actions/runs/30168603524). **Cola de PRs propios en CERO**: los 6 sucesores del triage mergeados (#630 `26f9862` · #626 `cd1f0ed` · #627 `1f90e5d` · #628 `dafcf40` · #624 `44c24a0` · #629 `b338511`) + #631/#632 de handoff; 2 originales cerrados definitivos (#426, #256) con followup. La alerta safety-p0 quedó **corregida en prod** (`apply -target`, verificado por REST). · **🔴 PLFL57 dejó de emitir CAN el 23-jul ~11:16 — flota hoy con 0 vehículos CAN, sin alerta que lo detectara; ver §2026-07-25.** · **📡 En `main` de la semana previa**: CAN live (#612), historial de traza (#615), temp ambiente + flag sensor (#616/#617, migr 0051), duración de movimiento (#618), privacidad tracking + TTL (#621, migr 0052), filtro **null-island** (#622), seed PLFL57 (#620), CI (#619, #623). **Pendientes que NO pasan por GitHub**: correr el **backfill** de distancia (gate PO, re-deriva certs), el **rollout del api** (`revision → null`, ventana elegida), y la **reparación física del CAN**. Ver §Sesión 2026-07-24/25.)

**Anterior**: 2026-06-05 (**Cierre del leg Google de SEC-001 H1.2 por boundary + reaper** [ADR-057] — deploy prod SUCCESS + `terraform apply` [reaper paused] + dry-run validado [scanned=14, 0 acciones]; **SC-1.2.2 Google leg = MET**; fix CodeQL `js/incomplete-sanitization` en `escapeCell`. PRs **#402→#405**. Ver §Sesión 2026-06-05.) · **2026-06-03**: App Check reCAPTCHA v3 PR #401 mergeado (⚠️ NO activar enforcement hasta ver tráfico verificado post-deploy) + DEFINE epic entorno dev ADR-055 DRAFT + hilo gitleaks abierto — ver §Sesión 2026-06-03.
**Documento vivo**: este archivo refleja el estado del proyecto. ✅ **NOTA 2026-06-06**: todo el trabajo de las sesiones 06-04→06-06 está **mergeado a `main`** (PRs #402→#413); la rama de la última sesión (`ci/drift-dedicated-reader-sa`, #413 squasheado como `2fce2df`) ya está integrada y puede borrarse. Para snapshots históricos ver `docs/handoff/YYYY-MM-DD-*.md`.
**Plan de referencia**: [`.specs/production-readiness/roadmap.md`](../../.specs/production-readiness/roadmap.md) (S0 cerrado, S1a Bloque A cerrado, pickup S1b) + [`docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md`](../plans/2026-05-12-identidad-universal-y-dashboard-conductor.md) (plan histórico waves 1-6)

---

## ⚠️ 2026-07-25 — PLFL57 dejó de emitir CAN (flota hoy: 0 vehículos con CAN)

**El único vehículo que entregaba CAN se cortó el 2026-07-23 ~11:16 (Santiago) y nadie se enteró** — se
detectó 2 días después por pregunta del PO, no por alerta. Firma: ignición OFF 11:06:34 → ON 11:16:44 y
desde ese ciclo los **cinco IDs LVCAN desaparecen juntos** (81/83/85/87/89) con `ign=1`. No es la
intermitencia normal por motor apagado. Después del corte hubo **viaje real sin CAN**: 23-jul 12h = 259
pings en movimiento / **0 con CAN**; 13h = 61 / **0** (antes: 22-jul 09h y 13h al 100 %, 23-jul 10h al
100 %). Desde el 23 ~13h el vehículo está estacionado (heartbeat 1 ping/h) → **sin evidencia de
recuperación**.

- **Causa probable**: física / runtime de AutoScan — mismo modo de falla que VFZH-68 (los 4 `.cfg` de la
  flota son byte-idénticos). **Acción de campo**: revisar cableado del par CAN al bus del Scania + re-correr
  AutoScan **antes** de que el camión vuelva a ruta.
- **Impacto**: el carbono **medido** (`exacto_canbus`) queda **sin insumo** — su deuda pasa de "cablear el
  modo" a bloqueada por hardware. El rollout CORFO de 10 camiones ya tiene 2 precedentes de CAN no
  funcional. **#624 NO se ve afectado** (distancia real = GPS + Routes, no CAN) — ya mergeado (`44c24a0`).
- **Hueco de software**: no existe monitor de salud de señal (el device manda GPS perfecto → toda la
  observabilidad lo ve "sano"). Followup: `.specs/_followups/monitor-salud-can.md`; requiere antes un flag
  de provisioning "CAN-capaz" (análogo a `tiene_sensor_temperatura` de #617).

## Sesión 2026-07-24/25 — telemetría en vivo, triage de 8 PRs rezagados y **deploy a prod**

> Semana de shipping sobre telemetría/tracking + housekeeping de CI, triage de los 8 PRs rezagados y **cierre completo el 25-jul**: los 6 rescatables mergeados, el apply dirigido aplicado y el **deploy a producción promovido al 100 %**. Cola de PRs propios en **cero**.

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

### #624 — distancia real híbrida (F0-0 paso 1), rebase de #598 — **EN PRODUCCIÓN**
Rebase de #598 sobre main actual (**#598 cerrado** apuntando a #624). Escribe `metricas_viaje.distancia_km_real` híbrida (Σ observado haversine gap<60 s + Σ huecos por Routes API por-tramo gap≥60 s) + endpoint admin de backfill (dry-run, platform-admin) + tabla `bitacora_backfill_distancia` (migr **0053**). Resoluciones del rebase: renumerar migración 0051→0053; el loader extraído `cargarPingsVentana` ahora **aplica el filtro null-island de #622** (sin regresión para cobertura/métricas/backfill). Evidencia: api **1847/1847**, cert-generator 89/89, typecheck/biome/build. **Draft/paso-1** (emisiones aún modeladas = deuda paso 2). Orden del plan: #597 (merged) → **#624** → correr backfill → liberar candado de retención de `telemetria_puntos`. El backfill re-deriva certs ya emitidos → **gate PO** (impacto legal/ESG).

### Triage de los 8 PRs rezagados — **EJECUTADO 2026-07-24** (6 agentes de verificación; reporte en `~/Downloads/triage-8-prs-2026-07-24.md`)
El PO decidió sobre los 8: **los 8 originales quedaron CERRADOS sin merge**; los 6 rescatables revivieron como PR fresco (rebase/rehecho desde main), los 2 irrescatables se cerraron definitivamente. **Los 6 sucesores están MERGEADOS (2026-07-25) → cola de PRs propios en CERO.** Lo que queda de estos PRs NO pasa por GitHub: el **apply dirigido** de #626 y el **deploy** (`gh workflow run release.yml --ref main`).

| Original (cerrado) | Veredicto | Sucesor | Nota |
|---|---|---|---|
| **#598** distancia real híbrida | RESCATAR | **#624** ✅ **MERGEADO** (`44c24a0`) + **EN PROD** | migr **0053** aplicada (`bitacora_backfill_distancia`, 11 columnas). Draft/paso-1; el **backfill sigue detrás del gate PO** (re-deriva certs emitidos) |
| **#511** consumer alerta safety-p0 | RESCATAR | **#626** ✅ **MERGEADO** (`cd1f0ed`) + ✅ **APLICADO** | `apply -target` corrido por el PO 2026-07-25 17:52 UTC. **Verificado por REST** (Monitoring API): la política viva dice `Consumer: apps/api · POST /internal/safety-events`, `mutatedBy=dev@boosterchile.com`, enabled=true. Antes llevaba sin mutar desde 2026-06-15 |
| **#526** hardening Secret Manager (INC-2026-06-19) | RESCATAR | **#627** ✅ **MERGEADO** (`1f90e5d`) | gate `content_sid_ready`: un content-sid sin valor real NO se monta. **0 diff en el plan → no requiere apply** (el default deja montados los mismos 4 de hoy); su valor es preventivo |
| **#596** desacopla SLOs/monitoring | RESCATAR | **#628** ✅ **MERGEADO** (`dafcf40`) | `slo.tf` por literal. **0 diff en el plan = prueba de que el refactor es neutro**; no requiere apply |
| **#513** reconnect chat SSE | RESCATAR | **#629** ✅ **MERGEADO** (`b338511`) | corta el loop 401/403 + `reset-on-success` per-RUT en rate-limit-pin. El test T8 de integración se caía (`expected 200 to be 429`): verificaba la semántica vieja (contaba **éxitos**) → reescrito a 5 intentos **FALLIDOS** (401) + escenario nuevo del reset contra Redis real. Decisión del PO |
| **#516** booleanFlag de @booster-ai/config | REHACER | **#630** ✅ **MERGEADO** (`26f9862`) | rehecho fresco: 2 archivos, api 1814/1814, 24 checks verdes. El original conflictuaba contra el `release.yml` reescrito a dispatch-only. **Sin deploy** — el merge a main ya no dispara release (dispatch-only desde 2026-07-10) |
| **#426** sitio público + /signup (ADR-067) | **CERRAR** | — (followup) | el `/signup` gateado YA vive en main vía `/solicitar-acceso` + backend SEC-001; falta solo el sitio de contenido `apps/marketing` → build fresco content-only, no rebase. ⚠️ su spec y **ADR-067 NO están en main** (viven solo en la rama, que no se borró; el número 067 quedó libre en la numeración). Followup: `marketing-site-content-only.md` |
| **#256** UI cards reales (T11) | **CERRAR** | — (followup) | base fantasma: apilado sobre #255 (cerrado sin merge), deps ausentes en main (endpoint T8 abortado + ruta T10), diff real vs main = 1157 archivos que revertirían trabajo vivo. La feature NO está hecha (`ZONAS_DEMO` sigue mockeado en main) → rehacer bajo D11 v2. Followup: `stakeholder-cards-datos-reales-d11-v2.md` |

### Deploy a producción 2026-07-25 — **promovido al 100 %**

Primer deploy desde que `release.yml` es `workflow_dispatch`-only: disparado con `gh workflow run
release.yml --ref main` sobre `0d5a6f6`, **gate humano de `production` aprobado por el PO**, run
[`30168603524`](https://github.com/boosterchile/booster-ai/actions/runs/30168603524) **success**.

| Ítem | Resultado |
|---|---|
| Revisión | `booster-ai-api-00525-yus` — **100 % del tráfico** (18:46:08 UTC, 30 min exactos de canary desde 18:15:51) |
| Migración **0053** | ✅ aplicada — `bitacora_backfill_distancia` (11 columnas) existe en prod |
| Errores en la revisión nueva | **0** (Logging API, desde el arranque) |
| Health | **200** en 0,4 s |

Gotcha del canary: Cloud Run expresa la promoción como `LATEST → 100 %`, y **esa entrada de
`trafficStatuses` no trae el nombre de la revisión**; la que sí lo trae es la del tag
(`canary-signup-<sha12>`), que va **sin porcentaje**. Un monitor que busque el % en la entrada con nombre
lee `0 %` y parece canary trabado — no lo está. Para verificar promoción: `LATEST` al 100 % +
`latestReadyRevision` = la revisión esperada.

⚠️ **Backfill NO corrido** — endpoint admin con dry-run, detrás del gate del PO (re-deriva certificados ya
emitidos → impacto legal/ESG). Es también lo que libera el candado de retención de `telemetria_puntos`.

**Infra (#626 merged / #627 / #628):** `terraform plan` de los tres corrido y auditado 2026-07-24 (informe en `~/Downloads/tfplan-626-627-628-auditoria-2026-07-24.md`): **`0 to add, 2 to change, 0 to destroy`**. Los dos riesgos que se venían arrastrando quedaron **desmentidos** sobre el JSON del plan — ningún Cloud Run pierde env vars (`REDIS_PASSWORD` idéntico before/after en los 3 que montan Redis; `compute.tf` sí lo declara) y **0 de 91** recursos de Secret Manager cambian, sin rastro de `ROTATE_ME` (gate `check-validated-secret-placeholders.mjs` en verde). **#627 y #628 aportan 0 diff** y es lo correcto: #628 es refactor neutro, #627 es preventivo (el default de `content_sid_ready` deja montados los mismos 4 de hoy). El 2º cambio del plan (`service_api...template.revision` → `null`) es **preexistente y por diseño** — `ignore_changes` sobre `revision` está **prohibido** (pinearlo causó el 409 de #472, audit 2026-06-15) → se aisló con `apply -target` (1 recurso, 0 Cloud Run) — **ya aplicado**; el rollout del api (`revision → null`) **sigue pendiente** para una ventana elegida. Memorias: [[trivy-gate-severity-unset-2026-07]], [[plfl57-itinerario-vs-carga-sintetica-2026-07]], [[capa2-historial-traza-carga-gap-2026-07]].

---

## Snapshots archivados

El detalle de las sesiones **2026-07-01 y 2026-07-18** se archivó en [`2026-07-25-snapshot-sesiones-07-01-y-07-18.md`](./2026-07-25-snapshot-sesiones-07-01-y-07-18.md) (incluye #609 lint-rls `57521aa` y #610 pnpm 10 / ADR-075 `7e87d66` — **ambos mergeados el 2026-07-18**, corrigiendo el «esperan aprobación del PO» que el handoff arrastraba; y Datadog/#554). El detalle de sesiones anteriores (2026-06-22 hacia atrás, hasta 2026-05-17) se archivó en [`2026-07-24-snapshot-current-2026-05-a-06.md`](./2026-07-24-snapshot-current-2026-05-a-06.md). Snapshots más viejos (2026-05-05 → 05-24) viven como archivos `docs/handoff/2026-05-*.md`.
