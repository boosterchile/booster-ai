# Spec — Aislamiento documentado (T10-13)

- Fecha: 2026-10-07
- Estado: Vigente
- Programa: TRL 10, fase B, criterio **T10-13** (`.specs/trl10/spec.md`, ADR-082)

## Problema

`scripts/lint-rls.mjs` exime de filtro de empresa a las tablas de `TENANT_FREE_TABLES` (20 entradas, con la razón en un comentario). No existía `docs/rls-exemptions.md`, y nadie verificaba que la lista cubriera todas las tablas sin `empresa_id`. Medido sobre `main` (0008fa6): el schema tiene 40 tablas, 27 sin columna de tenant. De esas, 9 no estaban en la lista (se protegen query a query). Además, `metricasViaje` era un alias que no corresponde a ninguna tabla.

## Salidas

1. `docs/rls-exemptions.md` con dos tablas:
   - **Exentas por tabla**: exactamente `TENANT_FREE_TABLES`, con la razón;
   - **Sin columna `empresa_id`, protegidas en cada query**: las 9 restantes, con cómo se protegen, contrastado con el código.
2. `lint-rls.mjs` verifica el documento en cada `pnpm lint:rls`, que corre dentro de `pnpm lint` en CI. Falla si:
   - la sección de exentas no coincide con `TENANT_FREE_TABLES`;
   - una tabla sin columna de tenant no figura en ninguna sección;
   - una entrada no es tabla del schema.
3. `TENANT_FREE_TABLES` pierde `metricasViaje` (alias sin tabla; `tripMetrics` ya está).

No se edita ningún workflow: el check vive en el script que CI ya ejecuta.

## Criterios de éxito

1. Rojo exhibido: los tests nuevos de `scripts/lint-rls.test.mjs` fallan antes de implementar.
2. `node --test scripts/lint-rls.test.mjs` y `pnpm lint` en verde, incluido el test que verifica el doc real contra el schema real.

## Coordinación

Cuando la migración 0059 (T10-03 PR 2, #748) borre `cuentas_demo`, ese PR debe sacar `cuentasDemo` de `TENANT_FREE_TABLES` y del documento. Si no, `lint:rls` falla con «no es una tabla de schema.ts».
