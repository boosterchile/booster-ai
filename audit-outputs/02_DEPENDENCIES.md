# 02 — Auditoría de Dependencias

**Subagent**: `dependency-auditor`
**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Generado**: 2026-05-19T02:53Z
**Modo**: read-only (sin `pnpm install/add/update`)
**Stack ground-truth**: ADR-001 (`docs/adr/001-stack-selection.md`)
**Métodos**:
- `pnpm audit --json` (full) → `/tmp/pnpm_audit.json` (12 235 bytes)
- `pnpm audit --json --prod` (prod-only) → exit 0, 0 vulns en 611 deps prod
- `pnpm outdated --recursive --format json` → `/tmp/pnpm_outdated.json` (31 516 bytes)
- Lectura directa de los 33 `package.json` del workspace
- `grep` recursivo de `from '<pkg>'` / `require('<pkg>')` en `apps/**/src` y `packages/**/src` para uso real
- `npm view <pkg> time.modified deprecated` (sample 22 pkgs sospechosos)

**Resumen ejecutivo**:
- **Total deps únicas declaradas (third-party)**: 83 paquetes
- **Total deps resueltas (lockfile)**: 1 384 (incluye transitivas)
- **Vulnerabilidades prod**: **0** (info/low/moderate/high/critical = 0/0/0/0/0)
- **Vulnerabilidades dev**: 2 moderate, 0 high/critical
- **Stack ADR-001**: 100 % canónico, **0 dependencias legacy prohibidas** (sin Express, Prisma, ESLint, Prettier, react-router-dom, Next.js)
- **Drift de versiones cross-workspace**: 1 caso (`google-auth-library` v9 vs v10)
- **Mayor riesgo**: GHSA-58qx-3vcg-4xpx en `ws@8.20.0` transitivo vía `jsdom` (33 paths) — mitigable con un `pnpm update ws` o `overrides`

---

## 1. Inventario por workspace

### 1.1 Root (`@booster-ai/monorepo`)

| Paquete | Versión | Tipo |
|---|---|---|
| `@biomejs/biome` | ^1.9.4 | dev |
| `@changesets/cli` | ^2.27.11 | dev |
| `@commitlint/cli` | ^19.6.1 | dev |
| `@commitlint/config-conventional` | ^19.6.0 | dev |
| `husky` | ^9.1.7 | dev |
| `lint-staged` | ^15.4.3 | dev |
| `turbo` | ^2.9.8 | dev |
| `typescript` | ^5.8.2 | dev |

### 1.2 Apps (9)

#### `apps/api` — Backend principal Hono
**Prod (32)**: 13 workspace + `@google-cloud/{kms,pubsub,storage}`, `@hono/node-server`, `@hono/zod-validator`, 6× `@opentelemetry/*`, 3× `@signpdf/*`, `drizzle-orm`, `firebase-admin`, `google-auth-library` (^10.6.2), `googleapis`, `hono`, `ioredis`, `node-forge`, `pdf-lib`, `pg`, `pino`, `pino-http`, `web-push`, `zod`
**Dev (8)**: `@types/{node,pg,web-push}`, `@vitest/coverage-v8`, `drizzle-kit`, `tsup`, `tsx`, `typescript`, `vitest`

#### `apps/web` — PWA multi-rol
**Prod (15)**: 2 workspace + `@hookform/resolvers`, `@tanstack/react-query`, `@tanstack/react-router`, `@tremor/react`, `@vis.gl/react-google-maps`, `clsx`, `firebase`, `idb`, `lucide-react`, `react`, `react-dom`, `react-hook-form`, `tailwind-merge`, `zod`, `zustand`
**Dev (25)**: axe + playwright + tailwind + testing-library + 6× workbox + vite stack

#### `apps/matching-engine`
Prod: 3 workspace. Dev: vitest/tsup/tsx/typescript/@types/node.

