# EXTENSIONS_RECOMMENDATIONS — Subagents, Hooks y MCPs sugeridos para misiones futuras

**Tipo**: Catálogo de extensiones derivadas de los hallazgos de la auditoría (no implementadas).
**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Generado**: 2026-05-19
**Origen**: análisis de las brechas detectadas en `01..06_*.md`. Cada propuesta cita el hallazgo que la motiva.

> Las extensiones aquí listadas **no** se crean automáticamente. Son recomendaciones priorizadas por impacto operativo para futuras sesiones de agent en este repo.

---

## 1. Subagents recomendados (`.claude/agents/<name>.md`)

### S-001 — observability-cabling-auditor

- **Disparador**: CC-1 / R-001 P0 (OTel + `pino-http` declarados con 0 imports).
- **Propósito**: verificar, antes de cada `/ship`, que todo endpoint productivo emite log con `correlationId` + span OTel + métrica custom si aplica (regla CLAUDE.md §6).
- **Inputs**: `apps/*/src/**/*.ts`, `apps/api/src/instrumentation.ts` (si existe), `package.json` deps `@opentelemetry/*`.
- **Output**: reporte de endpoints sin instrumentación con `archivo:línea`.
- **Modelo sugerido**: `haiku` (búsqueda estática).
- **Pre-requisito**: ADR-050 (R-A2) aprobado primero, para fijar criterios de cableado.

### S-002 — bundle-budget-monitor (frontend)

- **Disparador**: CC-2 / R-002 P1 (38 rutas eager, 4 deps muertas, Tremor+Maps+Firebase en initial chunk).
- **Propósito**: tras cada PR que toque `apps/web`, ejecutar `vite build --analyze`, parsear output, compararlo contra budget (ej. < 200KB gzip initial chunk, < 50KB por route lazy), fallar si excede.
- **Inputs**: output de `vite build`, `apps/web/src/router.tsx`, `package.json` deps.
- **Output**: tabla de chunks + verdict "within budget"/"over budget".
- **Modelo sugerido**: `haiku`.
- **Stack alterno**: si no se quiere subagent, equivalente como GitHub Action con `rollup-plugin-visualizer` + diff bot.

### S-003 — stub-cliff-watcher

- **Disparador**: CC-3 / R-011 P1 (8 placeholders productivos sin enforcement).
- **Propósito**: detectar cuando un package/app sigue siendo placeholder pasada su `deadline` documentada en ADR-051 (cuando se cree). Falla CI si stub vence su fecha objetivo.
- **Inputs**: `.specs/stubs-decision/spec.md` (o ADR-051), `apps/<skeleton>/src/main.ts`, `packages/<stub>/src/index.ts`.
- **Output**: warnings por stubs que llegaron al deadline + bloqueante si excedieron.
- **Modelo sugerido**: `haiku`.

### S-004 — node-version-drift-checker

- **Disparador**: CC-4 / R-004 P1 (`.nvmrc=22` vs CI=24 en 4 workflows).
- **Propósito**: hook CI que verifica congruencia entre `.nvmrc`, `engines.node`, ADR-001 (parseado por regex), y `node-version`/`NODE_VERSION` en todos los `.github/workflows/*.yml`. Falla si divergen sin ADR superseding.
- **Output**: tabla `archivo → versión declarada → versión esperada`.
- **Modelo sugerido**: `haiku`.
- **Forma alterna**: script puro `scripts/repo-checks/check-node-version.mjs` siguiendo el patrón existente.

### S-005 — terraform-state-leak-detector

- **Disparador**: CC-6 / R-014 P1 (`apply-plan.tfplan` + `.tfvars.local` en git).
- **Propósito**: scan recurrente que detecta `*.tfplan`, `*.tfstate*`, `*.tfvars.local`, `.terraform/` files en `git ls-files`. Bloqueante en pre-commit.
- **Output**: lista de paths ofensivos.
- **Modelo sugerido**: `haiku`.
- **Forma alterna**: gitleaks rules + `.gitignore` enforcement script.

### S-006 — algorithm-boundary-linter

- **Disparador**: CC-5 / R-012 P2 (haversine en service).
- **Propósito**: detectar funciones puras (sin DB/IO) definidas en `apps/*/src/services/` que deberían vivir en `packages/`. Heurística: función con cero `await` de `db.*`, sin `import` de Drizzle/pg, exportada por nombre.
- **Output**: lista de candidatos a migrar con justificación.
- **Modelo sugerido**: `sonnet` (clasificación heurística).

