# CLAUDE.md — Contrato del agente en Booster AI

Marketplace B2B de logística sostenible (empty-legs + huella GLEC v3.0 / GHG / ISO 14064). PO: Felipe Vicencio (`dev@boosterchile.com`). Monorepo pnpm 10 + Turborepo, Node 24: apps en `apps/`, packages en `packages/`, Terraform en `infrastructure/`, GCP (Cloud Run + GKE). Este archivo es el contrato normativo; el stack y los comandos canónicos vienen de `AGENTS.md`, importado aquí:

@AGENTS.md

Un solo test: `pnpm --filter <paquete> exec vitest run <archivo>`.

## Fuente de verdad

- **ADRs** (`docs/adr/`) fijan decisiones; se superseden con ADR nuevo, nunca se editan. Vigencia según [ADR-076](docs/adr/076-gobernanza-operador-unico.md): `Vigente`, `Superado por ADR-NNN`, `No perseguido`. Una etiqueta vieja (`Accepted`, `Proposed`) no certifica vigencia: manda el ADR posterior.
- **Specs aceptadas** (`.specs/<slug>/{spec,plan,verify,review,ship}.md`) fijan cada feature. Si la implementación contradice un cimiento, detente y escala el conflicto. No lo resuelvas por criterio propio.
- Qué se construye: `docs/frentes-vivos.md`. Estado del repo: `docs/handoff/CURRENT.md` (máx. ~150 líneas; léelo al iniciar, actualízalo al cerrar).

## Alcance y autonomía

- Haz exactamente lo pedido. Lo no pedido se propone en una línea al final, no se hace.
- Si no harás algo pedido, o lo harás distinto, dilo antes de empezar y con el motivo.
- Sin preguntar: leer, editar, ramas, commits, push de la rama de trabajo, abrir PR, dependencias del proyecto, verificación, y el merge según la regla de abajo.
- Preguntar solo por lo que sigue en «El agente no decide» y por los archivos protegidos.

## Frontera de decisiones

**Decide el agente**: estructura interna de módulos, detalles de implementación, nombres internos, refactors que no alteran contratos públicos, librerías menores ya alineadas al stack.

**Decide el PO**: contratos públicos (API, UI, schema BD) · migraciones destructivas o que tocan datos · deploys y activaciones en prod · `terraform apply` en prod · migraciones `contract` · `REAPER_DESTRUCTIVE=true` · secretos (solo Terraform o consola) · cambios a `CLAUDE.md`, ADRs, quality gates de CI, IAM/Billing en `infrastructure/` · deuda deliberada (siempre con issue o plan).

**Merge a `main`**: lo hace el agente con `gh pr merge --squash` cuando todos los checks obligatorios están en verde, sin `--admin` y sin saltar protecciones ([ADR-076](docs/adr/076-gobernanza-operador-unico.md)). Necesitan además el visto explícito del PO en el PR: archivos protegidos, IAM/Billing, quality gates, migraciones `contract` o que tocan datos. El gate humano queda en el deploy a producción.

## Ciclo de trabajo

1. **WIP**: máximo 3 PRs propios abiertos; no se abre frente nuevo con un sweep o batch pendiente. El trabajo de producto sale de la fase activa en `docs/frentes-vivos.md` ([ADR-082](docs/adr/082-objetivo-trl10-supersede-precomercial.md)), máximo tres frentes. No ocupan slot: incidente en prod, seguridad, este contrato y lo que el PO pida.
2. **Spec antes de código**: `.specs/<slug>/spec.md` con entradas, salidas y criterios de éxito antes del primer commit.
3. **TDD con rojo exhibido en dominio crítico** (factoring, pricing, GLEC, matching, migraciones, auth): test primero, rojo mostrado, luego implementación; el rojo va en la Evidencia del PR. Booster no emite DTE ([ADR-069](docs/adr/069-booster-deja-de-emitir-dte-remocion-sovos.md)).
4. **Terminado = evidencia fresca**: `pnpm run ci` corrido en el momento, salida en el PR. Sin placeholders ni `TODO`; un `catch` nunca traga errores.
5. **Bloqueo**: máx. ~4 intentos; después escala con diagnóstico clasificado. No repitas una estrategia que ya falló.
6. **Cierre**: commit (Conventional Commits con scope, summary en español ≤72 chars) + push de la rama, incluyendo `.specs/`. Nunca push directo a `main`. Cambios sin persistir se declaran.

