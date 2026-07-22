# Spec — pin @opentelemetry/propagator-jaeger >=2.9.0 (GHSA-45rx-2jwx-cxfr)

## Objetivo

Eliminar el único hallazgo **HIGH** del árbol de dependencias que rompe los gates
`Security` (npm audit + Trivy) desde ~2026-07-21, bloqueando el cierre limpio de otros PRs.

## Contexto

- **CVE**: GHSA-45rx-2jwx-cxfr — Denial of Service en `JaegerPropagator` de
  `@opentelemetry/propagator-jaeger` `<2.9.0` (excepción no manejada ante header
  malformado). Parche: `>=2.9.0`.
- **Path**: `apps/api > @opentelemetry/sdk-node > @opentelemetry/propagator-jaeger`
  (transitivo; ninguna app lo importa directo).
- No introducido por código propio: el advisory se publicó tras el merge de #611;
  el `Security` scheduled de `main` también quedó rojo. Es un pin de seguridad
  puro, no un cambio funcional.

## Entrada / Cambio

- `pnpm-workspace.yaml` → `overrides`: agregar
  `"@opentelemetry/propagator-jaeger@<2.9.0": ">=2.9.0"` (14º pin, junto al grupo
  OTel existente; ADR-075: fuente única de overrides).
- `pnpm-lock.yaml` regenerado con Corepack/pnpm 10.34.4 (`--lockfile-only`).

## Salidas / Criterios de éxito

1. `pnpm audit --audit-level=high --prod` → **0 HIGH/CRITICAL** (moderate permitidos).
2. Gate `npm audit (HIGH+)` y `Trivy filesystem + config scan` → verdes en la CI del PR.
3. Cero cambios de código de aplicación; diff acotado a `pnpm-workspace.yaml` +
   `pnpm-lock.yaml` (+ este spec).
4. `propagator-jaeger` resuelve a `>=2.9.0` en el lockfile; el resto del árbol OTel
   sigue compatible (major 2.x).

## Fuera de alcance

Bump de los otros pins OTel (`core`/`resources`/`sdk-trace-base`) más allá del
arrastre en lockstep que imponga la resolución; los 5 hallazgos `moderate` restantes
(no gatean el CI).
