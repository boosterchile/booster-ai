---
description: Escribir una spec formal antes de implementar una feature o cambio
---

# /spec — Spec antes de build

Antes de escribir código para una feature, un fix no trivial, o un cambio de contrato, escribe un spec formal. El spec es evidencia de que entiendes **qué** se va a construir antes de pensar en **cómo**.

## Cuándo usar

- Feature nueva que toca >1 archivo
- Cambio de contrato público (API endpoint, schema Zod exportado, interfaz de package)
- Refactor que altera comportamiento observable
- Fix de bug con causa raíz no obvia

## Cuándo NO usar

- Cambio trivial (typo, rename variable local, comment)
- Fix de bug con reproducción y causa clara en <5 líneas
- Trabajo de limpieza que no altera comportamiento

## Proceso

1. **Leer CLAUDE.md y el ADR relevante** para confirmar que la feature encaja en el modelo actual. Si no encaja, detenerse y proponer un nuevo ADR primero.
2. **Escribir spec en** `docs/specs/<YYYY-MM-DD>-<slug>.md` con secciones:
   - **Problema**: qué duele hoy (1-2 párrafos, con evidencia: ticket, métrica, conversación)
   - **Solución propuesta**: qué haremos (1 párrafo)
   - **Criterios de aceptación**: lista numerada, cada uno verificable con evidencia (test, output, screenshot)
   - **No goals**: qué NO cubre esta spec (explícito para evitar scope creep)
   - **Riesgos + mitigaciones**
   - **Plan de testing**: qué tests se añadirán
   - **Rollout**: cómo se activa en producción (feature flag, gradual, etc.)
3. **Pedir aprobación del spec** antes de ir a `/plan`.

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Es simple, no necesita spec" | Features "simples" que saltan spec son las que más retrabajo generan. |
| "Escribo el spec después del código" | El spec sirve para pensar, no documentar. Post-hoc pierde su valor. |
| "El Product Owner ya me lo explicó verbalmente" | La conversación oral no es evidencia auditable. |

## Exit criteria

- [ ] Archivo `docs/specs/<fecha>-<slug>.md` existe
- [ ] Cada criterio de aceptación es verificable con evidencia
- [ ] ADR relevante referenciado o creado si la feature no encaja en el modelo actual
- [ ] Revisor humano aprobó el spec
