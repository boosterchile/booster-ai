# Spec: production-readiness

- Author: Felipe Vicencio (con agent-rigor)
- Date: 2026-05-17
- Status: **Approved** (PO 2026-05-17, v2 post devils-advocate P0+P1)
- Linked: [`.specs/audit-2026-05-14/inventory.md`](../audit-2026-05-14/inventory.md), [`docs/handoff/CURRENT.md`](../../docs/handoff/CURRENT.md), [`./review.md`](./review.md), [`../stubs-decision/spec.md`](../stubs-decision/spec.md)

---

## 1. Objective

Llevar Booster AI desde su estado actual — "operativo con waves 1–6 mergeadas, auth universal activo, demo subdomain funcionando" — al estado **TRL 10 comercializable** declarado en `CLAUDE.md`: producto sin stubs, con cobertura full-stack, microservicios extraídos según ADRs, features comprometidas (Wave 5 UI ready, ADR-012 Capa 1 + Capa 2 piloto Coquimbo, factoring V1 escala plena) implementadas, certificado externamente bajo GLEC v3.0, auditado en seguridad pre-launch, con SLOs comprometidos *realistas para solo-dev*, DR ejercitado y al menos un cliente piloto pagando bajo contrato firmado.

El usuario directo es Felipe Vicencio (PO + único desarrollador). Derivativamente, los cinco roles del producto (shipper, carrier, driver, admin, stakeholder ESG).

## 2. Why now

CLAUDE.md fija "cero deuda técnica desde day 0" y el inventory 2026-05-14 mostró que el proyecto está cerca pero todavía no allí: 3 apps stub, 5 packages stub, `apps/api` branches coverage 75% (bajo gate 80%), 1 spec Playwright real, drift schema↔domain documentado, archivos raíz `AUDIT.md`/`PLAN-PHASE-0.md`/`DESIGN.md` sin tocar desde 2026-05-05. La demo Corfo del 2026-05-18 fue hito comercial pero no certificación: si se empieza a vender ya, los incidentes con clientes pagando se cobran en trust irrecuperable; el costo de cerrar la deuda hoy es ~4× menor que cerrarla con SLOs comprometidos en prod. El PO eligió alcance C (deuda + features + endurecimiento operacional + go-to-market) y optimización por calidad sin deadline externo — esta spec captura ese mandato como contrato verificable, con criterios honestos para solo-dev.

## 3. Success criteria

Cada criterio es comprobable de forma binaria. La spec se considera **Implementada** cuando todos los SC marcados como "bloqueantes para `Implemented`" están marcados. Los SC marcados como "post-Implemented" se trackean pero no bloquean el cierre (ver O-1 review.md).

### 3.1 Higiene técnica

- [ ] **SC-1** (bloqueante) — 0 archivos placeholder de 7–13 LOC en `apps/` y `packages/`. Cada uno **eliminado** del repo o **implementado** con cobertura ≥80/80/80/80. Decisiones por stub formalizadas en sub-spec [`stubs-decision/spec.md`](../stubs-decision/spec.md), aprobada **antes de iniciar S2**.
- [ ] **SC-2** (bloqueante) — Branches coverage ≥80% en `apps/api` (hoy 75.01%). Verificable vía `apps/api/coverage/coverage-summary.json`.
- [ ] **SC-3** (bloqueante) — Coverage 80/80/80/80 sostenido en todos los `apps/*` y `packages/*` con código real. CI gate enforza.
- [ ] **SC-4** (bloqueante) — Drift schema↔domain (CURRENT.md §c) resuelto. `domain/trip.ts` y `db/schema.ts` usan los mismos identifiers + state values. **ADR-043** cerrado (no ADR-042, que ya existe para stakeholder-geo).
- [ ] **SC-5** (bloqueante) — `AUDIT.md` raíz, `PLAN-PHASE-0.md` raíz y `DESIGN.md` raíz son **eliminados** o **migrados a `docs/archive/` con frontmatter `superseded_by:`**.
- [ ] **SC-6** (bloqueante) — 3 colisiones históricas de numeración ADR (028/034/035) documentadas en un ADR-meta + `scripts/check-adr-numbering.mjs` activo en pre-commit.
- [ ] **SC-7** (bloqueante) — `.gitlab-ci.yml` **eliminado** o **revivido con CI verde**.

### 3.2 Cobertura funcional comprometida

