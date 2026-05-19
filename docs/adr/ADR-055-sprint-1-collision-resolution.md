# ADR-055: Resolución de Colisión Sprint 1 — Mini-Sprint Observabilidad \+ S1b Ajustado \+ Mini-Sprint Residual

- **Fecha**: 2026-05-19  
- **Status**: Accepted  
- **Decisores**: Felipe Vicencio (PO)  
- **Tags**: sprint-planning, scheduling, sprint-1, s1b, audit-2026-05-19, p0

---

## Contexto y problema

La sesión 2026-05-19 generó simultáneamente dos planes de Sprint 1 con cero overlap funcional pero con un bloqueante transversal:

### Sprint 1 propuesto por la auditoría (`audit-outputs/06_REFACTOR_PRIORITIES.md`)

- "Cierre del gap observable" (2 semanas).  
- 10 items: **R-001** (P0, M, OpenTelemetry cableado) \+ 9 quick wins (R-003 a R-009, R-014, R-024).  
- Foco: 0 vulnerabilidades, observabilidad cableada, gate de coverage real.

### S1b vigente (`.specs/s1-drift-coverage-e2e/spec.md`)

- **Status: Approved** (PO 2026-05-18, v2 post devils-advocate P0+P1+P2).  
- Foco: drift estructural ADR-043, `packages/trip-state-machine`, branches coverage `apps/api` 75.01% → 80%, 4 specs Playwright \+ a11y en CI.  
- Success criteria: SC-S1.0 (stop-the-line) \+ SC-S1.1..S1.14 distribuidos en 5 bloques temáticos.

### La colisión

