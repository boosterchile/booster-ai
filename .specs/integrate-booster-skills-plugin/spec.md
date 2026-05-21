# integrate-booster-skills-plugin — Execution Plan (v4)

**Generado por**: skill `arquitecto-maestro` v1.1.0
**Sesión**: 4672f6ac-9aab-4d6b-ae07-2eeabdbad529
**Fecha v4**: 2026-05-20 (post coherence-audit, Opción B: resolver G4 + G6 inline)
**Status**: Draft v4 — pendiente aprobación PO

---

## 0. Changelog (v1 → v2 → v3 → v4)

| Versión | SHA256 | Status | Razón de cambio |
|---|---|---|---|
| v1 | `4511c012...` | Rejected by PO | §2 PR-1 cerrado mal expresado; repo `boosterchile`; R-2 mitigation insuficiente |
| v2 | `e4d8814d...` | Rejected ("cascade of errors") | PR-1 marcado EN CURSO falso; repo `fueradelabox` falso; scope extendido a root `agents/` no canónico |
| v3 | `b4929db7...` | Aprobable pero con 7 gaps (coherence audit) | Restauró canonicidad pero quedaron G4 (reusabilidad) y G6 (discoverability) sin resolver |
| **v4** | (este) | Draft | Resuelve G4 + G6 inline; G1-G3-G5-G7 como anotaciones operacionales en plan.md o PR body |

Cambios v3 → v4:
- **G4**: §7.2 incluye task de commitear `REPORTE-migracion-booster-skills-v0.1.0.md` a `docs/plugins/`. ADR-049 incluye sub-sección "Replicabilidad — crear un plugin equivalente para otro proyecto" con procedimiento de 5 pasos referenciando el REPORTE como ejemplo canónico.
- **G6**: CLAUDE.md sección nueva ("Integración con plugins de Claude Code") incluye sub-sección "Capas adicionales locales del proyecto" documentando los 3 archivos de `agents/` raíz como overrides Booster explícitos (con explicación de qué extienden y para qué).
- **G1** (extensión `hooks/session-start.md`): documentado en §0 como justificado (archivo .md documental obsoleto, decidido vía AskUserQuestion previa al PO).
- **G2** (`.claude/skills/` ya ausente): documentado en §2 Why now como observación empírica.
- **G3** (bug `devops-sre` fantasma): añadido a §1 Objective como side-effect documentado.
- **G5** (tracking OQ-3): plan.md incluirá task de crear `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` stub.
- **G7** (`.claude/staging/` cleanup): añadir `.claude/staging/` a `.gitignore` como task explícita en plan.md.

---

## 1. Objective

Cleanup del proyecto Booster AI tras la publicación verificada del plugin `booster-skills@0.1.0` en `github.com/boosterchile/booster-skills` (PR-1 cerrado 2026-05-20 15:41). Eliminar las copias locales redundantes con el plugin, consolidar la nueva ley operativa en `CLAUDE.md`, documentar la arquitectura en ADR-049, y **dejar el repo Booster en un estado coherente que (a) permita retomar sprints existentes (S1b, S2, Mini-Sprint 0, Fase 1.5) sin fricción, y (b) sirva de blueprint replicable para arrancar plugins equivalentes en otros proyectos.**

Side-effects documentados:
- Elimina el bug `devops-sre` fantasma del `.claude/commands/review.md` (BUG-1 del REPORTE-migracion).
- Limpia 12 duplicados de skills/agents sin namespace que confundían el resolver de Claude Code.

Estado observable al cierre:
- `.claude/commands/`, `.claude/agents/`, `.claude/skills/`, `skills/`, `hooks/` → inexistentes o vacíos
- **`agents/` raíz INTACTO** con sus 3 archivos como overrides Booster (documentados explícitamente en CLAUDE.md)
- `CLAUDE.md` con nuevas secciones "Integración con plugins" (incluye "Capas adicionales locales del proyecto") + "Reglas no-negociables del stack Booster"
- `docs/adr/049-claude-code-plugin-system-adoption.md` con sección de Replicabilidad
- `docs/adr/002-skill-framework-adoption.md` marcada `Superseded by ADR-049`
- `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` commitado (ejemplo canónico de migración)
- `.gitignore` excluye `.claude/staging/`
- Branch del PR: `chore/integrate-booster-skills-plugin`
- PR-2 verde en CI con sección `## Evidencia` (output literal `/plugin list`, diffs, tree antes/después)
- `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` creado como stub para futuro PR-1.5

