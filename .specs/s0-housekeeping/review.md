# Review: s0-housekeeping (devils-advocate pass)

- Spec: [`spec.md`](./spec.md) (Status Draft)
- Plan: [`plan.md`](./plan.md) (Status Draft)
- Sub-agente: `agent-rigor:devils-advocate`
- Fecha: 2026-05-17
- Ledger: `.claude/ledger/2026-05-17_8eef12fe-1dfc-4389-936f-139caac69d93.jsonl`

---

## P0 (bloqueantes — debe resolverse antes de approve)

### O-1: T9 es 3 tareas en un trench coat

- **Cita**: `plan.md` T9 — "ADR strangler vs cutover + budget mirroring si strangler" (~220 LOC).
- **Problema**: T9 hace (a) análisis comparativo strangler-vs-cutover, (b) estimación USD/sem por microservicio con validación vs `api-cost-guardrails.tf`, (c) definición de "condiciones para iniciar drill" si cutover. La estimación de budget requiere medir tráfico actual — no es ADR, es experimento medible.
- **Propuesta**: Partir en T9a (ADR conceptual strangler-vs-cutover, sin números), T9b (medición y tabla budget basada en métricas reales — puede diferirse a S2), T9c (criterios de drill, incorporable a SC-30 task de S2 o spec de S3).

### O-2: T1 (ADR-043) requiere lectura de código que no está estimada

- **Cita**: `plan.md` T1 — "identificar columns/state values divergentes entre `apps/api/src/domain/trip.ts` y `apps/api/src/db/schema.ts`".
- **Problema**: "Identificar divergencias" sin tooling es auditoría manual de schema. 30 divergencias → ADR de 400+ LOC, no 180. El plan asume inventario hecho; no lo está.
- **Propuesta**: Pre-tarea "inventario drift" antes del ADR, **o** acotar SC-S0.1 a "ADR-043 con metodología de migración, sin enumerar divergencias específicas (deliverable S1)".

### O-3: T10 acceptance self-fulfilling + rollback ficticio

- **Cita**: `spec.md` SC-S0.10 + `plan.md` T10 ("outreach enviado queda como conversación independiente").
- **Problema**: (a) "≥5 prospects identificados + primer contacto enviado" mide actividad, no calidad. (b) "Rollback: conversación queda independiente" admite que la acción es irreversible — no es rollback. Si el outreach va a contacto equivocado, daña reputación.
- **Propuesta**: SC-S0.10 debe exigir (i) criterio de fit explícito por prospect (sector + flota mínima + caso de uso), (ii) revisión PO antes de enviar emails (dry-run de la lista), (iii) reconocer en `spec.md §11` que outreach es irreversible.

### O-4: OQ-S0.1 y OQ-S0.2 no pueden quedar abiertas al approve

- **Cita**: `spec.md §12` Open questions + T5 dependiente de OQ-S0.2 + T10 dependiente de OQ-S0.1.
- **Problema**: 2 tareas del critical path bloqueadas por OQs sin dueño-fecha. "Decisión PO antes de T10" no es plan, es punt.
- **Propuesta**: Resolver ambas OQs ANTES de marcar spec Approved. Mover decisiones al §13 Decision log con fecha.

### O-5: 1 semana para 11 tareas con 2 RFPs profesionales + outreach es optimismo

- **Cita**: `plan.md` "5-7 días" + Order of execution.
- **Problema**: Día 3 contempla T6 + T7 = redactar 2 RFPs profesionales + identificar shortlist 6 vendors + enviar 6 emails personalizados. Día 4: T9 (denso, 220 LOC + análisis costos) + T8. Día 5: 3 tareas incluyendo outreach. Estimación huele a "todo es markdown, todo es rápido".
- **Propuesta**: Reestimar a 8-10 días, **o** sacar T6/T7/T10 del critical path de S0 a lane "S0-external" paralela a S1.

---

## P1

### O-6: Waiver de 100 LOC tapa que T9 (220) y T1 (180) son grandes, no solo "docs"

- **Cita**: `plan.md` Verification waiver.
- **Problema**: T9 incluye tabla budget cuantitativa, no prosa. T1 requiere inventario. Carga cognitiva > 100 LOC de código rutinario.
- **Propuesta**: Discriminar waiver: aplica a tareas prose-only; T1 y T9 justifican tamaño con sub-deliverables, no con "es markdown".

### O-7: T11 (CURRENT.md) acceptance laxo — único punto de integración

- **Cita**: `plan.md` T11 acceptance.
- **Problema**: Acceptance solo exige "sección nueva con artefactos linkeados". No exige que cada decisión de T1/T9 esté reflejada en CURRENT.md con su consecuencia sobre S1-S3.
- **Propuesta**: Acceptance T11 debe exigir (i) cada decisión de T1/T9 reflejada con consecuencia sobre roadmap, (ii) lanes externas con fecha esperada de respuesta documentada.

### O-8: Pre-commit `--allow-legacy` inmortaliza la deuda sin TTL

