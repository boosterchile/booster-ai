# Roadmap: production-readiness (v2)

- Spec: [`spec.md`](./spec.md) (Draft v2)
- Review: [`review.md`](./review.md)
- Sub-spec dependiente: [`../stubs-decision/spec.md`](../stubs-decision/spec.md) (debe aprobarse antes de S2)
- Created: 2026-05-17 (v1) — Updated 2026-05-17 (v2 post devils-advocate P0+P1)
- Status: **Approved** (PO 2026-05-17, v2 post devils-advocate)
- Cadencia: **variable por sprint**, **1 lane Felipe** (solo-dev)
- Deadline externo: ninguno — optimizar por calidad

> **Naturaleza de este documento.** Roadmap maestro de sprints, no `plan.md` de tareas atómicas. Cada sprint, al arrancar, produce su propio `.specs/<sprint-slug>/spec.md` y `.specs/<sprint-slug>/plan.md` con tareas ≤100 LOC.

> **Cambios clave v2** (de review.md):
> - 1 lane Felipe explícita en Gantt + lanes externas separadas (O-2).
> - SC-27 split: SC-27a bloqueante, SC-27b post-Implemented (O-1).
> - SC-23 movido a post-Implemented (O-1).
> - SC-13 reducido a Capa 1 + Capa 2 piloto Coquimbo (O-8 + lectura ADR-012).
> - SC-1 depende de sub-spec `stubs-decision/spec.md` aprobada antes de S2 (O-4).
> - SC-30: decisión strangler vs cutover en ADR antes de S3 + rollback drill + budget si strangler (O-3).
> - SC-22: on-call best-effort honesto + SLO gateway 99.5% (O-5).
> - SC-29: tiempo CI ≤10 min + sharding Playwright (O-6).
> - S8b: 3 categorías de rework + bound máx 3 sem (O-7).
> - SC-28: velocity check post-S2 (O-2).
> - Q-5..Q-8 resueltas pre-approve (P0/P1).

---

## Resumen ejecutivo

| Bloque | Sprints | Foco | Estimación lane Felipe |
|---|---|---|---|
| **A — Cierre de higiene** | S0, S1, S2 | Drift (ADR-043), legacy, coverage gaps, e2e crítico, D11, stubs decision via sub-spec | ~4–5 semanas |
| **B — Microservicios extraction** | S3, S4 | notification + matching + document service como Cloud Run independientes | ~4 semanas |
| **C — Features comprometidas** | S5, S6, S7 | Wave 5 UI ready, ADR-012 Capa 1 (eco-routing) + Capa 2 piloto Coquimbo, factoring escala plena | ~6–7 semanas |
| **D — Endurecimiento operacional** | S8, S9, S10 | Load test, DR drill, SLOs 99.5% + runbooks + on-call best-effort | ~5–6 semanas |
| **E — Compliance + go-to-market** | S11, S12, S13 | GLEC externa (post-Impl), security audit, legal+pricing+piloto firmado | ~3–4 semanas Felipe (resto lead time externo en lanes separadas) |
| **Total lane Felipe** | 14 sprints | — | **~22–26 semanas (~5–6 meses calendario)** |

**Camino crítico (lane Felipe, sin lead time externo):**
S0 → S1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → (S8b si aplica) → S9 → S10 → S12 (fixes hallazgos audit) → S13 (cierre).

**Lead times externos en lanes paralelas (NO consumen lane Felipe):**
- **GLEC audit** (SC-23 post-Impl): kickoff RFP S0; el auditor trabaja en paralelo desde ~S6 hasta donde llegue. Cierre se trackea post-Implemented.
- **Vendor pentest** (SC-24): kickoff RFP S0; vendor ejecuta entre S10–S12; Felipe fixea hallazgos en su lane.
- **Cliente piloto** (SC-27a): outreach desde S0; firma en S13; setup técnico es lane Felipe.
- **Picovoice** (SC-12): blocker externo; UI ready en S5 cumple SC-12 sin esperar approval.

---

## Gantt honesto (1 lane Felipe + N lanes externas)

```
LANE FELIPE (1 sprint a la vez):
  Sem:    1   2   3   4   5   6   7   8   9   10  11  12  13  14  15  16  17  18  19  20  21  22  23  24  25  26
  S0     ████
  S1         ████
  S2             ██████
  S3                   ████████
  S4                           ██████
  S5                                 ████
  S6                                     ██████████
  S7                                               ████
  S8                                                   ██████
  S8b                                                        ██████  (contingencia, si aplica)
  S9                                                              ████
  S10                                                                 ████
  S12 fix                                                                 ████  (fixes hallazgos)
  S13                                                                         ██████

LANES EXTERNAS (paralelas, NO consumen Felipe):
  RFPs S0  ██  (envío)
  GLEC audit (SC-23 post-Impl)
                      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (lead time auditor, cierra post-Impl)
  Vendor pentest (SC-24)
                              ░░░░░░░░░░░░░░░░░░░░░░░░░  (vendor ejecuta)
                                                       ██  (Felipe recibe hallazgos en S12)
  Cliente piloto outreach (SC-27a)
                                  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░  (outreach + negociación)
                                                                ██  (firma en S13)
  Picovoice approval
                                  ░░░░░░░░░░░░░░░░░░░░░░░░  (ETA desconocido — no bloquea)
```