---

## 2. Why now

**PR-1 cerrado 2026-05-20 15:41** (STATE.md §3 todas las 1.1-1.10 ✅). Plugin `booster-skills@0.1.0` publicado en `github.com/boosterchile/booster-skills`, instalado con project scope, `/reload-plugins` reportó `Reloaded: 2 plugins · 9 skills · 23 agents · 6 hooks`, lista verificada empíricamente. Esta sesión confirma 7 skills + 6 agents accesibles vía `booster-skills:*` y 22+ skills + 5 agents vía `agent-rigor:*`.

Mantener las copias locales mientras el plugin las provee crea **drift inevitable** entre dos fuentes de verdad para los mismos workflows. Viola Principios rectores §1 (Cero deuda técnica day 0) y §3 (Process over knowledge — un source-of-truth por workflow).

Verificaciones empíricas adicionales realizadas en esta sesión:
- Tarball canónico vs plugin instalado: **18/18 archivos bit-perfect identical** (SHA256 match).
- Manifests del plugin instalado: apuntan correctamente a `github.com/boosterchile/booster-skills`.
- **Observación G2**: `.claude/skills/` ya **no existe** en el worktree actual (sesión anterior probablemente la borró). STATE-addendum-pre-PR2.md listaba 5 entries que ya no están. SC-3 v4 ("inexistente o vacío") tolera ambos estados.
- `.github/workflows/` no contiene referencias a paths a borrar (R-3 mitigation confirmada empíricamente, probabilidad → Baja).

---

## 3. Success criteria (measurable)

| SC | Criterio | Verificación ejecutable |
|---|---|---|
| SC-1 | `.claude/commands/` inexistente o vacío | `[ ! -d .claude/commands ] \|\| [ -z "$(ls -A .claude/commands 2>/dev/null)" ]` |
| SC-2 | `.claude/agents/` inexistente o vacío | idem para `.claude/agents` |
| SC-3 | `.claude/skills/` inexistente o vacío | idem para `.claude/skills` |
| SC-4 | `skills/` raíz inexistente | `[ ! -d skills ]` |
| SC-5 | `hooks/` raíz inexistente | `[ ! -d hooks ]` |
| SC-6 | `agents/` raíz intacto con los 3 archivos | `ls agents/*.md \| sort \| tr '\n' ' '` = `agents/code-reviewer.md agents/security-auditor.md agents/sre-oncall.md ` |
| SC-7 | `.claude/{ledger,settings.json,settings.local.json,worktrees}/` sin diff vs main | `git diff main -- .claude/ledger .claude/settings.json .claude/settings.local.json .claude/worktrees` vacío |
| SC-8 | `CLAUDE.md` contiene `## Integración con plugins de Claude Code` y `## Reglas no-negociables del stack Booster` | `grep -qF "## Integración con plugins de Claude Code" CLAUDE.md && grep -qF "## Reglas no-negociables del stack Booster" CLAUDE.md` |
| SC-9 | `CLAUDE.md` no contiene la sección antigua `## Principios rectores — inviolables desde el commit 1` | `! grep -qF "Principios rectores — inviolables desde el commit 1" CLAUDE.md` |
| SC-10 | `docs/adr/049-...md` con `**Estado**: Accepted` + referencia `boosterchile/booster-skills` | `grep -qE "^\*\*Estado\*\*: Accepted" docs/adr/049-*.md && grep -qF "boosterchile/booster-skills" docs/adr/049-*.md` |
| SC-11 | `docs/adr/002-...md` marcada `**Estado**: Superseded by ADR-049` | `grep -qE "^\*\*Estado\*\*: Superseded by ADR-049" docs/adr/002-skill-framework-adoption.md` |
| SC-12 | Branch del PR = `chore/integrate-booster-skills-plugin` | `git rev-parse --abbrev-ref HEAD` retorna ese string |
| SC-13 | CI verde (lint, typecheck, test) | GitHub Actions: todos los checks pasan |
| SC-14 | Sin nuevos `any`, `@ts-ignore`, `console.*` | `git diff main -- '*.ts' '*.tsx'` no contiene esos tokens en líneas añadidas |
| SC-15 | PR description contiene `## Evidencia` con output literal `/plugin list`, diff `CLAUDE.md`, `git status` final, tree antes/después | revisión manual del PR body |
| SC-16 | `.specs/integrate-booster-skills-plugin/{spec,plan,verify,review,ship}.md` existen | `ls .specs/integrate-booster-skills-plugin/` lista los 5 |
| **SC-17 (G6)** | `CLAUDE.md` documenta los 3 archivos de `agents/` raíz como overrides Booster con explicación explícita | `grep -qF "agents/code-reviewer.md" CLAUDE.md && grep -qF "agents/security-auditor.md" CLAUDE.md && grep -qF "agents/sre-oncall.md" CLAUDE.md && grep -qF "override local Booster" CLAUDE.md` |
| **SC-18 (G4)** | `docs/adr/049-...md` incluye sección `## Replicabilidad` con procedimiento para crear plugin equivalente, y referencia a `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` | `grep -qF "## Replicabilidad" docs/adr/049-*.md && grep -qF "docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md" docs/adr/049-*.md && [ -f docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md ]` |
| **SC-19 (G7)** | `.gitignore` incluye `.claude/staging/` | `grep -qF ".claude/staging/" .gitignore` |
| **SC-20 (G5)** | `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` existe como stub | `[ -f .specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md ]` |

