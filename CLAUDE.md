# CLAUDE.md — Contrato de trabajo del agente en Booster AI

Marketplace B2B de logística sostenible (empty-legs + huella GLEC v3.0 / GHG / ISO 14064). Owner: Felipe Vicencio (`dev@boosterchile.com`). Monorepo pnpm/Turborepo: apps en `apps/`, packages en `packages/`, Terraform (`infrastructure/`), GCP Cloud Run + GKE. El índice cross-tool (stack, comandos) vive en `AGENTS.md`. Este archivo es el contrato normativo para cualquier agente.

## Fuente de verdad

- **ADRs** (`docs/adr/`) fijan las decisiones; se supersede con ADR nuevo, jamás se edita el viejo. La vigencia es la de [ADR-076](docs/adr/076-gobernanza-operador-unico.md): `Vigente`, `Superado por ADR-NNN` o `No perseguido`. Una etiqueta vieja (`Accepted`, `Proposed`, `Status`) no certifica que la decisión rija: manda el ADR posterior que la supersede, aunque el encabezado viejo no se haya migrado.
- **Specs aceptadas** (`.specs/<slug>/`) fijan cada feature. Si la implementación contradice un cimiento, detente y escala el conflicto explicado. No lo resuelvas por criterio propio.
- Qué se está construyendo: `docs/frentes-vivos.md`. Estado breve del repo: `docs/handoff/CURRENT.md` (máx. ~150 líneas; el detalle vive en snapshots fechados).

## Frontera de decisiones

**El agente decide solo**: estructura interna de módulos, detalles de implementación, nombres internos, refactors que no alteran contratos públicos, elección táctica de librerías menores ya alineadas al stack.

**El agente no decide** (lo hace el PO): contratos públicos (API, UI, schema BD) · migraciones destructivas o que tocan datos · deploys y activaciones en prod · `terraform apply` en producción · migraciones `contract` · modo destructivo del reaper (`REAPER_DESTRUCTIVE=true`) · secretos (solo Terraform/consola, jamás desde código) · cambios a `CLAUDE.md`, ADRs, quality gates de CI, IAM/Billing en `infrastructure/` · tomar deuda deliberada (siempre con issue/plan, nunca en silencio).

**Merge a `main`**: el agente no mergea. La rama se protege por checks ([ADR-076](docs/adr/076-gobernanza-operador-unico.md)), no por un segundo revisor. `--admin` es excepcional y cada uso se declara. El gate humano sigue en el deploy a producción (environment `production`).

## Ciclo de trabajo

1. **WIP de producto.** Máximo 3 PRs propios abiertos; no se abre frente nuevo con un sweep o batch pendiente de cierre. El trabajo de producto sale de los tres slots de `docs/frentes-vivos.md`. Un frente de producto fuera de slot se declara y se detiene. No ocupan slot, y se atienden: incidente en producción, seguridad, este contrato, y lo que el PO pida en el mensaje.
2. **Criterio de salida antes de construir**: `.specs/<slug>/spec.md` declara entradas, salidas y criterios de éxito antes del primer commit de código. Convención: `.specs/<slug>/{spec,plan,verify,review,ship}.md`.
3. **TDD con rojo exhibido en dominio crítico** (factoring, pricing, GLEC, matching, migraciones, auth): primero el test, se muestra el rojo, luego implementación. El output del rojo va en la Evidencia del PR. Sin rojo exhibido, no cierra. Booster no emite DTE ([ADR-069](docs/adr/069-booster-deja-de-emitir-dte-remocion-sovos.md)); ese subsistema no se reabre.
4. **Terminado = evidencia fresca**: tests + lint + typecheck + build corridos en el momento, output en el PR. Sin placeholders ni `TODO` en código entregado; un `catch` nunca traga errores en silencio.
5. **Bloqueo**: máx. ~4 intentos; después escala con diagnóstico clasificado (contexto faltante / supuesto erróneo / mal uso de herramienta / salida incompleta). No repetir una estrategia que ya falló.
6. **Cierre de tarea**: commit (Conventional Commits con scope, summary en español ≤72 chars) + push de la rama de trabajo, incluyendo `.specs/`. Jamás push directo a `main`. Cambios sin persistir se declaran, no se dejan pendientes en silencio.

## Reglas duras del stack (contratos; cambiarlas exige ADR)

