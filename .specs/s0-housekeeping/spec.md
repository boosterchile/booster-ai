# Spec: s0-housekeeping

- Author: Felipe Vicencio (con agent-rigor)
- Date: 2026-05-17
- Status: **Approved** (PO 2026-05-17, v2 post devils-advocate P0)
- Linked: [`../production-readiness/spec.md`](../production-readiness/spec.md), [`../production-readiness/roadmap.md`](../production-readiness/roadmap.md) §S0, [`../stubs-decision/spec.md`](../stubs-decision/spec.md) (Approved)

---

## 1. Objective

Cerrar el housekeeping heredado de waves 1-6 y kickoff de las **lanes externas** que dependen de proveedores con lead time (auditor GLEC, vendor pentest, cliente piloto). Sprint mayoritariamente doc-only: ADRs nuevos, archivos legacy archivados, scripts de check, RFPs enviados, outreach inicial. Sin código de producto en este sprint.

## 2. Why now

S0 es el primer sprint del plan production-readiness aprobado. Sus dos funciones son: (a) **limpiar la deuda visible que no requiere ejecución** (drift schema/domain ADR, archivos raíz legacy, ADR colisiones, GitLab CI), y (b) **disparar los relojes externos** (RFP auditor GLEC, RFP pentest, outreach piloto) lo antes posible, porque sus lead times corren en paralelo a los sprints S1-S12 y bloquearían el cierre del plan si no se inician ya. Cada semana de retraso en los RFPs es una semana adicional al cierre.

## 3. Success criteria

- [ ] **SC-S0.1** — ADR-043 (drift schema/domain) redactado con **metodología de migración**, en Status `Accepted`, mergeado en `docs/adr/`. **NO enumera divergencias específicas** (ese inventario es deliverable S1). Sin código aún. *(Acotado post-O-2 review.md)*
- [ ] **SC-S0.2** — `AUDIT.md`, `PLAN-PHASE-0.md`, `DESIGN.md` raíz **movidos a `docs/archive/2026-05-17-<nombre>.md`** con frontmatter `superseded_by: docs/handoff/CURRENT.md` (y referencia a la spec maestra). PRs mergeados.
- [ ] **SC-S0.3** — `scripts/check-adr-numbering.mjs` existe y se ejecuta en pre-commit (Husky); falla si un número ADR aparece más de una vez. Tests del script ≥80/80/80/80.
- [ ] **SC-S0.4** — ADR de colisiones 028/034/035 redactado en `docs/adr/` (renumerado al primer libre) documentando que son históricas y que desde ADR-040 aplica disciplina "un número por archivo" (CURRENT.md §Housekeeping ADRs).
- [ ] **SC-S0.5** — `.gitlab-ci.yml` **eliminado** del repo, con commit doc que referencia la decisión (memoria: GitHub canónico, GitLab semi-roto).
- [ ] **SC-S0.6** — RFP auditor GLEC enviado: documento `docs/compliance/glec-rfp.md` mergeado + shortlist de ≥3 auditores enviada por email; tracking en el mismo doc con estado por candidato.
- [ ] **SC-S0.7** — RFP vendor pentest enviado: documento `docs/audits/security-rfp.md` mergeado + shortlist de ≥3 vendors enviada por email; tracking en el mismo doc.
- [ ] **SC-S0.8** — ADR tool de load testing redactado y mergeado en `docs/adr/`. Recomendación inicial: k6 por integración OTEL y scripts en JS afines al stack. Setup mínimo en `apps/api/test/load/` (smoke script "hola mundo").
- [ ] **SC-S0.9a** — ADR strangler vs cutover **conceptual** redactado y mergeado. Decide approach (strangler vs cutover) con argumentos cualitativos. **NO incluye tabla cuantitativa de budget USD/sem** (eso requiere medir tráfico actual — se difiere a S2 como SC-S0.9b). **NO incluye criterios detallados de drill** (se incorpora a la spec de S3 como parte de SC-30). *(Acotado post-O-1 review.md)*
- [ ] **SC-S0.9b** (diferido a S2) — Medición de tráfico actual + tabla budget USD/sem por microservicio + validación contra `api-cost-guardrails.tf`. NO bloquea cierre de S0.
- [ ] **SC-S0.9c** (diferido a S3) — Criterios concretos para iniciar drill. NO bloquea cierre de S0.
- [ ] **SC-S0.10** — Outreach cliente piloto:
  1. Documento privado `.private/piloto-prospects.md` (gitignored) con ≥5 prospects identificados, **cada uno con criterio de fit explícito**: sector (transporte / agroindustria / forestal / minería / otro), flota mínima estimada (≥X vehículos), caso de uso GLEC justificable, canal de intro (warm / cold).
  2. **Dry-run PO**: PO revisa y aprueba la lista ANTES de enviar emails.
  3. Stub público mergeado en `docs/handoff/2026-05-XX-piloto-outreach.md` con conteos agregados ("≥5 prospects identificados; N contactados; M respondieron"), sin info sensible.
  4. Primer contacto ejecutado post-aprobación PO. *(Reforzado post-O-3 review.md)*