---

## 4. User-visible behaviour

**Antes (estado actual del worktree 2026-05-20):**
- Existen ambas fuentes: plugin namespaced + copias locales sin namespace.
- `/spec` puede invocar `.claude/commands/spec.md` local en lugar de `/agent-rigor:spec`.
- `Task` con `subagent_type: security-scanner` (sin prefijo) puede resolver al `.claude/agents/security-scanner.md` local en vez del plugin.
- Skills listadas en sesión: 7 `booster-skills:*` + 22+ `agent-rigor:*` + duplicados sin namespace.
- `find skills/` lista 6 directorios.

**Después (post-merge):**
- Solo fuente plugin: `/agent-rigor:*` y `booster-skills:*` namespaced.
- Subagents Booster del plugin accesibles vía namespace.
- **Subagents `code-reviewer`, `security-auditor`, `sre-oncall` permanecen como overrides locales Booster** en `agents/` raíz — el agent-rigor `subagent_type: code-reviewer` resuelve al override local Booster (con contenido específico Ley 19.628, SII, ESG, roles Uber-like) en vez del agent-rigor genérico cuando ambos están disponibles. **Este comportamiento es deliberado y documentado en CLAUDE.md** (sección "Integración con plugins de Claude Code" → sub-sección "Capas adicionales locales del proyecto"). Migración futura tracked en `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`.
- `find skills/` → vacío.
- `CLAUDE.md` declara la arquitectura de 3 capas + precedencia de reglas Booster + los 3 overrides locales.
- Cualquier sesión Claude Code nueva que abra el repo entiende qué es cada cosa sin chat history previo.
- **ADR-049 incluye sección "Replicabilidad"**: cualquier desarrollador puede leer el procedimiento de creación de un plugin equivalente (apuntando a `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` como ejemplo trabajado).

**Para el desarrollador humano**: cero ruptura externa. No cambia código de aplicación, ni schema, ni endpoints, ni UI.

---

## 5. Out of scope (explícito)

NO se toca en este PR:

- Código de aplicación (`apps/**/*`, `packages/**/*`, `infrastructure/**/*`).
- `docs/specs/` ni migración a `.specs/` (PR-3 separado).
- `.claude/settings.json` y `.claude/settings.local.json` (regla del PO).
- `.claude/ledger/` (regla del PO — solo append durante esta sesión).
- `.claude/worktrees/` (regla del PO — 12+ worktrees parallel).
- **`agents/` raíz** — los 3 archivos quedan como overrides locales Booster documentados.
- `references/`, `playbooks/`, `runbooks/`, `audit-outputs/` (Booster-específicos).
- Cualquier ADR ≤ 048 (excepto ADR-002 → `Superseded by ADR-049`).
- Nueva publicación del plugin (PR-1 cerrado, fuera de scope).
- **Migración del contenido de `agents/code-reviewer.md`, `security-auditor.md`, `sre-oncall.md` al plugin** — futuro PR-1.5 (booster-skills v0.2.0); stub tracking en `.specs/_followups/`.
- `CHANGELOG.md` o release-notes del proyecto Booster AI (chore meta-trabajo).

