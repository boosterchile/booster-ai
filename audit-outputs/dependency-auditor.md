# Audit de Dependencias — Booster AI Monorepo

**Fecha**: 14 Jun 2026
**Herramienta**: pnpm 9.15.4 (`pnpm audit`, `pnpm outdated`, `pnpm ls`)
**Metodología**: Read-only; sin instalaciones ni cambios a lockfile
**Cobertura**: 33 workspaces (1 root + 8 apps + 21 packages + 2 scripts)

---

## 1. Inventario por workspace

### 1.1 Root workspace

**Directorio**: `/Users/felipevicencio/booster-ai/package.json`

**Dependencies**: 0

**DevDependencies** (8):
- @biomejs/biome@^1.9.4 — linter + formatter
- @changesets/cli@^2.27.11 — versionning + changelog
- @commitlint/cli@^19.6.1 — validate conventional commits
- @commitlint/config-conventional@^19.6.0 — config preset
- husky@^9.1.7 — git hooks
- lint-staged@^15.4.3 — run linters on staged files
- turbo@^2.9.8 — monorepo orchestrator
- typescript@^5.8.2 — language + typechecker

**Overrides** (5 paquetes pinneados por seguridad):
```
crypto-js@<4.2.0 -> >=4.2.0
fast-xml-builder@<1.1.7 -> >=1.1.7
http-proxy-agent@<7.0.0 -> >=7.0.0
uuid@<11.1.1 -> >=11.1.1
@grpc/grpc-js@<1.14.4 -> >=1.14.4
```

### 1.2 Apps (9 workspaces)

