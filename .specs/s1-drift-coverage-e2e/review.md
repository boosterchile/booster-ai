# Review: s1-drift-coverage-e2e (devils-advocate pass)

- Spec: [`spec.md`](./spec.md) (Status Draft)
- Sub-agente: `agent-rigor:devils-advocate`
- Fecha: 2026-05-18
- Ledger: `.claude/ledger/2026-05-17_8eef12fe-1dfc-4389-936f-139caac69d93.jsonl`

---

## P0 (bloqueantes — debe resolverse antes de approve)

### O-1: T1.1 inventario sin gate "stop-the-line" si N > X divergencias

- **Cita**: `spec.md` §7.1 T1.1 + §3.1 SC-S1.1 + ADR-043 §2-3.
- **Problema**: La spec asume implícitamente inventario chico. ADR-043 lista 6 candidatos (tripEvents, assignments, offers, metricasViaje, dispositivosTelemetria, etc.) pero S1 no tiene gate "si N > X divergencias O ≥1 Clase C, replan antes de T1.2". Inventario de 25+ divergencias o 2 Clase C explota T1.2-T1.4 4× sin alertar; Bloque D (Playwright) se difiere a S2 silenciosamente.
- **Propuesta**: SC-S1.0 nuevo: "tras T1.1, si N divergencias > 10 O Clase C ≥ 1, **pausar sprint** y producir replan con scope reducido. PO firma replan antes de T1.2." Gate **bloqueante**, no informativo.

### O-2: SC-S1.7 reformulable — el criterio "≥80%" no previene tests placebo

- **Cita**: `spec.md` §3.3 SC-S1.7 + §9 row 2 "test placebo trap M/M".
- **Problema**: `branches.pct ≥ 80` se cumple igual con tests triviales (`if env === 'production'`) que con tests reales. Risk row 2 mitiga con "code review propio" — autodisciplina. CLAUDE.md §"Process over knowledge" pide reemplazar autodisciplina con proceso.
- **Propuesta**: split SC-S1.7 en (a) métrico `branches.pct ≥ 80`; (b) **lista nombrada** de ≥10 error paths reales en `.specs/.../coverage-targets.md` producida **antes** de T1.9. Si lista <10 paths, branches=80% no acepta.

### O-3: Dependencia oculta Bloque A → Bloque B no reconocida

- **Cita**: `spec.md` §3.2 SC-S1.5 + §7.2 T1.6 + sub-spec stubs §9 row 2.
- **Problema**: T1.6 (XState) usa enum values. Si T1.2 (Clase A) renombra valores, machine coordina. Spec presenta bloques A y B como paralelizables pero T1.6 no puede empezar hasta T1.2 cierre. Sin matriz de dependencias explícita.
- **Propuesta**: §7.0 nuevo "Orden de ejecución": T1.1 → (T1.2|T1.3|T1.4) → T1.6 → T1.7. Bloques A y B **secuenciales**. Bloque C en paralelo a B desde día 3-4. Bloque D en paralelo desde día 1.

### O-4: Estimación 1 semana para 14 tareas sin presupuesto realista

- **Cita**: `roadmap.md` §"Sprint 1" "1 semana" + `spec.md` §7 (~1530 LOC declarado).
- **Problema**: Suma real LOC ≈ **1760 LOC** en 5 días = 350 LOC/día con calidad CLAUDE.md (tests + lint + typecheck + revisión propia + ADRs Clase B/C). Felipe acaba de cerrar S0 5h-session; burnout marcado M/M (§9) es probablemente H/M. Velocity check formal en S2; S1 corre a ciegas.
- **Propuesta**: re-estimar **8-12 días honestos** + **checkpoint día 5**: si Bloques A+B no `Implemented`, Bloque D se difiere a S2 (split S1a/S1b). Rollback de scope **anclado al checkpoint**, no al final del sprint.

### O-5: Rollback de `packages/trip-state-machine` es ficción

