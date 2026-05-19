# CLAUDE.md (propuesto, derivado de auditoría 2026-05-19)

> **Status**: PROPUESTO — para revisión humana. **NO** sustituye al `CLAUDE.md` del repo sin aprobación explícita + ADR.
> **Origen**: derivado de convenciones empíricamente detectadas durante la auditoría `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7` + reglas inquebrantables Booster AI (CLAUDE.md actual §Principios) + comandos build/test/lint verificados contra `package.json` real.
> **Diferencias con el CLAUDE.md vigente**: corrige drift estructural detectado (Terraform tree descrito vs real, módulos faltantes), reformula reglas operativas con el patrón verificado de la implementación actual, deja explícito el contrato observabilidad (CC-1) que hoy está declarado pero no cableado.
> **Promoción al repo**: requiere ADR que supersede + PR humano. No promover automáticamente.

---

# CLAUDE.md — Contrato de trabajo del agente en Booster AI

Este documento es el **contrato de trabajo** entre Felipe Vicencio (Product Owner) y Claude (agente de desarrollo principal). Fija cómo trabaja el agente en este repo, qué decisiones puede tomar solo, cuándo pregunta, cómo documenta y cómo se valida su trabajo.

**Fecha de adopción**: 2026-04-23 (original) · revisión propuesta 2026-05-19.
**Marco de referencia**: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — Production-grade engineering skills for AI coding agents.

---

## Identidad del proyecto

- **Display name**: Booster AI
- **Slug técnico**: `booster-ai`
- **Owner humano**: Felipe Vicencio — `dev@boosterchile.com`
- **Origen**: reescritura greenfield de Booster 2.0 con cero deuda técnica desde day 0
- **Misión del producto**: Marketplace B2B de logística sostenible que conecta generadores de carga con transportistas, optimizando retornos vacíos y certificando huella de carbono bajo GLEC v3.0 / GHG Protocol / ISO 14064
- **Estado objetivo**: TRL 10 (sistema probado, certificado y listo para despliegue comercial)
- **GCP project**: `booster-ai-494222` (single project, no multi-environment Terraform — ver §Infrastructure real abajo)

---

## Principios rectores — inviolables desde el commit 1

Estos principios tienen precedencia sobre cualquier instrucción puntual. Si una instrucción contradice un principio, Claude lo señala antes de ejecutar.

### 1. Cero deuda técnica desde day 0

- **Sin `any`** en TypeScript. Biome lo prohíbe con `noExplicitAny: error`. Excepción: tests internos, documentada con comentario. **Verificado**: 4 `any` productivos detectados son adaptadores externos con `biome-ignore` justificada.
- **Sin `console.*`** en código de producción. Biome `noConsole: error`. Todo logging estructurado con `packages/logger` (Pino). Excepción: CLI dev tools en `scripts/`.
- **Sin secretos en el repo**. Ni en `.env`, ni en código, ni en documentación. Todas las credenciales via `GOOGLE_APPLICATION_CREDENTIALS` (dev local) o **Secret Manager via Terraform `infrastructure/security.tf`** (prod). Pre-commit hook con `gitleaks` lo aplica + CI workflow `security.yml`. Llaves públicas allowlisteadas explícitamente en `.gitleaks.toml`.
- **Sin features sin tests**. Coverage mínimo 80%/75%/80% (lines/branches/functions) bloqueante en CI desde el primer PR. No se mergea código sin tests que lo cubran. **Pendiente cerrar by-pass por workspaces ausentes** (R-003).
- **Sin infra manual**. Todo en Terraform, incluyendo IAM humana. Cambios a infra requieren PR.
- **Sin `.tfplan`, `.tfstate`, `.tfvars.local` en git**. `.gitignore` debe excluirlos (R-014).

### 2. Evidence over assumption

Cada afirmación técnica debe respaldarse con evidencia verificable:

- "Los tests pasan" → output de `pnpm test` pegado en el PR.
- "El deploy funciona" → URL de Cloud Run + log de health check.
- "La query es eficiente" → output de `EXPLAIN ANALYZE` o traza OpenTelemetry.
- "No hay regresiones" → diff de métricas antes/después.

Si Claude no puede generar la evidencia, **no afirma**. Dice "no validado" o "pendiente de verificar".

### 3. Process over knowledge

Este repo usa el framework de Agent Skills + agent-rigor. El agente no confía en su memoria — sigue los workflows definidos en `skills/` y los hooks de `agent-rigor` para cada operación. Cada skill tiene:

- **When to use** — condiciones de activación
- **Core process** — pasos numerados y específicos
- **Anti-rationalizations** — tentaciones comunes que el skill advierte
- **Exit criteria** — checkpoints verificables

Si una tarea no tiene un skill definido y es repetible, Claude propone crear el skill antes de ejecutar.

### 4. Decisiones en ADRs, no en conversación

Cualquier decisión arquitectónica con impacto futuro (stack, patrón, contrato público) se documenta como ADR en `docs/adr/`. Conversaciones de Slack/chat no son evidencia de decisión. Numeración linear (excepto colisiones legacy 028/034/035 documentadas en ADR-046).

### 5. Type safety end-to-end

El tipado empieza en la BD (Drizzle schema), se comparte via `packages/shared-schemas` (Zod), y llega hasta el cliente (TanStack Query types inferidos). **No hay frontera donde los tipos se pierdan**. Si aparece una frontera de tipos (ej. llamada HTTP externa sin schema), Claude crea el Zod schema antes de usar los datos.

### 6. Observabilidad desde el primer endpoint **[GAP P0 ABIERTO]**

Cada endpoint del backend y cada interacción relevante del frontend genera:

- Log estructurado con `correlationId` consistente
- Span de OpenTelemetry con contexto propagado (`@opentelemetry/sdk-node` + auto-instrumentations)
- Métrica custom si es operación de negocio (matches creados, emisiones calculadas, etc.)

No se añaden logs "después". Se añaden al momento de escribir el código.

> ⚠️ **Estado actual auditado** (2026-05-19): los 7 paquetes OTel + `pino-http` están declarados en `apps/api/package.json` pero tienen **0 imports en `src/`** y `main.ts` no preload-ea SDK Node. **R-001 P0 bloquea TRL 10** hasta cablear o emitir ADR superseding.

### 7. Seguridad por defecto

- Toda input externa pasa por validación Zod antes de tocar lógica de negocio (Hono `zValidator` + `packages/shared-schemas`).
- Toda consulta a BD usa parámetros (Drizzle los fuerza). `sql.raw` permitido solo sobre constantes hardcodeadas o SQL cargado de disco — NUNCA sobre user input.
- Toda operación server-to-server con GCP usa ADC + OAuth (nunca API keys, salvo legacy explicitado en ADR-009).
- Toda PII se redacta en logs automáticamente via Pino serializers (`packages/logger/src/redaction.ts`, ≥30 paths cubiertos).
- Pre-commit bloquea commits con patrones de secretos detectados (gitleaks + 5 stages adicionales en `.husky/pre-commit`).
- Frontend tiene security headers en nginx serving layer (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). **Estado actual**: 0 headers — R-006 P1 abierto.
- WAF Cloud Armor con opt-out granular por reglas específicas (no bypass total). **Estado actual**: bypass total para `api.boosterchile.com` — R-015 P1 abierto.

---

## Stack canónico (ADR-001 verificado 2026-05-19)

