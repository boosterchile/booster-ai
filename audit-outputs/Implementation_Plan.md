# Implementation Plan — Audit Baseline Booster AI

**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Fase**: PLAN (esperando aprobación humana explícita "apruebo")
**Generado**: 2026-05-19T02:20Z
**Objetivo**: producir baseline arquitectónico **exhaustivo y read-only** del repo `booster-ai`, ensamblando 12 artefactos bajo `audit-outputs/` sin modificar código fuente.

---

## 1. Scope a auditar (empíricamente verificado)

Monorepo `pnpm 9` + `Turborepo` con:

- **9 apps** en `apps/`: `api` (Hono 4), `web` (React 18 + Vite 6 + @tanstack/react-router + PWA Workbox), `matching-engine`, `telemetry-tcp-gateway`, `telemetry-processor`, `notification-service`, `whatsapp-bot`, `document-service`, `sms-fallback-gateway`.
- **21 packages** en `packages/`: shared-schemas, logger, ai-provider, config, trip-state-machine, codec8-parser, pricing-engine, matching-algorithm, carbon-calculator, whatsapp-client, dte-provider, carta-porte-generator, document-indexer, notification-fan-out, ui-tokens, ui-components, certificate-generator, coaching-generator, driver-scoring, factoring-engine.
- **Scripts workspaces**: `scripts/load-test`, `scripts/repo-checks`.
- **Infrastructure**: `infrastructure/` Terraform (incluye módulos GKE, Cloud Run, Pub/Sub, Firestore, Secret Manager).
- **ADRs**: `docs/adr/001..050+` (stack canónico, decisiones de producto, métodologías).
- **CI/CD**: `.github/workflows/{ci,security,release,e2e-staging}.yml`.

### 1.1 Stack canónico verificado (ADR-001)

| Pieza | Real (verificado) | Lo que decía el blueprint inicial |
|---|---|---|
| Runtime | Node.js 22 LTS | "Node.js serverless" (genérico, OK) |
| Backend framework | **Hono 4** | "serverless" (no especificado, OK) |
| DB | **Cloud SQL Postgres + `pg`** | "Neon Postgres con pgvector" ❌ corregido |
| ORM | **Drizzle** (varios packages) | No especificado |
| pgvector | **A verificar** (probablemente no usado) | Asumido como dado ❌ corregido a hipótesis |
| Frontend | **React 18 + Vite 6 + @tanstack/react-router** | "React + Vite + HashRouter" ❌ TanStack Router, no HashRouter |
| Frontend libs | TanStack Query, react-hook-form, zod, zustand, Tremor, Tailwind 4, lucide-react, Firebase | No especificado |
| PWA | workbox-* + vite-plugin-pwa | No especificado (ADR-008) |
| Config secrets | `packages/config` + Secret Manager (prod) | "`maps.config.ts`" ❌ no existe ese archivo |
| Linter | Biome 1.9 | No especificado (regla CLAUDE.md: no ESLint) |
| Testing | vitest + playwright + axe-core | No especificado |
| Pre-commit | husky + lint-staged + commitlint + gitleaks | No especificado |
| Package mgr | pnpm 9 | "npm" (asumido) ❌ es pnpm |

Las correcciones se aplican en los subagents: ninguno asume Neon, HashRouter, o `maps.config.ts`. Si esos hallazgos no aparecen (porque no existen), los reportes lo declararán explícitamente con "0 hallazgos · metodología: X".

### 1.2 Reglas inquebrantables Booster AI (de CLAUDE.md §Principios)

1. Sin `any` en TypeScript (Biome `noExplicitAny: error`).
2. Sin `console.*` en producción (`packages/logger` Pino).
3. Sin secrets en el repo (gitleaks pre-commit + CI).
4. Sin features sin tests (coverage 80% bloqueante CI).
5. Sin infra manual (Terraform 100% IaC incluyendo IAM humana).

Los subagents (especialmente `tech-debt-detector` y `security-scanner`) verifican adherencia a estas reglas.

---

## 2. Subagents y orden de ejecución

### Fase ACT — paralelo (5 subagents simultáneos)

| # | Subagent | Modelo | Output | Estimado |
|---|---|---|---|---|
| 1 | `explore-architecture` | haiku | `01_ARCHITECTURE.md` | 5–8 min |
| 2 | `dependency-auditor` | haiku | `02_DEPENDENCIES.md` | 4–7 min |
| 3 | `security-scanner` | sonnet | `03_SECURITY_FINDINGS.md` | 10–15 min |
| 4 | `performance-analyzer` | sonnet | `04_PERFORMANCE_FINDINGS.md` | 8–12 min |
| 5 | `tech-debt-detector` | haiku | `05_TECH_DEBT_REGISTRY.md` | 4–6 min |

Ejecutan concurrentemente — Claude Code soporta hasta 10 subagents en paralelo. No-fork-mid-flight: la main session **no** lee outputs en vuelo.

### Fase ACT — secuencial (1 subagent post-paralelo)

