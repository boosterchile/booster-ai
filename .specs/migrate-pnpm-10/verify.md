# verify — Migración a pnpm 10

Evidencia fresca, rama `feat/migrate-pnpm-10` (base `origin/main` @ b10519c), 2026-07-18. Validación corrida con **pnpm 10.34.4 real** (corepack) + **node 24.17.0** — no con el Homebrew 9.15.4.

## 1. El WARN desapareció (criterio 1)

`corepack pnpm@10.34.4 install` → `Done in 23s using pnpm v10.34.4`. Ocurrencias de `The "pnpm" field in package.json is no longer read by pnpm`:
- en el `install`: **0**
- en toda la corrida de `pnpm ci`: **0**

## 2. Sin degradación de seguridad (criterios 2 y 3)

`corepack pnpm@10.34.4 audit --audit-level=high --prod` → **`No known vulnerabilities found`** (exit 0).

Pins antes (lockfile origin/main, pnpm 9) vs después (regenerado con pnpm 10) — **idénticos, ninguno baja**:

| override | constraint | antes | después |
|---|---|---|---|
| websocket-driver | >=0.7.5 (CVE #604) | 0.7.5 | **0.7.5** |
| qs | >=6.15.2 | 6.15.2 | **6.15.2** |
| tmp | >=0.2.6 | 0.2.7 | **0.2.7** |
| crypto-js | >=4.2.0 | 4.2.0 | **4.2.0** |
| @grpc/grpc-js | >=1.14.4 | 1.14.4 | **1.14.4** |
| form-data | >=2.5.6 | 4.0.6 | **4.0.6** |
| uuid | >=11.1.1 | 11.1.1 | **11.1.1** |
| http-proxy-agent | >=7.0.0 | 7.0.2 | **7.0.2** |
| fast-xml-builder | >=1.1.7 | 1.2.0 | **1.2.0** |
| protobufjs | >=7.6.3 <8 | 7.6.4 | **7.6.4** |
| @opentelemetry/core | >=2.8.0 | 2.8.0 | **2.8.0** |
| @opentelemetry/resources | >=2.8.0 | 2.8.0 | **2.8.0** |
| @opentelemetry/sdk-trace-base | >=2.8.0 | 2.8.0 | **2.8.0** |

`corepack pnpm@10.34.4 -r why` (versión instalada real):
```
websocket-driver@0.7.5
qs@6.15.2
tmp@0.2.7
```

El `pnpm-lock.yaml` regenerado es **byte-idéntico** al de origin/main (no aparece en `git diff`) → la resolución no cambió. Conserva la sección `overrides:` con los 13 pins; `lockfileVersion: '9.0'`.

## 3. Nada roto por la nueva resolución (criterio 4)

`pnpm ci` (lint + typecheck + test + build) con pnpm 10.34.4 + node 24.17.0 → **exit 0**:
```
typecheck: Tasks: 32 successful, 32 total
test:      Tasks: 31 successful, 31 total
build:     Tasks:  9 successful,  9 total
```
(lint = `biome check . && pnpm lint:rls` pasó primero por el `&&` del script `ci`.)

## 4. `git diff --stat`

```
 .github/workflows/ci.yml          |  2 +-
 .github/workflows/e2e-pr.yml      |  2 +-
 .github/workflows/e2e-staging.yml |  2 +-
 .github/workflows/release.yml     |  2 +-
 .github/workflows/security.yml    | 14 +++++++-------
 package.json                      | 22 ++--------------------
 (+ docs/adr/075-migracion-pnpm-10.md, .specs/migrate-pnpm-10/  — nuevos)
 (pnpm-lock.yaml y pnpm-workspace.yaml SIN cambios)
```

ADR: **075** (`docs/adr/075-migracion-pnpm-10.md`, Proposed).