#### `apps/telemetry-tcp-gateway`
Prod (9): 4 workspace + `@google-cloud/pubsub`, `drizzle-orm`, `pg`, `pino`, `zod`. Dev: estándar.

#### `apps/telemetry-processor`
Prod (10): 4 workspace + `@google-cloud/{bigquery,pubsub,storage}`, `drizzle-orm`, `pg`, `pino`, `zod`. Dev: estándar.

#### `apps/notification-service`
Prod: 3 workspace solamente. Dev: estándar.

#### `apps/whatsapp-bot`
Prod (10): 4 workspace + `@hono/node-server`, `google-auth-library` (^9.15.0 ← drift), `hono`, `ioredis`, `pino`, `xstate`, `zod`. Dev: estándar.

#### `apps/document-service`
Prod: 3 workspace solamente. Dev: estándar.

#### `apps/sms-fallback-gateway`
Prod (9): 3 workspace + `@google-cloud/pubsub`, `@hono/node-server`, `@hono/zod-validator`, `hono`, `pino`, `zod`. Dev: estándar.

### 1.3 Packages (21)

| Package | Prod deps | Notas |
|---|---|---|
| `shared-schemas` | `zod` | |
| `config` | `zod` | |
| `dte-provider` | `zod` | |
| `logger` | `pino` (+ devdep `pino-pretty`) | |
| `whatsapp-client` | workspace `logger` | |
| `certificate-generator` | `@google-cloud/{kms,storage}`, 3× `@signpdf/*`, `node-forge`, `pdf-lib` | |
| `ai-provider`, `carbon-calculator`, `carta-porte-generator`, `coaching-generator`, `codec8-parser`, `document-indexer`, `driver-scoring`, `factoring-engine`, `matching-algorithm`, `notification-fan-out`, `pricing-engine`, `trip-state-machine`, `ui-components`, `ui-tokens` | ∅ (zero runtime deps) | Funciones puras / lógica de dominio según CLAUDE.md |

### 1.4 Scripts (2)
- `scripts/load-test`: `@booster-ai/codec8-parser` + tsx/typescript/@types/node
- `scripts/repo-checks`: vitest/typescript/@types/node + coverage-v8

---

## 2. Drift de versiones

**Metodología**: extraer `(workspace, package, version, type)` de los 33 `package.json`, agrupar por `package` y filtrar grupos con >1 versión distinta declarada (excluyendo `workspace:*`).

**Hallazgos**: **1 caso**.

| Paquete | Versión A | Workspace A | Versión B | Workspace B | Severidad |
|---|---|---|---|---|---|
| `google-auth-library` | `^10.6.2` | `@booster-ai/api` | `^9.15.0` | `@booster-ai/whatsapp-bot` | Media: major-version split → pnpm hoist puede instalar ambos, duplicando bundle y exponiendo a divergencia de comportamiento OAuth. **Acción**: alinear ambos a `^10.6.2` (la última estable v10 ya está en lock para api). |

Todas las demás versiones third-party están alineadas (todas las apps que usan `pino` declaran `^9.5.0`, todas las que usan `hono` declaran `^4.12.18`, etc.). El paquete `@types/node` está alineado en `^22.14.0` en los 19 workspaces que lo declaran.

---

## 3. Vulnerabilidades

### 3.1 Vista de prod-only

`pnpm audit --json --prod` → **0 hallazgos** en 611 deps de producción (info/low/moderate/high/critical = 0/0/0/0/0). Cumple política "Cero deuda day 0" para runtime.

### 3.2 Vista completa (incl. dev)

| Severidad | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Moderate | 2 |
| Low | 0 |

#### Moderate #1 — `ws` Uninitialized memory disclosure