**Notas del Gantt v2:**
- Solo S0..S13 dibujados en lane Felipe. Cada sprint es atómico — Felipe no ejecuta dos a la vez.
- "S11" como sprint dedicado de lane Felipe **se elimina del camino crítico**: el contenido humano se mueve a S0 (RFP) y a interactions ad-hoc con el auditor (~4-6h/semana acumulables en lane Felipe sin desplazar sprints). La spec se cierra antes de que termine la lane externa GLEC.
- S12 lane Felipe es **2-4 semanas de fixes** (post hallazgos vendor pentest). El vendor work está en lane externa.
- SC-28 (velocity check) ocurre post-S2 (~semana 5). Si velocity <0.7×, todo el cronograma S3-S13 se redibuja antes de iniciar S3.

---

## Sprint 0 — Housekeeping + RFPs (kickoff lanes externas)

**Duración estimada lane Felipe**: 1 semana.

### Objetivo
Cerrar drift visible heredado, decidir GitLab CI, purgar archivos legacy, ADR colisiones documentadas, **producir RFPs para vendors externos** (GLEC auditor, vendor pentest, ADR strangler-vs-cutover) y outreach inicial cliente piloto para que sus lead times empiecen ya.

### Cubre SC
- **SC-4 inicio** (drift schema/domain — ADR-043 redactado, sin código)
- **SC-5** (purga `AUDIT.md`, `PLAN-PHASE-0.md`, `DESIGN.md` raíz)
- **SC-6** (ADR colisiones 028/034/035 + script check)
- **SC-7** (`.gitlab-ci.yml` resuelto)
- **SC-30 inicio** (ADR strangler vs cutover redactado)

### Tareas principales (detalle en `.specs/s0-housekeeping/plan.md` cuando arranque)
- **S0.1** — ADR-043 redactado y aprobado (drift schema↔domain plan). Sin código aún.
- **S0.2** — Archivos raíz legacy (`AUDIT.md`, `PLAN-PHASE-0.md`, `DESIGN.md`): movidos a `docs/archive/<fecha>-<nombre>.md` con frontmatter `superseded_by:` o eliminados. Commit doc-only.
- **S0.3** — `scripts/check-adr-numbering.mjs` + ADR-meta documentando colisiones 028/034/035 + check pre-commit.
- **S0.4** — Decisión `.gitlab-ci.yml`: eliminar (recomendado) o revivir verde.
- **S0.5** — RFP auditor GLEC (`docs/compliance/glec-rfp.md`) + shortlist enviada por email. **Lane externa kickoff**.
- **S0.6** — RFP vendor pentest (`docs/audits/security-rfp.md`) + shortlist enviada. **Lane externa kickoff**.
- **S0.7** — ADR tool de load testing (recomendación k6) + setup mínimo en `apps/api/test/load/`.
- **S0.8** — **ADR strangler vs cutover** (cubre SC-30 parcial): decisión + budget USD/sem si strangler, validado contra `api-cost-guardrails.tf`.
- **S0.9** — Sub-spec [`.specs/stubs-decision/spec.md`](../stubs-decision/spec.md) creada (formaliza Q-6 con decisión por stub). Approve PO antes de S2.
- **S0.10** — Outreach cliente piloto: lista 5-10 prospects + primer contacto. **Lane externa kickoff**.

### Acceptance
- [ ] PRs mergeados: archivos legacy archivados, `check-adr-numbering.mjs` activo, GitLab CI resuelto.
- [ ] ADRs nuevos: ADR-043 (drift), ADR de load testing tool, ADR strangler vs cutover, ADR-meta colisiones.
- [ ] RFPs enviados (evidencia en `docs/compliance/` y `docs/audits/`).
- [ ] Sub-spec `stubs-decision/spec.md` en Draft (approve PO objetivo S1).
- [ ] Lista de prospects piloto en `docs/handoff/<fecha>-piloto-outreach.md`.

### Rollback
Sprint mayoritariamente doc-only. Revert PRs.

### Dependencias
Spec maestra **Approved**.

---

## Sprint 1 — Cierre de deuda visible parte 1: drift + coverage + e2e crítico

**Duración estimada lane Felipe**: 1 semana.

### Objetivo
Aplicar ADR-043 (drift schema↔domain) con migrations + tests; subir branches coverage `apps/api` al gate 80%; añadir primeros 4 specs Playwright críticos en CI por PR con sharding.

### Cubre SC
- **SC-2** (branches coverage api ≥80%)
- **SC-4 completo** (drift resuelto con migration + refactor)
- **SC-15 parcial** (4 de 8 flujos Playwright)
- **SC-16 parcial** (a11y en los 4 flujos)
- **SC-29** (sharding/path-filter Playwright en CI ≤10 min p95)