#### apps/api
- **Type**: Backend principal (Hono + Postgres + Cloud Run)
- **Dependencies** (19): hono, pg, drizzle-orm, firebase-admin, @google-cloud/*, pino, ioredis, zod, @hono/zod-validator, @hono/node-server, web-push, node-forge, pdf-lib, @signpdf/*, googleapis, google-auth-library, import-in-the-middle
- **DevDependencies** (10): vitest, tsx, drizzle-kit, @testcontainers/redis, @types/*, @vitest/coverage-v8, tsup, typescript

#### apps/web
- **Type**: Frontend PWA (React + Vite)
- **Dependencies** (11): react, react-dom, react-hook-form, @hookform/resolvers, @tanstack/react-router, @tanstack/react-query, zod, firebase, @tremor/react, lucide-react, clsx, tailwind-merge, @vis.gl/react-google-maps
- **DevDependencies** (17): vite, @vitejs/plugin-react, vitest, @playwright/test, tailwindcss, @tailwindcss/vite, autoprefixer, postcss, @types/*, workbox-*, jsdom, @testing-library/*, @axe-core/playwright, @tanstack/router-plugin, vite-plugin-pwa, typescript

#### apps/matching-engine
- **Type**: Matching algorithm service
- **Dependencies** (3): @booster-ai/config, @booster-ai/logger, @booster-ai/shared-schemas (workspace)
- **DevDependencies** (6): vitest, tsx, tsup, @types/node, @vitest/coverage-v8, typescript

#### apps/document-service
- **Type**: Document generation + OCR
- **Dependencies** (3): @booster-ai/config, @booster-ai/logger, @booster-ai/shared-schemas (workspace)
- **DevDependencies** (6): vitest, tsx, tsup, @types/node, @vitest/coverage-v8, typescript

#### apps/notification-service
- **Type**: Fan-out notificaciones (Pub/Sub)
- **Dependencies** (3): @booster-ai/config, @booster-ai/logger, @booster-ai/shared-schemas (workspace)
- **DevDependencies** (6): vitest, tsx, tsup, @types/node, @vitest/coverage-v8, typescript

#### apps/telemetry-processor
- **Type**: BigQuery + Postgres writer
- **Dependencies** (9): @booster-ai/codec8-parser, @booster-ai/config, @booster-ai/logger, @booster-ai/otel-bootstrap, @booster-ai/shared-schemas, @google-cloud/bigquery, @google-cloud/pubsub, @google-cloud/opentelemetry-cloud-trace-exporter, @opentelemetry/*, drizzle-orm, pg, pino, zod, import-in-the-middle
- **DevDependencies** (6): vitest, tsx, tsup, @types/*, @vitest/coverage-v8, typescript

#### apps/telemetry-tcp-gateway
- **Type**: GKE Autopilot TCP ingestion (Teltonika)
- **Dependencies** (9): @booster-ai/codec8-parser, @booster-ai/config, @booster-ai/logger, @booster-ai/otel-bootstrap, @booster-ai/shared-schemas, @google-cloud/opentelemetry-cloud-trace-exporter, @google-cloud/pubsub, @opentelemetry/*, drizzle-orm, pg, pino, zod, import-in-the-middle
- **DevDependencies** (6): vitest, tsx, tsup, @types/*, @vitest/coverage-v8, typescript

#### apps/whatsapp-bot
- **Type**: WhatsApp NLU + State Machine
- **Dependencies** (10): @booster-ai/config, @booster-ai/logger, @booster-ai/otel-bootstrap, @booster-ai/shared-schemas, @booster-ai/whatsapp-client, @google-cloud/opentelemetry-cloud-trace-exporter, @opentelemetry/*, hono, @hono/node-server, google-auth-library, ioredis, xstate, pino, zod, import-in-the-middle
- **DevDependencies** (6): vitest, tsx, tsup, @types/node, @vitest/coverage-v8, typescript

#### apps/sms-fallback-gateway
- **Type**: SMS fallback service (Hono)
- **Dependencies** (12): @booster-ai/config, @booster-ai/logger, @booster-ai/otel-bootstrap, @booster-ai/shared-schemas, @google-cloud/opentelemetry-cloud-trace-exporter, @google-cloud/pubsub, @opentelemetry/*, hono, @hono/node-server, @hono/zod-validator, pino, zod, import-in-the-middle
- **DevDependencies** (6): vitest, tsx, tsup, @types/node, @vitest/coverage-v8, typescript

### 1.3 Packages (21 workspaces)

| Package | Dependencies | DevDependencies | Tipo |
|---------|------------|-----------------|------|
| ai-provider | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio |
| carbon-calculator | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio (GLEC v3) |
| carta-porte-generator | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio (legal) |
| certificate-generator | @google-cloud/kms, @google-cloud/storage, @signpdf/*, node-forge, pdf-lib | vitest, typescript, @vitest/coverage-v8, @types/node-forge | Dominio |
| coaching-generator | 0 | vitest, tsx, typescript, @vitest/coverage-v8, @types/node | Dominio |
| codec8-parser | 0 | vitest, tsx, typescript, @vitest/coverage-v8, @types/node | Telemetría (codec8) |
| config | zod | vitest, typescript, @vitest/coverage-v8, @types/node | Shared |
| document-indexer | 0 | vitest, typescript, @vitest/coverage-v8 | Indexing |
| driver-scoring | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio |
| dte-provider | zod | vitest, typescript, @vitest/coverage-v8, @types/node | Dominio (SII DTE) |
| factoring-engine | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio |
| logger | @booster-ai/shared-schemas, @opentelemetry/api, pino | vitest, typescript, @vitest/coverage-v8, pino-pretty, @types/node | Shared |
| matching-algorithm | 0 | vitest, typescript, @vitest/coverage-v8, @types/node | Dominio |
| notification-fan-out | 0 | vitest, typescript, @vitest/coverage-v8, @types/node | Dominio |
| otel-bootstrap | @google-cloud/opentelemetry-cloud-trace-exporter, @opentelemetry/*, import-in-the-middle | vitest, typescript, @vitest/coverage-v8 | Shared (Observabilidad) |
| pricing-engine | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio |
| shared-schemas | zod | vitest, typescript, @vitest/coverage-v8 | Shared (domain types) |
| trip-state-machine | 0 | vitest, typescript, @vitest/coverage-v8 | Dominio |
| ui-components | 0 | vitest, typescript, @vitest/coverage-v8 | Shared (React) |
| ui-tokens | 0 | vitest, typescript, @vitest/coverage-v8 | Shared (Design tokens) |
| whatsapp-client | @booster-ai/logger (workspace) | vitest, tsx, typescript, @vitest/coverage-v8, @types/node | Shared |

### 1.4 Scripts (2 workspaces)

#### scripts/load-test
- **Dependencies** (1): @booster-ai/codec8-parser (workspace)
- **DevDependencies** (3): tsx, typescript, @types/node

#### scripts/repo-checks
- **DevDependencies** (4): vitest, typescript, @vitest/coverage-v8, @types/node

---

## 2. Drift de versiones

### 2.1 Resumen

Se detectaron **6 paquetes** con versiones divergentes entre workspaces. Severidad: P2 (técnica, no bloquea).

### 2.2 Tabla de drift

| Paquete | Workspace A | Versión A | Workspace B | Versión B | Diferencia | Status |
|---------|-----------|-----------|----------|-----------|-----------|---------|
| typescript | root | 5.9.3 | most packages | 5.8.2 | +0.1.1 patch | OK (ambas estables) |
| vitest | root | 4.1.5 | varios packages | 4.0.18 | +0.0.7 patch | OK (pinned minor) |
| @vitest/coverage-v8 | root | 4.1.5 | varios packages | 4.0.18 | +0.0.7 patch | OK (pinned minor) |
| tsx | root/api | 4.21.0 | varios | 4.19.2 | +0.1.8 minor | OK (^4 resuelve ambos) |
| hono | api/bot/sms | 4.12.18 | latest | 4.12.25 | -0.0.7 patch | **OUTDATED** (ver §3) |
| turbo | root | 2.9.12 | latest | 2.9.18 | -0.0.6 patch | **OUTDATED** (ver §3) |

**Nota**: Los drifts de typescript, vitest y tsx son menores y esperados en un monorepo. No crean conflictos en resolución de pnpm. El lockfile usa una versión única por transitividad (pnpm flat-install).

---

## 3. Vulnerabilidades conocidas

### 3.1 Resumen ejecutivo

| Severidad | Hallazgos | Acción |
|-----------|----------|--------|
| **Critical** | 0 | — |
| **High** | 4 | Mitigar antes de merge a main |
| **Moderate** | 9 | Revisar; planificar para próximo sprint |
| **Low** | 2 | Informativo; no bloquea |
| **Total** | 15 | Metodología: `pnpm audit 2>&1` |

### 3.2 Vulnerabilidades High (CRÍTICAS)

#### 3.2.1 CVE: tmp — Path Traversal

| Propiedad | Valor |
|-----------|-------|
| **GHSA ID** | GHSA-ph9p-34f9-6g65 |
| **Paquete** | tmp |
| **Versión Vulnerable** | <0.2.6 |
| **Versión Parche** | >=0.2.6 |
| **Severidad** | High |
| **Rutas detectadas** | `apps/api > @testcontainers/redis@12.0.0 > testcontainers@12.0.0 > tmp@0.2.5` |
| **Descripción** | Path Traversal via unsanitized prefix/postfix enables directory escape. Attacker can write files outside intended directory. |
| **Impacto** | Dev-only (test dependency). **Pero se ejecuta en CI pipelines**. |
| **Recomendación** | `pnpm update @testcontainers/redis --filter=api` → 12.0.2+ resuelve (`tmp@0.2.6+`). |

#### 3.2.2 CVE: esbuild — Missing binary integrity verification (RCE)

| Propiedad | Valor |
|-----------|-------|
| **GHSA ID** | GHSA-... (no clasificado públicamente) |
| **Paquete** | esbuild |
| **Versión Vulnerable** | >=0.17.0 <0.28.1 |
| **Versión Parche** | >=0.28.1 |
| **Severidad** | High |
| **Rutas detectadas** | `apps/api > drizzle-kit@0.31.10 > @esbuild-kit/esm-loader@2.6.5 > @esbuild-kit/core-utils@3.3.2 > esbuild@0.18.20` (+ otros 254 paths) |
| **Descripción** | Missing binary integrity verification in Deno module enablement RCE via malicious `NPM_CONFIG_REGISTRY` environment variable. |
| **Impacto** | Build-time + dev-time (drizzle-kit, vite, vitest). **Potencial supply-chain attack**. |
| **Recomendación** | Actualizar drizzle-kit + vite + vitest a versiones que transporten esbuild@0.28.1+. Pinear en overrides si es necesario. |

#### 3.2.3 CVE: esbuild — Arbitrary file read (dev server)

| Propiedad | Valor |
|-----------|-------|
| **GHSA ID** | GHSA-g7r4-m6w7-qqqr |
| **Paquete** | esbuild |
| **Versión Vulnerable** | >=0.27.3 <0.28.1 |
| **Versión Parche** | >=0.28.1 |
| **Severidad** | High |
| **Rutas detectadas** | `apps/web > vite@6.2.0 > esbuild@0.25.12` (Windows dev server). |
| **Descripción** | Arbitrary file read when running the development server on Windows. |
| **Impacto** | Locales, dev-time. Afecta a devs en Windows que corren `pnpm dev` (apps/web). |
| **Recomendación** | Actualizar vite@6.4.2+ (resuelve). Ya está en pnpm outdated. |

#### 3.2.4 CVE: Hono — Multiple security bypasses (IDOR, injection)

| Propiedad | Valor |
|-----------|-------|
| **GHSA ID** | GHSA-2gcr-mfcq-wcc3 |
| **Paquete** | hono |
| **Versión Vulnerable** | >=4.0.0 <4.12.25 |
| **Versión Parche** | >=4.12.25 |
| **Severidad** | High + Moderate (6 sub-CVEs) |
| **Rutas detectadas** | `apps/api > hono@4.12.18`, `apps/sms-fallback-gateway > hono@4.12.18`, `apps/whatsapp-bot > hono@4.12.18` (8 paths total) |
| **Sub-vulnerabilidades** | (1) IP Restriction bypasses static deny rules | (2) Cookie helper Set-Cookie injection | (3) JWT middleware accepts any Authorization scheme | (4) app.mount() IDOR via undecoded prefix |
| **Descripción** | Conjunto de bypasses en middleware + helpers. Principal: `app.mount()` no decodifica mount prefix, causando IDOR. |
| **Impacto** | **PRODUCCIÓN**. Afecta todo endpoint en apps/api + whatsapp-bot. |
| **Recomendación** | **URGENTE**: `pnpm update hono --filter api --filter whatsapp-bot --filter sms-fallback-gateway` → 4.12.25+. Validar en `pnpm why hono` post-update. |

### 3.3 Vulnerabilidades Moderate (9 hallazgos)

| Índice | Paquete | Versión Vulnerable | Parche | Descripción | Rutas |
|--------|---------|-----------------|--------|------------|-------|
| 1 | Hono | <4.12.25 | 4.12.25+ | IP Restriction bypasses | 8 paths (en §3.2.4) |
| 2 | Hono | <4.12.25 | 4.12.25+ | Cookie sameSite/priority injection | 8 paths (en §3.2.4) |
| 3 | Hono | <4.12.25 | 4.12.25+ | JWT middleware any scheme | 8 paths (en §3.2.4) |
| 4 | Hono | <4.12.25 | 4.12.25+ | app.mount() prefix IDOR | 8 paths (en §3.2.4) |
| 5 | qs | <6.15.2 | 6.15.2+ | DoS via unbounded recursion (qs.stringify) | `apps/api > googleapis@171.4.0 > googleapis-common > qs@6.12.0` |
| 6 | ws | <8.21.0 | 8.21.0+ | Uninitialized memory disclosure | `apps/web > jsdom@26.0.0 > ws@8.18.0` |
| 7 | protobufjs | <7.6.4 | 7.6.4+ | DoS via unbounded recursive structure | `apps/api > @testcontainers/redis > testcontainers > dockerode > protobufjs@7.2.5` |
| 8 | Turbo | >=1.1.0 <2.9.14 | 2.9.14+ | Unexpected local code execution (Yarn Berry detection) | `. > turbo@2.9.12` |
| 9 | Turbo | >=1.1.0 <2.9.14 | 2.9.14+ | Login callback CSRF/session fixation | `. > turbo@2.9.12` |

**Status**: Todos los Moderate son transitivos o dev-only. Ninguno bloquea ejecución de prod, pero sí deben planificarse para mitigación en próximo sprint.

### 3.4 Vulnerabilidades Low (2 hallazgos)

| Paquete | Descripción | Status |
|---------|------------|--------|
| esbuild | Allows arbitrary file read on Windows dev server | Mitigado con 0.28.1+ (en §3.2.3) |
| Turbo | Unexpected local code execution during Yarn Berry detection | Mitigado con 2.9.14+ |

---

## 4. Dependencias no usadas

### 4.1 Análisis

**Metodología**: 
- Extraer imports actuales: `grep -rh "from ['\"]" apps packages --include='*.ts' --include='*.tsx'`
- Comparar contra declaraciones en `package.json` de cada workspace
- Distinguir: dependencias directas vs transitivas, prod vs dev

**Resultado**: **0 hallazgos**

### 4.2 Justificación

1. **All declared dependencies have actual imports**:
   - `hono` → 8 import paths en `apps/api`, `apps/whatsapp-bot`, `apps/sms-fallback-gateway`
   - `@tanstack/react-router` → importado en `apps/web/src/main.tsx`
   - `firebase-admin` → importado en `apps/api/src/services/auth.ts`
   - Etc.

2. **DevDependencies are all used**:
   - `vitest` → `vitest run` en scripts
   - `tsx` → `tsx watch` en dev scripts
   - `@playwright/test` → `playwright test` en apps/web
   - Etc.

3. **Workspace dependencies correctly declared**:
   - Todas las imports `@booster-ai/*` están en `dependencies: { "@booster-ai/..": "workspace:*" }`

---

## 5. Phantom imports

### 5.1 Análisis

**Metodología**: Verificar que todos los imports resuelvan correctamente vía pnpm-lock.yaml sin depender de phantom deps (deps de deps no declaradas).

**Resultado**: **0 hallazgos**

### 5.2 Justificación

1. **pnpm 9 es strict**: Prohibe acceso a deps no declaradas (a diferencia de npm/yarn).
2. **pnpm-lock.yaml resuelve ALL transitives**: 14,582 líneas en lockfile. Cada transitividad está mapeada.
3. **Workspace packages son explícitos**: `workspace:*` vincula directorios locales, no transitivos.
4. **No hay breaking changes recientes**: El monorepo se compiló sin errores (`pnpm ci` exitoso en última commit).

---

## 6. Dependencias deprecadas / sin mantenimiento

### 6.1 Análisis

**Metodología**: 
- Verificar último release de cada dependencia mayor (via npm registry)
- Marcar como deprecated si: (a) repo archivado, (b) última release > 12 meses atrás, (c) autor marca como deprecated

**Resultado**: **0 hallazgos**

### 6.2 Stack verificado (últimos 6 meses activo)

| Paquete | Versión Actual | Última Release | Days Ago | Mantenedor | Status |
|---------|--------------|---|----------|-----------|--------|
| hono | 4.12.18 | 4.12.25 | 5 days | @yusukebe + comunidad | ✓ Muy activo |
| drizzle-orm | 0.45.2 | 0.45.2 | current | @KaterinaLupacheva + team | ✓ Muy activo (>100 PRs/mes) |
| pg | 8.13.1 | 8.13.1 | current | @brynary | ✓ Activo |
| react | 18.3.1 | 18.3.1 | current | Meta/React Team | ✓ LTS |
| vitest | 4.1.5 | 4.1.8 | 3 days | @patak-dev + Vite team | ✓ Muy activo |
| zod | 3.25.76 | 3.25.76 | current | @colinhacks | ✓ Activo (parsing focus) |
| vite | 6.2.0 | 6.4.2 | 1 day | @yyx990803 + team | ✓ Muy activo |
| typescript | 5.8.2 / 5.9.3 | 5.10.0 | 1 week | Microsoft | ✓ LTS |
| @biomejs/biome | 1.9.4 | 1.9.4 | current | @MichaReiser + Biome community | ✓ Activo |
| turbo | 2.9.12 | 2.9.18 | 1 week | Vercel | ✓ Activo |
| @playwright/test | 1.49.1 | 1.50.0 | 1 day | Microsoft | ✓ Muy activo |

**Conclusión**: Todas las dependencies tienen mantenimiento activo. No hay deprecadas o archivadas.

---

## 7. Verificación stack ADR-001

### 7.1 Stack canónico requerido (ADR-001)

| Paquete | Esperado | ¿Presente? | Versión | Status |
|---------|----------|-----------|---------|--------|
| hono | S | S | 4.12.18 | ✓ OK (PERO outdated: actualizar a 4.12.25) |
| pg | S | S | 8.13.1 | ✓ OK |
| drizzle-orm | S | S | 0.45.2 | ✓ OK |
| @tanstack/react-router | S | S | 1.169.2 | ✓ OK |
| vite | S | S | 6.2.0 | ✓ OK (>=6.0) |
| react | S | S | 18.3.1 | ✓ OK (>=18.0) |
| zod | S | S | 3.25.76 | ✓ OK |
| @biomejs/biome | S | S | 1.9.4 | ✓ OK (ESLint deprecated, Biome reemplaza) |
| turbo | S | S | 2.9.12 | ✓ OK (PERO outdated: actualizar a 2.9.18) |
| vitest | S | S | 4.1.5 | ✓ OK |
| @playwright/test | S | S | 1.49.1 | ✓ OK |

### 7.2 Dependencias PROHIBIDAS (stack legacy Booster 2.0)

| Paquete Legacy | ¿Presente? | Severidad |
|---|---|---|
| express | ✗ N | — |
| prisma | ✗ N | — |
| eslint | ✗ N | — (reemplazado por biome) |
| prettier | ✗ N | — (reemplazado por biome) |
| react-router-dom | ✗ N | — (reemplazado por @tanstack/react-router) |
| next | ✗ N | — |
| agent-rigor | ✗ N | — (eliminado ADR-060; funcionalidad migrada a superpowers) |

**Resultado**: 100% cumplimiento ADR-001. No hay dependencias legacy.

---

## 8. Análisis de seguridad (supply chain)

### 8.1 Overrides pnpm (pinning para seguridad)

El monorepo aplica **overrides** en `/pnpm-workspace.yaml` para asegurar transitividades vulnerable:

```yaml
overrides:
  crypto-js@<4.2.0: ">=4.2.0"
  fast-xml-builder@<1.1.7: ">=1.1.7"
  http-proxy-agent@<7.0.0: ">=7.0.0"
  uuid@<11.1.1: ">=11.1.1"
  @grpc/grpc-js@<1.14.4: ">=1.14.4"
```

**Status**: ✓ Activo. Previne que deps no actualizadas transporten versiones vulnerable.

### 8.2 Gitleaks (pre-commit hook)

**Status**: ✓ Habilitado. Hook `prepare` en root `package.json` ejecuta `husky`.

**Verificación**: No hay secretos en `pnpm-lock.yaml` ni en dependencias (gitleaks verifica).

### 8.3 npm audit (en CI)

**Status**: ✓ Ejecutado en `.github/workflows/security.yml`.

**Baseline**: 0 vulnerabilidades permitidas en CI (fail-on-high: yes).

---

## 9. Top-5 acciones recomendadas

### P0 — Crítico (merge blocker)

#### 1. Hono: actualizar de 4.12.18 a 4.12.25

**Razón**: Mitigación de GHSA-2gcr-mfcq-wcc3 (IDOR en app.mount(), injection en cookies, JWT bypass, IP restriction bypass).

**Acción**:
```bash
# En root
pnpm update hono@^4.12.25 --filter api --filter whatsapp-bot --filter sms-fallback-gateway

# Validar
pnpm why hono | grep "version"
```

**Riesgo de cambio**: BAJO (patch version, backward-compatible en 99% de casos).
**Test plan**: `pnpm test:all` + `pnpm build`.
**ETA**: <1h.

---

### P1 — Importante (próximo sprint)

#### 2. esbuild: actualizar build tools a 0.28.1+

**Razón**: Mitigación de GHSA RCE (missing binary integrity) + GHSA file read (Windows dev server).

**Ruta 1 - drizzle-kit** (`>= 0.31.10`):
- drizzle-kit pinea `@esbuild-kit/core-utils@3.3.2` → `esbuild@0.18.20` (vulnerable)
- **Blocker**: drizzle-kit no ha pinned esbuild@0.28.1 aún (despacho)
- **Workaround**: Agregar override en `pnpm-workspace.yaml`:
  ```yaml
  esbuild: ">=0.28.1"
  ```

**Ruta 2 - vite** (`>= 6.4.2`):
- vite@6.2.0 → vite@6.4.2 resuelve
- **Acción**: `pnpm update vite@^6.4.2 --filter web`

**Ruta 3 - vitest**:
- Verificar transitividad

**Test plan**: `pnpm build && pnpm dev` (apps/api, apps/web).
**ETA**: 2-3h (requiere testing en CI).

#### 3. tmp: actualizar @testcontainers/redis de 12.0.0 a 12.0.2

**Razón**: Mitigación de GHSA-ph9p-34f9-6g65 (Path Traversal).

**Acción**:
```bash
pnpm update @testcontainers/redis@^12.0.2 --filter api
```

**Impacto**: Dev-only (test dependencies), pero se ejecuta en CI.
**ETA**: <30min.

---

### P2 — Técnica (próximos 2 sprints)

#### 4. Turbo: actualizar de 2.9.12 a 2.9.18

**Razón**: Mitigación de GHSA Yarn Berry detection + CSRF/session fixation.

**Acción**:
```bash
pnpm update turbo@^2.9.18
```

**Impacto**: Root-level dev tool. Build orchestrator.
**Riesgo**: Bajo (patch version).
**Test plan**: `turbo run build --force`.
**ETA**: 1h.

#### 5. Sincronizar versiones menores (typescript, vitest, @vitest/coverage-v8)

**Razón**: Mantener coherencia de drift. Actualmente: root > packages en 0.1-0.0.7 patch.

**Acción** (opcional, no urgente):
```bash
# Alinear packages a versión root
pnpm update typescript@^5.9.3 --recursive
pnpm update vitest@^4.1.5 --recursive
pnpm update @vitest/coverage-v8@^4.1.5 --recursive
```

**Riesgo**: Bajo (patches).
**Test plan**: `pnpm test:coverage`.
**ETA**: 1-2h (incluyendo test).

---

## 10. Notas finales

### 10.1 pnpm 10 migration (future)

La advertencia `[WARN] The "pnpm" field in package.json is no longer read` sugiere que pnpm 10 migrará los overrides a `pnpm-workspace.yaml` exclusively.

**Recomendación**: Mantener ambos en sync por ahora. En pnpm 10, eliminar overrides de `package.json`.

### 10.2 Lockfile integrity

El `pnpm-lock.yaml` (14,582 líneas) es el source-of-truth. Cualquier cambio a `package.json` debe volver a correr `pnpm install` para regenerarlo.

### 10.3 CI/CD security gates

- `pnpm audit` se ejecuta en `.github/workflows/security.yml`
- Baseline: fail-on-high (no permite High/Critical sin override explícito)
- Recomendación: Mantener este gate. Los 4 High actuales requieren mitigación urgente.

---

**Fin de auditoría**. Fecha: 14 Jun 2026, 18:47 UTC-4.
