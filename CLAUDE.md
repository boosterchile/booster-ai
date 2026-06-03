# CLAUDE.md — Contrato de trabajo del agente en Booster AI

Este documento es el **contrato de trabajo** entre Felipe Vicencio (Product Owner) y Claude (agente de desarrollo principal). Fija cómo trabaja el agente en este repo, qué decisiones puede tomar solo, cuándo pregunta, cómo documenta y cómo se valida su trabajo.

**Fecha de adopción**: 2026-04-23
**Última actualización**: 2026-05-20 (ADR-049 plugin system)
**Marco de referencia**: plugins de Claude Code `agent-rigor` + `booster-skills` (ver §Integración con plugins de Claude Code).

---

## Identidad del proyecto

- **Display name**: Booster AI
- **Slug técnico**: `booster-ai`
- **Owner humano**: Felipe Vicencio — `dev@boosterchile.com`
- **Origen**: reescritura greenfield de Booster 2.0 con cero deuda técnica desde day 0
- **Misión del producto**: Marketplace B2B de logística sostenible que conecta generadores de carga con transportistas, optimizando retornos vacíos y certificando huella de carbono bajo GLEC v3.0 / GHG Protocol / ISO 14064
- **Estado objetivo**: TRL 10 (sistema probado, certificado y listo para despliegue comercial)

## Integración con plugins de Claude Code

Este proyecto se opera bajo Claude Code (CLI) y consume **dos plugins** que en conjunto forman el sistema operativo de desarrollo. Decisión arquitectónica documentada en [ADR-049](docs/adr/049-claude-code-plugin-system-adoption.md).

### Plugin 1: `agent-rigor` 0.2.0+

Provee la **disciplina senior-engineering generalista**: ciclo no-negociable, hooks de enforcement, sub-agents del ciclo, session ledger, benchmark.

