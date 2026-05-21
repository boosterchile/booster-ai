# Reporte de migración: booster-ai/skills + booster-ai/.claude/agents → boosterchile/booster-skills v0.1.0

- **Fecha**: 2026-05-20
- **Source repo**: `boosterchile/booster-ai` (paths `skills/` y `.claude/agents/`)
- **Target repo**: `boosterchile/booster-skills` v0.1.0 (paths `skills/` y `agents/`)
- **Source dump**: `booster-skills-source-dump.txt` (1545 líneas, 67824 bytes)

---

## Resumen ejecutivo

| Métrica | Valor |
|---|---|
| Skills auditados en source | 5 |
| Skills migrados | 5 (100%) |
| Skills agregados (nuevos) | 2 (`booster-stack-conventions`, `booster-deploy-cloud-run`) |
| Total skills en target | 7 |
| Agents auditados en source | 6 |
| Agents migrados | 6 (100%) |
| Agents agregados (nuevos) | 0 |
| Total agents en target | 6 |
| Skills NO migradas (deprecadas) | 2 (`writing-adrs`, `using-agent-skills`) — cubiertas por agent-rigor |
| Bugs corregidos | 1 (referencia a agent fantasma `devops-sre` — solo aparecía en commands/ que se borran) |

---

## Archivo por archivo: cambios aplicados

### Skills migrados

#### 1. `arquitecto-maestro` (v1.0.0 → v1.1.0)

**Cambios sustanciales:**

| # | Cambio | Razón |
|---|---|---|
| 1 | `description` ampliada con keywords de triggering | El skill-creator de Anthropic recomienda hacer descripciones "pushy" para mejor auto-triggering. La descripción original era neutra. |
| 2 | `references` reducidas a 3 (de 3) — eliminada `audit-outputs/EXTENSIONS_RECOMMENDATIONS.md` y `audit-outputs/CLAUDE.md` (no-promovido) | El path `audit-outputs/` es del modo auditoría temporal. `EXTENSIONS_RECOMMENDATIONS.md` no es referencia estable. |
| 3 | Sección "Cuándo NO activar": la lista de skills mencionadas se actualizó. Las skills referenciadas (`glec-emission-calculation`, `dte-integration-chile`, `telemetry-codec-handler`) NO existen en el repo. Reemplazadas por las skills reales del plugin booster-skills. | Evidence over assumption — las skills mencionadas como excusa para NO activar deben existir. |
| 4 | Fase 3 (estructura de spec.md): reescrita para alinear con las **13 secciones obligatorias de `/agent-rigor:spec`** | Antes era una estructura ad-hoc de 8 secciones. Ahora coincide con lo que agent-rigor exige, evitando re-trabajo. |
| 5 | Fase 5 (ledger): formato cambiado de `.claude/ledger/<YYYY-MM-DD>/<session-uuid>.md` a `.claude/ledger/<sessionId>.jsonl` con entries tipadas | agent-rigor usa JSONL canónico. El formato anterior era una invención que no aplica con plugin instalado. |
| 6 | Sección nueva: "Relación con agent-rigor" | Documenta explícitamente que `arquitecto-maestro` produce la spec, agent-rigor toma el flujo del ciclo. Sin esta sección, el rol de cada uno queda ambiguo. |
| 7 | Tabla "Comandos auxiliares" preservada pero actualizada: el comando `/arquitecto-maestro <desc>` se mantiene como sintaxis si Claude Code lo expone como skill slash command. Se aclara que Claude Code lo invoca automáticamente vía description matching. | Comportamiento real de Claude Code con skills. |

**NO cambió:**

- Las 6 fases del Core Process (Read-first, Levantamiento, Diseño, Aprobación, Ledger, CURRENT.md)
- Anti-rationalizations table
- Exit criteria
- Workflow `/auto-dream` (consolidación de memoria)

#### 2. `adding-cloud-run-service` (v1.0.0 → v1.1.0)

**Cambios sustanciales:**