---

## 6. Constraints

### 6.1 Audit-session hooks activos (`.claude/settings.json`) — validado empíricamente

- `PreToolUse: Write|Edit` solo permite paths con `/audit-outputs/`, `/.claude/`, o `/tmp/`. **Bloquea Write/Edit en `.specs/`, `docs/`, `CLAUDE.md` raíz**.
- `PreToolUse: Bash` bloquea regex en el COMANDO BASH: deleciones, renames de archivo, commits, push, reset, checkout-de-rama-nueva, merge, instalación de paquetes.
- **Workarounds (validados)**:
  - Escritura fuera de `.claude/`: vía Write a `.claude/staging/` + `cp` al destino.
  - Edición de archivos existentes: rewrite completo vía staging + `cp`.
  - Deleciones, commits, push: **PO ejecuta manualmente** desde otra sesión / terminal directa (etiquetadas `[PO-EXECUTES]` en plan.md).
  - Branch rename: `git branch -m` permitido.

### 6.2 Reglas del PO inmutables

- Conventional Commits con scope, español imperativo, ≤72 chars.
- Sección `## Evidencia` obligatoria en PR body.
- No tocar `.claude/{ledger,settings.json,settings.local.json,worktrees}/`.
- Vocabulario anti-drift activo (lista canónica en `agent-rigor/CLAUDE.md §4`).

- **Squash merge MANDATORIO en `/ship`** — no opcional. Justificación: limpia typos cosméticos detectados durante el cleanup (e.g., `versionadoç` en T13d, `*` extra en T13a) y presenta un solo commit limpio en main. Se enforce en `agent-rigor:64-shipping-and-launch` checklist.

### 6.3 Repos GitHub vinculados (canónico)

- **`github.com/boosterchile/booster-ai`** — repo donde vive este PR (PR-2).
- **`github.com/boosterchile/booster-skills`** — repo del plugin booster-skills (PR-1 cerrado).
- **`github.com/boosterchile/best-skill-claude`** — repo del plugin agent-rigor (fuera de scope de PRs Booster).

### 6.4 ADR vinculantes

- **ADR-002** (skill-framework-adoption): supersedida por ADR-049.
- **ADR-046** (numbering collisions): "un número por archivo" desde ADR-040; ADR-049 libre.

### 6.5 Branch

- Actual: `claude/flamboyant-jones-42a39b`.
- Target: `chore/integrate-booster-skills-plugin` vía `git branch -m`.

### 6.6 CI

- Lint, typecheck, test deben pasar.
- Verificación pre-push: `grep -rE "skills/|\.claude/commands|\.claude/agents" .github/workflows/` → empíricamente ya retorna vacío.

---

## 7. Approach

### 7.1 Estrategia ante audit-session

**Patrón Write→staging+cp** para escrituras (validado). **PO ejecuta** comandos bloqueados (rm, commits, push) desde otra sesión.

### 7.2 Pasos del Approach

