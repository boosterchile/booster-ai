# CLAUDE.md — Contrato de trabajo del agente en Booster AI

Este documento es el **contrato de trabajo** entre Felipe Vicencio (Product Owner) y Claude (agente de desarrollo principal). Fija cómo trabaja el agente en este repo, qué decisiones puede tomar solo, cuándo pregunta, cómo documenta y cómo se valida su trabajo.

**Fecha de adopción**: 2026-04-23
**Última actualización**: 2026-06-14 (ADR-060: capa de disciplina migrada de agent-rigor a superpowers)
**Marco de referencia**: plugins de Claude Code `superpowers` + `booster-skills` (ver §Integración con plugins de Claude Code).

---

## Identidad del proyecto

- **Display name**: Booster AI
- **Slug técnico**: `booster-ai`
- **Owner humano**: Felipe Vicencio — `dev@boosterchile.com`
- **Origen**: reescritura greenfield de Booster 2.0 con cero deuda técnica desde day 0
- **Misión del producto**: Marketplace B2B de logística sostenible que conecta generadores de carga con transportistas, optimizando retornos vacíos y certificando huella de carbono bajo GLEC v3.0 / GHG Protocol / ISO 14064
- **Estado objetivo**: TRL 10 (sistema probado, certificado y listo para despliegue comercial)

## Integración con plugins de Claude Code

Este proyecto se opera bajo Claude Code (CLI) y consume **dos plugins** que en conjunto forman el sistema operativo de desarrollo. Decisión arquitectónica documentada en [ADR-049](docs/adr/049-claude-code-plugin-system-adoption.md) y actualizada por [ADR-060](docs/adr/060-superpowers-replaces-agent-rigor.md).

### Plugin 1: `superpowers` (capa de disciplina genérica)

Provee la **disciplina senior-engineering generalista**: brainstorming antes de código, spec/plan, TDD iron-law, verificación antes de declarar terminado, y subagent-driven-development (subagentes frescos que implementan y revisan cada tarea en dos etapas: cumplimiento de spec y calidad de código).