## Reglas duras del stack (cambiarlas exige ADR)

- **Types**: zero `any`, zero `@ts-ignore` sin issue, zero `as unknown as T` sin Zod previo. Tipo dudoso → Zod + `z.infer<>`.
- **Boundaries**: todo input externo (HTTP, env, Pub/Sub, APIs) pasa por Zod antes de tocar lógica.
- **Observabilidad**: zero `console.*`; `@booster-ai/logger` con `trace_id`; span OTel y métrica de negocio en cada endpoint nuevo.
- **Seguridad**: secretos en Secret Manager. Auth: Firebase Auth + RUT y clave numérica ([ADR-028](docs/adr/028-rbac-auth-firebase-multi-tenant-with-consent-grants.md), [ADR-035](docs/adr/035-auth-universal-rut-clave-numerica.md)); servicio a servicio OAuth 2.0 + ADC (ADR-001). Sin JWT propio.
- **Testing**: coverage ≥80% en código nuevo (CI bloquea); `*.test.ts` junto al archivo; integration en `test/integration/`; E2E Playwright solo flujos críticos.
- **Arquitectura**: dominio canónico en `packages/shared-schemas/src/domain/`; algoritmos puros en `packages/`; imports absolutos con alias.
- **Naming bilingüe**: TS en inglés camelCase; SQL y enums en español snake_case sin tildes (siglas exentas); UI en español con tildes. `Transportista`/`GeneradorCarga`. Archivos kebab-case = export principal.

## PRs, staging y deploy

- PR: título Conventional Commits; sección `## Evidencia` obligatoria (tests, lint, typecheck, build, screenshots/curl si aplica). Ramas `feat/`, `fix/`, `chore/` + slug; si la plataforma impone otro prefijo, se usa y el título sigue Conventional Commits.
- **Staging** ([ADR-083](docs/adr/083-staging-gemelo-y-extraccion-con-shadow.md)): proyecto gemelo; `release-staging.yml` despliega a staging en cada push a `main`. Mientras no exista `STAGING_URL`, el nightly E2E sigue pegando a prod (deuda declarada).
- **Deploy a prod: manual, no en merge.** `gh workflow run release.yml --ref main` → gate humano (Environment `production`) → canary 1%→100% → monitoreo 2 h.
- **Irreversible en prod** (`terraform apply`, migraciones `contract`, `REAPER_DESTRUCTIVE=true`): lista de verificación escrita y corrida en seco con salida registrada, antes de ejecutar (ADR-076).

## Qué se impone solo (y qué no)

- **Hooks de git** (`.husky/`): gitleaks, Biome vía lint-staged, commitlint, `check-adr-numbering`, `spec-canonical-drift` al tocar `.specs/`, `docs/` o dominio.
- **CI**: lint, typecheck, tests con coverage ≥80%, build, migration safety; gitleaks, CodeQL, Trivy, npm audit, route default-deny.
- **Permisos locales** (`.claude/settings.local.json`, del operador, no versionados): bloquean push a `main`, force-push, `--admin`, `terraform apply`, deploys y secretos; piden confirmación para archivos protegidos.
- **Solo texto** (depende del agente): spec antes de código, rojo exhibido, WIP ≤3, `## Evidencia`, alcance. El repo no versiona plugins ni hooks de Claude Code ([ADR-078](docs/adr/078-retiro-config-plugins-hooks-claude-code.md)); un hook futuro entra por ADR.

## Archivos que no se tocan sin permiso explícito del PO en el chat

`CLAUDE.md` · `docs/adr/*.md` · secretos · quality gates en `.github/workflows/*.yml` · en `infrastructure/`, cualquier `.tf` que declare IAM, Billing, service accounts, KMS o firewall, sin importar el nombre del archivo. Ante duda, pregunta antes de editar. Con el permiso dado, el agente edita y lo declara en el PR.

---

*Contrato adoptado 2026-04-23 · reescrito 2026-07-06 ([ADR-072](docs/adr/072-disciplina-inline-plugins-como-conocimiento-opcional.md)) · alineado 2026-09-23 a ADR-069/076/078 · merge por el agente autorizado por el PO 2026-10-10 · reescrito 2026-10-21 (alcance, staging ADR-083, qué se impone).*