### S-007 — adr-staleness-watcher

- **Disparador**: H-ARCH-02 + H-ARCH-08 (drift CLAUDE.md ↔ realidad + ADR-008 file-based router vs manual).
- **Propósito**: detectar drift entre ADRs y la realidad — leer cada ADR, extraer afirmaciones verificables (paths, módulos, libraries declaradas), comparar contra `git ls-files` y `package.json`. Reportar afirmaciones inválidas.
- **Modelo sugerido**: `sonnet` (lectura ADRs + parseo + cross-check).

### S-008 — schema-drift-amplifier

- **Disparador**: ADR-043 ya tiene `scripts/repo-checks/drift-inventory.mjs`, pero la heurística `normalizeForMatch` tiene follow-up T1.0 (mejorar) y T1.x.parser (parsear `@drift-status` annotations).
- **Propósito**: subagent que ejecuta `drift-inventory.mjs --json`, parsea findings, los clasifica por taxonomía extendida (Clase A/B/C/H/I), produce report human-readable + sugiere fixes basados en patrones aprendidos (S1a).
- **Modelo sugerido**: `sonnet`.

### S-009 — pdf-lib-migration-validator

- **Disparador**: CC-8 / R-016 P1 (pdf-lib stale, firma documentos legales).
- **Propósito**: subagent que, durante una migración a alternativa de PDF, valida byte-equivalence de certificados generados antes/después (fixture-based comparison) + verifica firmas KMS+signpdf intactas.
- **Modelo sugerido**: `sonnet`.
- **Vida útil**: vinculada a la duración de ADR-049 implementación.

### S-010 — chile-compliance-evidence-auditor

- **Disparador**: contexto del proyecto (DTE SII, Carta Porte Ley 18.290, retención 6 años, GLEC v3.0).
- **Propósito**: verificar que cada feature que produce documento legal o emisión de CO₂ certificada (a) tiene tests fixture-based de regresión, (b) emite hash + timestamp para chain of custody, (c) cumple metadata GLEC (boundaries, factor emisión, fuente).
- **Modelo sugerido**: `sonnet` (legal/compliance reasoning).

---

## 2. Hooks recomendados

### H-001 — pre-commit: stub-deadline-check (`scripts/repo-checks/check-stub-deadlines.mjs`)

- **Disparador**: CC-3.
- **Propósito**: si commit toca un workspace que está en ADR-051 con fecha vencida, bloquea hasta que sea decisión "implementar | extraer | eliminar".
- **Forma**: Node script en `scripts/repo-checks/`, añadido a `.husky/pre-commit` después del check de drift.

### H-002 — pre-commit: terraform-leak-prevention

- **Disparador**: CC-6 / R-014.
- **Propósito**: bloquea commits que añaden `*.tfplan`, `*.tfstate*`, `*.tfvars.local`, `.terraform/*`.
- **Forma**: script Node que cruza `git diff --cached --name-only` con la lista de patterns prohibidos. Salida 1 con mensaje claro.

### H-003 — CI: coverage-workspace-completeness (`.github/workflows/ci.yml`)

- **Disparador**: R-003 P1 quick win.
- **Propósito**: en el job test, después de correr coverage, listar workspaces esperados (vía `pnpm -r exec`) y validar que cada uno emitió `coverage-summary.json`. Falla si alguno NO emitió summary (no solo si está bajo umbral).
- **Forma**: bash inline en el step actual, ~10 líneas.

### H-004 — CI: node-version-congruence-check

- **Disparador**: CC-4 / R-004 quick win.
- **Propósito**: matriz que valida `.nvmrc`, `engines.node`, y `NODE_VERSION` en cada workflow. Falla si difieren sin un ADR de superseding (detectado por regex `supersedes ADR-001` en archivos `docs/adr/`).
- **Forma**: nuevo workflow `.github/workflows/repo-consistency.yml` o step en `ci.yml`.

### H-005 — pre-push (opcional): tfplan-hash-verification

- **Disparador**: prevent ataque cadena suministro Terraform.
- **Propósito**: si push toca `infrastructure/*.tf`, ejecutar `terraform fmt -check` + validar que no se introdujo `apply-plan.tfplan` ni `.terraform/`.
- **Forma**: Node script en `scripts/`, hook `.husky/pre-push` (no existe hoy, requiere crearlo).

