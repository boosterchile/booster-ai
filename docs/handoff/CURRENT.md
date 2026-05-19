# Booster AI — Estado vivo del proyecto

> **Documento vivo**. Se actualiza en cada misión significativa, sprint review o decisión arquitectónica.
> **Última actualización**: 2026-05-19 — consolidación post-auditoría sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`.
> **Updater**: skill `arquitecto-maestro` (workflow `/auto-dream`).
> **Branch de referencia**: `chore/ci-integration-drift-scripts` @ `5d025f1`.

---

## 1. Identidad

| Campo | Valor |
|---|---|
| Display name | Booster AI |
| Slug técnico | `booster-ai` |
| GCP project | `booster-ai-494222` (single project, no multi-env) |
| Owner humano | Felipe Vicencio · `dev@boosterchile.com` |
| Origen | Reescritura greenfield de **Booster 2.0** con cero deuda día 0 |
| Estado objetivo | TRL 10 (probado, certificado, listo para despliegue comercial) |
| Branch principal | `main` (protegida, requiere PR) |

**Misión del producto**: marketplace B2B de logística sostenible. Conecta generadores de carga con transportistas, optimiza retornos vacíos, certifica huella de carbono bajo GLEC v3.0 / GHG Protocol / ISO 14064.

**Compliance requerido**: DTE SII Chile, Carta Porte Ley 18.290 (retención legal 6 años), GLEC v3.0 (evidencia para CDP / SBTi).

---

## 2. Stack canónico (ADR-001 verificado 2026-05-19)

| Pieza | Versión / herramienta | Notas |
|---|---|---|
| Runtime | Node.js 22 LTS (`.nvmrc=22`, `engines.node>=22`) | ⚠️ CI hardcodea Node 24 — drift R-004 abierto |
| Package manager | pnpm 9.15.4 (`packageManager` field) | Workspace + lockfile estricto |
| Build orchestrator | Turborepo 2.9.8 | Pipeline: build/dev/lint/typecheck/test/test:coverage/test:e2e/db:migrate/clean |
| Lenguaje | TypeScript 5.8.2 | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Linter | Biome 1.9.4 | `noExplicitAny=error`, `noConsole=error` |
| Backend HTTP | Hono 4 + `@hono/node-server` + tsup | Cloud Run serverless |
| Base de datos | **Cloud SQL Postgres** + `pg` 8 + Drizzle ORM | Extensión activa: `pgcrypto`. **NO** Neon, **NO** pgvector. |
| Frontend | React 18 + Vite 6 | PWA con `vite-plugin-pwa` + Workbox InjectManifest |
| Router frontend | **@tanstack/react-router** | Routing manual hoy (no file-based aunque plugin instalado) |
| Frontend libs | TanStack Query, react-hook-form, zod, Tremor, lucide-react, Firebase, workbox, idb*, zustand* | `*` declarados sin uso real |
| Auth | Firebase Admin `verifyIdToken(token, true)` + `google-auth-library` SA-to-SA | RS256/ES256 + JWKS |
| Config llaves | `packages/config` (Zod env validation) + Secret Manager via Terraform | **NO** `.env` locales en frontend, **NO** `maps.config.ts` |
| Testing | vitest 4 + Playwright 1.49 + axe-core | Coverage v8, gate ≥80%/75%/80% |
| Linters custom | `scripts/lint-rls.mjs` (RLS) + `scripts/repo-checks/*` (ADR numbering, drift-inventory, spec-canonical-drift) | |
| CI/CD | GitHub Actions (4 workflows) + Cloud Build (3 pipelines) + Workload Identity Federation | Sin SA keys |
| IaC | Terraform flat (18 `.tf`) + 3 módulos (`cloud-run-job`, `cloud-run-service`, `iap-bastion`) | NO layout `main.tf` + `environments/` |
| WAF | Cloud Armor con bypass total para `api.boosterchile.com` | Trade-off documentado (RUTs chilenos rompen reglas SQLi) — R-015 abierto |

**Stack supersedido (NO usar sin ADR explícito)**: `express`, `prisma`, `eslint`, `prettier`, `react-router-dom`, `next`.

---

## 3. Topología del monorepo

```
booster-ai/
├── apps/                   # 9 apps (6 funcionales + 3 skeleton)
│   ├── api/                # Hono — 101 .ts/.tsx, ~26.493 LOC
│   ├── web/                # React PWA — 231 .ts/.tsx, ~28.185 LOC
│   ├── telemetry-tcp-gateway/   # TCP server Codec8 (GKE Autopilot)
│   ├── telemetry-processor/     # Pub/Sub consumer
│   ├── whatsapp-bot/       # Hono webhook Meta + xstate FSM
│   ├── sms-fallback-gateway/    # Hono webhook Twilio
│   ├── document-service/   # SKELETON (R-011 / ADR-051 pendiente)
│   ├── matching-engine/    # SKELETON
│   └── notification-service/    # SKELETON
│
├── packages/               # 21 packages (15 implementados + 5 stubs + 1 ui-tokens)
│   # Implementados:
│   ├── shared-schemas/     # 18 Zod schemas dominio
│   ├── logger/             # Pino + redactores PII (≥30 paths)
│   ├── config/             # env Zod validation
│   ├── carbon-calculator/  # GLEC v3.0
│   ├── matching-algorithm/ # multifactor v2
│   ├── codec8-parser/      # Teltonika
│   ├── pricing-engine/, factoring-engine/, driver-scoring/, coaching-generator/
│   ├── certificate-generator/   # PDF KMS+signpdf (R-016: pdf-lib stale)
│   ├── dte-provider/       # SII Chile
│   ├── whatsapp-client/    # Twilio Content Templates
│   ├── notification-fan-out/    # formatters puros
│   └── ui-tokens/
│   # Stubs (R-011 / ADR-051):
│   └── {ai-provider, trip-state-machine, carta-porte-generator, document-indexer, ui-components}
│
├── infrastructure/         # Terraform FLAT (18 .tf + 3 módulos)
├── docs/adr/               # 50 ADRs (001..048 + colisiones legacy 028/034/035 en ADR-046)
├── docs/handoff/CURRENT.md # este archivo
├── .specs/                 # specs por feature (Plan-Phase, sub-specs)
├── skills/                 # workflows estructurados (6 categorías activas)
├── .claude/                # agentes, ledger agent-rigor, settings
├── .husky/                 # pre-commit 5 stages + commit-msg
├── scripts/repo-checks/    # linters custom (ADR-numbering, drift-inventory, etc.)
└── .github/workflows/      # ci.yml + security.yml + release.yml + e2e-staging.yml
```

---

## 4. Principios rectores activos

Resumidos. Detalle completo en `CLAUDE.md` §Principios rectores.

1. **Cero deuda técnica desde day 0** — sin `any` productivo (Biome lo bloquea), sin `console.*`, sin secretos en repo, sin features sin tests, sin infra manual, sin `*.tfplan`/`*.tfstate`/`*.tfvars.local` en git.
2. **Evidence over assumption** — cada afirmación con output verificable. No afirma sin evidencia.
3. **Process over knowledge** — el agente sigue workflows en `skills/` y hooks `agent-rigor`. No confía en su memoria.
4. **Decisiones en ADRs, no en conversación** — `docs/adr/` es la fuente de verdad arquitectónica.
5. **Type safety end-to-end** — Drizzle schema → `packages/shared-schemas` (Zod) → TanStack Query types inferidos. Sin frontera de tipos perdidos.
6. **Observabilidad desde el primer endpoint** — `correlationId` + span OTel + métrica custom desde T=0. **⚠️ GAP P0 ABIERTO (R-001)**.
7. **Seguridad por defecto** — validación Zod en toda input externa, queries parametrizadas (Drizzle/pg), ADC + OAuth (nunca API keys salvo legacy ADR-009), PII redacción Pino, pre-commit gitleaks + 5 stages.

---

## 5. Estado de auditoría arquitectónica (2026-05-19)

**Veredicto**: Booster AI cumple materialmente con 6/7 principios rectores. TRL 10 bloqueado por 1 hallazgo P0 + 14 P1.

| Severidad | Count | Esfuerzo agregado | Ventana objetivo |
|---|---:|---|---|
| **P0** — bloquea TRL 10 | 1 | M (1–3 días) | Sprint 1 |
| **P1** — degrada calidad o riesgo conocido | 14 | mezcla S/M + 1 L | Sprints 1–2 |
| **P2** — deuda incremental | 10 | mayormente S/M | Sprint 3+ |
| **Total** | **25** | ~3 sprints | ~6 semanas |

**Métricas de salud verificadas**:
- 0 vulnerabilidades críticas/altas en producción (2 moderates dev-only fixables con `pnpm overrides`).
- 0 secrets en cleartext en repo (2 keys públicas Firebase Web + Maps allowlisteadas en `.gitleaks.toml`).
- 0 drift en vocabulario sobre 446 commits últimos 30 días (Conventional Commits limpios).
- 4 `any` productivos detectados — todos adaptadores externos con `biome-ignore` justificada.

### 5.1 El único P0

**R-001 — Cablear OpenTelemetry + `pino-http` en `apps/api`** (esfuerzo M, 1–3 días).

`apps/api/package.json` declara 7 paquetes OTel + `pino-http` con **0 imports en `src/`**. `main.ts` no preload-ea `NodeSDK`. Viola CLAUDE.md §6 ("Observabilidad desde el primer endpoint"). Auditoría externa pre-TRL 10 lo flageará de inmediato.

Fix: `apps/api/src/instrumentation.ts` con `NodeSDK` + `OTLPTraceExporter` → Cloud Trace + middleware Hono para `correlationId` + cableo `pino-http`. Alternativa: ADR-050 superseding §6 (no recomendado).

### 5.2 8 hallazgos cross-cutting

| Code | Tema | Dimensiones | Recom. |
|---|---|---|---|
| CC-1 (P0) | OTel declarado sin cablear | deps + arch + tech-debt | R-001 |
| CC-2 (P1) | Bundle frontend inflado: 38 rutas eager + 4 deps muertas | perf + deps | R-002 + R-010 |
| CC-3 (P1) | 8 stubs by-passan gate cobertura | arch + tech-debt + ci | R-003 + R-011 |
| CC-4 (P1) | Node 22 (ADR-001) vs Node 24 (CI) | arch + reproducibilidad | R-004 |
| CC-5 (P2) | `haversineKm` en service en vez de `packages/` | arch + perf + tech-debt | R-012 |
| CC-6 (P1) | CLAUDE.md describe Terraform inexistente + `.tfplan`/`.tfvars.local` en git | arch + security | R-013 + R-014 |
| CC-7 (P1) | Bypass total WAF Cloud Armor para `api.boosterchile.com` | security | R-015 |
| CC-8 (P1) | `pdf-lib` 4 años sin commits, usado en firma legal con retención 6 años | deps + compliance | R-016 |

### 5.3 Roadmap consolidado

- **Sprint 1** (2 semanas) — "Cierre del gap observable": R-001 P0 + 9 quick wins (R-003, R-004, R-005, R-006, R-007, R-008, R-009, R-014, R-024).
- **Sprint 2** (2 semanas) — "Frontend y boundaries": R-002, R-010, R-011, R-013, R-015 + quick wins R-012, R-018, R-022, R-025.
- **Sprint 3+** — "Mantenimiento deps y deuda calidad": R-016 (L), R-017, R-019, R-020, R-021, R-023.

### 5.4 ADRs propuestos (pendientes redactar + PR)

- **ADR-049 (R-A1)** — reemplazo `pdf-lib` por mantenimiento congelado.
- **ADR-050 (R-A2)** — política observabilidad obligatoria + cableado OTel.
- **ADR-051 (R-A3)** — resolución 8 stubs (implementar/extraer/eliminar).
- **ADR-052 (R-A4)** — estructura definitiva Terraform (flat vs environments).
- **ADR-053 (R-A5)** — frontend security headers + CSP.

### 5.5 Artefactos completos en `audit-outputs/`

Sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7` produjo 12 markdown + 1 log:
`SESSION_CLAUDE.md`, `Implementation_Plan.md`, `01_ARCHITECTURE.md`, `02_DEPENDENCIES.md`, `03_SECURITY_FINDINGS.md`, `04_PERFORMANCE_FINDINGS.md`, `05_TECH_DEBT_REGISTRY.md`, `06_REFACTOR_PRIORITIES.md`, `PROJECT_OVERVIEW.md`, `CLAUDE.md` (propuesto, no promovido), `EXTENSIONS_RECOMMENDATIONS.md`, `SUMMARY.md`, `.execution.log`.

---

## 6. Decisiones humanas pendientes (NO automatizables por agentes)

1. **Promoción del `audit-outputs/CLAUDE.md` propuesto al `CLAUDE.md` del repo** — requiere ADR de transición + PR humano. El propio documento se marca como "no promover automáticamente".
2. **Resolución de los 8 stubs** (5 packages + 3 apps skeleton): decidir por cada uno entre **implementar | extraer del monorepo | eliminar**. Genera ADR-051.
3. **Estructura Terraform definitiva**: confirmar flat actual o migrar a `environments/{dev,staging,prod}/`. Genera ADR-052.
4. **Aprobación del Sprint 1** (10 items, ~7–10 días con dedicación).

---

## 7. Framework de trabajo activo

- **Marco de referencia**: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) — production-grade engineering skills para AI coding agents.
- **agent-rigor**: ledger en `.claude/ledger/` registra sesiones, decisiones, cierres.
- **Skills estructuradas** en `skills/` con formato canónico (When to use / Core process / Anti-rationalizations / Exit criteria).
- **specs por feature** en `.specs/` (Plan-Phase + sub-specs).
- **Pre-commit (5 stages)**: gitleaks + lint-staged + ADR numbering + drift gate + spec-canonical-drift.
- **CI completo**: lint + typecheck + test+coverage gate + drift-checks + build + security (gitleaks history full, pnpm audit HIGH, CodeQL, Trivy fs+config, SBOM CycloneDX).
- **Workload Identity Federation** (sin SA keys) para deploy + DWD sin keys via Workspace Identity Federation.

### 7.1 Migración arquitectónica en curso (2026-05-19)

**Decisión tomada**: el "Arquitecto Maestro" deja de vivir como Project Instructions en claude.ai y se transforma en `skills/arquitecto-maestro/SKILL.md` versionada en el repo. Razón: coherencia con Principio §3 (Process over knowledge), versionado git, acceso al filesystem real (evita stack drift), composición nativa con subagents existentes.

El Project en claude.ai queda como espacio de exploración temprana / brainstorming previo a comprometer en skills+specs, **no como meta-orquestador permanente**.

---

## 8. Comandos canónicos (verificados vs `package.json` real 2026-05-19)

| Operación | Comando |
|---|---|
| Bootstrap | `pnpm install` |
| Dev (todos) | `pnpm dev` → `turbo run dev` |
| Build | `pnpm build` → `turbo run build` |
| Type check | `pnpm typecheck` |
| Lint | `pnpm lint` → `biome check . && pnpm lint:rls` |
| Lint fix | `pnpm lint:fix` |
| Tests | `pnpm test` → `vitest run --passWithNoTests` |
| Tests con coverage | `pnpm test:coverage` (gate ≥80%/75%/80%) |
| Tests E2E | `pnpm test:e2e` (Playwright en `apps/web`) |
| CI local | `pnpm ci` → `lint && typecheck && test && build` |
| Gitleaks full | `pnpm security:scan` |
| Gitleaks staged | `pnpm security:scan-staged` |

Filtros: `pnpm --filter @booster-ai/<name> <cmd>`.

---

## 9. Próximas misiones del Arquitecto

Ordenadas por dependencia y criticidad:

1. **[esta sesión]** Commitear `docs/handoff/CURRENT.md` (este archivo) + `skills/arquitecto-maestro/SKILL.md`.
2. **[esta semana]** Redactar ADR-050 (observabilidad) + ejecutar R-001 (cablear OTel).
3. **[esta semana]** Sprint 1 quick wins: R-005, R-006, R-014, R-024 (cero esfuerzo cognitivo, alto impacto).
4. **[Sprint 1]** Cerrar gate coverage by-pass (R-003) + reconciliar Node version drift (R-004).
5. **[Sprint 2]** Redactar ADR-051 (stubs) + ADR-052 (Terraform) + ADR-053 (security headers).
6. **[Sprint 2]** Bundle frontend (R-002) + boundaries (R-012).
7. **[Sprint 3]** Migración `pdf-lib` (R-016) + ADR-049.

---

*Fin de CURRENT.md. Próxima actualización: al cerrar Sprint 1 o ante cualquier cambio arquitectónico significativo.*
