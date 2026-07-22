# Spec — dejar verde el gate Security (Trivy + npm audit) via pins de CVE

## Objetivo

Eliminar TODOS los hallazgos de vulnerabilidad *fixables* del árbol de dependencias que
rompían el workflow `Security` desde ~2026-07-21, bloqueando el cierre limpio de otros PRs
(p. ej. #612).

## Contexto — dos gates, dos umbrales

- **`npm audit (HIGH+)`** corre `pnpm audit --audit-level=high --prod` → **solo** gatea en
  HIGH/CRITICAL. Fallaba por 1 HIGH: **GHSA-45rx-2jwx-cxfr** (DoS en `JaegerPropagator` de
  `@opentelemetry/propagator-jaeger` `<2.9.0`, transitivo de `@opentelemetry/sdk-node` en
  `apps/api`).
- **`Trivy filesystem scan`** declara `severity: HIGH,CRITICAL` con intención documentada de
  bloquear solo en HIGH/CRITICAL, **pero** `format: sarif` + `aquasecurity/trivy-action@master`
  ejecuta `unset TRIVY_SEVERITY` cuando `limit-severities-for-sarif != true` → el filtro se
  ignora y `exit-code: 1` dispara sobre **cualquier** vuln fixable a **cualquier** severidad.
  Hoy: 5 MEDIUM (ver abajo). **Bug de scope latente del gate**, destapado el ~07-21 cuando esos
  advisories entraron a la DB de Trivy (verde hasta 07-20 = árbol con 0 fixables).

Decisión del PO (2026-07-21): **pinear los CVE** (no tocar el workflow por ahora). El bug de
scope del gate Trivy queda como **deuda declarada** (issue de tracking) — reaparecerá en el
próximo MEDIUM hasta setear `limit-severities-for-sarif: true`.

## Entrada / Cambio — `pnpm-workspace.yaml` overrides (ADR-075, fuente única)

| Paquete | Instalada | CVE / GHSA | Sev | Pin → resuelto |
|---|---|---|---|---|
| `@opentelemetry/propagator-jaeger` | 2.8.0 | GHSA-45rx-2jwx-cxfr | HIGH | `<2.9.0`→`>=2.9.0` (2.10.0) |
| `protobufjs` | 7.6.4 | CVE-2026-59877 | MED | `<7.6.5`→`>=7.6.5 <8` (7.6.5) |
| `hono` | 4.12.25 | CVE-2026-59895/896/897 | MED | `<4.12.27`→`>=4.12.27` (4.12.31) |
| `@hono/node-server` | 1.19.14 | GHSA-frvp-7c67-39w9 | MED | `<2.0.5`→`>=2.0.5` (2.0.11) |

`pnpm-lock.yaml` regenerado con Corepack/pnpm 10.34.4.

**Nota major bump** `@hono/node-server` 1→2: el advisory es *path traversal en `serve-static` solo
en Windows* (`%5C`); Booster corre en Cloud Run (Linux) y `apps/api` usa `serve()` (no
`serveStatic`). No hay fix en la línea 1.x → el pin exige 2.x. Verificado que NO rompe (typecheck
+ 1733 tests + build del api verdes con 2.0.11).

## Salidas / Criterios de éxito (todos verificados)

1. `pnpm audit --audit-level=high --prod` → **0 HIGH/CRITICAL**.
2. `trivy fs . --ignore-unfixed` (todas las severidades, = el gate CI) → **0 vulns fixables**.
3. `pnpm typecheck` → **32/32**. `pnpm test` → **31/31** (api 1733, web 1175). Build api ok.
4. Diff acotado a `pnpm-workspace.yaml` + `pnpm-lock.yaml` (+ este spec). Cero código de app.

## Fuera de alcance

Fix del bug de scope del gate Trivy (`limit-severities-for-sarif: true` en `security.yml`) —
requiere aprobación de quality-gate; queda como deuda con issue. Los 8 moderate de OTel restantes
si aplicara (no fixables / no gatean).