- **Cita**: `spec.md` §11 row 4 "fallback a string comparisons inline mientras se debuggea (revert al commit anterior del consumer)".
- **Problema**: T1.7 toca services en path crítico (liquidar trip, confirmar entrega). "Revert al commit anterior" = re-introducir el drift que ADR-043 vino a corregir. Sin flag, "rollback" = deshacer sprint entero. Viola CLAUDE.md §6 "feature-flagged para cambios runtime".
- **Propuesta**: T1.7 incluye flag `TRIP_STATE_MACHINE_ACTIVATED` (default `true` en dev, `false` en staging primer deploy). Services mantienen string comparison branch + machine branch durante 1 sprint. Tras S2 con telemetría limpia, flag OFF rama legacy → cleanup en S3.

---

## P1

### O-6: SC-S1.8 self-fulfilling — blinda risk en vez de medir valor

- **Cita**: `spec.md` §3.3 SC-S1.8.
- **Problema**: "tests NO bajan coverage en otros ejes" = ausencia de regresión, no valor. Felipe puede cumplir SC-S1.8 sin escribir tests (no añadir = no bajar).
- **Propuesta**: eliminar SC-S1.8 del listado; mover a §9 risks como "Mitigation: monitorear other axes". Reemplazar con SC-S1.8' real (ejerce ≥10 error paths nombrados).

### O-7: SC-S1.13 ya cumplido pre-sprint

- **Cita**: `spec.md` §3.5 SC-S1.13.
- **Problema**: Cumplido antes de arrancar el sprint = decorativo. Inflar SCs para parecer productivo.
- **Propuesta**: borrar SC-S1.13. Citar el sub-spec en CURRENT.md (SC-S1.14) y listo.

### O-8: SC-S1.12 wall-clock medida después del sprint, no antes del merge

- **Cita**: `spec.md` §3.4 SC-S1.12 + §7.4 T1.13.
- **Problema**: Medir "p95" sobre 1 PR no es estadístico. Si al cerrar S1 mide 14 min, sprint ya está mergeado.
- **Propuesta**: "Sobre ≥10 PRs post-merge de T1.11, p95 ≤10 min". Si no hay 10 PRs en S1, criterio se difiere a S2 como follow-up. T1.11 incluye dry-run en branch fake pre-merge.

### O-9: T1.10 Playwright auth — OQ-S1.4 puede materializarse como +200 LOC

- **Cita**: `spec.md` §12 OQ-S1.4 + §7.4 T1.10 (~400 LOC).
- **Problema**: "Probablemente fixture compartido" no es decisión. 4 flujos × 25 LOC auth setup = otros 100 LOC + debug `RUT + clave numérica` mock. Estimado optimista.
- **Propuesta**: OQ-S1.4 resuelta **antes** de T1.10 (pre-T1.10 spike 30 min). Si extender fixture >50 LOC, sumar al estimado (450-500 LOC).

### O-10: Risk row 7 (burnout) subestimado M/M

- **Cita**: `spec.md` §9 row 7.
- **Problema**: S0 cerró 12 PRs + 4 ADRs en 1 sem; sesión 5h continua. Felipe arranca S1 al día siguiente sin cooling-off real. Probabilidad realista H, no M.
- **Propuesta**: subir a H/M; mitigación accionable: "Día 0 de S1 = solo planning + lectura; ejecución día 1 con T1.1 (script automatizado, baja carga)". Si sesión >3h sin pausa, paraliza y solicita break.

---

## P2

### O-11: Drift vocabulary en spec ("refactor mínimo", "resto difiere")

- **Cita**: `spec.md` §7.2 T1.7 + §3.2 SC-S1.6.
- **Problema**: "Refactor mínimo necesario" + "resto difiere a S2 si surge scope creep" = drift vocabulary clásico. Consumer que NO se migra mantiene string comparisons = drift que el sprint vino a librar.
- **Propuesta**: T1.7 enumera **explícitamente** call sites IN-scope (3 conocidos) y OUT-of-scope con archivo+línea. Out-of-scope va a `.specs/.../followup-state-machine-migration.md` con owner + sprint objetivo.

### O-12: Out of scope "RLS lint en S2" — qué pasa si Clase C añade tabla