- [ ] **SC-S0.11** — `docs/handoff/CURRENT.md` actualizado al cierre del sprint: nuevo estado "production-readiness plan en S1", artefactos producidos linkeados, lanes externas en marcha.

## 4. User-visible behaviour

Ninguno para usuarios finales (shipper, carrier, driver, admin, stakeholder). Cambios visibles solo para:

- **Equipo dev** (Claude + Felipe): repo raíz queda más limpio (3 archivos legacy menos visible), pre-commit nuevo gate, ADRs nuevos en `docs/adr/`.
- **Vendors externos** (auditor GLEC, vendor pentest): reciben RFP via email.
- **Prospectos piloto**: reciben primer contacto comercial.

## 5. Out of scope

- **Ejecución de las decisiones de los ADRs**: ADR-043 redacta el plan de drift, pero la migration + refactor se ejecutan en S1. ADR strangler-vs-cutover decide el approach, pero la extracción de microservicios se ejecuta en S3/S4.
- **Implementación de los stubs**: aprobada en sub-spec aparte. Ejecución en S1 (`trip-state-machine`), S2 (`ui-components` + eliminar `ai-provider`/`document-indexer`), S3 (apps), S4 (`carta-porte-generator`).
- **Negociación / contrato firmado** con auditor GLEC, vendor pentest o cliente piloto: S0 cierra cuando los RFPs/outreach están **enviados**, no cuando los contratos están firmados. Esos cierres son lanes externas que corren en paralelo a S1-S13.
- **Setup completo de k6**: S0 solo deja un smoke script ("hola mundo"). El load test real se construye en S8.
- **Cualquier cambio a `apps/`, `packages/` o `infrastructure/` que no sea estrictamente el setup mínimo de `apps/api/test/load/`.**

## 6. Constraints

- **Sin breaking changes**: ningún PR de S0 debe romper builds, tests o deploys existentes. Verificable por CI verde.
- **Conventional commits + commitlint**: cada commit del sprint sigue formato (`docs:`, `chore:`, `feat(scripts):`, etc.).
- **Pre-commit hooks activos**: biome + gitleaks + (nuevo) `check-adr-numbering` no deben deshabilitarse.
- **Coverage gate**: el único código nuevo (script `check-adr-numbering.mjs`) tiene tests ≥80/80/80/80.
- **RFPs por email**: no enviar credenciales ni info sensible en el RFP (proceso público).
- **Outreach piloto**: no usar lenguaje de SLA 99.9% en outreach (consistente con SC-22 del plan maestro).

## 7. Approach

10 tareas verticales atómicas (cada una mergeable independiente). Detalle en [`plan.md`](./plan.md). Resumen:

- **T1** — ADR-043 redactado (drift schema/domain).
- **T2** — Archivos raíz legacy a `docs/archive/`.
- **T3** — `scripts/check-adr-numbering.mjs` + pre-commit.
- **T4** — ADR-meta de colisiones 028/034/035.
- **T5** — Eliminar `.gitlab-ci.yml`.
- **T6** — RFP GLEC auditor (`docs/compliance/glec-rfp.md` + emails enviados).
- **T7** — RFP vendor pentest (`docs/audits/security-rfp.md` + emails).
- **T8** — ADR tool load testing + setup k6 mínimo.
- **T9** — ADR strangler vs cutover + budget si strangler.
- **T10** — Outreach piloto: identificar 5 prospects + primer contacto.
- **T11** — Actualizar CURRENT.md al cierre.