| # | Cambio | Razón |
|---|---|---|
| 1 | **Frontmatter YAML completo agregado** (era `# Skill: ...` markdown puro sin frontmatter) | Sin `name`/`description` Claude Code NO puede auto-triggear esta skill. Era el problema central por el cual no estaba siendo detectada. |
| 2 | `description` redactada "pushy" con keywords: "new service", "extract context", "split apps/api", "Cloud Run scaffold", "dedicated consumer" | Triggering automático fiable. |
| 3 | `references` agregadas: ADR-001, ADR-005, `incident-response`, `booster-stack-conventions`, `booster-deploy-cloud-run` | Trazabilidad y composición con otras skills. |
| 4 | Referencia a `skills/writing-tests` removida del título del archivo (línea `**Relacionado**:`) | `skills/writing-tests` NO existe en el repo. Era referencia rota. |
| 5 | Referencias en "Referencias" final actualizadas a skills que SÍ existen en booster-skills | Coherencia. |

**NO cambió:**

- 11 pasos del Core Process (justificación ADR → estructura → deps → endpoints → env Zod → Dockerfile → Terraform → tests → CI → observability → runbook)
- Anti-rationalizations
- Exit criteria
- Bloques de código (Dockerfile, Terraform, src/config.ts)

#### 3. `carbon-calculation-glec` (v1.0.0 → v1.1.0)

**Cambios sustanciales:**

| # | Cambio | Razón |
|---|---|---|
| 1 | **Frontmatter YAML completo agregado** | Mismo problema de auto-triggering. |
| 2 | `description` con keywords: "carbon", "emissions", "huella de carbono", "GLEC", "GHG", "Scope 1/3", "factor de emisión", "ESG certificate", "kg CO2e", "well-to-tank" | Triggering fiable en ambos idiomas. |
| 3 | `references` agregadas | Trazabilidad ADRs. |

**NO cambió:**

- Tabla Scope 1 vs Scope 3
- 7 pasos del Core Process (Identificar tipo → Método de medición → Factores → Cálculo función pura → Tests deterministas → BigQuery → Certificado ESG)
- Bloques de código TypeScript + SQL
- Common Rationalizations
- Red Flags
- Exit Criteria con coverage ≥95%
- Referencias externas (GLEC Framework, GHG Protocol, ISO 14064-2)

#### 4. `empty-leg-matching` (v1.0.0 → v1.1.0)

**Cambios sustanciales:**

| # | Cambio | Razón |
|---|---|---|
| 1 | **Frontmatter YAML completo agregado** | Mismo problema de auto-triggering. |
| 2 | `description` con keywords: "matching", "carrier selection", "empty-leg", "scoring", "shipper-carrier dispatch", "viaje vacío", "asignación de carga", "ranking de carriers" | Triggering fiable en ambos idiomas. |
| 3 | `references` agregadas (ADR-004, ADR-005, ubicación del package) | Trazabilidad. |

**NO cambió:**

- 8 pasos del Core Process (señales input → filtros duros → scoring multifactor → empty-leg detection → generar ofertas → auditabilidad → tie-breaking → versionado)
- Tabla de factores y pesos iniciales (proximity 0.35, empty_leg 0.25, rating 0.15, etc.)
- Bloque JSON de `matching_decisions`
- Common Rationalizations
- Red Flags
- Exit Criteria con coverage ≥95%

#### 5. `incident-response` (v1.0.0 → v1.1.0)

**Cambios sustanciales:**

| # | Cambio | Razón |
|---|---|---|
| 1 | **Frontmatter YAML completo agregado** | Mismo problema de auto-triggering. |
| 2 | `description` con keywords: "incident", "outage", "down", "broken in prod", "users can't", "5XX errors spiking", "latency spike", "security breach", "incidente", "se cayó" | Triggering fiable bajo estrés en ambos idiomas. Es skill crítica. |
| 3 | `references` agregadas (Ley 19.628 + Google SRE) | Compliance + best practice. |
| 4 | Referencias a skills inexistentes removidas: `skills/post-mortem` (no existe), `skills/rotate-credential` (no existe) | Las menciones a "ver skill X" se reemplazaron por descripción inline del procedimiento (en sección "Fase 3" y "Auditoría de seguridad post-incidente") |
| 5 | Referencia agregada a `booster-deploy-cloud-run` (skill hermana que tiene el rollback procedure detallado) | Composición intra-plugin. |

**NO cambió:**

