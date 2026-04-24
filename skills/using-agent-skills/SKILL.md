# Skill: Using Agent Skills (meta-skill)

**Categoría**: core-engineering
**Prioridad**: máxima — este skill gobierna la invocación de todos los demás.

## Overview

Antes de ejecutar cualquier tarea no trivial, el agente debe consultar `skills/` para identificar si existe un workflow definido que cubra la tarea. Este skill define cómo descubrir, invocar y respetar los otros skills.

## When to Use

Aplica a **toda tarea** excepto conversación pura o cambios triviales (typo, rename local, un comment).

**Especialmente críticas**:
- Cualquier acción con impacto en producción (deploy, infra, DB migration, IAM)
- Cualquier acción con impacto en compliance (Ley 19.628, SII, retención)
- Cualquier acción repetible que ya se ha hecho antes (hay skill, no improvisar)

## Core Process

1. **Categorizar la tarea** en una de las 9 capas del framework:
   - `core-engineering` — spec, plan, test, review, ADRs, refactors
   - `operations-sre` — incidentes, post-mortems, rollbacks, on-call
   - `compliance` — Ley 19.628 requests, SII DTE, retención, audit logs
   - `customer-ops` — onboarding, tickets, feature flags, comms
   - `data-ml` — data validation, model rollout, drift, A/B
   - `iot-telemetry` — device provisioning, event handling, pipeline debug
   - `growth-business` — experiments, metrics, pricing changes
   - `performance` — load tests, capacity, cost optimization
   - `api-lifecycle` — deprecation, versioning, breaking changes

2. **Buscar skill existente** en la carpeta correspondiente (`ls skills/`). Nombres son descriptivos: `incident-response`, `adding-cloud-run-service`, `dte-sii-emission-flow`, etc.

3. **Si existe skill**: leer `SKILL.md` completo antes de hacer cualquier cosa. Seguir el `Core Process` tal cual. No saltar pasos. No racionalizar atajos.

4. **Si NO existe skill y la tarea es repetible**: proponer crear el skill primero (ver `skills/writing-skills/SKILL.md`). Si el PO aprueba, crear skill, luego ejecutar tarea. Si es one-off verdadero, documentar en `docs/runbooks/` como runbook.

5. **Durante la ejecución**: mantener evidencia de cada checkpoint del skill. Al terminar, el PR debe demostrar que cada exit criterion del skill fue cumplido.

## Common Rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Este caso es especial, el skill no aplica" | Los "casos especiales" son la mayoría. Si el skill no aplica, modifica el skill, no lo saltes. |
| "Conozco el proceso de memoria, no necesito releer" | Los humanos olvidan detalles; los agentes más. Releer toma <1min. |
| "Salto el exit criterion X porque no aplica aquí" | Si verdaderamente no aplica, documenta por qué. Si aplica pero es molesto, cumple. |
| "El skill es largo, hago resumen" | El detalle existe por razones. Resumir pierde disciplina. |

## Red Flags

- Un PR sin referencia al skill invocado
- Un PR donde el agente dice "lo hice de memoria"
- Un skill que "nunca aplica" → probablemente está mal escrito, revisarlo
- Exit criteria marcados sin evidencia concreta

## Exit Criteria

- [ ] Tarea categorizada en una de las 9 capas
- [ ] Skill correspondiente identificado y leído
- [ ] Core Process del skill seguido paso a paso
- [ ] Cada exit criterion del skill cubierto con evidencia
- [ ] PR referencia el skill invocado (ej. `Followed skill: adding-cloud-run-service`)
