# Plan: integrate-booster-skills-plugin (v2)

- **Spec**: `.specs/integrate-booster-skills-plugin/spec.md` v4 (SHA256 `8163778f50c99e74294b1cb506f9b4e4953d6574cd39d30d0f2d094f061d49c6`), APPROVED_BY_PO_2026-05-20 v4
- **Created**: 2026-05-20
- **Status**: Draft v2 — pendiente aprobación PO
- **Cambios v1→v2 post devils-advocate**:
  - B-1: T6 split a T6a (insertar §Integración) + T6b (reemplazar §Principios rectores con §Reglas no-negociables)
  - B-2: T12 split a T12a..T12e (5 commits = 5 tasks atómicas)
  - B-3: T11 ahora explícito en handoff PO→Agent post-deletes
  - B-4: T2 incluye verificación `git ls-files` para confirmar trackability (rollback de T9/T10 viable)
  - S-1: T6a depende de T4 (CLAUDE.md referencia ADR-049)
  - S-2: T13 nueva: actualizar `docs/handoff/CURRENT.md` post-merge
  - S-3: T1 incluye pre-check de existencia del branch destino
- **Waivers en ledger**:
  - 13 modules touched > 10 (cleanup masivo deliberado)
  - T4 (~150 LOC) > 100 (ADR doc atómico, split daña narrativa)

---

## Convenciones

- `[AGENT]` — Claude Code ejecuta (Write+cp staging pattern, Bash no bloqueado).
- `[PO]` — PO ejecuta manualmente desde otra sesión/terminal (audit-session bloquea).
- `[HANDOFF]` — sincronización explícita entre AGENT y PO (PO comunica completion via chat antes que AGENT avance).
- **Acceptance** mapea a SC del spec §3.
- **Rollback** ejecutable, no aspiracional.

---

## Tasks

### T1: Rename branch (con pre-check) [DONE 2026-05-20]
- **Files**: ninguno
- **LOC**: 0
- **Depends on**: ninguna
- **Owner**: `[PO]`
- **Pre-check**: PO ejecuta `git branch --list chore/integrate-booster-skills-plugin`. Si retorna no vacío, ejecutar `git branch -D chore/integrate-booster-skills-plugin` (con confirmación) ANTES de rename.
- **Comando**: `git branch -m chore/integrate-booster-skills-plugin`
- **Acceptance**: SC-12 — `git rev-parse --abbrev-ref HEAD` = `chore/integrate-booster-skills-plugin`
- **Rollback**: `git branch -m claude/flamboyant-jones-42a39b`

### T2: Capturar pre-cleanup snapshot + verificar trackability [DONE 2026-05-20]
- **Files**: `.specs/integrate-booster-skills-plugin/evidence/pre-cleanup-snapshot.txt` (nuevo)
- **LOC**: 0 (output capture)
- **Depends on**: ninguna (T1 no es prerequisito; el snapshot captura estado pre cualquier modificación)
- **Owner**: `[AGENT]` — Bash batch
- **Contenido capturado**:
  - `find skills -mindepth 1 -maxdepth 2 | sort`
  - `grep -n "^## \|^# " CLAUDE.md`
  - `wc -l CLAUDE.md`
  - `git status --short`
  - `git log --oneline -3`
  - `git branch --show-current`
  - `find .claude -mindepth 1 -maxdepth 2 \( -type f -o -type d -o -type l \) | sort`
  - `find agents hooks references playbooks -maxdepth 2 | sort`
  - `grep -rE "skills/|\.claude/commands|\.claude/agents" .github/workflows/`
  - `grep -nF "hooks/" CLAUDE.md`
  - **B-4**: `git ls-files .claude/commands/ .claude/agents/ skills/ hooks/session-start.md` — confirma que TODOS los archivos a borrar están tracked. Si retorna vacío o subset, rollback de T9/T10 vía `git restore` no funcionará — debe revertirse al snapshot con `git checkout main -- <path>` o copiar desde el working tree de otra sesión.
- **Acceptance**: archivo existe, 12 secciones nombradas, no vacío, sección `git ls-files` confirma trackability completa
- **Rollback**: `rm .specs/integrate-booster-skills-plugin/evidence/pre-cleanup-snapshot.txt`

### T3: Crear `docs/plugins/` y commitear REPORTE-migracion (G4 part 1) [DONE 2026-05-20]
- **Files**:
  - `docs/plugins/` (nuevo dir)
  - `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` (copia)