### Tareas principales
- **S1.1** — Migration de drift schema↔domain (siguiente número drizzle libre). Tests integration sobre infra T1+T2 ya mergeada.
- **S1.2** — Patch types en `domain/trip.ts` + `db/schema.ts` con state values consistentes; refactor de servicios afectados.
- **S1.3** — Tests para subir branches coverage `apps/api` al 80% (foco en error paths: 4xx/5xx, validation failures, race conditions).
- **S1.4** — 4 specs Playwright + axe-core: shipper-publica-carga, carrier-acepta-oferta, login-universal-rut-clave-numerica, public-tracking-via-link.
- **S1.5** — Workflow `ci.yml` actualizado para correr Playwright headless en PR.
- **S1.6** — **Sharding Playwright** + path-based filter (changed-files-only) + budget CI ≤10 min p95.
- **S1.7** — Sub-spec `stubs-decision/spec.md` aprobada por PO (target fin de S1).

### Acceptance
- [ ] Migration mergeada, `apps/api/coverage/coverage-summary.json` `total.branches.pct ≥ 80`.
- [ ] Integration test cubre trip lifecycle end-to-end con state values consistentes (T-4 spec.md).
- [ ] 4 specs Playwright corren verde en CI por PR; a11y 0 violations P0/P1.
- [ ] Tiempo CI p95 ≤10 min (GitHub Actions metrics).
- [ ] Sub-spec stubs-decision Approved.

### Rollback
Migration con down-migration testeada. Sharding configurable via env var en CI.

### Dependencias
S0 completo (ADR-043, stubs-decision spec en Draft).

---

## Sprint 2 — Cierre de deuda visible parte 2: stubs ejecución + D11 + RLS + e2e completo

**Duración estimada lane Felipe**: 2 semanas.

### Objetivo
Ejecutar decisiones de la sub-spec `stubs-decision` (eliminar o promover cada stub), cerrar D11 (T8..T12), extender RLS lint, completar suite Playwright a 8 flujos. **Velocity check al cierre del sprint (SC-28).**

### Cubre SC
- **SC-1** (0 stubs ejecutando decisión sub-spec)
- **SC-8** (D11 completa)
- **SC-15 completo** + **SC-16 completo** (8 flujos)
- **SC-17** (RLS lint extendido)
- **SC-28** (velocity check post-S2)

### Tareas principales
- **S2.1** — Ejecutar decisión por stub según sub-spec aprobada en S1. Un commit por package/app.
- **S2.2** — D11 T8..T12 completados (plan v2 existente en `docs/plans/2026-05-17-d11-v2-stakeholder-geo-aggregations.md`).
- **S2.3** — RLS lint extendido (`scripts/lint-rls.mjs`) + `docs/rls-exemptions.md` con justificación de exenciones.
- **S2.4** — 4 specs Playwright restantes: driver-ejecuta-viaje, admin-crea-organizacion-stakeholder, stakeholder-consulta-zonas, cumplimiento-emite-dte.
- **S2.5** — **Velocity check (SC-28)**: medir LOC/sem + tasks/sem ejecutados en S0-S1-S2. Producir `docs/handoff/<fecha>-velocity-check.md`. Si velocity <0.7×, replan formal S3-S13 antes de S3.

### Acceptance
- [ ] `find apps packages -path '*src*' -name '*.ts' -size -1k` retorna lista vacía o justificada.
- [ ] D11 PRs mergeados; `stakeholder-zonas.tsx` muestra drill-down con k-anon + tipo carga + combustible.
- [ ] `scripts/lint-rls.mjs` extendido + `docs/rls-exemptions.md`.
- [ ] 8 specs Playwright total en CI por PR.
- [ ] **`docs/handoff/<fecha>-velocity-check.md` producido y revisado por PO.**

### Rollback
Decisión por stub revertible vía revert PR. D11 con flag.

### Dependencias
S1 completo + sub-spec `stubs-decision/spec.md` aprobada.

---

## Sprint 3 — Microservicios extraction parte A: notification-service + matching-engine

**Duración estimada lane Felipe**: 2 semanas.

### Objetivo
Extraer `notification-service` y `matching-engine` de `apps/api` como Cloud Run independientes. Approach según ADR strangler-vs-cutover de S0.8.

### Cubre SC
- **SC-9** (notification-service extraído)
- **SC-10** (matching-engine extraído)
- **SC-30 completo** (rollback drill documentado)

