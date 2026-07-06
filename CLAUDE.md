# CLAUDE.md — Contrato de trabajo del agente en Booster AI

Marketplace B2B de logística sostenible (empty-legs + huella GLEC v3.0 / GHG / ISO 14064). Owner: Felipe Vicencio (`dev@boosterchile.com`). Monorepo pnpm/Turborepo: 9 apps (`apps/`), 20 packages (`packages/`), Terraform (`infrastructure/`), GCP Cloud Run + GKE.

## Fuente de verdad

- **ADRs** (`docs/adr/`) fijan las decisiones; se supersede con ADR nuevo, jamás se edita el viejo. **Specs aceptadas** (`.specs/<slug>/`) fijan cada feature. **Nada de eso se reabre desde código**: si la implementación contradice un cimiento, DETENTE y escala el conflicto explicado. No resuelvas por criterio propio.
- Estado del proyecto: `docs/handoff/CURRENT.md` (máx. ~150 líneas; el detalle vive en snapshots fechados).

## Frontera de decisiones

**Claude decide solo**: estructura interna de módulos, detalles de implementación, nombres internos, refactors que no alteran contratos públicos, elección táctica de librerías menores ya alineadas al stack.

**Claude NO decide** (aprobación explícita del PO): merge a `main` · contratos públicos (API, UI, schema BD) · migraciones destructivas o que tocan datos · deploys y activaciones en prod · secretos (solo Terraform/consola, jamás desde código) · cambios a `CLAUDE.md`, ADRs, quality gates de CI, IAM/Billing en `infrastructure/` · tomar deuda deliberada (siempre con issue/plan, nunca en silencio).

## Ciclo de trabajo

1. **Un frente por vez.** Máx. 3 PRs propios abiertos; no se abre frente nuevo con un sweep o batch pendiente de cierre. Cerrar antes de abrir.
2. **Criterio de salida antes de construir**: `.specs/<slug>/spec.md` declara entradas, salidas y criterios de éxito ANTES del primer commit de código. Convención: `.specs/<slug>/{spec,plan,verify,review,ship}.md`.
3. **TDD con rojo exhibido en dominio crítico** (DTE/SII, factoring, pricing, GLEC, matching, migraciones, auth): primero el test, se muestra el ROJO, luego implementación. El output del rojo va en la Evidencia del PR. Sin rojo exhibido, no cierra.
4. **Terminado = evidencia fresca**: tests + lint + typecheck + build corridos en el momento, output en el PR. Salida producida ≠ salida útil. Sin placeholders ni `TODO` en código entregado; un `catch` nunca traga errores en silencio.
5. **Bloqueo**: máx. ~4 intentos; después escala con diagnóstico clasificado (contexto faltante / supuesto erróneo / mal uso de herramienta / salida incompleta). No repetir una estrategia que ya falló.
6. **Cierre de tarea**: commit (Conventional Commits con scope, summary en español ≤72 chars) + push de la rama feature, incluyendo `.specs/`. Jamás push directo a `main`. Cambios sin persistir se declaran, no se dejan pendientes en silencio.

## Reglas duras del stack (contratos; cambiarlas exige ADR)

- **Types**: zero `any`, zero `@ts-ignore` sin issue, zero `as unknown as T` sin Zod previo. Tipo dudoso → Zod schema + `z.infer<>`.
- **Boundaries**: todo input externo (HTTP, env, Pub/Sub, APIs externas) pasa por Zod antes de tocar lógica.
- **Observabilidad**: zero `console.*` — `@booster-ai/logger` estructurado con `trace_id`; span OTel y métrica de negocio en cada endpoint nuevo.
- **Seguridad**: secretos en Secret Manager; JWT Zero-Trust (ADR-001); API keys GCP con restricciones.
- **Testing**: coverage 80%+ en código nuevo (CI bloquea); `*.test.ts` junto al archivo; integration en `test/integration/`; E2E Playwright solo flujos críticos.
- **Arquitectura**: domain canónico en `packages/shared-schemas/src/domain/`; algoritmos puros en `packages/` (prohibida lógica de matching/carbono inline en services); imports absolutos con alias.
- **Naming bilingüe**: código TS en inglés camelCase; SQL en español snake_case sin tildes; enums en español snake_case (siglas internacionales exentas); UI en español con tildes. `Transportista`/`GeneradorCarga` (carrier/shipper deprecated). Archivos kebab-case = export principal.

## PRs y deploy

- PR: título Conventional Commits, sección `## Evidencia` obligatoria (tests, lint, typecheck, build, screenshots/curl si aplica). Squash merge a `main`. Ramas: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.
- Deploy prod: merge a `main` → `release.yml` → gate humano (`required_reviewers` en Environment `production`) → Cloud Build canary 1%→100%. Monitoreo 2h post-deploy (error rate, P95, logs). No hay staging (`#STAGING-ENV`); el nightly E2E pega a prod — deuda declarada, pendiente de re-firma del PO.

## Herramientas de apoyo (sin responsabilidad contractual)

- **`booster-skills`** (plugin, Claude Code): conocimiento de dominio (GLEC, matching, deploy Cloud Run, stack conventions) + sub-agents de auditoría. Úsalo cuando esté disponible; este contrato no depende de él.
- **`superpowers`** (plugin, Claude Code): refuerzo opcional de proceso. Ídem.
- Checklists en `references/`; decisiones de producto en `playbooks/`.
- La disciplina de este proyecto la hacen cumplir: este contrato + CI/pre-commit (gitleaks, coverage, check-adr-numbering, spec-drift, preflight de secretos) + los gates humanos de GitHub. Ninguna regla de este archivo delega su cumplimiento a un plugin (ADR-072).

## Archivos que NUNCA se tocan sin permiso explícito

`CLAUDE.md` · `docs/adr/*.md` · `infrastructure/main.tf` (IAM/Billing) · quality gates en `.github/workflows/*.yml` · secretos.

---
*Contrato adoptado 2026-04-23 · reescrito 2026-07-06 ([ADR-072](docs/adr/072-disciplina-inline-plugins-como-conocimiento-opcional.md): disciplina inline; supersede ADR-049/060 en responsabilidades). Historia de la capa de plugins: ADR-049/050/060/064 y `docs/plugins/`.*
