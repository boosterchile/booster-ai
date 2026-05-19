# ADR-054: Migración del Arquitecto Maestro de Project Instructions (claude.ai) a Skill versionada en repo

**Status**: Accepted
**Date**: 2026-05-19
**Owner**: Felipe Vicencio · `dev@boosterchile.com`
**Supersedes**: N/A
**Superseded by**: N/A
**Related**:
- ADR-001 (stack canónico Booster AI)
- ADR-043 (drift-inventory enforcement)
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (marco de referencia)
- CLAUDE.md §3 (Process over knowledge), §4 (Decisiones en ADRs)
- Sesión auditoría `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7` (2026-05-19)

---

## Context

Entre 2026-05-18 y 2026-05-19 se evaluó arquitectónicamente el setup operativo del "Arquitecto Maestro" — meta-orquestador encargado de diseñar Execution Plans deterministas para misiones complejas del proyecto Booster AI (misiones que afectan >1 app/package, requieren ADR, o cruzan dimensiones architecture/security/performance/compliance).

El setup original consistía en:

- Un Claude Project hospedado en `claude.ai` (`Booster AI — Arquitecto Claude Code`).
- Project Instructions definiendo la persona meta-orquestadora + 4 reglas operativas inquebrantables (anti-alucinación, máquina de estados, plantilla Execution Blueprint, protocolo Auto-Dream de consolidación de memoria).
- Memoria conversacional acotada al scope del Project + opción de Project Knowledge con archivos como `Memoria_Proyecto.md`.
- Flujo de trabajo: PO conversa con Arquitecto en `claude.ai` → Arquitecto produce Execution Blueprint en Markdown → PO copia/pega Blueprint en sesión de Claude Code CLI → agente ejecuta.