Tareas independientes en su mayoría — pueden mergearse en cualquier orden salvo T11 (depende de las anteriores). T8 y T9 son los más densos (ADRs con análisis); el resto son ediciones de docs + scripts mínimos.

## 8. Alternatives considered

- **A. Distribuir el housekeeping a lo largo de S1-S13** — Rechazada. Los lead times externos (GLEC ~6-10 sem, pentest ~4-6 sem) requieren kickoff temprano. Si los RFPs se envían en S5 en vez de S0, el cierre de la spec maestra se atrasa 5 semanas. Concentrar en S0 es óptimo.
- **B. Saltar ADR de strangler-vs-cutover hasta S3** — Rechazada. La decisión afecta budget cloud (validable vía `api-cost-guardrails.tf`) y rollback drill (SC-30 del plan maestro). Decidir antes de S3 elimina retrabajo si el ADR concluye "cutover" mientras S3 estaba planeado strangler.
- **C. RFPs por email sin documento mergeado** — Rechazada. CLAUDE.md §"Evidencia" exige documentación verificable; un RFP por email no es auditable. El documento en repo es contrato.
- **D. No eliminar `.gitlab-ci.yml` (mantener como respaldo)** — Rechazada. Memoria documentó "GitHub canónico, GitLab semi-roto"; mantener el mirror crea posibilidad de divergencia silenciosa.

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pre-commit hook nuevo bloquea commits legítimos por bug del script | M | M | Tests ≥80/80/80/80 del script + dry-run sobre `docs/adr/` actual antes de activar pre-commit. |
| RFP enviado sin scope claro → respuestas heterogéneas difíciles de comparar | M | M | RFP usa template estándar con SLAs explícitos (lead time, deliverable, precio). Shortlist filtrada por referencias. |
| Outreach piloto sin warm intro → cero respuestas | M | M | Combinar outreach frío (email) con red personal de Felipe (LinkedIn + intros). Documento incluye sección "red identificada". |
| ADR strangler-vs-cutover decide cutover y eso invalida tareas de S3 ya planificadas | L | M | Cutover sigue requiriendo rollback drill (SC-30). El roadmap S3 cubre ambos paths. |
| Mover archivos legacy con `git mv` rompe links externos | L | L | Mantener path original como redirect markdown (`# Moved to: docs/archive/...`) por 1 mes; eliminar en S13. |
| RFP GLEC no recibe respuestas en 2 semanas | M | M | Si no hay respuesta, ampliar shortlist en S2/S3 + considerar auditores internacionales con presencia LATAM. |

## 10. Test list

- **T-S0.1** (SC-S0.1): existe `docs/adr/043-drift-schema-domain.md` con `Status: Accepted`.
- **T-S0.2** (SC-S0.2): `ls AUDIT.md PLAN-PHASE-0.md DESIGN.md` retorna error "no such file" en raíz; `ls docs/archive/2026-05-17-*.md` retorna los 3 archivos con frontmatter `superseded_by:`.
- **T-S0.3** (SC-S0.3): `scripts/check-adr-numbering.mjs` ejecutado contra `docs/adr/` actual NO retorna error (3 colisiones son legacy y aceptadas por excepción); modificar un ADR duplicando un número y re-ejecutar SÍ retorna error. Tests del script en `scripts/check-adr-numbering.test.mjs` con coverage ≥80/80/80/80. Pre-commit hook `.husky/pre-commit` invoca el script.
- **T-S0.4** (SC-S0.4): existe ADR-XXX (próximo libre, ej. 046) titulado "ADR numbering collisions — historical" en `docs/adr/`.
- **T-S0.5** (SC-S0.5): `git log --diff-filter=D -- .gitlab-ci.yml` muestra el commit de eliminación; CURRENT.md actualizado para reflejar.
- **T-S0.6** (SC-S0.6): existe `docs/compliance/glec-rfp.md` con sección "Sent to" listando ≥3 auditores con fecha de envío. Emails archivados (link a thread o screenshot en folder local).
- **T-S0.7** (SC-S0.7): existe `docs/audits/security-rfp.md` idem.
- **T-S0.8** (SC-S0.8): existe `docs/adr/XXX-load-testing-tool.md` con `Status: Accepted` + `apps/api/test/load/smoke.k6.js` (o equivalente) ejecutable con `pnpm load-test:smoke`.
- **T-S0.9** (SC-S0.9): existe `docs/adr/XXX-microservices-extraction-strangler-vs-cutover.md` con decisión + (si strangler) tabla de budget USD/sem por microservicio.
- **T-S0.10** (SC-S0.10): existe `docs/handoff/2026-05-XX-piloto-outreach.md` con tabla de ≥5 prospects.
- **T-S0.11** (SC-S0.11): `docs/handoff/CURRENT.md` modificado en este sprint (verificable con `git log -1 --pretty=format:%ci docs/handoff/CURRENT.md`).