| Pieza | Versión | Notas |
|---|---|---|
| Node.js | 22 LTS | `.nvmrc=22`, `engines.node>=22.0.0`. ⚠️ CI usa 24 (drift R-004) |
| pnpm | 9.15.4 (`packageManager`) | Workspace + lockfile estricto |
| Turborepo | 2.9.8 | `turbo.json` define pipeline build/dev/lint/typecheck/test/test:coverage/test:e2e/db:migrate/clean |
| TypeScript | 5.8.2 | `tsconfig.base.json` strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Biome | 1.9.4 | `noExplicitAny=error`, `noConsole=error`, `useImportType=error`, `useNodejsImportProtocol=error` |
| Backend | Hono 4 | `@hono/node-server`. Build con `tsup` |
| DB | Cloud SQL Postgres + `pg` 8 | Drizzle ORM. Extensión activa: `pgcrypto` (NO `pgvector` actualmente) |
| Frontend | React 18 + Vite 6 + @tanstack/react-router | Routing manual hoy (no file-based aunque plugin instalado) |
| Frontend libs | TanStack Query, react-hook-form, zod, Tremor, lucide-react, Firebase, workbox, idb*, zustand* | *declarados sin uso real |
| PWA | `vite-plugin-pwa` + Workbox `InjectManifest` + SW custom | ADR-008 |
| Auth | Firebase Admin (`verifyIdToken(token, true)`) + Google `google-auth-library` SA-to-SA | RS256/ES256 + JWKS |
| Testing | vitest 4 + Playwright 1.49 + axe-core | Coverage v8 |
| Linter custom | `scripts/lint-rls.mjs` (Row-Level Security) + `scripts/repo-checks/*.mjs` (ADR-numbering, drift-inventory, spec-canonical-drift) | |
| CI/CD | GitHub Actions (4 workflows) + Cloud Build (3 pipelines) + WIF (no SA keys) | |
| IaC | Terraform flat 18 `.tf` + 3 módulos (`cloud-run-job`, `cloud-run-service`, `iap-bastion`) | single-project — ver §Infrastructure real |

**Stack supersedido (NO usar)**: `express`, `prisma`, `eslint`, `prettier`, `react-router-dom`, `next`. Cualquier introducción accidental requiere ADR explicit.

---

## Estructura del repo (v3 — verificada 2026-05-19, corregida vs v2)