- **CVE/GHSA**: [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx) (CWE-908)
- **Advisory ID pnpm**: 1119108
- **Módulo afectado**: `ws@8.20.0` (vulnerable: `>=8.0.0 <8.20.1`)
- **Fix disponible**: `ws@8.20.1`
- **Camino de explotación**: `vitest@4.1.5 → jsdom@26.1.0 → ws@8.20.0`
- **Surface**: dev-only (jsdom es env de test). 33 paths sample (presente en TODOS los workspaces que tienen `vitest` con `coverage-v8`).
- **Fix recomendado**: añadir `"overrides": { "ws": "^8.20.1" }` en root `package.json` o bumpear `jsdom` a v27+ (que ya trae ws@8.20.1).

#### Moderate #2 — `esbuild` dev-server SSRF/CORS

- **CVE/GHSA**: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) (CWE-346)
- **Advisory ID pnpm**: 1102341
- **Módulo afectado**: `esbuild@0.18.20` (vulnerable: `<=0.24.2`, patched: `>=0.25.0`)
- **Camino**: `apps/api > drizzle-kit@0.31.10 > @esbuild-kit/esm-loader@2.6.5 > @esbuild-kit/core-utils@3.3.2 > esbuild@0.18.20`
- **Surface**: dev-only. `drizzle-kit` solo se ejecuta en migraciones locales/CI; el dev-server vulnerable de esbuild no se expone en runtime. `@esbuild-kit/*` está deprecated por el propio autor (issue conocido en drizzle-kit).
- **Fix recomendado**: bumpear `drizzle-kit` a `^0.32.x` cuando salga (corta la cadena `@esbuild-kit/*`). Workaround: `"overrides": { "esbuild": "^0.25.0" }`.

### 3.3 Comentario sobre política

Ambos hallazgos son **dev-only** y no violan la política "Cero deuda day 0" para deps de producción. Ningún path llega a un artefacto desplegado (Cloud Run / GKE). Aún así, se recomienda fix antes de TRL 10 para auditoría externa.

---

## 4. Deps no usadas

**Metodología**: para cada `package.json`, buscar en su propio directorio (excluyendo `node_modules`/`dist`) `from '<pkg>'` o `require('<pkg>')` con `--include='*.{ts,tsx,js,jsx,mjs,cjs}'`. Si 0 matches → flag.