### Tareas principales
- **S3.0** — **Rollback drill en staging** (cubre SC-30 completo): switch al microservicio, provocar fallo, verificar flag retorna al monolito con datos consistentes <5min. **Antes de cualquier switch en prod.** Documento en `docs/runbooks/rollback-drill-microservicios.md`.
- **S3.1** — `apps/notification-service`: scaffold real (Hono + Pub/Sub consumer + Web Push/FCM/WhatsApp/Email/SMS fan-out). Tests ≥80/80/80/80.
- **S3.2** — Dockerfile + `cloudbuild.staging.yaml` + `cloudbuild.production.yaml` + Terraform `cloud-run-service` module instance.
- **S3.3** — ADR-XXX (extraction notification-service) con decisión, alternatives, rollback referenciando S3.0.
- **S3.4** — Migration consumers: `apps/api/src/services/notify-*.ts` llama al microservicio vía OIDC SA-to-SA con flag `NOTIFICATIONS_VIA_MICROSERVICE`.
- **S3.5** — Si strangler: traffic mirroring 3-7 días en staging con monitoreo de budget (≤cap en SC-30 ADR). Si cutover: switch directo con flag.
- **S3.6** — Switch en prod; monolito mantiene fallback 2 semanas.
- **S3.7** — Mismo flow para `apps/matching-engine`: scaffold con `@booster-ai/matching-algorithm`, Pub/Sub consumer. ADR-XXX (extraction matching-engine).

### Acceptance
- [ ] `apps/notification-service` y `apps/matching-engine` con Dockerfile, deploy verde staging+prod, coverage ≥80/80/80/80.
- [ ] **Rollback drill ejecutado** y documentado.
- [ ] Endpoints fallback en monolito siguen funcionando.
- [ ] Logs muestran tráfico 100% al microservicio post-switch.
- [ ] Si strangler: budget mirroring respetado (verificable vs SC-30 ADR).
- [ ] 2 ADRs nuevos por microservicio.

### Rollback
Flag `*_VIA_MICROSERVICE=false` retoma monolito. Drill de S3.0 valida que esto funciona realmente.

### Dependencias
S0.8 (ADR strangler vs cutover) + S1 (coverage gate) + S2 (velocity check OK).

---

## Sprint 4 — Microservicios extraction parte B: document-service

**Duración estimada lane Felipe**: 2 semanas.

### Objetivo
Extraer `document-service` (DTE + Carta Porte + OCR + retention) como Cloud Run independiente. Más sensible que S3 por compliance SII — drill de rollback más estricto.

### Cubre SC
- **SC-11** (document-service extraído)

### Tareas principales
- **S4.1** — `apps/document-service`: scaffold (DTE provider integration, Carta Porte generator, OCR pipeline, GCS retention con Object Retention Lock). Tests ≥80/80/80/80.
- **S4.2** — Dockerfile + Cloud Build + Terraform module instance.
- **S4.3** — ADR-XXX (extraction document-service) con scope SII compliance.
- **S4.4** — Migration consumers: `apps/api` routes `documentos.ts`, `certificates.ts`, `cumplimiento.ts` llaman al microservicio vía OIDC. Flag `DOCUMENTS_VIA_MICROSERVICE`.
- **S4.5** — **Rollback drill SII-grade**: drill incluye emisión DTE en staging vía microservicio + rollback al monolito + reconciliación verificada (sin DTE duplicado ni perdido).
- **S4.6** — Si strangler: mirroring 1 semana en staging. Si cutover: switch + watch.
- **S4.7** — Switch en prod; monolito mantiene fallback 2 semanas.
- **S4.8** — Decisión `packages/carta-porte-generator` stub: poblar con lógica extraída o eliminar (según sub-spec stubs-decision).

### Acceptance
- [ ] `apps/document-service` con Dockerfile, deploy verde, coverage ≥80/80/80/80.
- [ ] **Rollback drill SII-grade ejecutado** y documentado.
- [ ] DTE emitido vía microservicio = DTE emitido vía monolito (paridad en staging).
- [ ] ADR-XXX.

### Rollback
Flag OFF. Si incidente en switch real con emisión DTE, rollback inmediato + reconciliación manual + nota SII si aplica.

### Dependencias
S3 completo (patrón strangler/cutover validado).

---

## Sprint 5 — Wave 5 wake-word UI ready behind flag

**Duración estimada lane Felipe**: 1 semana.

### Objetivo
Dejar PWA con wake-word activable sin nuevo deploy: instalar Porcupine SDK, wire `PorcupineWakeWordController` detrás de flag, Secret Manager listo para `PICOVOICE_ACCESS_KEY`, runbook de activación.

### Cubre SC
- **SC-12** (Wave 5 UI ready, activable sin deploy)

### Tareas principales
- **S5.1** — Instalar `@picovoice/porcupine-web` (cuando Picovoice approval ON; sino mock SDK).
- **S5.2** — `apps/web/src/services/wake-word.ts`: `PorcupineWakeWordController` real, lazy-loaded sólo si flag ON.
- **S5.3** — Endpoint `/feature-flags` retorna `WAKE_WORD_VOICE_ACTIVATED` desde env + valida `PICOVOICE_ACCESS_KEY` presente.
- **S5.4** — Terraform: Secret Manager para `PICOVOICE_ACCESS_KEY` (placeholder vacío si Picovoice OFF, IAM listo).
- **S5.5** — Runbook `docs/runbooks/wake-word-activation.md`.
- **S5.6** — Test E2E que verifica flag ON + key dummy → bundle carga controller real.