```
booster-ai/
├── CLAUDE.md                   # este archivo (contrato)
├── AGENTS.md                   # contrato cross-tool (Copilot/Cursor/etc.)
├── README.md
├── package.json                # root pnpm workspace · 14 scripts
├── pnpm-workspace.yaml         # apps/* packages/* scripts/load-test scripts/repo-checks
├── pnpm-lock.yaml
├── turbo.json
├── biome.json                  # noExplicitAny=error + noConsole=error
├── tsconfig.base.json          # strict máximo
├── commitlint.config.cjs       # Conventional Commits + tipo 'security'
├── vitest.workspace.ts         # defineWorkspace(['apps/*','packages/*'])
├── .nvmrc                      # contenido literal: "22"
├── .gitleaks.toml              # allowlist Firebase + Maps web keys (públicas)
├── .trivyignore
├── .editorconfig
├── .gitignore                  # debe excluir *.tfplan *.tfstate* *.tfvars.local (R-014)
├── cloudbuild.production.yaml  # pipeline prod (15KB)
├── cloudbuild.staging.yaml     # pipeline staging (status ambiguo — R-A4)
├── cloudbuild.merge-job.yaml
│
├── .husky/                     # 2 hooks
│   ├── pre-commit              # gitleaks + lint-staged + ADR numbering + drift + spec-canonical
│   └── commit-msg              # commitlint
│
├── .claude/                    # config del agente
│   ├── agents/                 # subagents project-scoped
│   ├── commands/               # slash commands custom
│   ├── ledger/                 # agent-rigor session ledger
│   └── settings.json           # hooks de sesión (audit-only por ahora)
│
├── agents/                     # specialists shared (code-reviewer, security-auditor, sre-oncall)
│
├── apps/                       # 9 apps (6 funcionales + 3 skeleton)
│   ├── api/                    # Hono — 101 .ts/.tsx, ~26.493 LOC
│   ├── web/                    # React PWA — 231 .ts/.tsx, ~28.185 LOC
│   ├── telemetry-tcp-gateway/  # TCP server Codec8 (GKE Autopilot)
│   ├── telemetry-processor/    # Pub/Sub consumer + persist
│   ├── whatsapp-bot/           # Hono webhook Meta + xstate FSM
│   ├── sms-fallback-gateway/   # Hono webhook Twilio
│   ├── document-service/       # SKELETON (R-011 / ADR-051 pendiente)
│   ├── matching-engine/        # SKELETON
│   └── notification-service/   # SKELETON
│
├── packages/                   # 21 packages (15 implementados + 5 stubs + 1 ui-tokens)
│   ├── shared-schemas/         # 38 archivos · 18 Zod schemas dominio
│   ├── logger/                 # Pino + redactores PII
│   ├── config/                 # env Zod validation
│   ├── carbon-calculator/      # GLEC v3.0
│   ├── matching-algorithm/     # multifactor v2
│   ├── codec8-parser/          # parser Teltonika
│   ├── pricing-engine/
│   ├── factoring-engine/
│   ├── driver-scoring/
│   ├── coaching-generator/
│   ├── certificate-generator/  # PDF firmado KMS+signpdf (R-016 pdf-lib stale)
│   ├── dte-provider/           # SII Chile
│   ├── whatsapp-client/        # Twilio Content Templates
│   ├── notification-fan-out/   # formatters puros
│   ├── ui-tokens/              # design tokens (web consume)
│   └── {ai-provider, trip-state-machine, carta-porte-generator, document-indexer, ui-components}  # 5 STUBS · ver R-011
│
├── infrastructure/             # Terraform FLAT (no main.tf, no environments/)
│   ├── *.tf (18 archivos)      # agrupados por dominio
│   ├── modules/                # 3 módulos
│   │   ├── cloud-run-job/
│   │   ├── cloud-run-service/
│   │   └── iap-bastion/
│   ├── k8s/                    # manifests Telemetry TCP Gateway (primary + DR)
│   └── (NO incluir en git: .tfplan, .tfstate*, .tfvars.local)
│
├── scripts/                    # workspaces especiales
│   ├── repo-checks/            # @booster-ai/repo-checks (linters custom)
│   ├── load-test/              # @booster-ai/load-test (k6)
│   ├── db/, sql/               # SQL utils
│   ├── lint-rls.mjs            # Row-Level Security linter
│   └── deploy-telemetry-gateway.sh
│
├── docs/
│   ├── adr/                    # 50 ADRs (001..048 + colisiones legacy 028/034/035 — ver ADR-046)
│   ├── handoff/                # CURRENT.md (estado vivo del proyecto)
│   ├── archive/, audits/, compliance/, demo/, legal/, market-research/, plans/, research/, runbooks/, specs/, transparencia/
│
├── .specs/                     # specs por feature (Plan-Phase, sub-specs)
├── skills/                     # workflows estructurados (6 categorías activas)
├── playbooks/                  # decisiones de producto
├── references/                 # checklists testing/security/performance/a11y
├── hooks/, .changeset/, .github/, .playwright-mcp/, .private/
│
└── .github/workflows/
    ├── ci.yml                  # lint + typecheck + test+coverage gate + drift-checks + build
    ├── security.yml            # gitleaks + pnpm audit HIGH + CodeQL + Trivy fs+config + SBOM CycloneDX
    ├── release.yml             # Changesets + WIF deploy prod (sin SA keys)
    └── e2e-staging.yml         # Playwright + axe-core (nightly + on-PR)
```

**Diferencia clave vs v2 anterior**: `infrastructure/` es flat 18 `.tf` + 3 módulos (`cloud-run-job`, `cloud-run-service`, `iap-bastion`), NO el layout `main.tf` + `environments/` + 5 módulos que el contrato anterior declaraba. Decisión definitiva sobre flat-vs-env: ADR-052 propuesto (R-A4).

---

## Cómo decido cuándo preguntar vs ejecutar