### H-006 — agent-rigor: observability-gate

- **Disparador**: R-001 P0.
- **Propósito**: hook agent-rigor que, en transición a `/ship`, bloquea si `apps/api/src/instrumentation.ts` no existe O si los deps `@opentelemetry/*` están declarados pero sin imports en `src/`. Justificable con `[waiver: permanente <ADR-link>]`.
- **Forma**: extender el `hooks/pre-tool-use.sh` del plugin agent-rigor con check específico Booster AI.

### H-007 — pre-commit: chile-bilingual-naming-check

- **Disparador**: convención CLAUDE.md (TS camelCase ↔ SQL snake_case sin tildes).
- **Propósito**: verifica que cada `pgTable('nombre_sql', { ... })` use snake_case sin tildes en SQL name y camelCase en TS name. Detecta drift.
- **Forma**: script Node que parsea `apps/api/src/db/schema.ts`.

---

## 3. MCP Servers recomendados

### MCP-001 — GitHub MCP (HTTP transport)

- **Disparador**: PR review, commit analytics, dependabot triage.
- **Comando setup**: `claude mcp add --transport http github https://api.githubcopilot.com/mcp/`
- **Use case**: subagents pueden consultar PRs abiertos, commits recientes, dependabot status, sin shell-out a `gh`.
- **Auth**: requiere handshake del usuario (OAuth GitHub Copilot).

### MCP-002 — Cloud SQL read-only (stdio)

- **Disparador**: validar drift schema vs código en tiempo real, queries de inspección post-deploy.
- **Comando setup**: `claude mcp add --transport stdio postgres-readonly --env "DATABASE_URL=$BOOSTER_CLOUD_SQL_READONLY_URL"`
- **Use case**: subagent `schema-drift-amplifier` puede ejecutar queries `SELECT typname FROM pg_type ...` para confirmar enum values reales.
- **Restricción**: SOLO read-only (usar role Postgres `read_only`).
- **Procedimiento**: ver memoria `reference_prod_db_headless_query.md` para conectar via IAP tunnel.

### MCP-003 — Terraform State read-only

- **Disparador**: validar que el state real coincide con lo que `infrastructure/*.tf` describe (post-apply audit).
- **Comando setup**: `claude mcp add --transport stdio terraform-state --env "TF_STATE_BUCKET=..."`
- **Use case**: subagent compara `terraform state list` con `infrastructure/*.tf`.
- **Restricción**: solo lectura de state, NO `terraform apply` / `destroy`.

### MCP-004 — Cloud Build history (HTTP)

- **Disparador**: análisis de regresiones en deploy time, frecuencia de failures.
- **Use case**: subagent SRE puede consultar últimos 50 builds, identificar patrones de fallo.

### MCP-005 — Pub/Sub topic inspector

- **Disparador**: debuggear pipelines telemetría sin shell-out.
- **Use case**: subagent valida que `telemetry-tcp-gateway` está publicando al topic correcto y `telemetry-processor` está consumiendo.

### MCP-006 — Sentry / error monitoring (cuando se introduzca)

- **Disparador**: una vez que R-001 (OTel cableado) + Sentry estén live, MCP para incident triage.
- **Use case**: subagent on-call lee últimos 20 errores, correlaciona con releases.

---

## 4. Skills custom recomendadas (`skills/<name>/SKILL.md`)

### SK-001 — `skill/glec-emission-calculation`

- **Disparador**: producto core (carbon-calculator).
- **Propósito**: pasos canónicos para añadir un nuevo cálculo de emisiones GLEC v3.0 — desde definir boundaries, validar factor emisión, generar evidencia para CDP/SBTi, hasta tests fixture-based.

### SK-002 — `skill/dte-integration-chile`

- **Disparador**: producto core (dte-provider para SII Chile).
- **Propósito**: pasos canónicos para integrar un nuevo tipo de documento tributario electrónico — folios, firma electrónica, retención 6 años, contingencia offline.

### SK-003 — `skill/telemetry-codec-handler`

- **Disparador**: producto core (telemetry-tcp-gateway, codec8-parser).
- **Propósito**: añadir soporte para nuevo codec Teltonika (e.g., codec 16) — parser, persistencia, dedup, dashboards.