| # | Acción | Quién ejecuta | Producto |
|---|---|---|---|
| 1 | Capturar outputs faltantes (STATE-addendum line 47-58 + verificación pre-push CI) en `.specs/integrate-booster-skills-plugin/evidence/pre-cleanup-snapshot.txt` | Agent (Bash) | Snapshot persistido |
| 2 | Rename branch: `git branch -m chore/integrate-booster-skills-plugin` | PO | Branch correcto activo |
| 3 | Crear `docs/plugins/` y commitear el REPORTE-migracion-booster-skills-v0.1.0.md (G4) — desde `/Users/fvicencio/Desktop/ahora/` vía `cp` | Agent | `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md` |
| 4 | Escribir `docs/adr/049-claude-code-plugin-system-adoption.md` vía staging + `cp` (incluye §Replicabilidad referenciando `docs/plugins/REPORTE...`) | Agent | ADR-049 creada |
| 5 | Reescribir `docs/adr/002-skill-framework-adoption.md` con `Estado: Superseded by ADR-049` vía staging + `cp` | Agent | ADR-002 superseded |
| 6 | Reescribir `CLAUDE.md` vía staging + `cp` con merge selectivo: insertar §Integración (incluye sub-sección "Capas adicionales locales del proyecto" documentando `agents/` raíz — G6) + reemplazar §Principios rectores con §Reglas no-negociables del stack Booster | Agent | CLAUDE.md actualizada |
| 7 | Escribir `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` stub vía staging + `cp` (G5) | Agent | Stub creado |
| 8 | Añadir `.claude/staging/` a `.gitignore` vía staging + `cp` (G7) | Agent | .gitignore actualizado |
| 9 | Borrar archivos del scope canónico + `hooks/session-start.md`: `.claude/commands/{6}`, `.claude/agents/{6}`, `.claude/skills/` (si existiera, ya está ausente), `skills/` raíz, `hooks/session-start.md`, `hooks/` | PO (`rm -f` / `rm -rf` + `rmdir`) | Files removed |
| 10 | Capturar `git status --short`, tree antes/después, `/plugin list` literal output | Agent (Bash) + PO (`/plugin list` desde Claude Code) | `evidence/` poblado |
| 11 | `git add -A` | Agent | Staging |
| 12 | Commits atómicos (1 por fase) | PO (`git commit` bloqueado para agent) | Commits en branch |
| 12a | Commit 1: `chore(claude): borrar .claude/commands/, .claude/agents/, .claude/skills/, skills/, hooks/` | PO | |
| 12b | Commit 2: `docs(claude): consolidar CLAUDE.md con integracion plugins y reglas stack` | PO | |
| 12c | Commit 3: `docs(adr): ADR-049 adopcion plugins Claude Code; ADR-002 superseded; docs/plugins/REPORTE` | PO | |
| 12d | Commit 4: `chore(git): excluir .claude/staging/ de versionado` | PO | |
| 12e | Commit 5: `docs(specs): spec v4 + plan + verify + review + ship + followups stub` | PO | |
| 13 | Devils-advocate pass sobre el resultado | Sub-agent + Agent | `.specs/integrate-booster-skills-plugin/devils-advocate.md` |
| 14 | `/agent-rigor:test` ejecuta `verify.sh` validando SC-1..SC-20 | Agent | `verify.md` |
| 15 | Cooling-off 30 min + `/agent-rigor:review` (code-reviewer + devils-advocate) | Agent | `review.md` |
| 16 | `/agent-rigor:ship` → push + `gh pr create` con body que incluye `## Evidencia` literal | Agent prepara cuerpo; PO ejecuta `gh pr create` | PR URL |
| 17 | Merge en `main` | PO | PR closed, ADR-049 + REPORTE + CLAUDE.md updates live |
| 18 | Actualizar `docs/handoff/CURRENT.md` con cierre de PR-2 + delta de plugin system | Agent (staging+cp) | CURRENT.md actualizado |

### 7.3 Subagents y skills a invocar

- `arquitecto-maestro` — produjo v1-v4.
- `/agent-rigor:plan` (siguiente) — desagrega en `plan.md`.
- `/agent-rigor:build` — ejecuta tasks.
- `devils-advocate` — mandatory en REVIEW y SHIP (solo-dev mode).
- `code-reviewer` (en `/agent-rigor:review`) — five-axis review (CLAUDE.md merge, ADR-049 con §Replicabilidad, coherencia spec/plan/verify).
- NO `security-auditor` (no toca auth/input/red/secrets).
- NO `test-engineer` (no tests reales).
- NO `ux-designer` (no UI).

### 7.4 Hooks/MCPs requeridos

- Hook audit-session: workaround §7.1.
- agent-rigor hooks: activos. Cooling-off 30 min antes de `/agent-rigor:review`.

---