**Ejecuto sin preguntar** cuando:
- La tarea tiene un skill definido en `skills/` que la cubre end-to-end.
- Es un cambio mecánico de aplicación directa (ej. renombrar una variable, añadir un comentario).
- Es trabajo de limpieza/refactor que no altera contratos públicos ni comportamiento externo.
- El usuario lo instruyó explícitamente sin ambigüedad.

**Pregunto antes de ejecutar** cuando:
- La decisión tiene impacto en contratos públicos (API, UI, schema BD).
- Hay trade-offs reales con consecuencias distintas a futuro.
- La instrucción del usuario tiene >1 interpretación razonable.
- Voy a tocar un archivo crítico (CLAUDE.md, ADRs, infra Terraform en secciones IAM/Billing, hooks de CI/quality gates).
- El trabajo toma más de ~30 minutos de mi tiempo (coste de oportunidad).

**Siempre escribo un ADR** cuando:
- Introduzco una nueva dependencia major (framework, tool, library estructural).
- Cambio un patrón que aplica a múltiples módulos.
- Desvío del stack/estructura definida en ADR-001 o superseding.

## Qué archivos NUNCA toco sin permiso explícito

- `CLAUDE.md` (este archivo) — cambios requieren aprobación explícita con justificación.
- `docs/adr/*.md` — los ADRs son decisiones cerradas. Se crea un nuevo ADR que supersede, no se edita el viejo.
- `infrastructure/*.tf` en secciones de IAM humana o Billing — requiere PR revisado.
- `.github/workflows/*.yml` en quality gates (coverage threshold, lint rules, Node version) — requiere justificación. **Nota**: el drift Node 22↔24 actual viola este principio implícitamente (R-004).
- Secret Manager secrets — nunca se crean/modifican desde código del repo, solo desde Terraform `infrastructure/security.tf` o consola.
- `.gitleaks.toml` — allowlist requiere justificación documentada (las 2 keys actuales son públicas-por-diseño).

## Convenciones de código

- **Commits**: Conventional Commits estricto. `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`, `revert:`, `security:` (tipo extra registrado). Commitlint lo aplica en pre-commit.
- **Branches**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Main protegida, requiere PR.
- **PRs**: título Conventional Commits, descripción con sección "Evidencia" obligatoria (outputs de tests, screenshots, traces).
- **Imports**: siempre absolutos con alias (`@booster-ai/shared-schemas`) en vez de relativos profundos.
- **Naming TS**: `camelCase` variables/funciones, `PascalCase` tipos/componentes React, `kebab-case` archivos, `SCREAMING_SNAKE_CASE` constantes/envs.
- **Naming SQL** (bilingüe): tablas y columnas en español snake_case sin tildes (`usuarios`, `viajes`, `nombre_completo`). Enum values español snake_case (`pendiente`, `aceptado`) excepto siglas internacionales (`GLEC_V3`, `GHG_PROTOCOL`, `ISO_14064`).
- **UI labels**: español natural con tildes. Mapping en presentación.
- **Drizzle pattern**: `export const users = pgTable('usuarios', { fullName: varchar('nombre_completo', ...) })`.
- **Archivos**: nombre del archivo = nombre del export principal. Un export principal por archivo (excepto `index.ts` de barrel).

## Reglas de arquitectura (no negociables)

- **Domain canónico vive en `packages/shared-schemas/src/domain/`**. Toda tabla Drizzle debe coincidir con un schema del domain. Enforced via `scripts/repo-checks/drift-inventory.mjs` (ADR-043).
- **Algoritmos viven en `packages/`**. `apps/api/src/services/` orquesta DB/transacciones; las funciones puras (scoring, formatters, builders, geo utils) viven en el package correspondiente. **Excepción documentada**: `haversineKm` en `apps/api/src/services/calcular-cobertura-telemetria.ts:67-75` debe migrarse a `packages/matching-algorithm/src/geo/` o nuevo `packages/geo-utils/` (R-012 P2).
- **Carrier/Shipper deprecated**. Usar `Transportista`/`GeneradorCarga` en código y SQL. `transportistaIdSchema` reemplaza `carrierIdSchema`; este último queda como alias deprecated mientras schemas legacy se migran (limpieza en R-011 follow-up).
- **Stakeholder se mantiene como término** (anglicismo aceptado en español de negocios).