- **Cita**: `spec.md` §5 row 5.
- **Problema**: Si T1.4 (Clase C) añade tabla, RLS actual no la cubre (eso es S2). Tabla nueva pasa sin RLS por 1-2 semanas = security gap.
- **Propuesta**: si T1.4 ejecuta, mini-task T1.4b: "tabla nueva incluye RLS policy explícita en la misma migration + test integration RLS activo". No esperar S2.

### O-13: Alternative E (runners distribuidos) rechazada con argumento débil

- **Cita**: `spec.md` §8 alt E.
- **Problema**: 4 specs hoy, pero ciclo apunta a 8+ (S2 + S5/S6/S7). Sin umbral declarado "cuándo migrar a runners distribuidos".
- **Propuesta**: "Si wall-clock CI con 8 specs >12 min, evaluar runners distribuidos en S2". Anclar al dato, no a intuición.

---

## Top 3 que cambian el sprint

1. **O-1: gate "stop-the-line" en T1.1** — inventario grande (15+ o ≥1 Clase C) explota S1 silenciosamente. Riesgo #1 sin mitigación estructural.
2. **O-2 + O-6: SCs measure-real-value, no metric-only** — branches=80% sin lista nombrada deja puerta abierta a test placebo. Patrón que CLAUDE.md §"Evidence over assumption" prohíbe.
3. **O-5: rollback ficticio para trip-state-machine** — sin flag, "rollback" = deshacer sprint completo en path crítico (liquidar trip, confirmar entrega). Viola CLAUDE.md §6.

---

## Status de aplicación (2026-05-18)

PO decidió aplicar **todas (P0 + P1 + P2)**. Spec v2 producida con los siguientes cambios:

| Obj | Severidad | Status | Cambio aplicado en spec v2 |
|---|---|---|---|
| **O-1** | P0 | ✅ Applied | SC-S1.0 nuevo (stop-the-line gate post-T1.1) |
| **O-2** | P0 | ✅ Applied | SC-S1.7 split en SC-S1.7a (lista nombrada ≥10 paths) + SC-S1.7b (métrico) |
| **O-3** | P0 | ✅ Applied | §7.0 nuevo "Orden de ejecución obligatorio" con Bloques A→B secuenciales |
| **O-4** | P0 | ✅ Applied | Estimación 8-12 días + SC-S1.checkpoint día 5 con split S1a/S1b opcional |
| **O-5** | P0 | ✅ Applied | SC-S1.6b flag `TRIP_STATE_MACHINE_ACTIVATED` obligatorio; branch legacy 1 sprint |
| **O-6** | P1 | ✅ Applied | SC-S1.8 eliminado (era self-fulfilling); monitoreo movido a risk operacional |
| **O-7** | P1 | ✅ Applied | SC-S1.13 eliminado (decorativo; ya cumplido pre-sprint) |
| **O-8** | P1 | ✅ Applied | SC-S1.12 reformulado: ≥10 PRs sample post-merge + dry-run pre-merge; follow-up S2 si <10 PRs |
| **O-9** | P1 | ✅ Applied | OQ-S1.4 resuelta pre-approve: spike 30 min pre-T1.10 + presupuesto adicional si fixture extend >50 LOC |
| **O-10** | P1 | ✅ Applied | Burnout subido a H/M con mitigación accionable (día 0 = planning + lectura; pausa si sesión >3h) |
| **O-11** | P2 | ✅ Applied | T1.7 lista IN-scope explícita (3 call sites) + OUT-of-scope con followup doc |
| **O-12** | P2 | ✅ Applied | SC-S1.4b nuevo: RLS policy + integration test si Clase C añade tabla |
| **O-13** | P2 | ✅ Applied | Umbral runners distribuidos declarado: "8 specs >12 min → evaluar en S2" |

13/13 objeciones aplicadas. Spec v2: 256 LOC.

## Decision log

- **2026-05-18** — Devils-advocate pass. 5 P0 + 5 P1 + 3 P2 = 13 objeciones.
- **2026-05-18** — PO aprobó aplicar **todas (P0 + P1 + P2)**.
- **2026-05-18** — Spec v2 producida con 13/13 objeciones aplicadas.