- [ ] **SC-8** (bloqueante) — D11 (stakeholder geo aggregations) completa y mergeada, infra de integration tests `apps/api` consolidada (T1+T2 ya mergeados, T3..T12 cerrados).
- [ ] **SC-9** (bloqueante) — `apps/notification-service` extraído como microservicio independiente con Dockerfile, deploy Cloud Run, tests ≥80/80/80/80, ADR de extracción, migración consumidores ON via flag.
- [ ] **SC-10** (bloqueante) — `apps/matching-engine` extraído como microservicio independiente (Pub/Sub consumer, scoring multifactor V2 vivo), idem requisitos SC-9.
- [ ] **SC-11** (bloqueante) — `apps/document-service` extraído como microservicio independiente (DTE + Carta Porte + OCR + retention), idem requisitos SC-9.
- [ ] **SC-12** (bloqueante) — Wave 5 wake-word UI ready behind flag + path de activación sin nuevo deploy una vez llegue Picovoice approval. `WAKE_WORD_VOICE_ACTIVATED=true` no requiere cambios de código, solo set de Secret Manager + flag.
- [ ] **SC-13a** (bloqueante) — **ADR-012 Capa 1** (eco-routing real-time) live en producción: detección de congestión <60s, sugerencia al driver <5s tras detección, tabla `route_suggestions` poblada en BigQuery, métricas custom de adopción visibles.
- [ ] **SC-13b** (bloqueante) — **ADR-012 Capa 2** (observatorio urbano) — **piloto Coquimbo** live: Dataform transformations + materialized views BigQuery, endpoints `apps/api/src/routes/observatory/*`, dashboard admin interno `/admin/observatory/coquimbo`, dashboard municipal entregado al municipio. Agregación mínima 10 vehículos por bucket; consent flow al onboarding carrier.
- [ ] **SC-14** (bloqueante) — Factoring V1 "Cobra Hoy" a escala plena (ADR-029/032): elimina escala mínima, soporta ≥100 liquidaciones/día sin manual intervention, reconciliación DTE automatizada (sin operador humano en flujo normal).

### 3.3 Tests

- [ ] **SC-15** (bloqueante) — Suite Playwright cubre los 8 flujos críticos por rol: shipper-publica-carga, carrier-acepta-oferta, driver-ejecuta-viaje, admin-crea-organizacion-stakeholder, stakeholder-consulta-zonas, public-tracking-via-link, login-universal-rut-clave-numerica, cumplimiento-emite-dte. Cada flujo corre en CI por PR.
- [ ] **SC-16** (bloqueante) — Suite a11y axe-core verifica WCAG 2.1 AA en cada flujo de SC-15. 0 violations P0/P1 al merge.
- [ ] **SC-17** (bloqueante) — RLS lint (`scripts/lint-rls.mjs`) extendido a 100% de tablas con datos por-empresa. Lista de tablas exentas documentada en `docs/rls-exemptions.md`.

### 3.4 Endurecimiento operacional

- [ ] **SC-18** (bloqueante) — Load test ejecutado al volumen target (§6: 50 RPS sostenido api, 200 RPS pico; 1 000 conexiones TCP concurrentes gateway). p95 ≤500ms api, p99 ≤1.5s, 0 connection drops sostenidos en gateway. Reporte en `docs/perf/load-test-YYYY-MM-DD.md`.
- [ ] **SC-19** (bloqueante) — DR drill ejecutado y documentado: failover cluster telemetría primario→DR, restore Cloud SQL desde snapshot, verificación de RTO ≤30 min / RPO ≤5 min. Reporte en `docs/runbooks/dr-drill-YYYY-MM-DD.md`.
- [ ] **SC-20** (bloqueante) — SLOs definidos por servicio (api 99.5%, telemetry-tcp-gateway **99.5% — bajado desde 99.9% por solo-dev**, telemetry-processor 99.5%, whatsapp-bot 99%) y alertas configuradas en Cloud Monitoring vía Terraform. Cada SLO con error budget burn-rate alert.
- [ ] **SC-21** (bloqueante) — Runbook por servicio en `docs/runbooks/` con estructura común (alerts handled, common failures, rollback steps, escalation). Lista mínima: `api.md`, `telemetry-tcp-gateway.md`, `telemetry-processor.md`, `whatsapp-bot.md`, `cobra-hoy.md`, `incidents-glec.md`.
- [ ] **SC-22** (bloqueante) — On-call ritual definido como **solo-dev best-effort explícito**: rotación documentada honestamente como unipersonal, canales de alerta (PagerDuty / Discord / SMS fallback), expected response time = "≤30 min business hours, ≤2h fuera de business hours", post-mortem template. Ventana real reflejada en T&C piloto (SC-25).

