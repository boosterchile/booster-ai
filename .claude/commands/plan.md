---
description: Producir un plan técnico detallado tras aprobar la spec
---

# /plan — Plan técnico post-spec

Después de que una spec está aprobada, produce un plan técnico antes de escribir código. El plan es la traducción de "qué" (spec) a "cómo" (archivos, orden, riesgos técnicos).

## Proceso

1. **Releer la spec aprobada**.
2. **Investigar el código actual** con Grep/Read. Identifica:
   - Archivos a modificar y archivos a crear
   - Contratos públicos afectados (shared-schemas, APIs, UI props)
   - Tests existentes que pueden romperse
3. **Escribir plan** en un comentario del PR o sección del spec:
   - **Arquitectura**: diagrama de alto nivel (ASCII o mermaid) si involucra >2 componentes
   - **Archivos a crear/modificar**: lista con 1 línea por archivo describiendo el cambio
   - **Orden de commits**: secuencia lógica, cada commit compila y pasa tests
   - **Riesgos técnicos**: cosas que pueden romperse + mitigación
   - **Dependencies nuevas**: si se introduce una lib, justificar o crear ADR
   - **Migraciones de BD** (si aplica): up + down + estrategia de deploy
   - **Feature flags** (si aplica): nombre del flag, rollout plan
4. **Pedir aprobación del plan** antes de ejecutar `/build`.

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Voy descubriendo mientras codeo" | Genera commits caóticos, PRs imposibles de revisar. |
| "El plan es obvio" | Si es obvio toma 5 minutos escribirlo y queda evidencia. |
| "Skippeo BD migrations porque es dev" | Las migrations hechas al final sin plan terminan rompiendo staging. |

## Exit criteria

- [ ] Plan documentado (PR comment o spec section)
- [ ] Orden de commits tiene sentido (cada uno compila)
- [ ] Riesgos identificados con mitigaciones
- [ ] Revisor humano aprobó el plan