### Acceptance
- [ ] Flag ON + key dummy en staging → bundle carga `PorcupineWakeWordController`.
- [ ] Runbook completo en `docs/runbooks/`.
- [ ] Terraform aplicado con Secret Manager + IAM ready.

### Rollback
Flag OFF retoma `StubWakeWordController`. Sin impacto visible.

### Dependencias
S0 (RFP Picovoice tracking — Picovoice approval **no bloqueante** para SC-12 que se conforma con "UI ready behind flag").

---

## Sprint 6 — ADR-012 Capa 1 (eco-routing) + Capa 2 (observatorio Coquimbo)

**Duración estimada lane Felipe**: 2.5 semanas. Sprint grande. Si velocity check S2 sugirió <0.7×, dividir en S6a/S6b.

### Objetivo
Implementar **solo las Capas 1 y 2** del ADR-012 según lectura post-review. Capas 3-4 (gemelos digitales) están en Out of scope de la spec maestra.

### Cubre SC
- **SC-13a** (Capa 1 — eco-routing real-time live)
- **SC-13b** (Capa 2 — observatorio Coquimbo live, dashboard municipal entregado)

### Tareas principales
- **S6.1** — Verificación ADR-012 vigente (ya hecho 2026-05-17, vigente con Capas 1-2 en este scope). Si requiere actualización por scope reducido, ADR nuevo con `supersede_partial: 012`.
- **S6.2 (Capa 1)** — `apps/eco-routing-service` (Cloud Run consumer Pub/Sub `traffic-condition-events`) + `packages/traffic-condition-detector` + `packages/route-alternatives-evaluator`. Notification al driver via Web Push (consumido por notification-service post-S3).
- **S6.3 (Capa 1)** — Tabla `route_suggestions` en Postgres + replicada a BigQuery para ML training futuro.
- **S6.4 (Capa 1)** — UI driver PWA: card con sugerencia + aceptar/rechazar; integración Routes API.
- **S6.5 (Capa 2)** — Dataform transformations BigQuery (cada hora) → materialized views `urban_flow_metrics_hourly` (foco Coquimbo IV región).
- **S6.6 (Capa 2)** — `apps/api/src/routes/observatory/*` con endpoints agregados (consent-aware). `packages/urban-observatory-queries` con queries tipadas.
- **S6.7 (Capa 2)** — Dashboard admin interno `/admin/observatory/coquimbo` + dashboard municipal.
- **S6.8 (Capa 2)** — Outreach + onboarding municipio Coquimbo (lane externa); **OQ-1 spec.md resuelta**.
- **S6.9** — Consent flow al onboarding carrier (default opt-in, opt-out sin penalización, agregación mínima 10 vehículos por bucket).
- **S6.10** — Tests Playwright para flujo observatory (shipper consent + stakeholder/admin views).

### Acceptance
- [ ] Capa 1: detección congestión <60s; sugerencia driver <5s; tabla `route_suggestions` poblada; métricas custom adopción visibles.
- [ ] Capa 2: BigQuery `observatory` queryable; endpoint público responde; dashboard admin Coquimbo renderiza datos reales; dashboard municipal entregado al municipio (sign-off documentado).
- [ ] Coverage ≥80/80/80/80 mantenido.
- [ ] Consent flow funcional + audit trail.

### Rollback
Flags `ECO_ROUTING_ACTIVATED=false` + `URBAN_OBSERVATORY_ACTIVATED=false` ocultan UI. BigQuery dataset queda poblado.

### Dependencias
S3 (matching-engine para datos de matches que alimentan observatory) + S5 puede estar en paralelo de la lane Felipe SI velocity lo permite, pero recordatorio: **1 lane Felipe = un sprint a la vez**.

---

## Sprint 7 — Factoring V1 "Cobra Hoy" escala plena

**Duración estimada lane Felipe**: 1.5 semanas.

### Objetivo
Pasar factoring V1 de "escala mínima" (ADR-032) a "escala plena": eliminar restricciones que requerían operador, soportar ≥100 liquidaciones/día sin intervención, reconciliación DTE automatizada.

### Cubre SC
- **SC-14** (factoring escala plena)

### Tareas principales
- **S7.1** — Revisar ADR-029/030/031/032; ADR-XXX con plan de escalado.
- **S7.2** — Job batch `procesar-cobranza-cobra-hoy.ts` upgradeado: paralelización segura, idempotencia mejorada, métricas custom.
- **S7.3** — Reconciliación DTE automática (`reconciliar-dtes.ts`): cubrir edge cases que hoy requieren operador.
- **S7.4** — Tests integration con dataset de 100 liquidaciones simuladas.
- **S7.5** — Dashboard admin `admin-cobra-hoy.tsx` con visibilidad de queue + retries + manual override (justificado).