### 3.5 Compliance y go-to-market

- [ ] **SC-23** (post-Implemented) — Certificación GLEC v3.0 externa: contrato con auditor third-party firmado, audit ejecutado, certificado emitido. Evidencia en `docs/compliance/glec-certification-YYYY.pdf`. **Lead time externo** — no bloquea `Implemented`.
- [ ] **SC-24** (bloqueante) — Auditoría de seguridad pre-launch externa (penetration test + OWASP review): contrato con vendor firmado, audit ejecutado, **0 findings P0/P1 abiertos** al cierre. Reporte en `docs/audits/security-pre-launch-YYYY-MM-DD.md`.
- [ ] **SC-25** (bloqueante) — Términos legales finales (T&C, política privacidad PII stakeholders, contrato shipper, contrato carrier, contrato driver, contrato stakeholder) **revisados por abogado** y publicados. T&C piloto incluye ventana real de respuesta on-call (consistente con SC-22). Evidencia: frontmatter `lawyer_review: <date>` + `signature_hash: <X>` en cada doc.
- [ ] **SC-26** (bloqueante) — Pricing prod publicado en `www.boosterchile.com` consistente con ADR-027 final. Si `apps/web` no tiene checkout flow, ADR-XXX documenta el mecanismo de cobro (factura manual / transferencia / pasarela B2B).
- [ ] **SC-27a** (bloqueante) — **≥1 cliente piloto firmado y operando** con contrato firmado, primer ciclo de facturación procesado, primera huella **auto-certificada GLEC-compatible** emitida, y feedback documentado en `docs/handoff/<fecha>-cliente-piloto-1.md`.
- [ ] **SC-27b** (post-Implemented) — Re-emisión del certificado del piloto con **sello externo** cuando SC-23 cierre. No bloquea `Implemented`.

### 3.6 Honesty rails para solo-dev

- [ ] **SC-28** (bloqueante) — Después de S2, **velocity check**: medir LOC/sem y tasks/sem ejecutados en S0-S2. Si velocity es ≤0.7× la planificada, replanificar S3-S13 antes de iniciar S3. Decision capturada en `docs/handoff/<fecha>-velocity-check.md` + actualización del roadmap.
- [ ] **SC-29** (bloqueante) — Tiempo CI total por PR ≤10 min p95 wall-clock. Verificable en GitHub Actions metrics. Si Playwright + a11y suben sobre umbral, sharding/path-filter aplicado en `ci.yml`.
- [ ] **SC-30** (bloqueante) — **Decisión strangler vs cutover documentada en ADR antes de S3**. Si strangler con mirroring: budget cloud incremental cuantificado en USD/semana y aprobado contra `api-cost-guardrails.tf`. Si cutover: rollback drill en staging documentado.

> **Regla de cierre**: la spec se marca `Implemented` cuando todos los **bloqueantes** están marcados. SC-23 y SC-27b son **post-Implemented** — se trackean en `docs/handoff/` como pendientes, pero no impiden cerrar la spec ni iniciar nuevas. Esto evita que la spec quede `Draft` indefinidamente esperando lead time externo (objection O-1 review.md).

## 4. User-visible behaviour

### 4.1 Por rol — cambios respecto al estado actual (post-Wave 6)

**Shipper** (generador de carga):
- Cumplimiento (DTE + Carta de Porte) emite sin reintentos manuales cuando Sovos responde 2xx; reintentos automáticos con backoff exponencial en fallas 5xx.
- Tracking público por link funciona en escenarios reales con telemetría 24/7 (no degradado a "ETA al centroide").
- Visualización observatorio urbano disponible para shippers con consent ESG explícito (Capa 2 ADR-012, piloto Coquimbo).
- Certificado de huella de carbono GLEC v3.0 firmado por KMS lleva sello de **auditor externo** cuando SC-23 cierre (SC-27b).

**Carrier** (transportista):
- Ofertas via WhatsApp template aprobado sin fallback a SMS salvo error real Twilio.
- Pago "Cobra Hoy" disponible para todas las liquidaciones que cumplan criterios (no solo escala mínima); UX muestra status de procesamiento en tiempo real.
- Liquidaciones agregadas por período (semana/quincena/mes) seleccionable; export CSV/PDF.
- Carriers en región IV reciben eco-routing real-time durante trips (ADR-012 Capa 1).