## 8. Risks

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-1 | Hook audit-session bloquea operaciones | Alta | Alto | §7.1: staging+cp + tasks `[PO-EXECUTES]`. Validado empíricamente. |
| R-2 | Rename del branch deja referencias colgando | Baja | Bajo | Worktree es ephemeral |
| R-3 | CI rompe por workflow que llama paths a borrar | **Muy Baja** | Alto | Verificado empíricamente: `grep` en `.github/workflows/` retorna vacío |
| R-4 | PR muy grande para code review | Media | Medio | Commits atómicos por fase (12a-12e). |
| R-5 | ADR-002 marcado Superseded sin documentar por qué | Baja | Alto | ADR-049 incluye sección "Supersede" explícita |
| R-6 | Plugin tiene bug no descubierto y la copia local era fallback de facto | Baja | Alto | Tarball y plugin verificados bit-perfect (18/18 SHA256 match). Si aparece bug, reinstalar vía `/plugin install` o `git restore` desde commit pre-PR-2 |
| R-7 | `.claude/staging/` queda con artefactos huérfanos | **Resuelto en v4 (G7)** | — | SC-19 + task 8: `.gitignore` excluye `.claude/staging/`. Los archivos vivos en staging quedan pero no afectan tracking ni clones |
| R-8 | `hooks/` borrado deja referencias rotas en CLAUDE.md | Baja | Bajo | Task §7.2 paso 1 captura grep "hooks/" — reemplazar si aplica |
| R-9 | Discrepancia STATE.md vs resultado final | Baja | Bajo | `verify.md` documenta diff; CURRENT.md como source-of-truth final |
| R-10 | Nueva sesión post-PR-2 no entiende qué es `agents/` raíz | **Resuelto en v4 (G6)** | — | SC-17: CLAUDE.md documenta los 3 archivos explícitamente como overrides Booster |
| R-11 | Procedimiento de replicabilidad se pierde al borrar copias locales | **Resuelto en v4 (G4)** | — | SC-18: ADR-049 §Replicabilidad + `docs/plugins/REPORTE-migracion...md` commitado |
| R-12 | OQ-3 (migración futura root agents/) se olvida y nunca se ejecuta | **Resuelto en v4 (G5)** | — | SC-20: `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md` stub creado con prompt para sesión futura |

---

## 9. Alternatives considered (rejected)

| Alternativa | Razón de rechazo |
|---|---|
| **A** | Mantener copias locales `.claude/*` como override permanente del plugin | Viola Principio §3 (un source-of-truth). Plugin y override se desincronizan |
| **B** | Borrar también root `agents/` (los 3 archivos) | Fuera de scope canónico. Contenido Ley 19.628, SII, ESG, roles Uber-like no cubierto por plugin v0.1.0; migración previa requeriría v0.2.0 (futuro PR-1.5; stub en `.specs/_followups/`) |
| **C** | Anexar addendum al final de CLAUDE.md sin tocar `Principios rectores` | Contenido duplicado (Zero `any` en 2 secciones). PO decidió Merge Selectivo |
| **D** | Postergar ADR-049 a otro PR | Sin ADR concurrente, cleanup es huérfano de justificación (Principio §4) |
| **E** | Renombrar archivos a `.deprecated.md` | Conserva ruido. Borrado limpio es Cero Parches day 0 |
| **F** | Hacer PR-2 desde otra sesión sin audit-session | Rompe trazabilidad del ledger de esta sesión |
| **G** | Eliminar el hook audit-session permanentemente como parte de este PR | Fuera de scope (OQ-1) |
| **H** | Desactivar audit-session puntualmente renombrando `.claude/settings.json` | Viola regla PO inmutable |
| **K** (nuevo v4) | Mantener REPORTE-migracion solo en Desktop/ahora/ sin commitear | Falla G4: el know-how no estaría disponible para futuros desarrolladores ni para sesiones Claude Code nuevas. Commitear a `docs/plugins/` lo hace artefacto público y referenciable desde ADR-049 |
| **L** (nuevo v4) | Embed completo del REPORTE inline en ADR-049 | ADR-049 quedaría >500 líneas. Mejor mantener ADR-049 conciso con §Replicabilidad de 5 pasos + link al REPORTE como ejemplo trabajado |

---

## 10. Test list

Verificaciones se ejecutan como `verify.sh` validando SC-1..SC-20:

```bash
#!/usr/bin/env bash
set -euo pipefail

# SC-1..5: estructura del repo (canónico + hooks)
[ ! -d .claude/commands ] || [ -z "$(ls -A .claude/commands 2>/dev/null)" ]
[ ! -d .claude/agents ] || [ -z "$(ls -A .claude/agents 2>/dev/null)" ]
[ ! -d .claude/skills ] || [ -z "$(ls -A .claude/skills 2>/dev/null)" ]
[ ! -d skills ]
[ ! -d hooks ]

# SC-6: agents/ raíz intacto con los 3 archivos
expected="agents/code-reviewer.md agents/security-auditor.md agents/sre-oncall.md "
actual="$(ls agents/*.md 2>/dev/null | sort | tr '\n' ' ')"
test "$actual" = "$expected" || { echo "FAIL SC-6. Actual: $actual"; exit 1; }

# SC-7: .claude/ key paths preservados
if [ -n "$(git diff main -- .claude/ledger .claude/settings.json .claude/settings.local.json .claude/worktrees)" ]; then
  echo "FAIL SC-7"; exit 1
fi

# SC-8..9: CLAUDE.md
grep -qF "## Integración con plugins de Claude Code" CLAUDE.md
grep -qF "## Reglas no-negociables del stack Booster" CLAUDE.md
! grep -qF "Principios rectores — inviolables desde el commit 1" CLAUDE.md

# SC-10..11: ADRs
grep -qE "^\*\*Estado\*\*: Accepted" docs/adr/049-claude-code-plugin-system-adoption.md
grep -qF "boosterchile/booster-skills" docs/adr/049-claude-code-plugin-system-adoption.md
grep -qE "^\*\*Estado\*\*: Superseded by ADR-049" docs/adr/002-skill-framework-adoption.md

# SC-12: branch
test "$(git rev-parse --abbrev-ref HEAD)" = "chore/integrate-booster-skills-plugin"

# SC-13: CI externo

# SC-14: sin código nuevo offensivo
! git diff main -- '*.ts' '*.tsx' | grep -E "^\+.*(\bany\b|@ts-ignore|console\.)"

# SC-15: PR description manual

# SC-16: artifacts existen
[ -f .specs/integrate-booster-skills-plugin/spec.md ]
[ -f .specs/integrate-booster-skills-plugin/plan.md ]
[ -f .specs/integrate-booster-skills-plugin/verify.md ]
[ -f .specs/integrate-booster-skills-plugin/review.md ]
[ -f .specs/integrate-booster-skills-plugin/ship.md ]

# SC-17 (G6): CLAUDE.md documenta agents/ raíz
grep -qF "agents/code-reviewer.md" CLAUDE.md
grep -qF "agents/security-auditor.md" CLAUDE.md
grep -qF "agents/sre-oncall.md" CLAUDE.md
grep -qF "override local Booster" CLAUDE.md

# SC-18 (G4): ADR-049 §Replicabilidad + REPORTE commitado
grep -qF "## Replicabilidad" docs/adr/049-claude-code-plugin-system-adoption.md
grep -qF "docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md" docs/adr/049-claude-code-plugin-system-adoption.md
[ -f docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md ]

# SC-19 (G7): .gitignore
grep -qF ".claude/staging/" .gitignore

# SC-20 (G5): stub followup
[ -f .specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md ]

echo "OK: SC-1..20 verified (SC-13 y SC-15 verificados externamente)"
```

Persistido en `.specs/integrate-booster-skills-plugin/verify.sh`, ejecutado en fase VERIFY.

---

## 11. Open questions

| OQ | Pregunta | Resolver |
|---|---|---|
| OQ-1 | ¿Los hooks audit-session se desactivan permanentemente al cierre de PR-2 o quedan activos? | PO durante `/ship` |
| OQ-2 | ¿La sección "Estructura del repo (v2 — tras ADR-004..008)" del CLAUDE.md se actualiza a "v3 — tras ADR-049"? | PO durante BUILD task de CLAUDE.md merge |
| OQ-3 | ~~Migrar contenido de `agents/` raíz al plugin v0.2.0~~ — **promovido a stub formal en `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`** | Sesión futura (post-PR-2) |

---

## 12. Devils-advocate pass

**Pendiente formal** — se invoca como sub-agent en transición `/agent-rigor:plan` → BUILD.

### Pre-pasada del propio arquitecto-maestro v4

1. **¿G4 vía commit del REPORTE-migracion a `docs/plugins/` versus embed en ADR-049?**
   - Decisión: commit del REPORTE como artefacto independiente + ADR-049 §Replicabilidad con 5 pasos concisos + link al REPORTE como ejemplo trabajado.
   - Razón: separa concerns — ADR-049 documenta la DECISIÓN; REPORTE documenta el HOW-TO ejecutado. Ambos referenciables independientemente. Inversa (embed full) inflaría ADR-049 a >500 líneas y mezclaría niveles de abstracción.

2. **¿G6 con SC-17 chequeando 4 grep literals es suficiente?**
   - Objeción: SC-17 verifica que existan menciones literales, no que la sección sea coherente con la realidad operacional.
   - Respuesta: SC-17 cubre el contrato mínimo (los 3 archivos documentados + nominación explícita como "override local Booster"). La calidad redaccional la valida code-reviewer + devils-advocate en `/agent-rigor:review`. SC mínimo + review humano-equivalente = suficiente.