- **LOC**: 0 nueva-LOC (es copy verbatim)
- **Depends on**: T1
- **Owner**: `[AGENT]`
- **Comando**: `mkdir -p docs/plugins/ && cp "/Users/fvicencio/Desktop/ahora/REPORTE-migracion-booster-skills-v0.1.0.md" docs/plugins/`
- **Acceptance**: SC-18 part 1 — `[ -f docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md ]`
- **Rollback**: `rm -rf docs/plugins/`

### T4: Crear `docs/adr/049-claude-code-plugin-system-adoption.md` (G4 part 2) [DONE 2026-05-20]
- **Files**: `docs/adr/049-claude-code-plugin-system-adoption.md` (nuevo, ~150 LOC, **waiver**)
- **LOC**: ~150
- **Depends on**: T3 (referencia el path `docs/plugins/REPORTE-...md`)
- **Owner**: `[AGENT]` — Write to `.claude/staging/adr-049.md` + `cp` to `docs/adr/`
- **Contenido obligatorio** (per spec v4 Apéndice A):
  - Status: Accepted
  - Date: 2026-05-20
  - Decider: Felipe Vicencio (PO)
  - Supersedes: ADR-002
  - Related: ADR-001, CLAUDE.md, ADR-046
  - §Contexto, §Decisión (3 capas), §Consecuencias (+/-)
  - §Replicabilidad — 5-step procedure + link a `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`
  - §Validación, §Referencias
- **Acceptance**: SC-10 + SC-18 part 2
- **Rollback**: `rm docs/adr/049-claude-code-plugin-system-adoption.md`

### T5: Marcar ADR-002 como Superseded by ADR-049 [DONE 2026-05-20]
- **Files**: `docs/adr/002-skill-framework-adoption.md` (modificar)
- **LOC**: ~5 LOC delta
- **Depends on**: T4
- **Owner**: `[AGENT]` — Read + Write a staging + cp
- **Cambios**:
  - Línea 3: `**Status**: Accepted` → `**Status**: Superseded by ADR-049`
  - Apéndice al final: sección "## Supersedence Note (2026-05-20)" con razón + link
- **Acceptance**: SC-11
- **Rollback**: `git restore docs/adr/002-skill-framework-adoption.md`

### T6a: Insertar §"Integración con plugins de Claude Code" en CLAUDE.md (G6 incluido) [DONE 2026-05-20]
- **Files**: `CLAUDE.md` (modificar)
- **LOC**: ~80 LOC delta (insertar 80 nuevas líneas)
- **Depends on**: T4 (CLAUDE.md referencia ADR-049 en sub-sección "Distribución de responsabilidades")
- **Owner**: `[AGENT]` — Read CLAUDE.md + Write a staging con sección nueva insertada antes de `## Principios rectores` + cp
- **Cambios específicos**:
  - Insertar antes de `## Principios rectores`:
    - `## Integración con plugins de Claude Code` (titulo)
    - Sub-sección Plugin 1 agent-rigor (repo, instalación, contenido)
    - Sub-sección Plugin 2 booster-skills (repo `boosterchile/booster-skills`, instalación, contenido)
    - Sub-sección "Verificación" (`/plugin list`)
    - Sub-sección "Distribución de responsabilidades" (tabla; referencia ADR-049 implícito por mención)
    - Sub-sección "Precedencia en conflicto" (reglas Booster ganan)
    - **Sub-sección "Capas adicionales locales del proyecto" (G6)** — tabla 3 archivos × (qué extiende / por qué local), literal "override local Booster", link a `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`
  - **OQ-2 resolución inline**: actualizar `## Estructura del repo (v2 — tras ADR-004..008)` → `(v3 — tras ADR-049)` y reflejar nueva realidad (sin skills/, agents/ con 3 overrides documentados, plugins instalados)
- **Acceptance**: SC-8 part 1 (literal `## Integración con plugins de Claude Code`) + SC-17 (G6 verificable)
- **Rollback**: `git restore CLAUDE.md`