**Driver** (conductor):
- Login universal RUT + clave numérica sin opción legacy de email/password (legacy queda solo accesible para users heredados con flag `LEGACY_AUTH_GRANDFATHERED`).
- Wake-word "Oye Booster" activable cuando llegue Picovoice (no requiere nuevo deploy de la PWA).
- Coaching post-viaje emitido automáticamente cuando el viaje cierra con score <umbral.
- Sugerencias eco-routing durante trip activo (cards en PWA con "Aceptar sugerencia" / "Seguir ruta actual").

**Admin** (staff Booster):
- Dashboard observabilidad incluye burn-rate de cada SLO + lista de alertas activas.
- Console de stakeholder orgs soporta creación + miembros + revocación de consents.
- Dashboard `/admin/observatory/coquimbo` muestra flujos urbanos.
- Audit log de acciones críticas (cambio de pricing, override matching, deshabilitación user) visible y filtrable.

**Stakeholder ESG**:
- Drill-down por zona con k-anonimización (k≥5) sin fallar al cruzar tipo de carga + combustible (D11 v2 completa).
- Reporte mensual descargable (PDF + CSV) con metodología GLEC v3.0 (sello externo post-SC-23).
- Audit trail de accesos visible al stakeholder en su propio dashboard.

**Municipio piloto Coquimbo**:
- Dashboard urban observatory con métricas de flujos, congestión, emisiones, OD matrix (vista exportable en PDF mensual).

## 5. Out of scope

Lo siguiente queda explícitamente **fuera** del alcance de esta spec:

- **Internacionalización**: producto sigue siendo solo Chile (ADR-007). 0 trabajo multi-país, multi-currency, multi-language.
- **Apps nativas iOS/Android**: PWA es la decisión vigente (ADR-008).
- **Marketplace de servicios complementarios** (seguros, mantenimiento, repuestos).
- **Marketing site rediseño**: `www.boosterchile.com` se actualiza solo en pricing (SC-26).
- **SOC 2 Type II full**: la auditoría de SC-24 es pre-launch (penetration + OWASP), no SOC 2 formal.
- **Multi-tenant a nivel de white-label**.
- **Refactor mayor de arquitectura**: este alcance la completa, no la rediseña.
- **Wave 5 al estado "voice command end-to-end"**: scope se detiene en "UI ready behind flag, activable sin deploy".
- **Reemplazo de Sovos por proveedor DTE alternativo**.
- **ADR-012 Capa 3 (Gemelo de flota per-carrier)** — se mueve a roadmap post-production-readiness, queda en backlog (`docs/roadmap/post-pr-digital-twins-fleet.md` al cierre).
- **ADR-012 Capa 4 (Gemelo de ciudad per-comuna + expansión multi-comuna)** — se mueve a roadmap post-production-readiness, queda en backlog.
- **Expansión del observatorio fuera de Coquimbo** (Santiago, Valparaíso, Concepción): post-production-readiness, dependiente de contratos B2G adicionales (ADR-012 Fase 4 original).

## 6. Constraints

### 6.1 Performance

- **API HTTP**: p50 ≤200ms, p95 ≤500ms, p99 ≤1.5s en endpoints leídos; p95 ≤800ms en escritura.
- **Telemetry TCP gateway**: 1 000 conexiones concurrentes sostenidas con CPU ≤70%, 0 connection drops por minuto bajo carga normal.
- **Telemetry processor**: lag de Pub/Sub ≤30s p95 bajo carga objetivo (5 000 msg/min).
- **Frontend web**: TTI ≤3s en 4G simulado, Lighthouse perf ≥80, a11y ≥95.
- **CI por PR**: tiempo wall-clock ≤10 min p95 (SC-29).
- **Cost budget** (`api-cost-guardrails.tf`): no overrun de límites declarados, incluyendo mirroring transitorio en S3-S4 (SC-30).

### 6.2 Regulatorios

- **GLEC v3.0 / GHG Protocol / ISO 14064-2**: cálculos de carbono certificables (SC-23, post-Implemented).
- **SII Chile**: DTE Guía de Despacho + Factura electrónica + Carta de Porte Ley 18.290 + Acta de entrega con firma digital + retención legal 6 años en GCS con Object Retention Lock.
- **PII stakeholders**: cumplimiento `docs/pii-handling-stakeholders-consents.md`, consent-based scope, audit trail visible.
- **Ley 19.628 (privacidad Chile)**: agregación mínima 10 vehículos por bucket en observatorio público (ADR-012 §Privacidad).
- **RUT** como identidad universal (ADR-035).