- 3 fases (Detectar → Estabilizar → Entender)
- Severity classification (SEV-1/2/3/4)
- Anti-rationalizations
- Red Flags
- Techniques (Cloud Logging query, Cloud Run rollback, feature flags)
- Exit Criteria

---

### Agents migrados (sin cambios)

Los 6 agents tenían frontmatter YAML correcto y contenido auto-contenido. Migración: copia literal byte-a-byte.

| Agent | Modelo | Bytes (verificado idéntico al source) |
|---|---|---|
| `dependency-auditor` | haiku | sin cambios |
| `explore-architecture` | haiku | sin cambios |
| `performance-analyzer` | sonnet | sin cambios |
| `refactor-advisor` | opus | sin cambios |
| `security-scanner` | sonnet | sin cambios |
| `tech-debt-detector` | haiku | sin cambios |

**Razón**: estos agents ya operan correctamente bajo Claude Code (los 6 ejecutaron la auditoría 2026-05-19). Cambiarlos sin razón violaría "evidence over assumption" y "don't fix what's not broken". Futuras versiones del plugin pueden iterarlos.

---

### NO migrados

#### Skills deprecadas

| Skill | Razón |
|---|---|
| `writing-adrs` | Cubierto por `agent-rigor` skill `63-documentation-and-adrs`. Mantenerlo duplicaría responsabilidad. |
| `using-agent-skills` | Cubierto por `agent-rigor` skill `00-using-this-pack`. Mantenerlo duplicaría meta-instrucción. |

Si en el futuro se detecta que el contenido específico Booster de estas skills se perdió en la migración, considerar incorporar deltas a skills existentes (e.g., extender `arquitecto-maestro` con detalles de naming de ADRs Booster bilingüe).

#### Commands locales NO migrados (se borran en PR-2)

| Command | Razón |
|---|---|
| `.claude/commands/build.md` | Reemplazado por `/agent-rigor:build` + skill `booster-stack-conventions` |
| `.claude/commands/plan.md` | Reemplazado por `/agent-rigor:plan` |
| `.claude/commands/review.md` | Reemplazado por `/agent-rigor:review`. Contenía bug: invocaba agent fantasma `devops-sre`. |
| `.claude/commands/ship.md` | Reemplazado por `/agent-rigor:ship` + skill `booster-deploy-cloud-run` |
| `.claude/commands/spec.md` | Reemplazado por `/agent-rigor:spec`. Usaba path `docs/specs/<date>-<slug>.md`; canónico es `.specs/<feature-slug>/spec.md`. |
| `.claude/commands/test.md` | Reemplazado por `/agent-rigor:test` |

---

## Skills nuevas (creadas durante la migración)

### `booster-stack-conventions` v1.0.0

**Origen**: contenido de stack disperso en `.claude/commands/build.md` (sección "Disciplina de código") + sección "Anti-rationalizations" + sección "Exit criteria".

**Justificación**: las reglas (Zod en boundaries, Biome zero `any`, `@booster-ai/logger`, OTel trace_id, coverage 80%, Conventional Commits con scope, Evidencia obligatoria en PRs) son aplicables a **toda escritura de código en el proyecto Booster**, no solo durante `/build`. Promoverlas a skill con auto-triggering las hace cumplir consistentemente.

**Descripción "pushy"**: 6 keywords de triggering — "implement", "refactor", "add", "modify", "fix", "trivial-seeming changes".

### `booster-deploy-cloud-run` v1.0.0

**Origen**: contenido de deploy disperso en `.claude/commands/ship.md` (10 pasos: CI green → smoke tests → checklist seguridad → checklist observabilidad → checklist rollback → merge squash → deploy staging Cloud Build → smoke staging → manual approval prod → monitoreo 2h).

**Justificación**: el flujo de deploy de Booster es específico (Cloud Build staging→prod con manual approval, monitoreo 2h, smoke PWA, checklist GCP) y NO está cubierto por las skills genéricas de agent-rigor (`64-shipping-and-launch` da los 12 puntos generales). Esta skill complementa.

**Descripción "pushy"**: keywords — "deploy", "ship", "release", "promote", "roll out", "Cloud Build", "staging deploy", "production promotion", "rollback", "smoke tests", "post-deploy monitoring".