| Workspace | Paquete declarado | Severidad | Verificación adicional |
|---|---|---|---|
| `@booster-ai/api` | `@opentelemetry/api` | Alta | externalizado en `tsup.config.ts` pero **0 imports en src/**; no hay preload (`--require`/`--import`) en Dockerfile ni en `scripts.start`. Probablemente código de instrumentación nunca cableado. |
| `@booster-ai/api` | `@opentelemetry/auto-instrumentations-node` | Alta | mismo análisis |
| `@booster-ai/api` | `@opentelemetry/exporter-trace-otlp-http` | Alta | mismo análisis |
| `@booster-ai/api` | `@opentelemetry/resources` | Alta | mismo análisis |
| `@booster-ai/api` | `@opentelemetry/sdk-node` | Alta | mismo análisis |
| `@booster-ai/api` | `@opentelemetry/semantic-conventions` | Alta | mismo análisis |
| `@booster-ai/api` | `pino-http` | Media | externalizado pero sin imports en src/. Logging HTTP probablemente hecho manualmente vía `@booster-ai/logger`. |
| `@booster-ai/sms-fallback-gateway` | `@hono/zod-validator` | Media | sin imports |
| `@booster-ai/sms-fallback-gateway` | `pino` | Baja | logging vía `@booster-ai/logger` (que ya trae pino); decl. directa redundante |
| `@booster-ai/telemetry-processor` | `pino` | Baja | mismo: vía logger |
| `@booster-ai/telemetry-tcp-gateway` | `pino` | Baja | mismo: vía logger |
| `@booster-ai/whatsapp-bot` | `pino` | Baja | mismo: vía logger |
| `@booster-ai/web` | `clsx` | Media | 0 imports en `src/`; solo mención en un comentario CSS |
| `@booster-ai/web` | `idb` | Alta | 0 imports → PWA offline queue declarada en ADR-008 pero no implementada |
| `@booster-ai/web` | `tailwind-merge` | Media | 0 imports en `src/`; solo mención en comentario CSS |
| `@booster-ai/web` | `zustand` | Alta | 0 imports → state management global declarado en ADR-001 pero no usado |

**Implicación crítica**: las 6 deps `@opentelemetry/*` declaradas en `apps/api` significan que **el principio rector #6 "Observabilidad desde el primer endpoint" (CLAUDE.md) no se está cumpliendo en el código** — los paquetes están declarados pero la instrumentación no está cableada. Esto es hallazgo cross-cutting (debe correlacionarse con auditoría de `apps/api/src/main.ts` por otro subagent).

**Implicación secundaria**: `idb` + `zustand` en `apps/web` están declarados pero el offline-storage (ADR-005) y el state global (ADR-001) probablemente no están implementados.

---

## 5. Phantom imports

**Metodología**: para cada workspace, listar `from '<pkg>'` y `require('<pkg>')` en `src/`, `test/`, `tests/`; comparar contra `dependencies+devDependencies+peerDependencies`. pnpm strict-resolution debería atrapar phantoms pero validamos manualmente.

| Workspace | Símbolo | Análisis |
|---|---|---|
| `@booster-ai/api` | `k6`, `k6/http` | **Falso positivo**: `apps/api/test/load/smoke.k6.js` es script DSL ejecutado por el CLI `k6` (load testing tool, no es módulo Node). El comando `pnpm run load-test:smoke` invoca `k6 run …`, no `node`. ADR-047 (`k6` como load testing tool) lo confirma. **Acción**: 0. |
| `@booster-ai/carbon-calculator`, `certificate-generator`, `coaching-generator`, `codec8-parser`, `driver-scoring`, `matching-algorithm`, `ui-tokens` | self-import (e.g. `@booster-ai/carbon-calculator`) | **Falso positivo**: imports en sus propios `test/` con el nombre canónico para validar barrel exports. pnpm resuelve via `workspace:*` implícito. **Acción**: 0. |

**Phantoms reales**: **0 hallazgos**. La estricta resolución de pnpm 9 está funcionando.

---

## 6. Deps deprecadas / sin mantenimiento

**Metodología**: `npm view <pkg> time.modified deprecated` sobre 22 deps de mayor riesgo (no se audita el universo de transitivas — fuera de alcance del subagent y deferred a auditor de tooling). Umbral: último release > 12 meses desde 2026-05-18 → corte 2025-05-18.

| Paquete | Último release | Workspaces afectados | Estado | Acción |
|---|---|---|---|---|
| `pdf-lib` | 2022-05-12 (**4 años**) | `apps/api`, `packages/certificate-generator` | Sin deprecation oficial pero `pdf-lib` está en modo maintenance — issues abiertos > 200, sin commits desde 2022. Riesgo serio para `certificate-generator` (firma de PDF legal Chile). | **Evaluar alternativa** (`pdfme`, `hummus-recipe`, o `pdf-lib-with-encrypt` fork) antes de TRL 10. |
| `web-push` | 2024-01-16 (**16 meses**) | `apps/api` | Sin deprecation pero maintenance lento. Estándar VAPID está estable (ADR-016) → riesgo bajo. | Marcar para revisión semestral. |
| `@tremor/react` | 2025-01-13 (**16 meses**) | `apps/web` | Tremor cambió a modelo "tremor.so blocks" y el paquete npm clásico parece desatendido. | Auditar Roadmap antes de Wave 4 UI. |
| `@hookform/resolvers` | 2025-09-14 (8 meses ✓ no stale) — pero declarado en `^3.10.0` mientras existe `5.2.2` | `apps/web` | **No stale por fecha** pero **2 major behind**. | Bump a `^5.x` cuando se hace migración react-hook-form. |
| `clsx`, `lucide-react`, `tailwind-merge`, `idb`, `@signpdf/*` | Todos < 12 meses (2025-06 a 2026-04) | varios | ✓ Activos | sin acción |

**Deps explícitamente deprecadas (`deprecated: <string>`)**: **0 hallazgos directos** en las 22 sampleadas. Note: `@esbuild-kit/*` (transitivo vía `drizzle-kit`) está deprecated por el autor (ver §3.2 esbuild) — pero no es dep declarada en nuestros `package.json`.

---

## 7. Verificación stack ADR-001

### 7.1 Stack canónico — debe estar PRESENTE

| Pieza ADR-001 | Esperado | Encontrado | OK |
|---|---|---|---|
| Runtime Node 22 LTS | `engines.node >=22` | `>=22.0.0` (root) | ✓ |
| pnpm 9 | `packageManager: pnpm@9.x` | `pnpm@9.15.4` | ✓ |
| Turborepo | `turbo` en root | `turbo@^2.9.8` | ✓ |
| TypeScript 5.8+ | `typescript ^5.8.2` en todos | declarado en 32 workspaces | ✓ |
| Biome 1.9 | `@biomejs/biome` en root | `^1.9.4` | ✓ (major behind: latest 2.4.15 — ver §2/§3) |
| Hono 4 | `hono ^4.x` | `^4.12.18` en api/sms/whatsapp-bot | ✓ |
| Drizzle ORM | `drizzle-orm` | `^0.45.2` en api/telemetry-processor/tcp-gateway | ✓ |
| `pg` | `pg ^8.x` | `^8.13.1` en 3 apps | ✓ |
| Zod | `zod` | `^3.25.76` en 9 workspaces | ✓ |
| Pino | `pino` directa + via logger | logger usa `pino@^9.5.0` | ✓ |
| Vitest | unit + integration | `vitest@^4.0.18` en 29 workspaces | ✓ |
| Playwright | `@playwright/test` en web | `^1.49.1` | ✓ |
| React 18 | `react ^18.3.1` + `react-dom` | `^18.3.1` en web | ✓ |
| Vite 6 + PWA | `vite ^6.x` + `vite-plugin-pwa` | `vite@^6.2.0` + `vite-plugin-pwa@^0.21.1` | ✓ |
| TanStack Router | `@tanstack/react-router` | `^1.169.2` en web | ✓ |
| TanStack Query | `@tanstack/react-query` | `^5.100.9` en web | ✓ |
| Tailwind 4 | `tailwindcss ^4` | `^4.0.0` + `@tailwindcss/vite` | ✓ |
| `react-hook-form` + Zod resolver | ambos | `^7.75.0` + `@hookform/resolvers ^3.10.0` | ✓ |
| Workbox (PWA) | workbox-* en web | 6 paquetes `^7.3.0` | ✓ |
| Firebase Auth (client) | `firebase` en web | `^12.10.0` | ✓ |
| Firebase Admin (server) | `firebase-admin` en api | `^13.7.0` | ✓ |
| `@vis.gl/react-google-maps` | en web | `^1.5.0` | ✓ |
| XState | en `whatsapp-bot` y/o `trip-state-machine` | `^5.31.0` en whatsapp-bot | ✓ parcial (ver Anomalías) |
| OpenTelemetry SDK | en backend | declarado en api **pero no usado en src/** (ver §4) | ⚠️ |
| ioredis | `ioredis` | `^5.4.2` en api/whatsapp-bot | ✓ |
| `@google-cloud/{pubsub,storage,kms,bigquery}` | varios apps | todos presentes | ✓ |
| `@signpdf/*` + `node-forge` + `pdf-lib` (Carta Porte ADR-007) | certificate-generator | todos presentes | ✓ |
| `xstate` en `trip-state-machine` (ADR-004) | esperado | **AUSENTE** — `packages/trip-state-machine` no declara `xstate` | ❌ Anomalía |

### 7.2 Stack legacy — debe estar AUSENTE

| Pieza legacy Booster 2.0 | Esperado | Encontrado | OK |
|---|---|---|---|
| `express` | ausente | 0 ocurrencias en cualquier `package.json` ni import | ✓ |
| `prisma`, `@prisma/*` | ausente | 0 | ✓ |
| `eslint`, `eslint-*` | ausente | 0 (reemplazado por Biome) | ✓ |
| `prettier` | ausente | 0 (reemplazado por Biome) | ✓ |
| `react-router-dom` | ausente | 0 (reemplazado por TanStack Router) | ✓ |
| `next` / Next.js | ausente | 0 (reemplazado por Vite SPA + PWA) | ✓ |

**Resultado**: cero deuda legacy declarada. La reescritura greenfield se sostiene en deps.

### 7.3 Anomalías ADR-001

1. **OTel declarado pero no cableado** (§4): viola principio rector #6 de CLAUDE.md.
2. **`@booster-ai/trip-state-machine` no declara `xstate`** aunque ADR-004 lo nombra como librería base. Posibles causas: (a) usa máquinas custom sin xstate, (b) re-export de xstate vía otro paquete, (c) implementación pendiente. Hallazgo para correlacionar con auditor de código.
3. **Biome major behind**: 1.9.4 declarado vs 2.4.15 último estable. Biome 2.x cambia el formato de `biome.json` — bump intencional pendiente.

---

## 8. Top-5 acciones recomendadas

| # | Acción | Severidad | Esfuerzo | Justificación |
|---|---|---|---|---|
| **1** | **Cablear OpenTelemetry en `apps/api`** (o eliminar las 6 deps `@opentelemetry/*` si la decisión es diferir observabilidad). Mismo análisis para `pino-http`. | **Crítico** | Alto (cableo) / Bajo (remoción) | Viola principio rector #6 de CLAUDE.md. Bloqueante TRL 10 (requisito APM observability). 6 paquetes prod sin uso = ruido + atack surface inflado. |
| **2** | **Aplicar `overrides` para `ws ^8.20.1` y `esbuild ^0.25.0`** en root `package.json` (single-line fix). | Alto | Trivial (1 PR) | Elimina los 2 únicos findings moderate del audit. Lleva el repo a 0 vulnerabilidades en cualquier severidad. |
| **3** | **Alinear `google-auth-library` a `^10.6.2`** en `apps/whatsapp-bot` (hoy `^9.15.0`) — drift major. | Medio | Bajo (verificar OAuth/ADC sigue funcionando) | Único drift cross-workspace detectado. Reduce bundle size y elimina divergencia de comportamiento OAuth. |
| **4** | **Remover deps muertas en `apps/web`** (`clsx`, `idb`, `tailwind-merge`, `zustand`) — o implementar las features que las justificaban (offline queue ADR-008, state global ADR-001). | Medio | Trivial (remover) / Medio (implementar) | Coherencia entre `package.json` y código real. Reduce bundle. |
| **5** | **Evaluar alternativa a `pdf-lib`** antes de cierre TRL 10. | Medio-Alto | Alto (PoC + migración signature-aware) | Última release hace ~4 años. `certificate-generator` emite documentos legales Chile (Ley 18.290, retención 6 años). Riesgo de bug crítico sin parche upstream. |

**Notas adicionales** (no top-5 pero relevantes):
- Bump `@hookform/resolvers` de v3 a v5 cuando se haga refactor react-hook-form.
- Considerar bump `@biomejs/biome` v1 → v2 en una ventana planificada (cambio de config schema).
- `@tremor/react` requiere decisión de roadmap UI (ver ADR de dashboards si existe).
- `vitest` y `@vitest/coverage-v8` ya en 4.x — al día.

---

**Fin de 02_DEPENDENCIES.md**