### 6.3 Seguridad

- **OWASP Top 10 mitigado** (verificado por SC-24).
- **Sin secretos en repo**: gitleaks pre-commit + scan CI.
- **ADC + OAuth** para server-to-server GCP (ADR-009); no API keys salvo legacy ya documentado.
- **PII redacted** en logs vía Pino serializers.
- **TLS 1.2+ en todas las conexiones externas**; mTLS donde aplique (telemetría wave 3).

### 6.4 Coverage y calidad

- **80/80/80/80** mantenido en CI; gate bloqueante.
- **Sin `any` en código de producción**; biome enforza.
- **Sin `console.*` en código de producción**.
- **Conventional commits + commitlint** en cada commit.
- **Pre-commit hooks** activos (biome + gitleaks + `check-adr-numbering`).

### 6.5 Disponibilidad y operación (solo-dev calibrated)

- **SLO uptime api**: 99.5% mensual.
- **SLO uptime telemetry-tcp-gateway**: **99.5% mensual** — bajado desde 99.9% original. Razón: con un solo humano sin partner on-call, sostener 99.9% (43 min downtime/mes) con response ≤15 min es físicamente incompatible (review.md O-5). T&C piloto refleja esta ventana (SC-25). Revisar al upgrade del on-call ritual post-SC-22 si llega partner.
- **SLO uptime telemetry-processor**: 99.5%.
- **SLO uptime whatsapp-bot**: 99%.
- **RTO ≤30 min, RPO ≤5 min** (SC-19).
- **On-call response**: ≤30 min business hours (10-19 CLT), ≤2h fuera. Best-effort honesto, no "≤15 min SEV-1".

## 7. Approach

El trabajo se descompone en **14 sprints** (S0..S13) con duración **variable** según contenido. La secuencia respeta dependencias y permite paralelismo donde el recurso *no es Felipe* (auditor GLEC, vendor pentest, abogado, cliente piloto). El plan detallado vive en [`roadmap.md`](./roadmap.md). Cada sprint, al arrancar, produce su propio `.specs/<sprint-slug>/spec.md` y `.specs/<sprint-slug>/plan.md`.

**Cadencia honesta solo-dev**: Felipe ejecuta **1 sprint a la vez** (1 lane humana). Los lead times externos corren en lanes separadas y NO se suman a la lane de Felipe en el Gantt. Velocity real se mide post-S2 (SC-28) y replanifica si <0.7× nominal.

Resumen por bloque:

- **Bloque A — Cierre de higiene** (S0–S2): drift schema/domain resuelto (ADR-043), archivos raíz legacy purgados, GitLab CI resuelto, coverage gaps cerrados, e2e Playwright crítico, D11 cerrado, sub-spec stubs-decision aprobada y ejecutada.
- **Bloque B — Microservicios extraction** (S3–S4): notification-service + matching-engine + document-service salen de `apps/api` como Cloud Run independientes. Decisión strangler vs cutover documentada antes de S3 (SC-30); si strangler, budget mirroring cuantificado.
- **Bloque C — Features comprometidas** (S5–S7): Wave 5 wake-word UI ready, ADR-012 Capa 1 (eco-routing) + Capa 2 piloto Coquimbo, factoring V1 escala plena.
- **Bloque D — Endurecimiento operacional** (S8–S10): load testing real, DR drill ejecutado, SLOs (99.5% calibrados solo-dev) + alertas + runbooks + on-call ritual best-effort.
- **Bloque E — Compliance + go-to-market** (S11–S13): certificación GLEC externa (lead time externo — kickoff en S0/S11 para no acoplar al cierre de la spec), auditoría seguridad pre-launch, términos legales finales con T&C honestos, pricing prod, cliente piloto firmado y pagando (SC-27a cierra spec; SC-27b post-Implemented).

**Paralelismos seguros** (NO consumen lane Felipe):

- **S11 (GLEC audit lead time)** corre en lane externa desde S0 (RFP) hasta S13.
- **S12 (vendor pentest lead time)** corre en lane externa desde S0 (RFP) hasta S12.
- **S13 (lead time cliente piloto firma)** corre en lane externa desde S0 (outreach) hasta S13.