---

## Bugs corregidos durante la migración

### Bug-001: `devops-sre` agent fantasma

**Síntoma**: el `.claude/commands/review.md` del proyecto Booster invocaba a un agent llamado `devops-sre` que NO existe ni en el proyecto Booster (.claude/agents/) ni en agent-rigor (5 sub-agents).

**Impacto**: cualquier ejecución de `/review` con cambios de infra fallaría silenciosamente o produciría comportamiento indefinido.

**Fix**: el command `.claude/commands/review.md` se borra completamente en PR-2 (reemplazado por `/agent-rigor:review` que invoca correctamente `security-auditor` para infra). El bug deja de existir al eliminarse el archivo.

**Verificación post-migración**: `grep -r "devops-sre" booster-skills-plugin-v0.1.0/` retorna vacío.

---

## Verificación de integridad post-migración

### Auto-triggering

| Skill | Antes (frontmatter) | Después (frontmatter) | Auto-triggerable |
|---|---|---|---|
| arquitecto-maestro | ✅ tenía | ✅ mejorado | ✅ sí |
| adding-cloud-run-service | ❌ no tenía | ✅ agregado | ✅ sí (antes NO) |
| carbon-calculation-glec | ❌ no tenía | ✅ agregado | ✅ sí (antes NO) |
| empty-leg-matching | ❌ no tenía | ✅ agregado | ✅ sí (antes NO) |
| incident-response | ❌ no tenía | ✅ agregado | ✅ sí (antes NO) |
| booster-stack-conventions | n/a (nueva) | ✅ desde origen | ✅ sí |
| booster-deploy-cloud-run | n/a (nueva) | ✅ desde origen | ✅ sí |

**Resultado**: las 7 skills son ahora auto-triggerables por Claude Code. Antes solo 1 lo era (arquitecto-maestro vía symlink), y solo cuando el usuario la invocaba explícitamente.

### Referencias rotas eliminadas

| Referencia | Estado |
|---|---|
| `skills/writing-tests` | Eliminada de adding-cloud-run-service. No existe. |
| `skills/post-mortem` | Reemplazada por procedimiento inline en incident-response. |
| `skills/rotate-credential` | Reemplazada por procedimiento inline en incident-response. |
| `glec-emission-calculation` | Eliminada de arquitecto-maestro (era ejemplo, no skill real). |
| `dte-integration-chile` | Eliminada de arquitecto-maestro (era ejemplo, no skill real). |
| `telemetry-codec-handler` | Eliminada de arquitecto-maestro (era ejemplo, no skill real). |
| `audit-outputs/EXTENSIONS_RECOMMENDATIONS.md` | Eliminada de references de arquitecto-maestro. |
| `audit-outputs/CLAUDE.md` (no-promovido) | Eliminada de references. |
| agent fantasma `devops-sre` | Eliminado al borrar commands/review.md |

---

## Trazabilidad de cambios

Cada skill migrada incluye su tabla de versionado actualizada en su `## Versionado de esta skill` section o frontmatter version bump notes. El historial es trazable individualmente.

Resumen agregado:

- 5 skills bumped de v1.0.0 a v1.1.0 (migración).
- 2 skills nuevas en v1.0.0.
- 6 agents sin cambio de versión (migración byte-a-byte).
- 1 bug corregido por eliminación de archivo (devops-sre fantasma).
- 9 referencias rotas eliminadas o reemplazadas por procedimientos inline.

---

## Siguiente paso

Tras revisar este reporte y empaquetar el plugin (`booster-skills-plugin-v0.1.0-COMPLETO.tar.gz`):

1. Crear repo público `boosterchile/booster-skills` en GitHub.
2. `git init && git add . && git commit -m "feat: initial release v0.1.0"`
3. `git tag v0.1.0 && git push origin main --tags`
4. `gh release create v0.1.0 --generate-notes`
5. En Claude Code:
   ```
   /plugin marketplace add boosterchile/booster-skills
   /plugin install booster-skills@booster-skills
   ```
6. Verificar con `/plugin list`: ambos plugins (agent-rigor + booster-skills) habilitados.
7. Proceder con PR-2 (cleanup del proyecto Booster AI).