### T6b: Reemplazar §"Principios rectores" con §"Reglas no-negociables del stack Booster" en CLAUDE.md [DONE 2026-05-20]
- **Files**: `CLAUDE.md` (modificar — segundo round de cambios)
- **LOC**: ~+80 LOC nuevas, -62 LOC reemplazadas, neto +18 LOC
- **Depends on**: T6a (mismo archivo, edición secuencial; mantener orden para evitar conflict)
- **Owner**: `[AGENT]` — Read CLAUDE.md post-T6a + Write a staging con reemplazo + cp
- **Cambios específicos**:
  - Remover sección `## Principios rectores — inviolables desde el commit 1` (líneas 19-80 del CLAUDE.md original)
  - Insertar sección `## Reglas no-negociables del stack Booster` con contenido del addendum sección 3:
    - Type safety end-to-end (Zero any/ts-ignore, Zod boundaries)
    - Validación en boundaries (Zod en handlers, env, Pub/Sub, APIs externas)
    - Observabilidad obligatoria (Zero console, trace_id, OTel, métricas custom)
    - Seguridad por defecto (Secret Manager, API key restrictions, JWT)
    - Testing (coverage 80%+, *.test.ts colocados, integration, E2E)
    - Commits y PRs (Conventional Commits con scope, Evidencia obligatoria)
    - Deploy (staging auto, prod manual approval, monitoreo 2h, no-deploy viernes-16h-CL)
- **Acceptance**: SC-8 part 2 (literal `## Reglas no-negociables del stack Booster`) + SC-9 (sección antigua removida)
- **Rollback**: `git restore CLAUDE.md` (revierte T6a + T6b)

### T7: Crear `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` stub (G5) [DONE 2026-05-20]
- **Files**: `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` (nuevo)
- **LOC**: ~30
- **Depends on**: T1
- **Owner**: `[AGENT]` — Write a staging + cp
- **Contenido**: Stub con title, status Draft, trigger, objetivo, inputs (ADRs 004/007/021/034), procedimiento 5 steps, acceptance, prompt para sesión futura
- **Acceptance**: SC-20
- **Rollback**: `rm .specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`

### T8: Añadir `.claude/staging/` a `.gitignore` (G7) [DONE 2026-05-20]
- **Files**: `.gitignore` (modificar)
- **LOC**: 1
- **Depends on**: T1
- **Owner**: `[AGENT]` — Read + Write a staging con append + cp
- **Cambio**: append línea `.claude/staging/` con comentario explicativo
- **Acceptance**: SC-19
- **Rollback**: `git restore .gitignore`

### T9: Borrar `.claude/commands/{6}`, `.claude/agents/{6}`, `.claude/skills/` (si existe) [DONE 2026-05-20]
- **Files removed**:
  - `.claude/commands/build.md`, `plan.md`, `review.md`, `ship.md`, `spec.md`, `test.md` + dir
  - `.claude/agents/dependency-auditor.md`, `explore-architecture.md`, `performance-analyzer.md`, `refactor-advisor.md`, `security-scanner.md`, `tech-debt-detector.md` + dir
  - `.claude/skills/` (defensivo: probable que no exista)
- **LOC**: 0 (deletes)
- **Depends on**: T2 (snapshot captured)
- **Owner**: `[PO]` — desde otra sesión:
  ```bash
  cd /Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/flamboyant-jones-42a39b
  rm -f .claude/commands/{build,plan,review,ship,spec,test}.md
  rmdir .claude/commands 2>/dev/null || true
  rm -f .claude/agents/{dependency-auditor,explore-architecture,performance-analyzer,refactor-advisor,security-scanner,tech-debt-detector}.md
  rmdir .claude/agents 2>/dev/null || true
  rm -rf .claude/skills/ 2>/dev/null || true
  ```
- **Acceptance**: SC-1 + SC-2 + SC-3
- **Rollback**: `git restore .claude/commands .claude/agents .claude/skills` (viable si T2 confirmó trackability)

### T10: Borrar `skills/` raíz, `hooks/session-start.md`, `hooks/` [DONE 2026-05-20]
- **Files removed**:
  - Todo `skills/` (6 subdirs)
  - `hooks/session-start.md`
  - `hooks/` (dir vacío post-delete)
- **LOC**: 0
- **Depends on**: T2 (snapshot)
- **Owner**: `[PO]` — desde otra sesión:
  ```bash
  rm -rf skills/
  rm -f hooks/session-start.md
  rmdir hooks 2>/dev/null || true
  ```
- **Acceptance**: SC-4 + SC-5
- **Rollback**: `git restore skills hooks` (viable si T2 confirmó trackability)

### T11: [HANDOFF] PO comunica completion T9 + T10 [DONE 2026-05-20]
- **Files**: ninguno
- **LOC**: 0
- **Depends on**: T9, T10 (PO debe haberlas ejecutado)
- **Owner**: `[HANDOFF PO→AGENT]` — PO escribe en chat `T9+T10 DONE` (o equivalente). Sin este ack, T12 no arranca.
- **Acceptance**: PO confirma en chat
- **Rollback**: n/a (es sincronización)