**Dependencias críticas externas**:

- Picovoice approval (S5 — no bloqueante si UI ready cumple SC-12).
- Auditor GLEC contratado (post-Implemented SC-23/SC-27b).
- Vendor security audit contratado (SC-24).
- Cliente piloto identificado y firmando (SC-27a).
- Sub-spec `stubs-decision/spec.md` aprobada antes de S2 (SC-1).
- ADR-XXX (strangler vs cutover) aprobado antes de S3 (SC-30).

## 8. Alternatives considered

- **A. Vender ya con la deuda actual** — Rechazada. Producto ya operativo en prod, pero "100% producción comercializable" ≠ "operativo". Incidentes con clientes pagando cuestan trust irrecuperable; costo de cerrar deuda hoy es ~4× menor que cerrarla con SLOs comprometidos.

- **B. Sólo cerrar deuda visible (alcance original A)** — Rechazada por el PO. Deja Wave 5, microservicios extraction, observatorio, factoring escala plena y endurecimiento como backlog implícito — drift garantizado.

- **C. Refactor mayor / rewrite parcial** — Rechazada. La arquitectura es sólida; el problema es **completitud + endurecimiento**, no diseño.

- **D. Saltar certificación externa GLEC (auto-certificación)** — Rechazada. ADR-021 explicita GLEC v3.0 externa como diferenciador defensible. Auto-cert no es diferenciador. **Pero**: el cierre de la spec NO depende de SC-23 (post-Implemented) — la auto-certificación GLEC-compatible (SC-27a) basta para firmar piloto, y SC-23/SC-27b cierran post-Implemented cuando auditor termine.

- **E. ADR-012 completo (4 fases, Capas 1-4)** — Rechazada para este scope. ADR-012 original es Q3 2026 → Q3 2027 (~9-12 meses). Comprimirlo en un sprint era irreal. Se reduce a Capa 1 + Capa 2 piloto Coquimbo; Capas 3-4 quedan en roadmap post-production-readiness con su propio scope cycle.

- **F. SLO gateway 99.9% con partner on-call contratado** — Rechazada en favor de bajar SLO a 99.5%. Razón: contratar partner añade complejidad de coordinación + costo recurrente sin evidencia de demanda del piloto. Revisitable post-SC-27a si el piloto demanda SLA ≥99.9%.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Picovoice approval no llega en timeline | H | M | SC-12 explícitamente acepta "UI ready behind flag" como cierre. |
| Auditor GLEC lead time > 8 semanas | M | M | SC-23 es **post-Implemented**, no bloquea cierre. RFP en S0. |
| Load test (S8) revela problema de arquitectura que requiere rework | M | H | "S8b" definida con 3 categorías de rework esperables + bound máx 3 semanas (ver roadmap). Si rework excede, re-aprobar spec maestra. |
| **Felipe burnout / velocity <0.7× planificada (solo-dev)** | **H** | **H** | SC-28 velocity check post-S2 obligatorio. Replanificación formal si <0.7×. Sin colchón 20%, plan se ajusta a la realidad observada. |
| Cambio regulatorio SII / GLEC durante el plan | L | H | Sovos abstrae cambios SII. GLEC v3.0 vigente. |
| Coverage gate frena PRs si nuevos features bajan ratio | M | M | Tests obligatorios en spec antes de plan. |
| Cliente piloto (SC-27a) no se encuentra en S13 | M | H | S13 incluye outreach. Si no hay piloto, sprint extiende. SC-27a sigue bloqueante. |
| Microservicios extraction (S3-S4) rompe contratos in-flight | M | H | SC-30 obliga decisión strangler vs cutover en ADR antes de S3. Si strangler: rollback drill en staging antes de switch en prod. Si cutover: feature flag por endpoint + rollback drill. |
| **Strangler mirroring overrun de budget cloud (3 microservicios)** | **M** | **M** | SC-30 cuantifica budget USD/semana incremental, validado contra `api-cost-guardrails.tf`. Si overrun >20%, switch a cutover. |
| Drift schema/domain (SC-4) requiere migration breaking | M | H | ADR-043 (nuevo, no ADR-042). Migration testeada en integration tests reales. Plan rollback en spec del sprint. |
| Felipe solo + on-call SLO 99.5% | M | M | SLO bajado de 99.9% a 99.5% explícitamente. T&C piloto refleja ventana real. |
| Budget Cloud overrun por load test (SC-18) | L | M | Load test corre en staging con quota separada. |
| Sovos cambia API/precios mid-plan | L | M | DTE-provider package abstrae. |
| **ADR-012 scope creep si Capa 2 piloto Coquimbo no convence al municipio** | **M** | **M** | Sub-spec del sprint S6 incluye criterios de aceptación del municipio antes de marcar SC-13b. Si municipio no adopta, marcar SC-13b con caveat + plan recuperación post-PR. |

