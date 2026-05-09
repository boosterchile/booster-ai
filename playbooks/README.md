# Playbooks

Decisiones de **producto y estrategia** de Booster AI. Complementan a [`docs/adr/`](../docs/adr/) que cubre decisiones **arquitectónicas**.

## Diferencia con ADRs

| Artefacto | Pregunta que responde | Ejemplo |
|---|---|---|
| **ADR** | ¿Qué tecnología/patrón/estructura usamos? | "Usamos Hono en lugar de Express" |
| **Playbook** | ¿Qué decimos al mercado, a quién, en qué orden, por qué? | "Posicionamos a Booster como el GLEC certificado de LATAM" |

Ambos son decisiones cerradas: se crea uno nuevo que supersede en lugar de editar el viejo. Conversaciones de Slack/chat no son evidencia de decisión (CLAUDE.md §Principio 4).

## Convención de nombres

`NNN-slug-kebab.md` con numeración correlativa, igual que ADRs.

## Estructura sugerida de un playbook

```markdown
# NNN — Título

**Status**: Draft | In review | Accepted | Superseded by NNN
**Date**: YYYY-MM-DD
**Decider**: Felipe Vicencio (Product Owner)
**Related**: enlaces a ADRs, market research, otros playbooks

## Decisión
Una frase que resume qué se decide.

## Contexto
Qué evidencia y qué research llevó a esta decisión (citar 001/002/003 según corresponda).

## El playbook
La secuencia operativa: qué se hace, cuándo, en qué orden, con qué señales de éxito.

## Anti-playbook
Qué explícitamente NO se hace (para evitar feature creep o pivots erráticos).

## Métricas de éxito
Cómo se mide que el playbook está funcionando.

## Triggers de revisión
Qué eventos obligan a revisar/superseder este playbook.
```

## Playbooks vigentes

- [001 — Posicionamiento competitivo Chile + LATAM](001-posicionamiento-competitivo.md)

## Documentos relacionados

- [`docs/integration-plan.md`](../docs/integration-plan.md) — plan vivo que conecta cada decisión de playbook con los cambios técnicos en código (packages, apps, ADRs, tests).
