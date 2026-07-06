# Spec — ADR-072: disciplina inline, plugins como conocimiento opcional

**Fecha**: 2026-07-06 · **Rama**: `chore/adr-072-disciplina-inline` · **Origen**: solicitud del PO tras análisis comparativo con ICARENEST (`audit-outputs/2026-07-06-analisis-base-disciplina-icarenest.md`).

## Objetivo

Reescribir el contrato de trabajo (`CLAUDE.md`) al estilo ICARENEST: corto, autosuficiente, releíble por sesión, con la disciplina inline en vez de delegada a plugins de Claude Code. Formalizarlo con ADR-072.

## Entradas

- Análisis con evidencia: `audit-outputs/2026-07-06-analisis-base-disciplina-icarenest.md`
- Borrador aprobado en dirección por el PO: `audit-outputs/2026-07-06-propuesta-CLAUDE.md`
- ADR-049/050/060/064 (historia de la capa de plugins)

## Salidas

1. `docs/adr/072-disciplina-inline-plugins-como-conocimiento-opcional.md` (Accepted, decider PO)
2. `CLAUDE.md` reescrito (~90 líneas)
3. `AGENTS.md` con la referencia a plugins ajustada a "apoyo opcional"

## Criterios de éxito

- [ ] El nuevo CLAUDE.md no asigna ninguna responsabilidad de disciplina a un plugin; toda regla es verificable por contrato + CI + gate humano.
- [ ] Conserva íntegras las reglas Booster con evidencia de funcionamiento: stack (types/Zod/observabilidad/seguridad/testing), naming bilingüe, arquitectura, commits/PRs/Evidencia, deploy con gate humano, archivos protegidos.
- [ ] Incorpora los mecanismos ICARENEST: frontera de decisiones, un frente por vez (WIP máx. 3 PRs propios), criterio de salida antes de construir, TDD con rojo exhibido en dominio crítico, detenerse-y-escalar, ~4 intentos + escalada clasificada, commit+push por tarea.
- [ ] ADR-072 documenta el retiro del ledger observacional (follow-up en repo booster-skills) y el estatus opcional de superpowers.
- [ ] `check-adr-numbering` y commitlint pasan; ningún ADR existente se edita.
- [ ] Ni código, ni CI, ni deploy cambian (solo governance/docs).

## Fuera de alcance

- Release de booster-skills sin hooks de ledger (follow-up en ese repo).
- Triage del batch #509–#527, ramas muertas y stubs `_followups` (deuda operativa, frente aparte).
- Cambios a `.claude/settings.json` (los plugins siguen habilitados como apoyo).