Ambos planes proponen "Sprint 1" como entregable inmediato. La colisión fue detectada durante el test de humo de la skill `arquitecto-maestro` (PR \#304) que paró en Fase 2 esperando decisión PO.

### Análisis de overlap

**Cero overlap funcional**:

| Audit Sprint 1 | S1b vigente | Solapamiento real |
| :---- | :---- | :---- |
| R-001 OTel | — | Único |
| R-003 (gate coverage, skeletons) | SC-S1.7 (branches coverage apps/api error paths) | Conceptos distintos sobre el mismo término |
| R-005..R-009, R-024 (quick wins) | — | Únicos audit |
| R-014 (Terraform purge) | — | Único audit |
| — | SC-S1.1..S1.4b (drift schema ADR-043) | Únicos S1b |
| — | SC-S1.5..S1.6b (trip-state-machine) | Únicos S1b |
| — | SC-S1.9..S1.12 (Playwright \+ a11y) | Únicos S1b |

**Bloqueante transversal**: R-001 P0 OTel es bloqueante de visibilidad para el propio S1b. Sin observabilidad cableada, las mediciones de SC-S1.12 (sharding p95 ≤10min) son menos confiables y debuggear tests Playwright que fallan en CI requiere correlation manual sin traceId.

---

## Decisión

Adoptar **Opción 2a-refinado**: ejecutar en 3 fases secuenciales con absorción oportunista de quick wins.

### Fase 1 — Mini-Sprint 0: cierre observable (≈1 semana)

Items críticos para desbloquear S1b con visibilidad operacional:

| Item | Prioridad | Esfuerzo | Justificación |
| :---- | :---- | :---- | :---- |
| **R-001** | P0 | M | Cableado OpenTelemetry \+ pino-http en `apps/api`. Bloqueante de visibilidad para S1b y para todo lo posterior. ADR-050 ya documenta el diseño técnico. |
| **R-005** | P1 | S | `pnpm overrides` ws \+ esbuild → 0 vulnerabilidades dev. Endurece repo antes del trabajo de S1b. |
| **R-006** | P1 | S | Security headers en nginx (capa de defensa adicional al ADR-053 que actúa en `apps/api`). |
| **R-009** | P1 | S | Endurecer pool pg (idleTimeoutMillis \+ statement\_timeout). Mitiga zombies/queries colgadas durante carga de tests Playwright en CI. |
| **R-014** | P1 | S | Purgar binarios Terraform del git. Higiene de repo, independiente de S1b pero rápido. |
| **R-024** | P2 | S | CORS credentials false. Quick win seguridad si da tiempo. |
| **R-004** | P1 | S | Alinear Node 22 en workflows. Quick win infra si da tiempo. |

**Resultado esperado al cierre de Fase 1**:

- OpenTelemetry cableado, trazas exportando a Cloud Trace, correlation\_id propagado.  
- 0 vulnerabilidades en `pnpm audit`.  
- Pool pg endurecido.  
- Repo libre de binarios Terraform.  
- S1b puede arrancar con observabilidad viva.

### Fase 2 — S1b ajustado (≈2 semanas)

Ejecutar `s1-drift-coverage-e2e/spec.md` íntegro tal como fue aprobado el 2026-05-18 v2 post-devils-advocate. **Sin cambios al scope original**.

Diferencias respecto al plan original:

- **Observabilidad viva desde el día 1**: SC-S1.12 (sharding p95 ≤10min) se mide con confianza.  
- **Trace correlation disponible para debugging**: tests Playwright que fallan en CI se debuggean con traceId completo desde apps/web → apps/api → Cloud SQL.  
- **Oportunidad de absorción**: si el contexto de SC-S1.7 (branches coverage con error paths nombrados) cruza paths que también son hotspots de R-007 (batch N+1 matching) o R-008 (COUNT(\*) AVL), absorber el fix como sub-item oportunista. Decisión técnica del PO en el momento, no compromiso forzado.

### Fase 3 — Mini-Sprint residual: deuda restante (≈3-5 días)

Cerrar items del Audit Sprint 1 no absorbidos durante Fase 2:

| Item | Prioridad | Esfuerzo | Notas |
| :---- | :---- | :---- | :---- |
| **R-003** | P1 | S | Cerrar gate de coverage de los 8 skeletons. Depende de ADR-051 (C.1) para decidir destino de cada stub. |
| **R-007** | P1 | S | Batch N+1 matching, si no se absorbió en Fase 2\. |
| **R-008** | P1 | S | Eliminar COUNT(\*) AVL, si no se absorbió en Fase 2\. |

**Bloqueante**: R-003 solo puede ejecutarse después de ADR-051 (decisiones individuales por stub).

---

## Consecuencias

### Positivas

- **Preserva el commitment del PO al S1b aprobado** (2026-05-18). Cero alteración al `spec.md` vigente.  
- **R-001 P0 OTel desbloqueado primero**, alineado con Principio §6 (Observabilidad obligatoria).  
- **SC-S1.12 se mide con confianza** (sharding p95 ≤10min con trace correlation viva).  
- **Quick wins de seguridad y rendimiento se aplican en momentos naturales**, no forzados.  
- **No hay alteración a la arquitectura ni a ADRs previos**. Es decisión de scheduling pura.

### Negativas

- **Calendario más largo que solo S1b**: \~3-4 semanas totales vs 2 semanas si se ejecutara solo S1b. Contrapeso: ese tiempo se invierte en deuda crítica documentada.  
- **Context-switching parcial**: el desarrollador (solo-dev declarado en spec.md) cambia de "cableado infraestructura" (Fase 1\) a "drift estructural" (Fase 2\) a "deuda residual" (Fase 3). Mitigación: fases tienen objetivos cohesivos internos.

### Riesgos

- **Slip de Fase 1**: si R-001 OTel toma más de los 1-3 días estimados, retrasa S1b. Mitigación: ADR-050 ya tiene plan técnico detallado, mitigando incertidumbre.  
- **Tentación de absorber demasiado en Fase 2**: el "oportunismo" de absorber R-007/R-008 puede expandir el scope de S1b. Mitigación: regla clara — solo absorber si encaja en el flujo natural de SC-S1.7. Si requiere desvío, queda en Fase 3\.

### Decisiones rechazadas

- **Opción 1 (Supersede)**: rechazada. Romper compromiso PO-aprobado 2026-05-18 sin justificación proporcional. S1b es estructural para microservicios extraction (S3/S4); supersede pierde ese momentum.  
- **Opción 2a estricta (Audit completo → S1b completo)**: rechazada por incluir items P2 (R-024) en Fase 1 que no son críticos, retrasando S1b sin proporción.  
- **Opción 2b (S1b → Audit)**: rechazada. S1b sin OTel cableado debugga a ciegas — SC-S1.12 menos confiable.  
- **Opción 3 (Paralelo)**: rechazada por incompatibilidad con capacidad declarada (solo-dev). Reconsiderable si se agrega capacidad técnica (otro dev / contractor).

---

## Plan de implementación

### Fase 1 — Mini-Sprint 0 (días 1-7)

| Día | Item | Esfuerzo | Notas |
| :---- | :---- | :---- | :---- |
| 1-3 | R-001 OTel | M | Implementar según ADR-050. Fases 1-4 del plan del ADR. |
| 4 | R-005 pnpm overrides | S | Quick win deps. |
| 4 | R-006 nginx security headers | S | Coordinar con ADR-053 (no duplicar, capa nginx es defensa adicional). |
| 5 | R-009 pool pg | S | Quick win DB. |
| 5 | R-014 Terraform purge | S | Quick win higiene. |
| 6-7 | R-024 CORS, R-004 Node 22 | S | Si dan tiempo. |

### Fase 2 — S1b ajustado (días 8-21)

Ejecutar `.specs/s1-drift-coverage-e2e/spec.md` íntegro. Plan detallado vive en ese spec, no se duplica aquí.

Oportunidades de absorción a considerar momento-a-momento:

- Si SC-S1.7 (branches coverage error paths) cruza `matching-v2-lookups.ts:97-138` → absorber R-007.  
- Si SC-S1.7 cruza `persist.ts:114-119` → absorber R-008.

### Fase 3 — Mini-Sprint residual (días 22-26)

| Día | Item | Notas |
| :---- | :---- | :---- |
| 22-24 | R-003 gate coverage 8 stubs | Requiere ADR-051 (C.1) ya redactado y cada stub decidido. |
| 25-26 | R-007, R-008 (si no absorbidos en Fase 2\) | Quick wins DB. |

**Calendario total**: \~26 días (≈4 semanas calendar, ≈3.5 semanas de trabajo efectivo).

**Sprint**: este ADR documenta la decisión; los milestones internos siguen el calendario de cada fase.

**Files afectados (creación durante ejecución)**:

- Durante Fase 1: módulos en `apps/api/src/observability/` (ver ADR-050).  
- Durante Fase 2: ver `s1-drift-coverage-e2e/spec.md`.  
- Durante Fase 3: edits puntuales en `packages/*/` según cada stub (ver ADR-051).

---

## Referencias

- `audit-outputs/06_REFACTOR_PRIORITIES.md` (Sprint 1 audit \+ cross-cutting findings CC-1 a CC-8)  
- `.specs/s1-drift-coverage-e2e/spec.md` (S1b PO-approved 2026-05-18)  
- `.specs/s1-drift-coverage-e2e/inventory.md`  
- `CLAUDE.md` §6 Observabilidad obligatoria, §3 Process over knowledge  
- ADR-043 (metodología drift schema/domain — base de S1b)  
- ADR-050 (observabilidad OpenTelemetry — Fase 1 R-001)  
- ADR-051 (resolución 8 stubs — bloqueante de Fase 3 R-003)  
- ADR-053 (frontend security headers — relacionado con R-006 nginx layer)  
- ADR-054 (Arquitecto Maestro migration, PR \#303)  
- PR \#304 (skill activation)  
- PR \#305 (ADR-050)  
- PR \#306 (ADR-053)  
- PR \#307 (ADR-049)