## 10. Test list

Cada SC mapea a uno o más tests verificables. Esta lista es el input para `/test` de cada sprint.

### Higiene técnica (Bloque A)
- **T-1** (SC-1): `find apps packages -name '*.ts' -size -1k -path '*src*'` retorna lista vacía o solo archivos justificados (constants, re-exports). Tests por package muestran ≥80/80/80/80.
- **T-2** (SC-2): `apps/api/coverage/coverage-summary.json` muestra `total.branches.pct ≥ 80`.
- **T-3** (SC-3): bash gate CI valida coverage-summary.json de cada app/package non-stub.
- **T-4** (SC-4): integration test ejerce trip lifecycle desde domain→api→db→read-back con state values consistentes.
- **T-5** (SC-5): `ls AUDIT.md PLAN-PHASE-0.md DESIGN.md` retorna error "no such file" en raíz.
- **T-6** (SC-6): `scripts/check-adr-numbering.mjs` valida cada número ADR aparece exactamente una vez.
- **T-7** (SC-7): CI valida `.gitlab-ci.yml` ausente o verde.

### Cobertura funcional (Bloque B + C)
- **T-8** (SC-8): integration test cubre stakeholder-zonas (cards + drill-down + k-anon + tipo carga + combustible).
- **T-9..T-11** (SC-9/10/11): tests por microservicio: build Docker, deploy Cloud Run staging, smoke endpoint, switch flag, rollback drill verificado en staging.
- **T-12** (SC-12): integration test verifica flag ON + key dummy → bundle carga `PorcupineWakeWordController`.
- **T-13a** (SC-13a): integration test simula congestión, verifica sugerencia llega a driver via Web Push <5s tras detección. Métricas custom emitidas a Cloud Monitoring.
- **T-13b** (SC-13b): integration test puebla materialized views `urban_flow_metrics_*`; smoke endpoint observatory responde; dashboard admin renderiza datos reales. Verificación con municipio Coquimbo (acceptance del sprint S6 incluye sign-off municipal).
- **T-14** (SC-14): integration test simula 100 liquidaciones/día sin intervención, reconciliación DTE automática.

### Tests (Bloque A.3)
- **T-15** (SC-15): 8 specs Playwright corren en CI por PR.
- **T-16** (SC-16): `@axe-core/playwright` corre en cada spec; 0 violations P0/P1.
- **T-17** (SC-17): `scripts/lint-rls.mjs` falla si tabla con datos por-empresa carece de RLS.

### Endurecimiento (Bloque D)
- **T-18** (SC-18): load test script ejecuta scenario, reporta p95/p99. Output en `docs/perf/`.
- **T-19** (SC-19): DR drill script ejecuta failover; tiempos medidos vs RTO/RPO.
- **T-20** (SC-20): Terraform `monitoring.tf` declara SLO + burn-rate por servicio con SLO 99.5% gateway.
- **T-21** (SC-21): existencia de cada `docs/runbooks/<servicio>.md` con secciones mínimas.
- **T-22** (SC-22): `docs/runbooks/post-mortem-template.md` + `docs/runbooks/on-call.md` con ventana real.

### Compliance y go-to-market (Bloque E)
- **T-23** (SC-23, post-Implemented): `docs/compliance/glec-certification-<año>.pdf` + ADR de metodología certificada.
- **T-24** (SC-24): `docs/audits/security-pre-launch-<fecha>.md` + 0 findings P0/P1 abiertos.
- **T-25** (SC-25): cada doc legal en `docs/legal/` tiene frontmatter `lawyer_review: <date>` + `signature_hash: <X>` + sección "on-call response window".
- **T-26** (SC-26): `www.boosterchile.com` pricing consistente con ADR-027; smoke test scrapea y diffs. Si checkout flow ausente: ADR-XXX existente.
- **T-27a** (SC-27a): `docs/handoff/<fecha>-cliente-piloto-1.md` con evidencia facturación + certificado auto-emitido + feedback.
- **T-27b** (SC-27b, post-Implemented): re-emisión cert externa documentada.