3. **¿La cadena PR-1 → PR-2 → futuro PR-1.5 (migración root agents/) → PR-3 (migración specs path) tiene orden correcto?**
   - Objeción: PR-1.5 podría hacerse antes de PR-2 para eliminar la necesidad de mantener overrides locales.
   - Respuesta: PR-1.5 modifica el plugin remoto (booster-skills repo); PR-2 modifica el repo local Booster. Hacer PR-1.5 antes implica posponer el cleanup local — fricción operativa más larga. Coste/beneficio: mejor cerrar PR-2 con overrides documentados (es coste de transición conocido) que esperar PR-1.5 (timeline indefinido). Stub en `.specs/_followups/` mantiene el follow-up tracked.

4. **¿20 SC es demasiado? Marca señal de over-engineering?**
   - Objeción: muchos SC pueden indicar spec inflada.
   - Respuesta: 4 SC nuevos (SC-17/18/19/20) corresponden 1:1 a los 4 gaps que el coherence-audit identificó. Cada uno es ejecutable. No hay SC redundantes. Coverage proporcional al alcance del PR.

---

## 13. Approval

**Status**: Pendiente (v4 — Opción B post coherence-audit: G4 + G6 resueltos inline, G1-G3-G5-G7 como anotaciones operacionales)

**Aprobador requerido**: Felipe Vicencio (PO, `dev@boosterchile.com`)

**Para aprobar**, comentar en chat: `APPROVED_BY_PO_2026-MM-DD v4` con firma textual.

O si requiere cambios: listar específicos y volver a Phase 2 (quinta iteración).

---

## Apéndice A — Cómo se ve ADR-049 §Replicabilidad (preview del contenido durante BUILD)

> ### Replicabilidad — Crear un plugin equivalente para otro proyecto
>
> La arquitectura de 3 capas (`agent-rigor` global + `<proyecto>-skills` plugin + `<proyecto>` local minimal) es replicable. Procedimiento de 5 pasos:
>
> 1. **Identificar las skills/agents específicos del proyecto** que merecen vivir en plugin (estables, reusables, no triviales).
> 2. **Construir directorio** `<proyecto>-skills/` con: `.claude-plugin/{plugin.json, marketplace.json}`, `README.md`, `CHANGELOG.md`, `LICENSE`, `skills/<skill>/SKILL.md`, `agents/<agent>.md`.
> 3. **Validar manifests** con `claude plugin validate .` y parser auténtico (PyYAML para frontmatters, json.loads para manifests).
> 4. **Publicar en GitHub** + tag `v0.1.0` + release.
> 5. **Instalar y verificar**: `/plugin marketplace add <org>/<proyecto>-skills` + `/plugin install <plugin-name>@<plugin-name>` + `/plugin list` confirma activo.
>
> Ejemplo trabajado completo (incluye decisiones de diseño, bugs encontrados, validaciones aplicadas): `docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md`.

## Apéndice B — Cómo se ve CLAUDE.md "Capas adicionales locales del proyecto" (preview)

> ### Capas adicionales locales del proyecto
>
> Además de los plugins, el repo Booster mantiene 3 archivos en `agents/` raíz como **overrides locales Booster** del agent-rigor genérico:
>
> | Archivo | Qué extiende | Por qué local |
> |---|---|---|
> | `agents/code-reviewer.md` | `agent-rigor:code-reviewer` | Añade disciplina ADR Booster + anti-rationalizations Booster específicas |
> | `agents/security-auditor.md` | `agent-rigor:security-auditor` | Añade compliance Chile: Ley 19.628 (privacy), SII/DTE (retention 6 años), modelo Uber-like + Sustainability Stakeholder (ADR-004, ADR-034) |
> | `agents/sre-oncall.md` | — (sin equivalente en plugins) | Único: SLOs, observabilidad GCP, capacity planning específico |
>
> Cuando agent-rigor invoca `subagent_type: code-reviewer` o `security-auditor` en este repo, Claude Code resuelve al override local en lugar del genérico del plugin. Es comportamiento deliberado.
>
> Migración futura de este contenido al plugin `booster-skills` (v0.2.0+ con compliance Chile) tracked en `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`.