- **Cita**: `plan.md` T3 + T4.
- **Problema**: Flag inmortaliza 3 colisiones como excepciones permanentes. Sin TTL ni ticket — drift vocabulary <quote>for now</quote> implícito.
- **Propuesta**: ADR-046 debe declarar explícitamente "estas 3 colisiones no se renumeran nunca, por contrato" **o** "se renumeran en sprint X". Sin punto medio.

### O-9: T8 setup k6 mínimo es decisión arquitectónica oculta

- **Cita**: `plan.md` T8.
- **Problema**: Elegir k6 en S0 sin SLO target ni perfil de carga conocido es elegir tool antes de problema. Smoke script anclará a `apps/api/test/load/` y package.json. Cambiar a Artillery/Gatling en S8 si k6 no escala obliga refactor.
- **Propuesta**: ADR puede mergearse, pero diferir smoke script a S8 cuando exista SLO concreto. **O** explicitar en ADR-047: "decisión k6 es reversible hasta S8; smoke script es throwaway".

### O-10: Dependencias mentidas — T4 depende de más que T1

- **Cita**: `plan.md` T4 "Depends on: T1".
- **Problema**: T4 depende de conocer el próximo número libre ADR, no de T1 específicamente. Si T8/T9 se hacen antes que T4, también consumen números. La cadena real es T1 → T4 → T8 → T9.
- **Propuesta**: Documentar dependencia secuencial T1 → T4 → T8 → T9 por numeración ADR. **O** reservar bloque 043-048 al inicio del sprint en un commit dummy.

---

## P2

### O-11: Falta kickoff de seed dataset GLEC

- **Cita**: ausente (RFP GLEC T6 menciona "Sample data willingness" sin tarea de generar/curar).
- **Problema**: Si auditor pide datos en semana 2, Booster no los tiene listos.
- **Propuesta**: T12 (o out-of-band) "Definir sample dataset GLEC para auditor — owner Felipe — due antes de respuesta auditor".

### O-12: SC-S0.6/S0.7 son self-fulfilling

- **Cita**: `spec.md` SC-S0.6/7 ("emails enviados").
- **Problema**: No "respuesta recibida en X días" ni "shortlist filtrada por respuesta".
- **Propuesta**: "emails enviados + confirmación de recepción (read receipt o respuesta no-bounce) en ≥2 de 3 por RFP".

### O-13: Risk RFP GLEC mitigación es punt

- **Cita**: `spec.md §9` risk row RFP GLEC.
- **Problema**: "Ampliar shortlist en S2/S3" es repetir acción esperando resultado distinto.
- **Propuesta**: Definir en S0 rango de precio "señal de mercado roto" para escalar a auditor internacional vs revisar scope.

### O-14: Drift signal "smoke script hola mundo" + "setup mínimo"

- **Cita**: `spec.md` y `plan.md` T8.
- **Problema**: Lenguaje <quote>mínimo</quote> y <quote>hola mundo</quote> es drift vocabulary suave. Justificado por out-of-scope explícito, pero merece ticket.
- **Propuesta**: Acceptance T8 incluye "ticket abierto: S8 reemplaza smoke con suite real".

---

## Top 3 que cambian el sprint

1. **O-4: cerrar OQ-S0.1 y OQ-S0.2 antes de aprobar.** 2 OQs bloquean tareas del critical path.
2. **O-5: reestimar a 8-10 días, o cortar T6/T7/T10 a lane "S0-external".** 1 sem para 11 tareas con 2 RFPs profesionales es optimismo.
3. **O-1 + O-2: T9 y T1 son cada una 2+ tareas.** Partir T9 (ADR conceptual vs medición budget). Acotar T1 a "metodología, no enumeración".

---

## Verificación inmediata de OQ-S0.2 (yo, no PO)

`git remote -v` muestra:
- `github` → `https://github.com/boosterchile/booster-ai.git` (canónico)
- `origin` → `git@gitlab.com:boosterchile-group/booster-ai.git` (GitLab mirror)

`git ls-remote --heads gitlab` vacío (sin branches activas en GitLab, o sin acceso).

**Hallazgo**: eliminar `.gitlab-ci.yml` es seguro (no hay CI activo dependiendo). **Pero** el remote `origin` sigue apuntando a GitLab — eso es decisión separada (¿remover `origin`? ¿reapuntar a GitHub?). No bloquea T5 de S0 pero merece T-extra o decisión PO en T11.

Referencias residuales a "gitlab" en repo (post-eliminación de `.gitlab-ci.yml` quedarían en):
- `docs/adr/020-ci-cd-strategy.md` (ADR histórico, no se toca).
- 2 handoffs históricos (no se tocan).
- specs nuevos (incluyendo esta misma).

**OQ-S0.2 resuelta**: no hay branches activas en GitLab; T5 puede ejecutarse. Pendiente subordinado: decisión sobre remote `origin` (no urgente, decidir antes de S2).

---

## Decision log

- **2026-05-17** — Devils-advocate pass. 5 P0 + 5 P1 + 4 P2 + verificación OQ-S0.2 resuelta.