- **Types**: zero `any`, zero `@ts-ignore` sin issue, zero `as unknown as T` sin Zod previo. Tipo dudoso → Zod schema + `z.infer<>`.
- **Boundaries**: todo input externo (HTTP, env, Pub/Sub, APIs externas) pasa por Zod antes de tocar lógica.
- **Observabilidad**: zero `console.*` — `@booster-ai/logger` estructurado con `trace_id`; span OTel y métrica de negocio en cada endpoint nuevo.
- **Seguridad**: secretos en Secret Manager. Auth de usuario: Firebase Auth + RUT y clave numérica ([ADR-028](docs/adr/028-rbac-auth-firebase-multi-tenant-with-consent-grants.md), [ADR-035](docs/adr/035-auth-universal-rut-clave-numerica.md)). Servicio a servicio: OAuth 2.0 + ADC (ADR-001). API keys GCP con restricciones. No se introduce un JWT propio.
- **Testing**: coverage 80%+ en código nuevo (CI bloquea); `*.test.ts` junto al archivo; integration en `test/integration/`; E2E Playwright solo flujos críticos.
- **Arquitectura**: domain canónico en `packages/shared-schemas/src/domain/`; algoritmos puros en `packages/` (prohibida lógica de matching/carbono inline en services); imports absolutos con alias.
- **Naming bilingüe**: código TS en inglés camelCase; SQL en español snake_case sin tildes; enums en español snake_case (siglas internacionales exentas); UI en español con tildes. `Transportista`/`GeneradorCarga` (carrier/shipper deprecated). Archivos kebab-case = export principal.

## PRs y deploy

- PR: título Conventional Commits, sección `## Evidencia` obligatoria (tests, lint, typecheck, build, screenshots/curl si aplica). El merge a `main` es squash y lo ejecuta quien opera el repo, con los checks obligatorios en verde. Ramas en el repo: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`. Si la plataforma del agente impone otro prefijo, se usa ese prefijo y el título del PR sigue Conventional Commits.
- Deploy prod: **manual, no en merge** — `release.yml` es `workflow_dispatch`-only desde 2026-07-10 (un push o merge a `main` no despliega). Disparo: `gh workflow run release.yml --ref main` → gate humano (`required_reviewers` en Environment `production`) → Cloud Build canary 1%→100%. Monitoreo 2h post-deploy (error rate, P95, logs). No hay staging (`#STAGING-ENV`); el nightly E2E pega a prod — deuda declarada, pendiente de re-firma del PO.
- Irreversible en prod (ADR-076): `terraform apply`, migraciones `contract` y `REAPER_DESTRUCTIVE=true` exigen lista de verificación escrita y corrida en seco con su salida registrada, antes de ejecutar.

## Qué se verifica solo

- **Pre-commit** (`.husky/pre-commit`): gitleaks, Biome vía lint-staged, `check-adr-numbering` (colisiones 028/034/035 heredadas) y `spec-canonical-drift` cuando el commit toca `.specs/`, `docs/` o el dominio/schema.
- **CI**: lint, typecheck, tests con coverage ≥80%, build, migration safety. Security: gitleaks, CodeQL, Trivy, npm audit, route default-deny.
- **Plan de Terraform** (`terraform-drift.yml`): preflight de placeholders de secretos. La numeración de ADR y el spec-drift corren al commitear; no están en los workflows de CI.

## Herramientas de apoyo

El repo no activa plugins ni hooks de Claude Code ([ADR-078](docs/adr/078-retiro-config-plugins-hooks-claude-code.md)). Instalar `superpowers` o `booster-skills` es decisión del operador, fuera de este repo. Si no están instalados, no se buscan ni se simulan. Checklists en `references/`; decisiones de producto en `playbooks/`. La disciplina la hacen cumplir este contrato, el pre-commit, CI y el gate de deploy.

## Archivos que nunca se tocan sin permiso explícito

- `CLAUDE.md` · `docs/adr/*.md` · secretos · quality gates en `.github/workflows/*.yml`.
- En `infrastructure/`: **cualquier `.tf` que declare IAM, Billing, service accounts, KMS o reglas de firewall**, sin importar su nombre de archivo. La regla protege el tipo de recurso, no la ruta: un rename o un split de módulos no la desactiva. Ante duda sobre si un `.tf` cae bajo esta regla, se pregunta antes de editar.

---

*Contrato adoptado 2026-04-23 · reescrito 2026-07-06 ([ADR-072](docs/adr/072-disciplina-inline-plugins-como-conocimiento-opcional.md)) · alineado 2026-09-23 a ADR-069, ADR-076 y ADR-078.*
