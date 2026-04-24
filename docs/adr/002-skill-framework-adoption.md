# ADR-002 — Adopción del framework de Agent Skills

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-001](./001-stack-selection.md), [CLAUDE.md](../../CLAUDE.md)

---

## Contexto

Booster AI se desarrolla con Claude como agente principal. Sin un framework estructurado para gobernar cómo el agente trabaja, aparecen tres problemas conocidos del 2.0:

1. **Drift de convenciones** — el agente "recuerda" inconsistentemente qué hacer para tareas repetibles (ej. cómo escribir un test, cómo añadir un endpoint).
2. **Falta de checkpoints verificables** — el agente puede reportar "hecho" sin evidencia real; esto generó rework en el 2.0.
3. **Ausencia de anti-rationalization guards** — el agente racionaliza atajos ("este caso es especial, salto el test") sin flags explícitos.

## Decisión

Adoptar el framework de [**addyosmani/agent-skills**](https://github.com/addyosmani/agent-skills) — "Production-grade engineering skills for AI coding agents" — como estructura para codificar workflows repetibles del equipo.

### Estructura adoptada

```
skills/                    # Workflows estructurados
├── <skill-name>/
│   ├── SKILL.md           # Entry point (obligatorio)
│   └── ... (archivos de soporte opcionales)

agents/                    # Personas reutilizables
├── code-reviewer.md
├── security-auditor.md
└── test-engineer.md

.claude/
├── commands/              # Slash commands
│   ├── spec.md
│   ├── plan.md
│   ├── build.md
│   ├── test.md
│   ├── review.md
│   └── ship.md
└── settings.json          # Permisos (opcional)

hooks/                     # Session lifecycle
└── session-start.md

references/                # Checklists suplementarios
├── testing-checklist.md
├── security-checklist.md
├── performance-checklist.md
└── accessibility-checklist.md
```

### Anatomía obligatoria de cada SKILL.md

Todo skill debe tener estas secciones:

1. **Title + Overview** — 1-2 oraciones sobre qué hace y por qué importa.
2. **When to Use** — bullets con condiciones de activación y exclusiones.
3. **Core Process** — pasos numerados, específicos (no "verifica tests" sino "ejecuta `pnpm test --filter=api`").
4. **Techniques / Patterns** — guidance detallada, ejemplos de código.
5. **Common Rationalizations** — tabla "Tentación → por qué es un error".
6. **Red Flags** — señales de que el skill no está funcionando.
7. **Exit Criteria** — checklist con evidencia verificable por checkpoint.

### Principios de diseño de skills

- **Process over knowledge** — skills son workflows, no documentación de referencia.
- **Specific over general** — "Ejecuta `pnpm typecheck`" gana a "verifica los tipos".
- **Evidence over assumption** — cada exit criterion debe ser verificable con output concreto (test output, screenshot, trace).

### Skills iniciales a crear (bootstrap)

En orden de prioridad para el primer mes:

1. `using-agent-skills` — meta-skill sobre cómo invocar y respetar skills.
2. `writing-adrs` — cómo proponer y escribir nuevos ADRs.
3. `writing-tests` — disciplina de testing (qué testear, cómo estructurar, coverage).
4. `adding-endpoint` — paso a paso para añadir un endpoint Hono con validación Zod + tests + observabilidad.
5. `adding-migration` — cómo añadir migración Drizzle sin romper deploys.
6. `carbon-calculation` — workflow específico de dominio: cómo calcular huella de carbono GLEC v3.0 correctamente.
7. `empty-leg-matching` — workflow específico de dominio: cómo implementar matching con score multifactor.

### Slash commands iniciales

- `/spec` — escribir spec antes de implementar (Write, Test, Done criterio).
- `/plan` — plan técnico detallado (archivos a tocar, orden, riesgos).
- `/build` — implementación disciplinada siguiendo skills relevantes.
- `/test` — suite de tests + verificación contra exit criteria.
- `/review` — code review formal (usa agent `code-reviewer`).
- `/ship` — checklist pre-deploy (tests, typecheck, build, security scan).

## Consecuencias

### Positivas

- **Repetibilidad**: tareas como "añadir endpoint" se ejecutan igual cada vez, con los mismos checkpoints.
- **Onboarding instantáneo**: un nuevo dev (humano o agente) puede consultar `skills/` para entender cómo opera el equipo.
- **Auditoría mejorada**: para TRL 10, los skills son "procedures" documentados que pasan auditoría de ISO 27001 / SOC 2 con menor esfuerzo.
- **Reducción de rationalization**: la sección explícita de "Common Rationalizations" ataca los atajos que el agente toma cuando no hay estructura.

### Negativas

- **Overhead inicial**: crear y mantener skills requiere tiempo. Mitigado empezando con 3-5 skills críticos y creciendo orgánicamente.
- **Riesgo de skills obsoletas**: si un skill no se actualiza cuando cambia una práctica, el agente puede seguir el skill viejo. Mitigado con revisión trimestral de skills activos.
- **Dependencia conceptual de un framework externo**: si `addyosmani/agent-skills` deja de mantenerse, adaptamos. El framework es suficientemente simple para continuar sin el repo upstream.

## Implementación

### Fase 1 — Infraestructura (immediate)

- Crear estructura de carpetas (`skills/`, `agents/`, `.claude/commands/`, `hooks/`, `references/`).
- Crear `skills/using-agent-skills/SKILL.md` como primer skill (meta).
- Crear `skills/writing-adrs/SKILL.md`.
- Crear 5 slash commands iniciales (`spec`, `plan`, `build`, `test`, `review`).
- Crear `agents/code-reviewer.md`.

### Fase 2 — Skills de dominio (semana 2-4)

- `writing-tests`
- `adding-endpoint`
- `adding-migration`

### Fase 3 — Skills específicos de Booster (semana 4-8)

- `carbon-calculation`
- `empty-leg-matching`
- `esg-report-generation`

## Validación

- [ ] Estructura de carpetas creada
- [ ] `skills/using-agent-skills/SKILL.md` existe y pasa la anatomía obligatoria
- [ ] Al menos 3 slash commands funcionales
- [ ] Al menos 1 agent persona definida
- [ ] Referenciado desde `CLAUDE.md`

## Referencias

- [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — framework base
- [addyosmani/agent-skills docs/skill-anatomy.md](https://github.com/addyosmani/agent-skills/blob/main/docs/skill-anatomy.md)
- [ADR-001](./001-stack-selection.md) — stack selection
- [CLAUDE.md](../../CLAUDE.md) — contrato agente