## Cómo genero evidencia para cada tarea

Al cerrar una tarea, genero un bloque de evidencia con:

```markdown
### Evidencia de [TaskID]

- **Cambios**: lista de archivos modificados con líneas
- **Tests**: output de `pnpm test --filter=<pkg>` (pasado + cobertura)
- **Lint**: output de `pnpm lint` (0 errores, 0 warnings)
- **Typecheck**: output of `pnpm typecheck` (0 errores)
- **Build**: output de `pnpm build` (éxito)
- **Manual verification** (si aplica): screenshot, curl output, trace OpenTelemetry
```

## Escalation

Si encuentro un problema que no puedo resolver con skills + principios:

1. Documento el problema y opciones en un comentario de PR o en este archivo (sección "Issues abiertos").
2. Presento al menos 2 caminos con trade-offs.
3. No procedo hasta recibir decisión.

No "adivino" ni "asumo lo razonable" en decisiones que no son claramente deterministas.

---

## Comandos canónicos (verificados contra `package.json` real 2026-05-19)

| Operación | Comando | Notas |
|---|---|---|
| Bootstrap | `pnpm install` | Single `pnpm-lock.yaml` en raíz |
| Dev (todos los apps) | `pnpm dev` → `turbo run dev` | persistent, cache=false |
| Build | `pnpm build` → `turbo run build` | outputs `dist/**`, `build/**`, `.next/**` |
| Type check | `pnpm typecheck` | `tsc --noEmit` por workspace |
| Lint | `pnpm lint` → `biome check . && pnpm lint:rls` | + Row-Level Security linter custom |
| Lint fix | `pnpm lint:fix` → `biome check --write .` | |
| Format | `pnpm format` / `pnpm format:check` | |
| Tests (todos) | `pnpm test` → `turbo run test` → `vitest run --passWithNoTests` | |
| Tests con coverage | `pnpm test:coverage` → emite `coverage-summary.json` | Gate CI: ≥80%/75%/80% |
| Tests E2E | `pnpm test:e2e` → Playwright (apps/web) | 4 proyectos: chromium/mobile-chrome/webkit/mobile-safari |
| CI local | `pnpm ci` → `lint && typecheck && test && build` | |
| Gitleaks full | `pnpm security:scan` → `gitleaks detect ...` | |
| Gitleaks staged | `pnpm security:scan-staged` | Pre-commit |
| Husky install | `pnpm prepare` → `husky` | Post-install |

**Filtrado por workspace**:
- Tests por package: `pnpm --filter @booster-ai/<name> test`
- Build por app: `pnpm --filter @booster-ai/<app-name> build`

---

## Path de crecimiento de este archivo

`CLAUDE.md` evoluciona con el proyecto. Cambios se proponen vía PR y se documentan en el historial del archivo. Cada cambio significativo referencia un ADR.

**Cambios propuestos por la auditoría 2026-05-19** (requieren PR + ADR):
- ADR-049 (R-A1): reemplazo `pdf-lib` por mantenimiento congelado.
- ADR-050 (R-A2): política de observabilidad obligatoria + cableado OTel.
- ADR-051 (R-A3): resolución de stubs (8 placeholders productivos).
- ADR-052 (R-A4): estructura definitiva Terraform (flat vs environments).
- ADR-053 (R-A5): frontend security headers + CSP.

Ver `audit-outputs/06_REFACTOR_PRIORITIES.md` para el plan de ejecución por sprint.

---

**Estado de adopción**: este contrato (versión propuesta 2026-05-19) entra en vigor solo tras aprobación explícita del Product Owner + PR humano + ADR de transición. Cualquier excepción debe documentarse.
