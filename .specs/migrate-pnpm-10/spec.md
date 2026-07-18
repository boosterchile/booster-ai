# spec — Migración a pnpm 10 (fuente única de overrides)

**Slug**: `migrate-pnpm-10`
**Frente**: deuda de tooling / cadena de suministro (overrides duplicados package.json vs pnpm-workspace.yaml)
**Decisión**: [ADR-075](../../docs/adr/075-migracion-pnpm-10.md) (Proposed → Accepted al aprobar el PO)

## Objetivo

Completar la migración a pnpm 10: `pnpm-workspace.yaml` como fuente única de `overrides`/`onlyBuiltDependencies`, eliminar el campo `pnpm` de `package.json` (que pnpm 10 ignora → WARN), subir `packageManager` y la versión de pnpm del CI a pnpm 10, y regenerar el lockfile — **sin perder ningún security pin ni reintroducir vulnerabilidades**.

## Entradas (estado verificado 2026-07-18, origin/main @ b10519c)

- `package.json.pnpm`: 13 overrides + 2 onlyBuiltDependencies. `packageManager = pnpm@9.15.4`, `engines.pnpm >=9.0.0`.
- `pnpm-workspace.yaml`: mismos 13 overrides + 2 onlyBuiltDependencies (idénticos entrada-por-entrada).
- CI: 5 workflows con `pnpm/action-setup` en `9.15.4` (ci/e2e-pr/release vía `PNPM_VERSION`; security ×7 + e2e-staging ×1 hardcoded).
- `pnpm` local por defecto (Homebrew) = 9.15.4; `corepack pnpm@10` = 10.34.4.

## Salidas

- `pnpm-workspace.yaml` fuente única; campo `pnpm` eliminado de `package.json`.
- `packageManager = pnpm@10.34.4`; `engines.pnpm >=10.0.0`; todos los `pnpm/action-setup` en `10.34.4`.
- Lockfile regenerado con pnpm 10.
- ADR-075.

## Criterios de éxito (contrato)

1. El WARN `The "pnpm" field in package.json is no longer read by pnpm` **desaparece** del `pnpm install`.
2. `pnpm audit --audit-level=high --prod` = **0 vulnerabilidades** (no degradar seguridad).
3. `pnpm why` de los pins (websocket-driver, qs, tmp, …) muestra las **mismas versiones** que antes — **ningún pin baja**.
4. `pnpm ci` (lint + typecheck + test + build) en **verde** bajo pnpm 10 + node 24.
5. Los dos cambios inseparables (quitar el campo `pnpm` + subir el CI a pnpm 10) van en el **mismo PR**.
6. PR abierto, **sin mergear** (lo aprueba el PO — quality gate de CI).

## Fuera de alcance

- Cambiar los constraints de los overrides (se preservan tal cual; solo se consolida el lugar).
- Actualizar dependencias de negocio (la resolución debe quedar idéntica; el lockfile no debe cambiar de versiones).

## Riesgo clave

Quitar el campo `pnpm` mientras el CI corre pnpm 9 pierde los overrides → reintroduce CVEs. Mitigación: ambos cambios en el mismo PR; validación corrida con pnpm 10 real (corepack), no con el Homebrew 9.15.4. Abort si `pnpm audit` pasa de 0 a >0, si algún pin baja, o si `pnpm ci` rompe por la nueva resolución.