| # | Subagent | Modelo | Output | Estimado |
|---|---|---|---|---|
| 6 | `refactor-advisor` | opus | `06_REFACTOR_PRIORITIES.md` | 6–10 min |

Espera a los 5 anteriores, lee sus reportes, produce síntesis transversal.

### Fase ENSAMBLE — main session

| # | Artefacto | Producido por | Estimado |
|---|---|---|---|
| 7 | `PROJECT_OVERVIEW.md` | main session (síntesis de 01–05) | 4–6 min |
| 8 | `CLAUDE.md` (propuesto, para revisión humana — **no** sustituye al del repo sin aprobación) | main session | 5–8 min |
| 9 | `EXTENSIONS_RECOMMENDATIONS.md` | main session | 3–5 min |
| 10 | `SUMMARY.md` (≤ 2 páginas ejecutivo) | main session | 4–6 min |

**Total estimado**: 50–80 minutos de wall clock para la fase ACT completa.

---

## 3. Artefactos exigidos (12)

Bajo `/Volumes/Pendrive128GB/Booster-AI/audit-outputs/`:

1. ✅ `SESSION_CLAUDE.md` (efímero — reglas operativas) **ya creado en PLAN**
2. ✅ `Implementation_Plan.md` (este archivo) **ya creado en PLAN**
3. ⏳ `01_ARCHITECTURE.md`
4. ⏳ `02_DEPENDENCIES.md`
5. ⏳ `03_SECURITY_FINDINGS.md`
6. ⏳ `04_PERFORMANCE_FINDINGS.md`
7. ⏳ `05_TECH_DEBT_REGISTRY.md`
8. ⏳ `06_REFACTOR_PRIORITIES.md`
9. ⏳ `PROJECT_OVERVIEW.md`
10. ⏳ `CLAUDE.md` (propuesto, **distinto** al del repo)
11. ⏳ `EXTENSIONS_RECOMMENDATIONS.md`
12. ⏳ `SUMMARY.md`
13. ⏳ `.execution.log` (PostToolUse hook)

(El blueprint listaba 12 pero el SESSION_CLAUDE.md también cuenta como artefacto — total efectivo 13 contando el log.)

---

## 4. Riesgos identificados + mitigaciones

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | **Stack mismatch** con blueprint inicial (Neon vs Cloud SQL, HashRouter vs TanStack Router, `maps.config.ts` inexistente). | Alta | Corrección aplicada en subagents §1.1. Si subagents encuentran "0 hallazgos" en categorías basadas en stack erróneo, lo declararán explícitamente. |
| R2 | **Coexistencia con agent-rigor hooks**: el plugin agent-rigor tiene hooks `PreToolUse` con drift detection que bloquean contenido con vocabulario flagged. Subagents que escriban patrones de drift (e.g., `tech-debt-detector` listando comentarios con "FIXME" o "HACK") fallarán sin un `drift_justified` activo. | Alta | (a) Subagents instruidos a usar paráfrasis para findings y a registrar `drift_justified` en el ledger antes de outputs con literales. (b) El bypass dura 10 minutos; relogueo según necesidad. |
| R3 | **Hooks de la sesión** (`.claude/settings.json`) podrían bloquear las propias escrituras del agente si los paths no calzan. | Media | El hook permite escrituras en `audit-outputs/`, `.claude/`, `/tmp/`. Activación del hook requiere reinicio de sesión típicamente — durante PLAN no estuvo activo aún. |
| R4 | **Volumen del monorepo** (9 apps × 21 packages) puede agotar el contexto del subagent `refactor-advisor`. | Media | refactor-advisor solo lee reportes 01–05 (cada uno ≤ ~30KB esperado), no el código fuente. |
| R5 | **MCPs solicitados** (GitHub MCP, Postgres MCP) requieren handshake del usuario para auth. Hooks no pueden registrarlos sin intervención. | Baja | Omitidos en PLAN. La auditoría funciona sin ellos (subagents leen historia local con `git log` y schema vía Drizzle migrations). Si el usuario quiere MCPs, los registra fuera de banda con `claude mcp add` y se relanza. |
| R6 | **Greenfield avanzado pero no completo**: algunas apps pueden estar en scaffold parcial. Findings de "no hay tests" pueden ser ruido si la app aún no está escrita. | Media | `explore-architecture` reportará el grado de completitud por app (LOC, presencia de tests, presencia de README). Subsequent subagents pueden filtrar findings por app productiva vs scaffold. |
| R7 | **`/security-review` y `/review` built-in** invocados por `security-scanner` pueden generar costo adicional no presupuestado. | Baja | Decisión del usuario; el subagent indica que lo invocará como complemento al final, no como reemplazo. |
| R8 | **Sub-task de tripstate-alignment** (CURRENT.md §S2 condición 1) está pendiente de spec.md. Si la auditoría destapa hallazgos relacionados, deben referenciarse pero no resolverse en este audit. | Baja | refactor-advisor proponen ADRs / sub-specs sin redactarlos. |