### Acceptance
- [ ] Test integration procesa 100 liquidaciones sin intervención manual, todas con DTE reconciliado.
- [ ] Métricas custom (procesadas, monto factorizado, error rate) visibles en Cloud Monitoring.
- [ ] Dashboard admin muestra queue + retries + override.

### Rollback
Flag `FACTORING_V1_FULL_SCALE=false` retoma escala mínima. Idempotencia preserva liquidaciones in-flight.

### Dependencias
S4 (document-service para DTE estable).

---

## Sprint 8 — Load testing + performance hardening

**Duración estimada lane Felipe**: 2 semanas (1.5 si no aparecen sorpresas; S8b reservado si rework).

### Objetivo
Ejecutar load test al volumen target (SC-18) sobre staging, identificar bottlenecks, aplicar fixes hasta cumplir budget.

### Cubre SC
- **SC-18** (load test cumple budgets)

### Tareas principales
- **S8.1** — Script `pnpm load-test` (tool decidido en S0.7) con scenarios: 50 RPS sostenido api, 200 RPS pico, 1 000 conexiones TCP gateway.
- **S8.2** — Smoke run en staging con quota separada.
- **S8.3** — Análisis: identificar bottlenecks (DB queries, N+1, missing indexes, hot paths).
- **S8.4** — Fixes por bottleneck (commits separados). Cada fix con before/after measurements.
- **S8.5** — Re-run load test hasta cumplir budgets.
- **S8.6** — Reporte `docs/perf/load-test-YYYY-MM-DD.md`.

### Acceptance
- [ ] Reporte muestra p95 ≤500ms api, p99 ≤1.5s, 1 000 conexiones TCP sin drops.
- [ ] Cost budget no overrun.

### Rollback
Fixes por commit revertibles. Test infra no-op si no se re-ejecuta.

### Dependencias
S3 + S4 completos (microservicios estables) + S7 (factoring escala plena para representar carga real).

### Contingencia S8b — categorías de rework esperables (cubre O-7 review)
Si load test revela rework, S8b máximo **3 semanas lane Felipe**. Categorías típicas:
- **(a) DB-bound**: read replica + connection pooling tuning + query optimization. ~1.5 sem.
- **(b) N+1 / app-bound**: batching, DataLoader pattern, eliminar serial fetches. ~1 sem.
- **(c) Infra-bound** (Cloud Run cold starts, Pub/Sub backlog): min instances, concurrency tuning, autoscaling thresholds. ~1 sem.

Si rework requerido excede 3 sem combinadas, **re-aprobar spec maestra** antes de continuar (gate explícito).

---

## Sprint 9 — DR drill + runbooks por servicio

**Duración estimada lane Felipe**: 1.5 semanas.

### Objetivo
Ejecutar primer DR drill real (no solo provisión de infra DR como hoy), medir RTO/RPO contra targets, documentar runbooks.

### Cubre SC
- **SC-19** (DR drill ejecutado)
- **SC-21** (runbook por servicio)

### Tareas principales
- **S9.1** — Script `pnpm dr-drill`: snapshot Cloud SQL → failover gateway primary→DR → restore Cloud SQL DR desde snapshot → verificación paridad → failback.
- **S9.2** — Ejecutar drill en staging completo; medir RTO + RPO.
- **S9.3** — Si RTO >30 min o RPO >5 min, ajustes Terraform + scripts; re-run.
- **S9.4** — Reporte `docs/runbooks/dr-drill-<fecha>.md`.
- **S9.5** — Runbooks por servicio: `api.md`, `telemetry-tcp-gateway.md`, `telemetry-processor.md`, `whatsapp-bot.md`, `cobra-hoy.md`, `incidents-glec.md` + nuevos `notification-service.md`, `matching-engine.md`, `document-service.md`, `eco-routing-service.md` con estructura común.

### Acceptance
- [ ] Reporte DR drill: RTO ≤30 min, RPO ≤5 min.
- [ ] ≥10 runbooks completos.

### Rollback
Drill en staging. Failback documentado y testeado. Prod no se toca.

### Dependencias
S8 (perf hardening — DR no debe revelar lo que S8 no vio).

---

## Sprint 10 — SLOs + alertas + on-call ritual best-effort

**Duración estimada lane Felipe**: 1.5 semanas.

### Objetivo
Definir SLOs por servicio en Terraform (99.5% para gateway, no 99.9% — solo-dev calibrated), configurar burn-rate alerts, documentar on-call ritual unipersonal explícito.

### Cubre SC
- **SC-20** (SLOs + alertas)
- **SC-22** (on-call ritual best-effort)

### Tareas principales
- **S10.1** — ADR-XXX con SLOs por servicio (todos 99.5% excepto whatsapp-bot 99%). Refleja decisión spec §6.5.
- **S10.2** — Terraform `monitoring.tf` extendido: SLO resource + burn-rate alert (fast + slow burn) por servicio.
- **S10.3** — Cloud Monitoring dashboards por servicio con SLI tracking.
- **S10.4** — `docs/runbooks/on-call.md` con rotación unipersonal, canales (PagerDuty/Discord/SMS), response window: ≤30 min business hours, ≤2h fuera. Sin partner en este alcance.
- **S10.5** — `docs/runbooks/post-mortem-template.md` con sections: summary, timeline, impact, root cause, action items.
- **S10.6** — Smoke: trigger alerta sintética, verificar que página al canal correcto.

