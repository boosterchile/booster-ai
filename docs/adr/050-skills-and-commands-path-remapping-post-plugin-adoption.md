# ADR-050 — Path-remapping de skills, commands y agents post-adopción de plugins

**Estado**: Accepted
**Fecha**: 2026-05-21
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-049](./049-claude-code-plugin-system-adoption.md), [ADR-002](./002-skill-framework-adoption.md), [ADR-001](./001-stack-selection.md), [ADR-011](./011-admin-console.md), [ADR-046](./046-historical-adr-numbering-collisions.md), [CLAUDE.md](../../CLAUDE.md)

---

## Contexto

ADR-049 (2026-05-20) adoptó el sistema de plugins de Claude Code y supersedió ADR-002, materializado por PR-2 que borró los directorios `skills/`, `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, y `hooks/`.

ADR-046 §1 establece que **ADRs viejos no se editan**: "los ADRs son decisiones cerradas. Se crea un nuevo ADR que supersede, no se edita el viejo".

Pero ADRs históricos (notablemente ADR-001 y ADR-011) contienen referencias a paths que dejaron de existir. Editarlos viola ADR-046. No documentar el mapping deja a futuros lectores resolviendo a mano cada referencia rota.

Este ADR documenta el mapping canónico como referencia.

## Decisión

**Documentar el mapping path-antiguo → namespacing-nuevo en una tabla autoritativa de este ADR**, sin editar ADRs anteriores. Lectores futuros que encuentren referencias a paths borrados en ADRs viejos resuelven mentalmente vía esta tabla.

### Tabla de mapping

**Skills** (de `skills/<name>/SKILL.md` a namespacing de plugin):

| Path antiguo | Equivalente actual | Notas |
|---|---|---|
| `skills/adding-cloud-run-service/SKILL.md` | `booster-skills:adding-cloud-run-service` | Migrado vía PR-1 (booster-skills v0.1.0) |
| `skills/carbon-calculation-glec/SKILL.md` | `booster-skills:carbon-calculation-glec` | Migrado |
| `skills/empty-leg-matching/SKILL.md` | `booster-skills:empty-leg-matching` | Migrado |
| `skills/incident-response/SKILL.md` | `booster-skills:incident-response` | Migrado |
| `skills/arquitecto-maestro/SKILL.md` | `booster-skills:arquitecto-maestro` | Migrado |
| `skills/using-agent-skills/SKILL.md` | `agent-rigor:00-using-this-pack` | Deprecated; no migrado (cubierto por agent-rigor genérico) |
| `skills/writing-adrs/SKILL.md` | `agent-rigor:63-documentation-and-adrs` | Deprecated; no migrado |
| `skills/writing-tests/SKILL.md` | `agent-rigor:31-test-driven-development` | Nunca existió como archivo local (era TODO); cubierto por agent-rigor |

**Slash commands** (de `.claude/commands/<cmd>.md` a namespacing global):

| Path antiguo | Equivalente actual |
|---|---|
| `.claude/commands/spec.md` | `/agent-rigor:spec` |
| `.claude/commands/plan.md` | `/agent-rigor:plan` |
| `.claude/commands/build.md` | `/agent-rigor:build` |
| `.claude/commands/test.md` | `/agent-rigor:test` |
| `.claude/commands/review.md` | `/agent-rigor:review` |
| `.claude/commands/ship.md` | `/agent-rigor:ship` |

**Sub-agents** (de `.claude/agents/<name>.md` a namespacing de plugin):

| Path antiguo | Equivalente actual |
|---|---|
| `.claude/agents/dependency-auditor.md` | `booster-skills:dependency-auditor` |
| `.claude/agents/explore-architecture.md` | `booster-skills:explore-architecture` |
| `.claude/agents/performance-analyzer.md` | `booster-skills:performance-analyzer` |
| `.claude/agents/refactor-advisor.md` | `booster-skills:refactor-advisor` |
| `.claude/agents/security-scanner.md` | `booster-skills:security-scanner` |
| `.claude/agents/tech-debt-detector.md` | `booster-skills:tech-debt-detector` |

**Agents de proyecto local** (overrides Booster, NO se migran al plugin v0.1.0):

| Path | Estado | Migración futura |
|---|---|---|
| `agents/code-reviewer.md` | Conservado como override local Booster | Tracked en `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` |
| `agents/security-auditor.md` | Conservado como override local Booster | idem |
| `agents/sre-oncall.md` | Conservado como override local Booster (sin equivalente en plugins) | idem |

**Hooks de sesión** (de `hooks/<name>.md` a hooks del plugin):

| Path antiguo | Equivalente actual |
|---|---|
| `hooks/session-start.md` | Hook SessionStart del plugin agent-rigor (en `~/.claude/plugins/cache/agent-rigor/agent-rigor/<ver>/hooks/`) — se ejecuta automáticamente al inicio de sesión Claude Code |

## Consecuencias

### Positivas

- **ADRs históricos (001, 011, otros) quedan intactos** respetando ADR-046 §1.
- **Referencias rotas se resuelven via lookup** — un lector que ve `skills/empty-leg-matching/SKILL.md` en ADR-011 abre ADR-050 y encuentra `booster-skills:empty-leg-matching`.
- **Plantilla replicable**: futuros refactors de paths globales en el repo pueden seguir este patrón (ADR remapping vs edición histórica).

### Negativas

- **Latencia cognitiva**: el lector debe abrir ADR-050 para resolver referencias, en lugar de tener el path correcto inline.
- **Drift potencial**: si en futuro se borran/renaman más paths, esta tabla debe extenderse. Sin disciplina, el mapping queda desactualizado.
- **No reemplaza link rot**: las referencias en ADRs viejos siguen siendo strings rotos en el sentido literal — esta tabla los hace navegables semánticamente, no funcionales como hyperlinks.

## Implementación

PR-2 (chore/integrate-booster-skills-plugin) materializa este ADR como parte de su commit T22 ("fix(claude): orphan refs + ADR-050 path-remapping + idioma headers ADRs").

ADR-049 §Validación se actualiza para incluir reference a este ADR como complemento.

ADR-001 y ADR-011 **no se modifican**. Sus referencias a paths borrados quedan como evidencia histórica del estado del repo al momento de su redacción.

## Validación

- [x] ADR-050 archivo existe en `docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md`
- [x] Tabla de mapping completa: 8 skills + 6 commands + 6 agents + 1 hook + 3 overrides locales
- [x] Referenciado desde ADR-049 §Referencias (al cierre de PR-2)
- [ ] Linked desde CLAUDE.md §Integración con plugins de Claude Code (next iteration si aplica)
- [x] ADR-046 §1 respetado: cero ediciones a ADRs <050

## Referencias

- [ADR-049](./049-claude-code-plugin-system-adoption.md): decisión arquitectónica de adopción del sistema de plugins.
- [ADR-046](./046-historical-adr-numbering-collisions.md) §1: "los ADRs son decisiones cerradas".
- [ADR-002](./002-skill-framework-adoption.md): adopción inicial del framework local (superseded by ADR-049).
- [`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`](../plugins/REPORTE-migracion-booster-skills-v0.1.0.md): ejemplo trabajado de la migración.
- [CLAUDE.md](../../CLAUDE.md) §Integración con plugins de Claude Code: sección operativa actual.