### SK-004 — `skill/post-deploy-smoke`

- **Disparador**: `release.yml:84` 3-retry smoke test existente.
- **Propósito**: checklist post-deploy estandarizado — health endpoints, OTel trace sanity, métricas baseline.

### SK-005 — `skill/agent-rigor-meta-task`

- **Disparador**: esta auditoría misma fue meta-task con `skip_cycle_declared`.
- **Propósito**: cuándo y cómo declarar `[skip-cycle: meta-task]`, qué artefactos producir, dónde almacenarlos para que el benchmark agent-rigor no penalice.

---

## 5. Configuración `.claude/settings.json` permanente (vs sesión audit)

### Variantes propuestas

1. **Modo `audit-only`** (actual): bloquea writes fuera de `audit-outputs/`, `.claude/`, `/tmp/`. Útil solo para sesiones de auditoría.
2. **Modo `feature-dev`**: permite writes en `apps/*`, `packages/*`, `.specs/*`, pero bloquea writes en `infrastructure/`, `docs/adr/`, `.github/workflows/`, `CLAUDE.md` sin override explícito.
3. **Modo `infra-change`**: permite writes en `infrastructure/`, pero exige `[waiver: <ADR link>]` en el mensaje de commit y requiere PR aprobado humano.

### Mecanismo propuesto

Un script `scripts/claude-mode.mjs` que renombra entre `.claude/settings.{audit,feature,infra}.json` y `.claude/settings.json` según contexto. Cada modo es un preset.

---

## 6. Priorización por impacto

| Extensión | Tipo | Impacto operativo | Esfuerzo | Sprint sugerido |
|---|---|---|---|---|
| H-006 (observability-gate) | Hook | Bloquea TRL 10 si no se cumple §6 | S | Sprint 1 (después de R-001) |
| H-003 (coverage-completeness) | Hook | Cierra by-pass del gate cobertura | S | Sprint 1 (con R-003) |
| H-004 (node-version-congruence) | Hook | Previene drift Node | S | Sprint 1 (con R-004) |
| H-002 (terraform-leak) | Hook | Previene fuga IaC | S | Sprint 1 (con R-014) |
| S-002 (bundle-budget) | Subagent | Previene regression frontend | M | Sprint 2 (con R-002) |
| S-003 (stub-cliff-watcher) | Subagent | Enforce ADR-051 | M | Sprint 2 (con R-011) |
| S-005 (tf-state-leak) | Subagent | Defense-in-depth IaC | S | Sprint 2 |
| MCP-001 (GitHub) | MCP | Habilita PR analytics | S | Sprint 2 |
| MCP-002 (Cloud SQL RO) | MCP | Habilita drift live | M | Sprint 3 |
| SK-001..SK-004 (skills producto) | Skill | Acelera onboarding de features | M c/u | Sprint 3+ |
| S-001 (observability-auditor) | Subagent | Continuous compliance §6 | M | Sprint 3 (después de R-001 + ADR-050) |
| S-006 (algorithm-boundary) | Subagent | Enforce regla packages | M | Sprint 3 |
| S-008 (schema-drift-amplifier) | Subagent | Mejora ADR-043 enforcement | M | Sprint 3 (con T1.0 + T1.x.parser) |
| S-009 (pdf-lib-migration) | Subagent | Acompaña R-016 mientras dure | M | Sprint 3+ |
| S-010 (chile-compliance) | Subagent | TRL 10 evidence | L | Pre-launch |

---

## 7. Anti-recomendaciones (NO hacer)

Para evitar ruido, estas son ideas que NO recomendamos:

- ❌ Subagent "fix-everything-auto": demasiado amplio, viola disciplina spec-first.
- ❌ Hook que ejecuta `pnpm install` automáticamente en branch switch: rompe reproducibilidad.
- ❌ MCP con permisos write a producción (Cloud SQL, GCP IAM): infra debe pasar por Terraform PR.
- ❌ Subagent que genera ADRs automáticamente sin revisión humana: ADRs son decisiones, no documentación generada.
- ❌ Hook que silencia warnings de drift sin ADR: derrota el propósito del enforcement.

---

*Fin de EXTENSIONS_RECOMMENDATIONS.md.*
*Catálogo derivado de hallazgos en `01..06_*.md`. Implementación discrecional según roadmap.*