## 11. Rollout

- **Feature-flagged**: no aplica (no hay código de producto nuevo).
- **Migration needed**: no.
- **Rollback plan general**:
  - Si pre-commit nuevo bloquea trabajo legítimo: comentar la línea en `.husky/pre-commit` (script queda pero no se invoca); investigar; arreglar; re-activar.
  - Si archivo legacy archivado se descubre activamente referenciado: revert `git mv`, crear plan de migración paulatina en S1.
  - ADRs son add-only (no se revertean si cambia opinión; se crea uno nuevo con `supersede:`).
- **Acciones IRREVERSIBLES en este sprint** (O-3 review.md):
  - **T6/T7 (RFPs enviados)**: emails enviados a vendors no se rollbackean. Mitigación: dry-run del email a PO antes de envío masivo + plantilla de retiro formal si shortlist cambia.
  - **T10 (outreach piloto)**: emails enviados a prospects no se rollbackean. Mitigación: dry-run PO obligatorio (parte de SC-S0.10) + criterio de fit pre-validado para no contactar leads equivocados. Si un prospect inicia diálogo y luego decidimos no proceder, se cierra formalmente con email de "no fit en este momento".
- **Monitoring**: pre-commit hook ejecuta localmente; no requiere monitoring runtime.

## 12. Open questions

~~**OQ-S0.1**~~ → **Resuelta (2026-05-17, PO)**: privada en `.private/piloto-prospects.md` (gitignored) con stub público de conteos. Reflejada en SC-S0.10 y T10.

~~**OQ-S0.2**~~ → **Resuelta (2026-05-17, agente)**: verificado con `git ls-remote --heads gitlab` (vacío); no hay branches activas en GitLab. T5 puede ejecutarse sin migración. Pendiente subordinado: decisión sobre remote `origin` (apunta a GitLab) — se decide antes de S2, NO bloquea T5.

**Open quedantes** (ninguna bloquea aprobación):

- **OQ-S0.3** (post-T5) — Reapuntar remote `origin` a GitHub o eliminarlo. Decisión PO antes de S2.

## 13. Decision log

- **2026-05-17** — Initial draft post approval spec maestra v2. 10 tareas atómicas mapeadas a SC-S0.1..11.
- **2026-05-17** — Devils-advocate pass: 5 P0 + 5 P1 + 4 P2 (review.md). PO decidió aplicar P0.
- **2026-05-17** — **Aplicado v2**: SC-S0.1 acotado a "metodología, no enumeración" (O-2); SC-S0.9 split en 9a (ADR conceptual, S0) + 9b/9c (diferidos S2/S3, O-1); SC-S0.10 reforzado con criterios de fit + dry-run PO + irreversibilidad reconocida (O-3); OQ-S0.1 resuelta (privada en `.private/`) + OQ-S0.2 verificada por agente (O-4); estimación movida a 8-10 días (O-5).
- **2026-05-17** — **APPROVED por PO** junto con plan.md v2. Sprint S0 listo para arrancar BUILD (T1..T11).