### Honesty rails (3.6)
- **T-28** (SC-28): `docs/handoff/<fecha>-velocity-check.md` existe post-S2 con LOC/sem + tasks/sem + replan si aplica.
- **T-29** (SC-29): GitHub Actions metrics muestran p95 ≤10 min wall-clock por PR.
- **T-30** (SC-30): ADR-XXX (strangler vs cutover) existe en `docs/adr/` con decisión + budget si strangler. Rollback drill documentado en `docs/runbooks/`.

## 11. Rollout

- **Feature-flagged**: cada feature comprometida usa flag. Nuevas features de esta spec añaden flag por feature.
- **Migrations**: pipeline existente Drizzle + ADR-044 journal integrity guard. T1+T2 mergeados son requisito.
- **Microservicios extraction (S3-S4)**: decidido según SC-30 ADR. Si strangler:
  1. Endpoints en microservicio.
  2. **Rollback drill en staging antes del switch**: provocar fallo, verificar flag retorna al monolito con datos consistentes <5min.
  3. Traffic mirroring en staging (3-7 días).
  4. Switch en prod con flag.
  5. Monolito mantiene fallback 2 semanas.
- **Rollback plan general**: por sprint, declarado en su spec. Default = revert PR + `terraform apply` previous + flag OFF.
- **Monitoring post-deploy**: SLO burn-rate alerts activos antes de S11.

## 12. Open questions

Status: resueltas o promovidas a sub-specs/ADRs antes del approve.

1. ~~**Q-1** (S0) Tool de load testing~~ → **Resuelta en S0**: ADR explícito, recomendación k6 por integración OTEL.
2. ~~**Q-2** (S11) Auditor GLEC~~ → **Promovida a out-of-band**: SC-23 es post-Implemented, RFP en S0 no bloquea.
3. ~~**Q-3** (S12) Vendor pentest~~ → **Promovida a S0**: RFP en S0, contrato firmado antes de S12.
4. ~~**Q-4** (S13) Cliente piloto~~ → **Convertida en task S0**: outreach inicia desde S0, lead time corre en lane externa.
5. ~~**Q-5** (SC-22) On-call partner~~ → **Resuelta**: bajar SLO gateway a 99.5%, sin partner en este alcance. Revisable post-SC-27a.
6. ~~**Q-6** (SC-1) Stubs decision~~ → **Promovida a sub-spec** [`.specs/stubs-decision/spec.md`](../stubs-decision/spec.md), aprobada antes de S2.
7. ~~**Q-7** (S6) ADR-012 vigente~~ → **Resuelta**: vigente con scope reducido a Capa 1 + Capa 2 piloto Coquimbo (SC-13a/13b). Capas 3-4 movidas a Out of scope.
8. ~~**Q-8** (S3/S4) Strangler vs cutover~~ → **Promovida a SC-30**: ADR antes de S3 con decisión + budget si strangler. Rollback drill obligatorio en ambos casos.

**Open quedantes** (no bloquean approve, se resuelven en sprints individuales):

- **OQ-1** (S6): ¿Municipio Coquimbo ya tiene contraparte identificada para piloto urban observatory? Si no, S6 incluye outreach municipal.
- **OQ-2** (S13): forma legal del piloto (B2B contrato standard vs piloto sin facturación durante X meses con valor en kind como case study).

## 13. Decision log

- **2026-05-17** — Initial draft post-inventory. Scope C confirmado por PO. Cadencia variable. Sin deadline.
- **2026-05-17** — Devils-advocate pass: 4 P0 + 4 P1 + 3 P2 objeciones (review.md). PO aprobó aplicar P0 + P1.
- **2026-05-17** — **Aplicado v2**: SC-27 split (a bloqueante + b post-Impl); SC-23 movido a post-Impl; SC-13 split en 13a (eco-routing) + 13b (observatorio Coquimbo); ADR-012 Capas 3-4 a Out of scope; SC-4 corregido a ADR-043 (no 042); SLO gateway 99.9%→99.5%; on-call best-effort honesto en SC-22; SC-28 velocity check; SC-29 CI ≤10min; SC-30 strangler decisión ADR; risks Felipe burnout H/H + mirroring budget M/M; Q-5..Q-8 resueltas pre-approve.
- **2026-05-17** — **APPROVED por PO**. Sub-spec `stubs-decision/spec.md` queda en Draft (no bloquea S0/S1; aprobar antes de S2).