La auditoría arquitectónica del 2026-05-19 (sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`, 6 subagents paralelos + 1 refactor-advisor) reveló inconsistencias estructurales del setup:

1. **Violación de Principio §3 (Process over knowledge)** — el Arquitecto vivía como memoria conversacional + plantillas en context window, no como proceso versionado bajo `skills/`. CLAUDE.md §3 declara explícitamente: *"El agente no confía en su memoria — sigue los workflows definidos en `skills/` y los hooks de `agent-rigor` para cada operación"*.
2. **Stack drift confirmado empíricamente** — durante la sesión se detectaron 5 divergencias entre el stack declarado en Project Instructions (Neon Postgres, HashRouter, `maps.config.ts`, npm, pgvector) y el stack real verificado en el repo (Cloud SQL, `@tanstack/react-router`, `packages/config` + Secret Manager, pnpm 9, sin pgvector). El medio (memoria en context) no permite verificación contra filesystem real; el drift es inherente al diseño.
3. **Sin versionado en git** — las Project Instructions viven en `claude.ai` sin historial trazable, sin diff, sin PR, sin blame. Cualquier cambio es opaco para revisores posteriores.
4. **No compartible con el equipo** — el Project en `claude.ai` es propiedad personal del usuario individual; no se hereda al clonar el repo. Inviable si el equipo crece >1 desarrollador.
5. **Redundancia con agent-rigor** — el repo ya tiene framework de rigor con ledger en `.claude/ledger/` y workflows estructurados en `skills/`. El Arquitecto reimplementaba parcialmente la máquina de estados (Regla 2 del setup original = tracker manual; agent-rigor lo provee nativamente).
6. **Composición limitada con primitivas existentes** — el Arquitecto en `claude.ai` podía describir subagents/hooks/MCPs pero no invocarlos directamente. La auditoría 2026-05-19 dejó 6 subagents reusables en `.claude/agents/`; aprovecharlos requiere una skill que los componga, no una persona conversacional que los referencie.

---

## Decision

El "Arquitecto Maestro" deja de vivir como Project Instructions en `claude.ai` y se transforma en una skill versionada bajo el repo, complementada por documentación viva del estado del proyecto:

### Cambios estructurales

| Componente original | Reemplazo en repo |
|---|---|
| Project Instructions (persona) | `skills/arquitecto-maestro/SKILL.md` (formato addyosmani/agent-skills) |
| Project Knowledge (`Memoria_Proyecto.md`) | `docs/handoff/CURRENT.md` (estado vivo) |
| Regla 1 (anti-alucinación + consulta de conocimiento) | Fase 1 read-first del workflow de la skill (lee CLAUDE.md + CURRENT.md + ADRs + drift-inventory) |
| Regla 2 (máquina de estados con tracker manual) | agent-rigor ledger en `.claude/ledger/<YYYY-MM-DD>/<session-uuid>.md` |
| Regla 3 (plantilla Execution Blueprint copy-paste) | `.specs/<feature-slug>/spec.md` versionado en git |
| Regla 4 (Auto-Dream con output a chat) | Sub-workflow `/auto-dream` con output como PR al repo (`docs/handoff/CURRENT.md` + ledger) |

### Redefinición del Project en `claude.ai`

El Project original (`Booster AI — Arquitecto Claude Code`) se renombra a **`Booster AI — Exploration Workspace`** con propósito acotado:

- Brainstorming temprano sobre requerimientos antes de comprometerlos a skills/specs del repo.
- Trabajo meta-arquitectónico exploratorio que no toca código.
- Borradores conversacionales de ADRs antes de redactarlos formalmente.

**No es** meta-orquestador permanente, ni fuente de verdad operativa, ni reemplazo del flujo skill+spec del repo.

---

## Consequences

### Positivas

- **Coherencia filosófica completa** — alineado con Principio §3 (Process over knowledge) y §4 (Decisiones en ADRs). Elimina la tensión interna del proyecto.
- **Cero drift estructural** — la skill lee filesystem real en cada activación (CLAUDE.md, CURRENT.md, ADRs activos, drift-inventory). No puede operar contra stack obsoleto.
- **Versionado completo** — cada cambio al Arquitecto pasa por PR + diff + blame + posibles ADR superseding. Auditable a perpetuidad.
- **Heredable por equipo** — todos los devs que clonen el repo obtienen la skill automáticamente. Escala más allá de 1 dev.
- **Composición nativa con subagents** — la skill invoca directamente los 6 subagents de `.claude/agents/` (explore-architecture, dependency-auditor, security-scanner, performance-analyzer, tech-debt-detector, refactor-advisor) en vez de describirlos.
- **Trazabilidad por sesión** — agent-rigor ledger captura inicio + decisiones + cierre de cada misión orquestada con timestamp y session UUID.
- **Reproducibilidad** — el mismo prompt + el mismo repo en HEAD producen el mismo plan. Project Instructions en `claude.ai` no garantizaban esto.

### Negativas

- **Pérdida de conversación libre como entrada al flujo** — el Project en `claude.ai` permitía iterar sobre un requerimiento ambiguo antes de escribir spec. Mitigación: el Project se conserva como "exploration workspace" para esta función.
- **Curva de creación más alta** — cada nueva sub-rutina del Arquitecto debe escribirse como skill estructurada (formato canónico: When to use / Core process / Anti-rationalizations / Exit criteria), no como prompt libre. Trade-off aceptado.
- **Memoria conversacional reducida** — `claude.ai` Projects tienen memoria nativa cross-chat; CURRENT.md requiere actualización explícita post-misión. Mitigación: sub-workflow `/auto-dream` automatiza la consolidación.
- **Posible fricción operativa inicial** — durante las primeras misiones post-migración puede haber tentación de "saltar a `claude.ai`" por costumbre. Mitigación: durante 30 días post-merge, monitorear cuántas misiones se inician en el Project vs. en Claude Code CLI; si la migración no toma tracción, revisar el diseño de la skill.

### Riesgos identificados y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Drift entre `CURRENT.md` y realidad del repo | Media | Medio | Sub-workflow `/auto-dream` post-misión + hook `PostToolUse` opcional que recuerda actualizar CURRENT.md |
| Skill `arquitecto-maestro` se vuelve obsoleta sin que nadie lo note | Baja | Medio | Versionado semántico (1.0.0 inicial) + revisión cada 3 meses como mantenimiento de skill |
| Equipo (cuando crezca) no descubre la skill | Baja | Bajo | Documentación en CLAUDE.md §3 + README del repo + onboarding spec en `.specs/onboarding/` |

---

## Migration plan

1. **2026-05-19** — Creación de `docs/handoff/CURRENT.md` con estado consolidado post-auditoría arquitectónica. **[Completado en este PR]**
2. **2026-05-19** — Creación de `skills/arquitecto-maestro/SKILL.md` v1.0.0 con workflow completo (6 fases, 9 anti-rationalizations, 9 exit criteria, sub-workflow `/auto-dream`). **[Completado en este PR]**
3. **2026-05-19** — Redacción de este ADR (ADR-054) documentando la transición. **[Completado en este PR]**
4. **+7 días desde merge** — Test de humo invocando `/arquitecto-maestro <misión>` en sesión nueva de Claude Code para validar activación correcta. Si falla, abrir PR de fix sobre la skill.
5. **+30 días desde merge** — Revisión retrospectiva: ¿la skill captura todos los casos de uso del Arquitecto original? ¿Hay sub-rutinas que requieran spin-off a skills específicas? Documentar hallazgos como follow-up.
6. **Permanente** — El Project `Booster AI — Exploration Workspace` queda como espacio de exploración temprana únicamente. No se promueve trabajo desde ahí sin pasar por skill+spec en repo.

---

## Validation criteria

Esta migración se considera **exitosa** cuando, dentro de 30 días post-merge:

- [ ] Test de humo de la skill pasa (output esperado: `.specs/<feature>/spec.md` emitido + STOP esperando aprobación).
- [ ] ≥1 misión real de Sprint 1 fue orquestada vía `/arquitecto-maestro` produciendo spec versionada.
- [ ] `docs/handoff/CURRENT.md` se actualizó al menos 1 vez tras cierre de misión vía `/auto-dream`.
- [ ] Agent-rigor ledger contiene registros completos (inicio + decisiones + cierre) de las misiones orquestadas.
- [ ] Cero misiones de producción ejecutadas tomando Execution Blueprints desde el Project en `claude.ai`.

Si cualquier criterio falla a los 30 días, abrir ADR-055 de revisión.

---

## References

- `docs/handoff/CURRENT.md` — estado vivo del proyecto, consolidación inicial post-auditoría.
- `skills/arquitecto-maestro/SKILL.md` — skill resultante v1.0.0.
- `audit-outputs/SUMMARY.md` — síntesis ejecutiva auditoría 2026-05-19.
- `audit-outputs/EXTENSIONS_RECOMMENDATIONS.md` — catálogo de subagents/hooks/MCPs/skills reusables.
- `audit-outputs/CLAUDE.md` (propuesto) — constitución del repo derivada de la auditoría.
- Sesión de auditoría: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7` (2026-05-19).
- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — marco de referencia para skills production-grade.
- ADR-001 — stack canónico Booster AI.
- ADR-043 — drift-inventory enforcement.

---

*Fin de ADR-054.*
