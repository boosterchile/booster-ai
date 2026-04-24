---
description: Implementar código siguiendo el plan aprobado, con disciplina de TDD opcional
---

# /build — Implementación disciplinada

Después de `/spec` y `/plan` aprobados, implementa el código en commits pequeños, cada uno compilando y pasando tests.

## Proceso

1. **Verificar** que tienes el spec y plan aprobados. Si no, volver atrás.
2. **Crear branch** `feat/<slug>` (o `fix/`, `refactor/`, etc. según Conventional Commits).
3. **Implementar por capas** en el orden del plan:
   - Shared schemas (Zod) primero si hay nuevos contratos
   - Lógica pura (packages/*) antes de capas I/O
   - Endpoints API antes de UI
   - Tests junto al código, no al final
4. **Commits pequeños** (Conventional Commits):
   - Cada commit corresponde a 1 unidad lógica
   - Cada commit compila y pasa `pnpm ci` local
   - Mensaje claro: `feat(domain): short description`
5. **PR al final** con:
   - Referencia al spec: `Closes #<issue>` o `Refs docs/specs/<file>`
   - Descripción del cambio (copiar del plan)
   - **Sección Evidencia obligatoria**: output de tests, screenshots, curl, trace
   - Checklist de ADR compliance si aplica

## Disciplina de código

- **Zero `any`**: Biome lo prohíbe. Si un tipo no existe, crear Zod schema.
- **Zero `console.*`**: usar `@booster-ai/logger`.
- **Tests junto al código**: unit tests en `*.test.ts` al lado del archivo; integration en `test/integration/`.
- **Observabilidad al escribir**: cada endpoint nuevo tiene log con `trace_id`, span OTel, métrica si es op de negocio.
- **Validación en boundaries**: todo input externo pasa por Zod schema antes de lógica.

## Anti-rationalizations

| Tentación | Por qué es un error |
|-----------|---------------------|
| "Uso `any` aquí porque el tipo es complicado" | Los tipos complicados son los que MÁS necesitan estar bien tipados. |
| "Agrego tests después del PR" | Nunca pasa. |
| "Skippeo el log estructurado en este endpoint trivial" | No existen endpoints triviales en producción. |
| "Hago este commit grande para no fragmentar" | Los commits grandes hacen los reviews malos y los rollbacks imposibles. |

## Exit criteria

- [ ] Branch con commits Conventional Commits
- [ ] Cada commit compila y pasa tests locales
- [ ] PR abierto con descripción + sección Evidencia
- [ ] CI pasa (lint + typecheck + test + coverage 80%+ + build)
- [ ] Sin `any`, sin `console.*`, sin TODOs nuevos sin issue asociado
- [ ] Logger + OTel + métricas custom presentes donde corresponde