### Acceptance
- [ ] `terraform plan` muestra SLO + burn-rate alert por servicio (10 servicios incluyendo microservicios extraídos + eco-routing).
- [ ] Smoke test páginas oncall.
- [ ] Runbooks on-call + post-mortem en `docs/runbooks/`.

### Rollback
Alertas silenciables vía Terraform. SLOs son metadata.

### Dependencias
S9 (runbooks por servicio existen).

---

## Sprint 11 — (eliminado del camino crítico Felipe)

**Contenido movido**:
- RFP GLEC → S0.5 (lane Felipe).
- Lead time auditor → lane externa GLEC audit (corre desde ~S6 hasta donde llegue).
- Sesiones Q&A con auditor → ad-hoc en lane Felipe (~4-6h/semana acumulables, no desplaza otros sprints).
- Fixes a metodología si auditor identifica gaps → commits en su propio mini-ciclo spec/plan, no sprint dedicado.

**SC-23** se cierra **post-Implemented** cuando llegue el certificado. **SC-27b** idem.

---

## Sprint 12 — Fixes hallazgos vendor pentest

**Duración estimada lane Felipe**: 2-4 semanas (depende de # findings P0/P1).

### Objetivo
Vendor ejecuta pentest en lane externa (kickoff RFP en S0.6, contrato firmado entre S2-S6). Felipe recibe findings y los fixea. Cierre con re-test vendor.

### Cubre SC
- **SC-24** (0 findings P0/P1 abiertos al cierre)

### Tareas principales
- **S12.1** — Lane externa (no consume Felipe): vendor ejecuta pentest + OWASP review entre semana ~12 y ~18.
- **S12.2 (lane Felipe)** — Triage de findings por severidad.
- **S12.3 (lane Felipe)** — Fixes a findings P0/P1 (commits con tests). ADR si requiere cambio arquitectónico.
- **S12.4** — Re-test vendor + reporte final adjunto en `docs/audits/security-pre-launch-<fecha>.md`.
- **S12.5** — Tickets de findings P2/P3 abiertos en backlog con owner + fecha objetivo.

### Acceptance
- [ ] Reporte security pre-launch adjunto.
- [ ] **0 findings P0/P1 abiertos** al cierre.
- [ ] P2/P3 trackeados en backlog.

### Rollback
N/A (fixes en código son commits revertibles).

### Dependencias
S10 (SLOs + alertas visibles — el vendor querrá ver telemetría operativa) + lane externa vendor en marcha desde S0.6.

---

## Sprint 13 — Go-to-market readiness

**Duración estimada lane Felipe**: 2 semanas (sin contar lead time externo cliente piloto).

### Objetivo
Cerrar wrap: términos legales firmados con T&C que reflejan ventana on-call real, pricing prod publicado, ≥1 cliente piloto firmado y procesando ciclo (SC-27a). SC-27b queda pendiente para post-Implemented.

### Cubre SC
- **SC-25** (términos legales firmados, incluyen ventana on-call)
- **SC-26** (pricing prod)
- **SC-27a** (piloto firmado y operando con cert auto-emitido)

### Tareas principales
- **S13.1** — Términos legales finalizados (T&C, política privacidad, contratos shipper/carrier/driver/stakeholder) con sección "on-call response window" reflejando SC-22. Abogado contratado (lane externa desde S0/S1).
- **S13.2** — ADR-XXX actualizado con tiers definitivos pricing.
- **S13.3** — `www.boosterchile.com` actualizado con pricing.
- **S13.4** — Smoke test scrapea www y diff vs ADR pricing.
- **S13.5** — Si no hay checkout flow en `apps/web`, ADR-XXX documenta mecanismo de cobro (factura manual / transferencia / pasarela B2B).
- **S13.6** — Cliente piloto: outreach inició en S0.10. En S13: cerrar contrato firmado.
- **S13.7** — Onboarding cliente piloto (sesión presencial + setup técnico).
- **S13.8** — Primer ciclo de facturación procesado para el piloto.
- **S13.9** — Primer certificado de huella emitido para el piloto, **auto-certificado GLEC-compatible** (cumple SC-27a). Re-emisión con sello externo cuando GLEC audit cierre (SC-27b post-Impl).
- **S13.10** — Documento de feedback piloto en `docs/handoff/<fecha>-cliente-piloto-1.md`.
- **S13.11** — Marcar spec maestra **Implemented** (todos los bloqueantes marcados). SC-23 + SC-27b siguen abiertos en `docs/handoff/` como post-Implemented.

### Acceptance
- [ ] Docs legales con frontmatter `lawyer_review` + `signature_hash` + sección on-call window.
- [ ] Pricing en www coincide con ADR.
- [ ] Cliente piloto: contrato + primer ciclo facturado + cert auto-emitido + feedback documentado.
- [ ] **Spec production-readiness Status: Implemented.**

### Rollback
N/A (actions externas + commits revertibles).

### Dependencias
S12 (sin findings P0/P1 abiertos) + S10 (SLOs visibles) + lane externa cliente piloto firma + lane externa abogado contratado y revisión hecha.

---

## Cronograma agregado v2 — solo lane Felipe

| Sem | Sprint en lane Felipe | Hito externo en lane paralela |
|---|---|---|
| 1 | S0 (housekeeping + RFPs) | RFP enviados GLEC, pentest, outreach piloto |
| 2 | S1 (drift + coverage api + 4 specs Playwright) | sub-spec stubs-decision Approved (target fin S1) |
| 3-4 | S2 (stubs ejecución + D11 + RLS + Playwright completo + velocity check) | — |
| 5 | **Velocity check** (SC-28); replan S3-S13 si <0.7× | Contratos vendor GLEC + pentest firmándose |
| 5-6 | S3 (notification + matching extracted) | — |
| 7-8 | S4 (document extracted) | Vendor pentest comienza ejecución staging |
| 9 | S5 (Wave 5 UI ready) | Auditor GLEC comienza review en lane externa |
| 10-12 | S6 (Capa 1 eco-routing + Capa 2 observatorio Coquimbo) | Cliente piloto outreach activo |
| 13 | S7 (factoring escala plena) | Vendor pentest entrega findings |
| 14-15 | S8 (load test + perf hardening) | — |
| 16-18 | S8b (contingencia rework, si aplica, máx 3 sem) | — |
| 19 | S9 (DR drill + runbooks) | — |
| 20 | S10 (SLOs + on-call best-effort) | — |
| 21-23 | S12 (fixes hallazgos pentest) | Auditor GLEC continúa (no bloquea) |
| 24-25 | S13 (legal + pricing + piloto firma + setup + cert auto-emitida) | Cliente piloto en setup técnico |
| 26 | **Spec Implemented** (bloqueantes cerrados) | SC-23 + SC-27b siguen abiertos post-Impl |

Total lane Felipe: **22–26 semanas** según contingencias S8b y velocity.

---

## Out-of-band (continuo, no sprints dedicados)

- Coverage gate mantenido en CI durante todos los sprints.
- Pre-commit hooks (biome + gitleaks + `check-adr-numbering`) no se debilitan.
- Devils-advocate obligatorio al arrancar cada sprint (al producir sub-spec).
- CURRENT.md actualizado al cierre de cada sprint con merge significativo.
- Picovoice approval monitoreado fuera del sprint cycle.
- GLEC auditor interactions: ~4-6h/sem ad-hoc (no desplaza sprints).
- Cliente piloto outreach: contactos mantenidos ~2h/sem (no desplaza sprints).

## Open questions remaining (no bloquean approve)

- **OQ-1** (S6): Municipio Coquimbo contraparte identificada.
- **OQ-2** (S13): Forma legal del piloto (B2B vs case study sin facturación durante X meses).

## Matriz de dependencias (cubre O-9)

| Sprint | Depende de spec/sub-spec/ADR | Depende de sprint anterior |
|---|---|---|
| S0 | Spec maestra Approved | — |
| S1 | ADR-043 de S0 | S0 |
| S2 | Sub-spec stubs-decision Approved | S1 |
| S3 | ADR strangler-vs-cutover de S0; velocity OK | S2 |
| S4 | Patrón validado | S3 |
| S5 | — | (puede ir post-S2 si lane Felipe disponible; default post-S4) |
| S6 | ADR-012 (vigente con scope reducido) | S3 (datos matching) |
| S7 | — | S4 (document-service) |
| S8 | — | S3 + S4 + S7 (carga representativa) |
| S9 | — | S8 |
| S10 | — | S9 |
| S12 | — | S10 + lane externa vendor |
| S13 | SC-25 lane externa abogado + lane externa piloto firma | S12 + S10 |

## Decision log

- **2026-05-17** — Roadmap v1 inicial.
- **2026-05-17** — Devils-advocate pass. PO eligió aplicar P0+P1 + bajar SLO 99.5%.
- **2026-05-17** — **v2**: 1 lane Felipe explícita; S11 eliminado (lead time externo en lane paralela); S12 redefinido como fixes hallazgos pentest; S6 reducido a Capa 1+2 (Capas 3-4 a Out of scope); SC-30 (strangler vs cutover ADR + rollback drill) + SC-28 (velocity check) + SC-29 (CI ≤10min) integrados en sprints; matriz de dependencias agregada; total 22-26 sem lane Felipe (vs "17-22 sem" v1 deshonesto).
- **2026-05-17** — **APPROVED por PO** junto con spec.md v2. S0 puede iniciar cuando el PO lo señale.