### T12: Capturar post-cleanup evidence [DONE 2026-05-20]
- **Files**: `.specs/integrate-booster-skills-plugin/evidence/{plugin-list.txt, git-status.txt, tree-before.txt, tree-after.txt}` (nuevos)
- **LOC**: 0 (output capture)
- **Depends on**: T11 (handoff confirmado)
- **Owner**: `[AGENT]` + `[PO]` para `/plugin list`
  - `[PO]` corre `/plugin list` desde Claude Code, pega output en chat o en `.claude/staging/plugin-list.txt`
  - `[AGENT]` `cp .claude/staging/plugin-list.txt .specs/integrate-booster-skills-plugin/evidence/plugin-list.txt`
  - `[AGENT]` Bash: `git status --short > .specs/integrate-booster-skills-plugin/evidence/git-status.txt`
  - `[AGENT]` Bash: capturar tree antes (del snapshot T2) y tree-after fresh
- **Acceptance**: SC-15 — los 4 archivos existen, plugin-list.txt contiene literales `agent-rigor@agent-rigor` + `booster-skills@booster-skills`
- **Rollback**: `rm -rf .specs/integrate-booster-skills-plugin/evidence/`

### T13a: Commit 1 — deletes (chore) [DONE 2026-05-20]
- **Files staged**: `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, `skills/`, `hooks/`
- **Depends on**: T12 (evidence capturada)
- **Owner**: `[PO]` —
  ```bash
  git add .claude/commands .claude/agents .claude/skills skills hooks
  git commit -m "chore(claude): borrar .claude/commands/, .claude/agents/, .claude/skills/, skills/, hooks/"
  ```
- **Acceptance**: `git log -1` muestra el mensaje literal con scope `(claude)`
- **Rollback**: `git reset --soft HEAD~1`

### T13b: Commit 2 — CLAUDE.md merge (docs) [DONE 2026-05-20]
- **Files staged**: `CLAUDE.md`
- **Depends on**: T13a
- **Owner**: `[PO]` —
  ```bash
  git add CLAUDE.md
  git commit -m "docs(claude): consolidar CLAUDE.md con integracion plugins y reglas stack"
  ```
- **Acceptance**: `git log -1` con mensaje literal
- **Rollback**: `git reset --soft HEAD~1`

### T13c: Commit 3 — ADRs + plugins doc (docs) [DONE 2026-05-20]
- **Files staged**: `docs/adr/049-...md`, `docs/adr/002-...md`, `docs/plugins/`
- **Depends on**: T13b
- **Owner**: `[PO]` —
  ```bash
  git add docs/adr/049-claude-code-plugin-system-adoption.md docs/adr/002-skill-framework-adoption.md docs/plugins/
  git commit -m "docs(adr): ADR-049 adopcion plugins Claude Code; ADR-002 superseded"
  ```
- **Acceptance**: `git log -1`
- **Rollback**: `git reset --soft HEAD~1`

### T13d: Commit 4 — .gitignore (chore) [DONE 2026-05-20]
- **Files staged**: `.gitignore`
- **Depends on**: T13c
- **Owner**: `[PO]` —
  ```bash
  git add .gitignore
  git commit -m "chore(git): excluir .claude/staging/ de versionado"
  ```
- **Acceptance**: `git log -1`
- **Rollback**: `git reset --soft HEAD~1`

### T13e: Commit 5 — specs + followups (docs) [DONE 2026-05-20]
- **Files staged**: `.specs/integrate-booster-skills-plugin/`, `.specs/_followups/`
- **Depends on**: T13d
- **Owner**: `[PO]` —
  ```bash
  git add .specs/integrate-booster-skills-plugin/ .specs/_followups/
  git commit -m "docs(specs): spec v4 + plan + verify + review + ship + followups stub"
  ```
- **Acceptance**: `git log -1` + `git log --oneline -5` muestra 5 commits con ordering correcto
- **Rollback**: `git reset --soft HEAD~1`

### T14: Update `docs/handoff/CURRENT.md` (post-merge a main)
- **Files**: `docs/handoff/CURRENT.md` (modificar)
- **LOC**: ~10-20 LOC (añadir sección "## Refactor sistema de desarrollo cerrado (2026-05-DD)")
- **Depends on**: PR-2 mergeado en main (post `/agent-rigor:ship`)
- **Owner**: `[AGENT]` — Read CURRENT.md + Write a staging con sección añadida + cp + commit aparte (o squash con commit final)
- **Contenido a añadir**: cierre de refactor 3-capas, plugin booster-skills v0.1.0 operativo, scope canónico aplicado, agents/ raíz documentado como override, link a ADR-049
- **Acceptance**: CURRENT.md actualizado y commiteado en main (S-2 resuelto)
- **Rollback**: `git restore docs/handoff/CURRENT.md`

---

## Out-of-band tasks

- **OOB-1**: `.claude/staging/` queda con artefactos de esta sesión (spec-pr2*.md, plan-pr2-v*.md, adr-049.md, etc.) — ignored por T8 pero físicamente presentes. Decisión: aceptar como conocido (referencia futura útil); el PO puede limpiar manualmente cuando lo crea conveniente.
- **OOB-2**: Squash de los 5 commits T13a-T13e en uno solo al hacer merge — decisión del PO en `/agent-rigor:ship`.
- **OOB-3**: Post-merge: `git remote prune origin` para limpiar referencias.
- **OOB-4**: Si tras T6a/T6b la sección "Estructura del repo" actualizada queda inconsistente con la realidad (e.g. menciona un dir que ya no existe), `/agent-rigor:test` lo detecta vía SC-17 grep.

---

## Open questions

- **OQ-1**: ¿Los hooks audit-session se desactivan al cierre PR-2 o quedan activos? Resolución: `/agent-rigor:ship`.
- **OQ-2**: Resuelto inline en T6a (actualizar "Estructura del repo (v2)" → "(v3)").

---

## Devils-advocate pass (auto-aplicado v1→v2)

| Objeción | Severidad | Resolución v2 |
|---|---|---|
| B-1: T6 es 2 tareas | Bloqueante | Split T6→T6a + T6b |
| B-2: T12 son 5 commits | Bloqueante | Split T12→T13a..T13e |
| B-3: Falta handoff T9/T10→T11 | Bloqueante | T11 nuevo: [HANDOFF] explícito |
| B-4: Rollback T9/T10 no verificado | Bloqueante | T2 incluye `git ls-files` check |
| S-1: T6a missing dependency T4 | Sustantiva | T6a depends on T4 explicitado |
| S-2: Missing CURRENT.md task | Sustantiva | T14 añadida |
| S-3: T1 sin pre-check branch existente | Sustantiva | T1 incluye pre-check + comando `git branch -D` si necesario |
| S-4: T6 podría exceder 100 LOC con OQ-2 | Sustantiva | Resuelto por split + OQ-2 absorbida en T6a |
| C-1: T2 antes de T1 | Cosmética | T2 ya no depende de T1 |
| C-2: `.claude/staging/` huérfanos | Cosmética | Aceptado como conocido (OOB-1) |

**Veredicto post-v2**: ready for PO approval pending external pasada formal en transición a BUILD.

---

## Verification del plan (sub-checklist skill 20)

- [x] Todas tasks son vertical slices (cada una deja el repo en estado funcional)
- [x] LOC ≤100 por task **excepto T4** (waiver ADR atómico)
- [x] Acceptance trace a SC del spec: T1→SC-12, T2→pre, T3→SC-18, T4→SC-10/18, T5→SC-11, T6a→SC-8/17, T6b→SC-8/9, T7→SC-20, T8→SC-19, T9→SC-1/2/3, T10→SC-4/5, T11→handoff, T12→SC-15, T13a-e→commit ordering, T14→post-merge CURRENT.md
- [x] Rollback plan ejecutable para cada task
- [x] Devils-advocate output captured (sección anterior)

---

## Notas operacionales

- **Solo-developer cooling-off**: 30 min entre approval de plan v2 y T1.
- **Branch rename safety (T1)**: pre-check incluido. Si conflict, PO decide `-D` o re-evaluar nombre.
- **R-1 mitigation activa**: cada `[AGENT]` Write→staging+cp; cada `[PO]` ejecuta desde otra sesión.
- **Total**: 14 tasks (T1, T2, T3, T4, T5, T6a, T6b, T7, T8, T9, T10, T11, T12, T13a, T13b, T13c, T13d, T13e, T14) — más atómico que v1 (12).

---

## Approval

**Status**: Pendiente.

**Para aprobar**: `APPROVED_PLAN_BY_PO_2026-05-20 v2` con firma textual.

Tras approval: cooling-off 30 min, después `/agent-rigor:build` arranca con T1.