---

## 5. Coexistencia con framework agent-rigor

Esta auditoría se ejecuta como **meta-task** dentro de la sesión agent-rigor (declarado `skip_cycle` en el ledger porque no implementa feature ni toca código en `main`).

| Componente | agent-rigor (plugin) | audit-session (`.claude/settings.json`) | Coexistencia |
|---|---|---|---|
| PreToolUse Write/Edit | Bloquea sin lectura previa de CLAUDE.md + sin `drift_justified` ante drift vocab | Bloquea escritura fuera de `audit-outputs/` + `.claude/` + `/tmp/` | Ambos corren; el más estricto gana |
| PreToolUse Bash | Bloquea drift vocab sin justified | Bloquea comandos destructivos (rm, mv, git commit/push/reset, pnpm install/add) | Ambos corren |
| PostToolUse | Ledger logging via Bash | Append a `audit-outputs/.execution.log` | Ambos corren |
| Sub-agents | `code-reviewer`, `security-auditor`, `test-engineer`, `devils-advocate`, `ux-designer` (en `agents/` raíz) | `explore-architecture`, `dependency-auditor`, `security-scanner`, `performance-analyzer`, `tech-debt-detector`, `refactor-advisor` (en `.claude/agents/`) | Namespaces distintos — no chocan |

**Nota crítica**: el archivo `CLAUDE.md` propuesto generado en `audit-outputs/CLAUDE.md` **no sustituye** al `CLAUDE.md` del repo. Es un artefacto de revisión. Cualquier promoción del propuesto al repo requiere ADR + decisión humana explícita (regla CLAUDE.md §"archivos que NUNCA toco sin permiso explícito").

---

## 6. Restricciones operativas (recordatorio)

- **Read-only sobre código fuente**: writes solo a `audit-outputs/`, `.claude/`, `/tmp/`.
- **Bash allowlist**: lectura, inspección, `git log/status/diff`, `pnpm ls|outdated|audit`, utilitarios. Todo lo demás bloqueado.
- **Secrets**: nunca reproducir valores en cleartext en ningún output.
- **Contexto**: ejecutar `/compact` si la main session supera 60% de uso.
- **Drift vocabulary**: `drift_justified` debe reloguearse cada ~10 min si los outputs contienen literales.

---

## 7. Criterios de éxito de la auditoría

Replicados del blueprint, con adaptación al stack real:

1. Los 12 artefactos en `audit-outputs/` existen y son no-vacíos.
2. Cero modificaciones a archivos fuera de `audit-outputs/`, `.claude/`, `/tmp/`.
3. `CLAUDE.md` propuesto refleja convenciones reales detectadas (no template genérico) + reglas Booster AI "Cero Parches" + comandos build/test verificados contra `package.json` real.
4. `06_REFACTOR_PRIORITIES.md` clasifica hallazgos P0/P1/P2 con justificación trazable a evidencia (sección de reporte origen + `archivo:línea`).
5. Cualquier secret accidentalmente comiteado se reporta como P0 sin reproducir el valor en cleartext.
6. Cada subagent que no encuentre hallazgos en una categoría declara explícitamente "0 hallazgos · metodología: X" (no silencio).
7. Cross-check de coherencia: si `03_SECURITY_FINDINGS.md` reporta un secret en archivo X, debe aparecer también en `05_TECH_DEBT_REGISTRY.md` o `06_REFACTOR_PRIORITIES.md` como P0.

---

## 8. Lo que ya existe (estado actual de PLAN)

Verificable en disco:

- `audit-outputs/SESSION_CLAUDE.md` — reglas operativas de la sesión.
- `audit-outputs/Implementation_Plan.md` — este archivo.
- `.claude/agents/explore-architecture.md`
- `.claude/agents/dependency-auditor.md`
- `.claude/agents/security-scanner.md`
- `.claude/agents/performance-analyzer.md`
- `.claude/agents/tech-debt-detector.md`
- `.claude/agents/refactor-advisor.md`
- `.claude/settings.json` — hooks de enforcement de la sesión.
- Ledger entries: `drift_justified` + `skip_cycle_declared` + `phase_enter` registradas.

---

## 9. Próximo paso (requiere aprobación humana)

Espero la palabra **"apruebo"** (o equivalente: "ok", "adelante", "go") del Product Owner para:

1. Salir de fase PLAN.
2. Activar oficialmente fase ACT.
3. Spawn paralelo de los 5 subagents (explore-architecture, dependency-auditor, security-scanner, performance-analyzer, tech-debt-detector).
4. Tras completarse, spawn de refactor-advisor.
5. Ensamble de PROJECT_OVERVIEW / CLAUDE.md propuesto / EXTENSIONS / SUMMARY.

**Si decides modificar el plan antes de aprobar**, indícame qué subagent revisar/ajustar o qué riesgo replantear. Si decides cancelar la auditoría, indícalo explícitamente para registrar `phase_abort` en el ledger.

---

**STOP — esperando aprobación humana.**