Repo: [`obra/superpowers`](https://github.com/obra/superpowers) (MIT). Reemplaza a `agent-rigor` (ver ADR-060: el motor bash de agent-rigor no enforced de verdad y se retiró).

Instalación (dentro de una sesión de Claude Code, no en zsh):
```
/plugin install superpowers@claude-plugins-official
```
O vía el marketplace de obra:
```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Contenido relevante:
- **Skills de proceso auto-disparadas**: `brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`, `using-git-worktrees`, entre otras.
- **Enforcement por moldeo conductual** (no por bloqueo bash): las skills rígidas (TDD, verificación) interceptan la *racionalización* ("skip just this once", "should work") con tablas de Red Flags y refutaciones. Es el mecanismo que ataca el modo de falla real (hacer lo mínimo / parchear / declarar listo sin evidencia), no un grep de vocabulario.
- **Bootstrap automático**: el hook `SessionStart` inyecta `using-superpowers`; las skills se activan solas cuando aplican.

> **Prioridad**: `superpowers:using-superpowers` declara explícitamente que las instrucciones del usuario (este `CLAUDE.md`, `AGENTS.md`) tienen **prioridad máxima** sobre las skills. Este archivo manda.

### Plugin 2: `booster-skills` 0.2.0+ (dominio + estándar Booster)

Provee el **dominio + stack + auditoría + estándar de disciplina específicos de Booster AI**.

Repo: [`boosterchile/booster-skills`](https://github.com/boosterchile/booster-skills)

Instalación:
```
/plugin marketplace add boosterchile/booster-skills
/plugin install booster-skills@booster-skills
```

Contenido:

- **9 skills**: `arquitecto-maestro`, `adding-cloud-run-service`, `carbon-calculation-glec`, `empty-leg-matching`, `incident-response`, `booster-stack-conventions`, `booster-deploy-cloud-run`, **`definicion-de-terminado`** (Definición de Terminado anti-parches; rescatada de agent-rigor como estándar verificable), **`tdd-dominio-critico`** (TDD obligatorio para DTE/SII, factoring, pricing, GLEC, matching, migraciones, auth).
- **6 sub-agents** de auditoría arquitectónica: `dependency-auditor`, `explore-architecture`, `performance-analyzer`, `refactor-advisor`, `security-scanner`, `tech-debt-detector`.
- **Ledger observacional + scorecard semanal** (rescate del mecanismo #2 de agent-rigor): hooks `SessionStart`/`PostToolUse`/`Stop` que registran artefactos por tipo, ratio test:source, invocaciones de subagentes y lecturas de skills. **Sin gates** (ningún hook bloquea). Reporte vía `benchmark/score-week.sh`.

### Verificación

Tras instalar ambos plugins, una sesión nueva de Claude Code debe reportar (vía `/plugin list`):

- `superpowers` ✓ enabled
- `booster-skills@booster-skills` v0.2.0 ✓ enabled
- `agent-rigor` ❌ ausente (retirado por ADR-060)

Test de aceptación de superpowers: sesión limpia + "hagamos una lista de tareas en React" → debe auto-disparar `brainstorming` antes de escribir código.

### Distribución de responsabilidades

| Responsabilidad | Plugin |
|---|---|
| Brainstorming → spec → plan → build → verify → review | `superpowers` |
| TDD iron-law + verificación antes de declarar terminado | `superpowers` |
| Subagent-driven-development (review de spec + calidad por tarea) | `superpowers` |
| Estándar de Terminado anti-parches (Definición de Terminado) | `booster-skills` (skill `definicion-de-terminado`) |
| TDD obligatorio en dominio crítico (DTE, factoring, pricing…) | `booster-skills` (skill `tdd-dominio-critico`) |
| Stack Booster (Zod, Biome, Logger, OTel, coverage) | `booster-skills` (skill `booster-stack-conventions`) |
| Deploy Booster (Cloud Run + Cloud Build + monitoreo 2h) | `booster-skills` (skill `booster-deploy-cloud-run`) |
| Dominio Booster (carbon GLEC, empty-leg matching) | `booster-skills` |
| Auditoría arquitectónica del codebase | `booster-skills` (6 sub-agents) |
| Ledger observacional + scorecard | `booster-skills` (hooks) |
| Reglas específicas del proyecto (stack, naming, ADRs Booster) | este CLAUDE.md |

### Precedencia en conflicto

Si una regla de `superpowers` entra en conflicto con una regla específica Booster declarada en este CLAUDE.md o en una skill de booster-skills, **gana la regla Booster** para este proyecto (y superpowers lo respeta por diseño: las instrucciones del usuario tienen prioridad máxima). Ejemplos:

- superpowers sugiere convención de naming en inglés; este CLAUDE.md declara naming bilingüe Booster → gana Booster.
- superpowers usa `docs/plans/` para planes; Booster conserva `.specs/<feature-slug>/` como convención del proyecto → gana Booster (ver abajo).

**Path canónico de specs**: `.specs/<feature-slug>/{spec,plan,verify,review,ship}.md`. Es **convención del proyecto Booster** (se conserva como documentación viva; ya no la impone un hook). No usar `docs/specs/`.

### Capas adicionales locales del proyecto

**Ya no hay overrides locales en `agents/`** (directorio eliminado). Los 3 sub-agents Booster que vivían ahí fueron **consolidados en `booster-skills@0.3.0`** ([ADR-064](docs/adr/064-consolidate-local-subagents-into-booster-skills.md)):

- `security-auditor` → plegado en `booster-skills:security-scanner` (módulo compliance Chile: Ley 19.628, SII/DTE retención 6 años, RBAC por rol shipper/carrier/driver/admin/stakeholder, consent ESG; ADR-004/007/034).
- `sre-oncall` → nuevo sub-agent `booster-skills:sre-oncall` (revisor SRE *pre-merge*: observabilidad, rollback, SLO, capacity, costos).
- `code-reviewer` → retirado; su único bit (ADR-compliance) plegado en `booster-skills:booster-stack-conventions` (paso 7). El review genérico lo provee `superpowers` (subagent-driven-development).

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
- **Tests existen ANTES del commit del feature**, no después. Para dominio crítico (DTE, factoring, pricing, GLEC, matching, migraciones, auth) TDD es obligatorio — ver skill `booster-skills:tdd-dominio-critico`.

### Commits y PRs

- **Conventional Commits con scope**: `<type>(<scope>): <summary>`. Ejemplos válidos: `feat(matching): ...`, `fix(auth): ...`, `refactor(carbon): ...`.
- **Scope** corresponde al dominio del cambio (matching, telemetry, auth, web, api, infra, db, carbon, etc.).
- **Summary** en español, imperativo, ≤72 chars.
- **Squash merges** a `main`.
- **PRs con sección `## Evidencia` obligatoria**: output tests, screenshots si UI, curl trace si endpoint, ADR compliance checklist, `pnpm ci` final. Sin sección Evidencia el PR no se mergea.

### Deploy

- **No existe entorno staging** (backlog `#STAGING-ENV`: requiere un 2º GCP project con infra paralela). El `cloudbuild.staging.yaml` fue eliminado (#445, higiene tooling); `release.yml` removió el job `deploy-staging`. El nightly `e2e-staging.yml` corre Playwright contra **producción** (`PRODUCTION_URL`; `STAGING_URL` solo aplicaría en PR, que no existe) por falta de staging — decisión deliberada **pendiente de re-firma del PO** o de priorizar `#STAGING-ENV`.
- **Producción**: merge a `main` → `release.yml` (GitHub Actions vía Workload Identity Federation) → **requiere aprobación humana** en el GitHub Environment `production` (`required_reviewers`, enforced desde 2026-05-29) → Cloud Build `cloudbuild.production.yaml` canary (1% tráfico → 30 min → 100%). El step `canary-verify` es placeholder (`exit 0`): la promoción a 100% se observa/decide humanamente, no por verificación automática. Ver inventario `.specs/adr-vs-prod-inventory/inventory.md` finding #1.
- **Monitoreo 2h post-deploy**: error rate, latency P95, logs limpios.
- **Regla de horario de deploy eliminada 2026-05-29 por decisión del PO**: el control de riesgo de deploy se ejerce vía gate de aprobación (`required_reviewers` en el GitHub Environment `production`) + observación humana del canary, no vía restricción de calendario.
- Detalles en skill `booster-deploy-cloud-run`.

> **Recordatorio**: Estas reglas son la columna vertebral de "Cero deuda técnica desde day 0". El estándar de cuándo algo está terminado (y cuándo un corte es deuda explícita aceptable vs. parche silencioso prohibido) está definido en `booster-skills:definicion-de-terminado` — verificable, no un tabú de vocabulario. Tomar deuda deliberada exige declararla explícitamente con plan/issue, nunca en silencio.

---

## Estructura del repo (v3 — tras ADR-049, actualizada por ADR-060)

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
├── .claude/                    # Los plugins se instalan a nivel usuario/global
│   │                           # (~/.claude) vía `/plugin install`. El
│   │                           # `.claude/settings.json` versionado habilita
│   │                           # `booster-skills` (enabledPlugins).
│   ├── settings.local.json     # permisos pre-autorizados (gitignored)
│   ├── ledger/                 # ledger observacional de booster-skills (.jsonl per session)
│   ├── worktrees/              # worktrees parallel (superpowers:using-git-worktrees)
│   └── staging/                # (gitignored) workaround pattern audit-session
│
├── references/                 # checklists Booster (code-review, security, IDOR audits)
├── playbooks/                  # decisiones de producto/negocio
│
├── docs/
│   ├── adr/                    # ADRs (incluye ADR-049 plugin system, ADR-060 superpowers)
│   ├── plugins/                # REPORTE-migracion-booster-skills-v0.1.0.md (replicabilidad)
│   ├── handoff/                # CURRENT.md + handoffs históricos fechados
│   └── ... (otros sub-dirs Booster)
│
├── .specs/                     # convención Booster: <feature-slug>/{spec,plan,verify,review,ship}.md
│   ├── _followups/             # follow-up stubs no urgentes
│   └── <feature-slug>/         # specs activas por feature
│
├── apps/                       # 9 apps
│   ├── api/                    # Backend principal (Hono)
│   ├── web/                    # PWA multi-rol (shipper/carrier/driver/admin/stakeholder)
│   ├── matching-engine/        # Matching carrier-based
│   ├── telemetry-tcp-gateway/  # GKE Autopilot (TCP Teltonika)
│   ├── telemetry-processor/    # Dedup + enrich + write
│   ├── notification-service/   # Fan-out notificaciones
│   ├── whatsapp-bot/           # Webhook Meta + NLU
│   ├── document-service/       # DTE + Carta Porte + OCR
│   └── sms-fallback-gateway/   # Fallback SMS (Cloud Run)
│
├── packages/                   # 20 packages compartidos
│   # carbon-calculator, carta-porte-generator,
│   # certificate-generator, coaching-generator, codec8-parser, config,
│   # document-indexer, driver-scoring, factoring-engine,
│   # logger, matching-algorithm, notification-fan-out, otel-bootstrap,
│   # pricing-engine, shared-schemas, transport-documents, trip-state-machine,
│   # ui-components, ui-tokens, whatsapp-client
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
    └── e2e-staging.yml         # Playwright; nightly pega a PRODUCCIÓN (no hay staging, #STAGING-ENV)
```

Cambios v2→v3 (post-PR-2 / ADR-049):

- **Eliminados**: `skills/`, `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, `hooks/` — funcionalidad migrada a plugins.
- **Conservados**: `references/`, `playbooks/`. (`agents/` eliminado en ADR-064: los 3 overlays locales se consolidaron en `booster-skills@0.3.0`.)

Cambios post-ADR-060:

- **Capa 1 de disciplina**: `agent-rigor` (bespoke, retirado) → `superpowers` (oficial).
- **`.claude/ledger/`**: ahora lo produce el ledger observacional de `booster-skills` (sin gates), no agent-rigor.

## Cómo decido cuándo preguntar vs ejecutar

**Ejecuto sin preguntar** cuando:
- La tarea tiene una skill definida (en `superpowers:*` o `booster-skills:*`) que la cubre end-to-end.
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

Esto es coherente con `superpowers:verification-before-completion`: no declaro nada "terminado" sin evidencia fresca de la verificación corrida en el momento.

## Punto de control post-tarea: commit + push (regla permanente)

Al terminar CADA tarea (cuando se cumple la Definición de Terminado de `booster-skills:definicion-de-terminado`), antes de pasar a la siguiente o de cerrar la sesión, el agente DEBE:

1. Identificar explícitamente que la tarea quedó terminada y que hay cambios sin persistir.
2. Commitear con Conventional Commits con scope, incluyendo los cambios en `.specs/` (el spec/plan es parte del entregable, no solo el código).
3. Hacer `git push` de la rama feature — respaldo en GitHub; commit local ≠ guardado.
4. NUNCA pushear directo a `main` — `main` exige PR + squash merge (ver §Deploy).

Si al cerrar el turno hay cambios sin commitear o commits sin pushear, el agente debe decirlo explícitamente y proponer el commit/push — no dejarlo pendiente en silencio. "Lo commiteo después" es drift (ver `definicion-de-terminado`).

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