Repo: [`boosterchile/best-skill-claude`](https://github.com/boosterchile/best-skill-claude)

Instalación:
```bash
/plugin marketplace add boosterchile/best-skill-claude
/plugin install agent-rigor@agent-rigor
```

Contenido relevante:
- **Ciclo no-negociable**: `/agent-rigor:spec` → `/agent-rigor:plan` → `/agent-rigor:build` → `/agent-rigor:test` → `/agent-rigor:review` → `/agent-rigor:ship`.
- **Comandos adicionales**: `/agent-rigor:design`, `/agent-rigor:code-simplify`, `/agent-rigor:benchmark`.
- **Sub-agents**: `code-reviewer`, `devils-advocate` (mandatory en solo-dev mode), `security-auditor`, `test-engineer`, `ux-designer`.
- **22 skills numeradas**: `00-using-this-pack` a `64-shipping-and-launch`.
- **Hooks enforcement**: PreToolUse anti-racionalización (vocabulario drift catalogado en `agent-rigor/CLAUDE.md §4`) + ciclo forzado (no `Write/Edit` sin spec previa).
- **Session ledger**: `.claude/ledger/<sessionId>.jsonl` con todas las decisiones, skips, waivers.

**Path canónico de specs**: `.specs/<feature-slug>/{idea,spec,plan,verify,review,ship}.md`. Definido por agent-rigor. No usar `docs/specs/`.

### Plugin 2: `booster-skills` 0.1.0+

Provee el **dominio + stack + auditoría específicos de Booster AI**.

Repo: [`boosterchile/booster-skills`](https://github.com/boosterchile/booster-skills)

Instalación:
```bash
/plugin marketplace add boosterchile/booster-skills
/plugin install booster-skills@booster-skills
```

Contenido:

- **7 skills**: `arquitecto-maestro`, `adding-cloud-run-service`, `carbon-calculation-glec`, `empty-leg-matching`, `incident-response`, `booster-stack-conventions`, `booster-deploy-cloud-run`.
- **6 sub-agents** de auditoría arquitectónica: `dependency-auditor`, `explore-architecture`, `performance-analyzer`, `refactor-advisor`, `security-scanner`, `tech-debt-detector`.

### Verificación

Tras instalar ambos plugins, una sesión nueva de Claude Code debe reportar (vía `/plugin list`):

- `agent-rigor@agent-rigor` ✓ enabled
- `booster-skills@booster-skills` ✓ enabled

### Distribución de responsabilidades

| Responsabilidad | Plugin |
|---|---|
| Ciclo Define → Plan → Build → Verify → Review → Ship | `agent-rigor` |
| Anti-racionalización + waivers + cooling-off | `agent-rigor` |
| Sub-agents del ciclo (5) | `agent-rigor` |
| Session ledger + benchmark | `agent-rigor` |
| Stack Booster (Zod, Biome, Logger, OTel, coverage) | `booster-skills` (skill `booster-stack-conventions`) |
| Deploy Booster (Cloud Run + Cloud Build + monitoreo 2h) | `booster-skills` (skill `booster-deploy-cloud-run`) |
| Dominio Booster (carbon GLEC, empty-leg matching) | `booster-skills` |
| Auditoría arquitectónica del codebase | `booster-skills` (6 sub-agents) |
| Reglas específicas del proyecto (stack, naming, ADRs Booster) | este CLAUDE.md |

### Precedencia en conflicto

Si una regla de agent-rigor entra en conflicto con una regla específica Booster declarada en este CLAUDE.md o en una skill de booster-skills, **gana la regla Booster** para este proyecto. Ejemplos:

- agent-rigor sugiere convención de naming en inglés; este CLAUDE.md declara naming bilingüe Booster → gana Booster.
- agent-rigor `64-shipping-and-launch` da checklist de 12 puntos; `booster-deploy-cloud-run` agrega 4 pasos específicos GCP → ambos aplican, los específicos no reemplazan los generales.

### Capas adicionales locales del proyecto

Además de los plugins, el repo Booster mantiene 3 archivos en `agents/` raíz como **overrides locales Booster** del agent-rigor genérico:

| Archivo | Qué extiende | Por qué override local Booster |
|---|---|---|
| `agents/code-reviewer.md` | `agent-rigor:code-reviewer` | Añade disciplina ADR Booster + anti-rationalizations Booster específicas |
| `agents/security-auditor.md` | `agent-rigor:security-auditor` | Añade compliance Chile: Ley 19.628 (privacy), SII/DTE (retention 6 años), modelo Uber-like + Sustainability Stakeholder (ADR-004, ADR-034) |
| `agents/sre-oncall.md` | — (sin equivalente en plugins) | Único: SLOs, observabilidad GCP, capacity planning específico |

Cuando agent-rigor invoca `subagent_type: code-reviewer` o `security-auditor` en este repo, Claude Code resuelve al override local en lugar del genérico del plugin. Es comportamiento deliberado.

Migración futura de este contenido al plugin `booster-skills` (v0.2.0+ con compliance Chile) tracked en [`.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`](.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md).

Para resolver referencias a paths antiguos (`skills/`, `.claude/commands/`, etc.) que aparezcan en ADRs históricos (≤ ADR-048): ver [ADR-050 path-remapping](docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md).

## Reglas no-negociables del stack Booster

Estas reglas son **contratos**, no preferencias. La skill `booster-stack-conventions` (en plugin `booster-skills`) las hace cumplir automáticamente cada vez que se escribe código en este proyecto. Cambiar cualquiera de ellas requiere un ADR formal.

### Type safety end-to-end

- **Zero `any`** (Biome lo prohíbe). Si TypeScript no infiere un tipo, crear Zod schema y derivar con `z.infer<>`.
- **Zero `@ts-ignore` / `@ts-expect-error`** sin issue de GitHub asociado.
- **Zero `as unknown as T`** sin validación Zod previa.

### Validación en boundaries

Todo input externo pasa por Zod **antes** de tocar lógica:

- HTTP body/query/headers → Zod en handler (típicamente vía `@hono/zod-validator`).
- Variables de entorno → Zod en `packages/config/env.ts` al startup.
- Payloads Pub/Sub, Cloud Tasks → Zod en el consumer.
- Respuestas de APIs externas → Zod en el cliente.

### Observabilidad obligatoria

- **Zero `console.*`** — usar `@booster-ai/logger` con structured logs.
- **Cada endpoint nuevo** tiene: log estructurado con `trace_id`, span OpenTelemetry, métrica custom si la operación es de negocio.
- **No silently swallow errors**: cada `catch` debe loguear con contexto + re-throw o recovery explícito con métrica.

### Seguridad por defecto

- **Secretos**: Google Secret Manager, nunca en código, nunca en variables de entorno hardcoded en repo.
- **API keys GCP**: con restricciones IP/referrer activadas.
- **Auth**: JWT Zero-Trust según ADR-001. No introducir mecanismos alternativos sin ADR.

### Testing

- **Coverage 80%+** en código nuevo (líneas, branches, funciones). CI bloquea si baja.
- **Unit tests**: `*.test.ts` al lado del archivo (`src/foo.ts` → `src/foo.test.ts`).
- **Integration tests**: `test/integration/` por workspace. Levantan DB Postgres local.
- **E2E tests**: `pnpm --filter @booster-ai/web test:e2e`. Playwright. Solo flujos críticos.
- **Tests existen ANTES del commit del feature**, no después.

### Commits y PRs

- **Conventional Commits con scope**: `<type>(<scope>): <summary>`. Ejemplos válidos: `feat(matching): ...`, `fix(auth): ...`, `refactor(carbon): ...`.
- **Scope** corresponde al dominio del cambio (matching, telemetry, auth, web, api, infra, db, carbon, etc.).
- **Summary** en español, imperativo, ≤72 chars.
- **Squash merges** a `main`.
- **PRs con sección `## Evidencia` obligatoria**: output tests, screenshots si UI, curl trace si endpoint, ADR compliance checklist, `pnpm ci` final. Sin sección Evidencia el PR no se mergea.

### Deploy

- **No existe entorno staging** (backlog `#STAGING-ENV`: requiere un 2º GCP project con infra paralela). El `cloudbuild.staging.yaml` está inactivo; `release.yml` removió el job `deploy-staging`.
- **Producción**: merge a `main` → `release.yml` (GitHub Actions vía Workload Identity Federation) → **requiere aprobación humana** en el GitHub Environment `production` (`required_reviewers`, enforced desde 2026-05-29) → Cloud Build `cloudbuild.production.yaml` canary (1% tráfico → 30 min → 100%). El step `canary-verify` es placeholder (`exit 0`): la promoción a 100% se observa/decide humanamente, no por verificación automática. Ver inventario `.specs/adr-vs-prod-inventory/inventory.md` finding #1.
- **Monitoreo 2h post-deploy**: error rate, latency P95, logs limpios.
- **Regla de horario de deploy eliminada 2026-05-29 por decisión del PO**: el control de riesgo de deploy se ejerce vía gate de aprobación (`required_reviewers` en el GitHub Environment `production`) + observación humana del canary, no vía restricción de calendario.
- Detalles en skill `booster-deploy-cloud-run`.

> **Recordatorio**: Estas reglas son la columna vertebral de "Cero deuda técnica desde day 0". Saltearlas requiere waiver explícito documentado en `.claude/ledger/`.

---

## Estructura del repo (v3 — tras ADR-049)

```
Booster-AI/
├── CLAUDE.md                   # este archivo
├── AGENTS.md                   # contrato cross-tool (Copilot/Cursor/etc.)
├── README.md                   # quick start
├── package.json                # root pnpm workspace
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo orchestration
├── biome.json                  # linter + formatter
├── tsconfig.base.json          # TS config compartida
├── commitlint.config.cjs
├── .editorconfig
├── .nvmrc
├── .gitignore
│
├── .claude/                    # minimal post-PR-2 (ADR-049). Los plugins NO se
│   │                           # declaran acá: se instalan a nivel usuario/global
│   │                           # (~/.claude) vía `/plugin install`. NO existe un
│   │                           # `.claude/settings.json` versionado (corrección 2026-06-03).
│   ├── settings.local.json     # permisos pre-autorizados (gitignored)
│   ├── ledger/                 # sesiones agent-rigor (.jsonl per session)
│   ├── worktrees/              # sesiones parallel
│   └── staging/                # (gitignored) workaround pattern audit-session
│
├── agents/                     # 3 overrides Booster locales (ver §Capas adicionales)
│   ├── code-reviewer.md        # extiende agent-rigor:code-reviewer
│   ├── security-auditor.md     # + compliance Chile (Ley 19.628, SII/DTE)
│   └── sre-oncall.md           # único: SLOs + observabilidad GCP
│
├── references/                 # checklists Booster (code-review, security, IDOR audits)
├── playbooks/                  # decisiones de producto/negocio
│
├── docs/
│   ├── adr/                    # ADRs (049 al cierre de PR-2; incluye ADR-049 plugin system)
│   ├── plugins/                # REPORTE-migracion-booster-skills-v0.1.0.md (replicabilidad)
│   ├── handoff/                # CURRENT.md + handoffs históricos fechados
│   └── ... (otros sub-dirs Booster)
│
├── .specs/                     # path canónico agent-rigor: <feature-slug>/{spec,plan,verify,review,ship}.md
│   ├── _followups/             # follow-up stubs no urgentes
│   └── <feature-slug>/         # specs activas por feature
│
├── apps/                       # 8 apps
│   ├── api/                    # Backend principal (Hono)
│   ├── web/                    # PWA multi-rol (shipper/carrier/driver/admin/stakeholder)
│   ├── matching-engine/        # Matching carrier-based
│   ├── telemetry-tcp-gateway/  # GKE Autopilot (TCP Teltonika)
│   ├── telemetry-processor/    # Dedup + enrich + write
│   ├── notification-service/   # Fan-out notificaciones
│   ├── whatsapp-bot/           # Webhook Meta + NLU
│   └── document-service/       # DTE + Carta Porte + OCR
│
├── packages/                   # ~21 packages compartidos
│   # shared-schemas, logger, ai-provider, config,
│   # trip-state-machine, codec8-parser, pricing-engine,
│   # matching-algorithm, carbon-calculator, whatsapp-client,
│   # dte-provider, carta-porte-generator, document-indexer,
│   # notification-fan-out, ui-tokens, ui-components, etc.
│
├── infrastructure/             # Terraform 100% IaC (incluye IAM humana)
│   ├── main.tf
│   ├── modules/
│   └── environments/{dev,staging,prod}/
│
└── .github/workflows/
    ├── ci.yml                  # lint + test + coverage + build
    ├── security.yml            # gitleaks + npm audit + CodeQL
    ├── release.yml             # Changesets + Cloud Build
    └── e2e-staging.yml         # Playwright contra staging
```

Cambios v2→v3 (post-PR-2 / ADR-049):

- **Eliminados**: `skills/`, `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, `hooks/` — funcionalidad migrada a plugins (`agent-rigor` + `booster-skills`).
- **Conservados**: `agents/` (3 overrides Booster documentados), `references/`, `playbooks/`.
- **Añadidos**: `.claude/staging/` (workaround pattern audit-session), `docs/plugins/` (REPORTE replicabilidad), `.specs/_followups/`.

## Cómo decido cuándo preguntar vs ejecutar

**Ejecuto sin preguntar** cuando:
- La tarea tiene una skill definida (en `agent-rigor:*` o `booster-skills:*`) que la cubre end-to-end.
- Es un cambio mecánico de aplicación directa (ej. renombrar una variable, añadir un comentario).
- Es trabajo de limpieza/refactor que no altera contratos públicos ni comportamiento externo.
- El usuario lo instruyó explícitamente sin ambigüedad.

**Pregunto antes de ejecutar** cuando:
- La decisión tiene impacto en contratos públicos (API, UI, schema BD).
- Hay trade-offs reales con consecuencias distintas a futuro.
- La instrucción del usuario tiene >1 interpretación razonable.
- Voy a tocar un archivo crítico (CLAUDE.md, ADRs, infra/main.tf, hooks de CI).
- El trabajo toma más de ~30 minutos de mi tiempo (coste de oportunidad).

**Siempre escribo un ADR** cuando:
- Introduzco una nueva dependencia major (framework, tool, library estructural).
- Cambio un patrón que aplica a múltiples módulos.
- Desvío del stack/estructura definida en ADR-001.

## Qué archivos NUNCA toco sin permiso explícito

- `CLAUDE.md` (este archivo) — cambios requieren aprobación explícita con justificación.
- `docs/adr/*.md` — los ADRs son decisiones cerradas. Se crea un nuevo ADR que supersede, no se edita el viejo.
- `infrastructure/main.tf` en secciones de IAM humana o Billing — requiere PR revisado.
- `.github/workflows/*.yml` en quality gates (coverage threshold, lint rules) — requiere justificación.
- Secret Manager secrets — nunca se crean/modifican desde código del repo, solo desde Terraform o consola.

## Convenciones de código

- **Commits**: Conventional Commits estricto. `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `build:`, `ci:`, `revert:`. Commitlint lo aplica en pre-commit.
- **Branches**: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Main protegida, requiere PR.
- **PRs**: título Conventional Commits, descripción con sección "Evidencia" obligatoria (outputs de tests, screenshots, traces).
- **Imports**: siempre absolutos con alias (`@booster-ai/shared-schemas`) en vez de relativos profundos.
- **Naming**: `camelCase` para variables y funciones, `PascalCase` para tipos y componentes React, `kebab-case` para archivos, `SCREAMING_SNAKE_CASE` para constantes y env vars.
- **Archivos**: nombre del archivo = nombre del export principal. Un export principal por archivo (excepto index.ts de barrel).

## Cómo genero evidencia para cada tarea

Al cerrar una tarea, genero un bloque de evidencia con:

```markdown
### Evidencia de [TaskID]

- **Cambios**: lista de archivos modificados con líneas
- **Tests**: output de `pnpm test --filter=<pkg>` (pasado + cobertura)
- **Lint**: output de `pnpm lint` (0 errores, 0 warnings)
- **Typecheck**: output de `pnpm typecheck` (0 errores)
- **Build**: output de `pnpm build` (éxito)
- **Manual verification** (si aplica): screenshot, curl output, trace
```

## Escalation

Si encuentro un problema que no puedo resolver con skills + principios:

1. Documento el problema y opciones en un comentario de PR o en este archivo (sección "Issues abiertos").
2. Presento al menos 2 caminos con trade-offs.
3. No procedo hasta recibir decisión.

No "adivino" ni "asumo lo razonable" en decisiones que no son claramente deterministas.

## Path de crecimiento de este archivo

`CLAUDE.md` evoluciona con el proyecto. Cambios se proponen vía PR y se documentan en el historial del archivo. Cada cambio significativo referencia un ADR.

---

## Reglas de naming bilingüe (Booster AI)

- **TypeScript code**: identifiers en inglés camelCase. `users`, `trips`, `OfferRow`, `acceptOffer`.
- **SQL DDL**: tablas y columnas en español snake_case sin tildes. `usuarios`, `viajes`, `nombre_completo`, `creado_en`.
- **Enum values**: español snake_case sin tildes. Excepto siglas internacionales (`GLEC_V3`, `GHG_PROTOCOL`, `ISO_14064`, `GRI`, `SASB`, `CDP`).
- **UI labels**: español natural con tildes. Mapping en presentación (componentes web).
- **Drizzle pattern**: `export const users = pgTable('usuarios', { fullName: varchar('nombre_completo', ...) })`.

## Reglas de arquitectura (no negociables)

- **Domain canónico vive en `packages/shared-schemas/src/domain/`**. Toda tabla Drizzle debe coincidir con un schema del domain.
- **Algoritmos viven en `packages/`**. `apps/api/src/services/` orquesta DB/transacciones; las funciones puras (scoring, formatters, builders) viven en el package correspondiente. Prohibido escribir lógica de matching o cálculo de carbono inline en services.
- **Carrier/Shipper deprecated**. Usar `Transportista`/`GeneradorCarga` en código y SQL. `transportistaIdSchema` reemplaza `carrierIdSchema`; este último queda como alias deprecated mientras schemas legacy se migran.
- **Stakeholder se mantiene como término** (anglicismo aceptado en español de negocios).

---

**Estado de adopción**: este contrato entra en vigor desde el primer commit del repo. Cualquier excepción debe documentarse.
