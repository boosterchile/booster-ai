# Plan v3: integrate-booster-skills-plugin

- **Spec**: `.specs/integrate-booster-skills-plugin/spec.md` v4 (APPROVED_BY_PO_2026-05-20 v4)
- **Plan previo**: v2 (APPROVED_PLAN_BY_PO_2026-05-20 v2) — T1-T13e DONE, T14 post-merge pendiente
- **Trigger v3**: REVIEW verdict CHANGES_REQUESTED — sub-agents detectaron 19 orphan refs + idioma header ADR-049 + .gitignore redundancia + SC-17d cosmético
- **Created**: 2026-05-21
- **Status**: Draft v3 — pendiente aprobación PO

---

## Cambios v2 → v3

- **8 tasks nuevas** (T15-T22) que ejecutan los fixes derivados del review
- **T14 (post-merge CURRENT.md)** se mantiene, renumerado a T25
- **Squash merge MANDATORIO en SHIP** (T20 doc + T24 ejecución) — single hard requirement, no opcional
- Plan v2 T1-T13e quedan DONE (no se re-ejecutan)

Razones del re-plan:
1. R-9 mitigación del spec era demasiado estrecha (solo CLAUDE.md + .github/workflows/) — 19 archivos del repo tienen orphan refs no cubiertos
2. ADR-049 header en inglés vs ADR-045-048 en español (SC-10 verificó literal pero no consistency)
3. .gitignore línea 139 (`.claude/staging/`) redundante con línea 131 (`.claude/`)
4. SC-17d depende de column header de tabla — verificación cosmética
5. Commits con typos (versionadoç, hooks/*) — resuelve squash merge mandatory

---

## Tasks nuevas

### T15: Castellanizar header ADR-049 + actualizar SC-10 en verify.sh [DONE 2026-05-21]
- **Files**:
  - `docs/adr/049-claude-code-plugin-system-adoption.md` (modificar líneas 3-4)
  - `docs/adr/002-skill-framework-adoption.md` (modificar líneas 3-4 para alineación cross-ADR)
  - `.specs/integrate-booster-skills-plugin/verify.sh` (modificar SC-10/SC-11 grep patterns)
  - `.specs/integrate-booster-skills-plugin/spec.md` (actualizar SC-10/SC-11 description)
- **LOC**: ~12 LOC delta
- **Owner**: `[AGENT]` — sed sobre 4 archivos
- **Cambios específicos**:
  - ADR-049: `**Status**` → `**Estado**`; `**Date**` → `**Fecha**`
  - ADR-002: `**Status**: Superseded by ADR-049` → `**Estado**: Superseded by ADR-049`; `**Date**` → `**Fecha**`
  - verify.sh SC-10a: `grep -qE "^\*\*Status\*\*: Accepted"` → `grep -qE "^\*\*Estado\*\*: Accepted"`
  - verify.sh SC-11: idem
  - spec.md §3 SC-10/SC-11: actualizar texto descriptivo
- **Acceptance**: ADR-045-049 y ADR-002 todos usan `**Estado**`/`**Fecha**` consistentemente; verify.sh SC-10/SC-11 actualizados pasan
- **Rollback**: `git restore docs/adr/049-...md docs/adr/002-...md .specs/integrate-booster-skills-plugin/verify.sh .specs/integrate-booster-skills-plugin/spec.md`

### T16: Crear ADR-050 path-remapping [DONE 2026-05-21]
- **Files**: `docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md` (nuevo)
- **LOC**: ~80 LOC
- **Owner**: `[AGENT]` — Write to staging + cp
- **Contenido**:
  - Estado: Accepted
  - Fecha: 2026-05-21
  - Decider: Felipe Vicencio (PO)
  - Related: ADR-049, ADR-002, ADR-001, ADR-011
  - §Contexto: ADRs históricos (001, 011) referencian paths que PR-2 borró. ADR-046 prohíbe editar ADRs viejos directamente.
  - §Decisión: documentar el mapping path antiguo → nuevo namespacing como referencia canónica. Lectores futuros que ven `skills/X` en ADRs viejos resuelven con esta tabla.
  - §Mapping tabla:
    - `skills/adding-cloud-run-service/SKILL.md` → `booster-skills:adding-cloud-run-service`
    - `skills/carbon-calculation-glec/SKILL.md` → `booster-skills:carbon-calculation-glec`
    - `skills/empty-leg-matching/SKILL.md` → `booster-skills:empty-leg-matching`
    - `skills/incident-response/SKILL.md` → `booster-skills:incident-response`
    - `skills/arquitecto-maestro/SKILL.md` → `booster-skills:arquitecto-maestro`
    - `skills/using-agent-skills/SKILL.md` → `agent-rigor:00-using-this-pack` (deprecated, no migra)
    - `skills/writing-adrs/SKILL.md` → `agent-rigor:63-documentation-and-adrs` (deprecated, no migra)
    - `skills/writing-tests/SKILL.md` → `agent-rigor:31-test-driven-development` (nunca existió como skill local; era TODO)
    - `.claude/commands/spec.md` → `/agent-rigor:spec`
    - `.claude/commands/plan.md` → `/agent-rigor:plan`
    - `.claude/commands/build.md` → `/agent-rigor:build`
    - `.claude/commands/test.md` → `/agent-rigor:test`
    - `.claude/commands/review.md` → `/agent-rigor:review`
    - `.claude/commands/ship.md` → `/agent-rigor:ship`
    - `.claude/agents/<6>` → `booster-skills:<6>` namespaced
    - `hooks/session-start.md` → reemplazado por agent-rigor SessionStart hook (en `~/.claude/plugins/cache/agent-rigor/...`)
  - §Consecuencias: ADRs 001 y 011 quedan intactos; referencias se resuelven mentalmente vía esta tabla; futuros ADRs deben usar nombres canónicos de plugins
  - §Referencias: ADR-049 (decisión arquitectónica), CLAUDE.md (sección §Integración con plugins de Claude Code), docs/plugins/REPORTE (ejemplo trabajado)
- **Acceptance**: SC-NUEVO (ver spec actualizada) — ADR-050 existe con Estado: Accepted y contiene la tabla de mapping
- **Rollback**: `rm docs/adr/050-...md`

### T17: Fix orphan refs Categorías A+B+C+D+G (13 archivos) [DONE 2026-05-21]
- **Files modificados**:
  - **Categoría A**: `README.md` (líneas 115, 127), `AGENTS.md` (línea 53)
  - **Categoría B**: 7 `apps/*/README.md` (línea 40 api, línea 10 los otros 6)
  - **Categoría C**: 3 `apps/*/src/main.ts` (línea 13: matching-engine, notification-service, document-service)
  - **Categoría D**: `docs/ci-cd.md` (líneas 135, 142)
  - **Categoría G**: `packages/shared-schemas/src/domain/cargo-request.ts` (línea 33)
- **LOC**: ~30 LOC delta total
- **Owner**: `[AGENT]` — Write to staging + cp para cada archivo, o sed -i '' si patrón uniforme
- **Cambios específicos**:
  - Reemplazar `skills/adding-cloud-run-service/SKILL.md` → `booster-skills:adding-cloud-run-service` (skill del plugin)
  - Reemplazar `skills/incident-response/SKILL.md` → `booster-skills:incident-response`
  - Reemplazar `skills/empty-leg-matching/SKILL.md` → `booster-skills:empty-leg-matching`
  - Reemplazar `skills/writing-tests/SKILL.md` → `agent-rigor:31-test-driven-development`
  - Reemplazar referencias genéricas a `skills/` o `.claude/commands/` → ver ADR-049 + ADR-050
  - `README.md` líneas 115, 127: actualizar el tree y la lista
  - `AGENTS.md` línea 53: actualizar el bullet
  - `apps/*/src/main.ts` línea 13 comments: actualizar a referencia plugin
- **Acceptance**: SC-NUEVO — `find docs apps packages infrastructure scripts README.md AGENTS.md -type f -exec grep -lE "skills/|\.claude/commands|\.claude/agents|hooks/session-start" {} +` retorna solo los archivos legítimos (.specs/, docs/plugins/REPORTE, ADR-002, ADR-049, ADR-050, ADRs 001/011 si se aceptan)
- **Rollback**: `git restore <13 archivos>`

### T18: Limpiar `.gitignore:139` redundancia [DONE 2026-05-21]
- **Files**: `.gitignore` (eliminar líneas 138-139 — comment + path)
- **LOC**: -3 LOC
- **Owner**: `[AGENT]` — sed -i '' delete específico
- **Decisión técnica**: línea 131 `.claude/` ya cubre `.claude/staging/`. SC-19 redactado para verificar literal pero el contenido es noise. **Acción**: eliminar líneas 138-139 (newline + comment + path). Si futuro `.gitignore` cambia el patrón `.claude/` (e.g., agregando `!.claude/staging-public/`), entonces re-incluir staging/. Al cierre de PR-2 es redundante.
- **Acceptance**: SC-19 se reformula a "Verificar que `.claude/staging/` está cubierto por `.gitignore` vía línea `.claude/`" — pasa empíricamente vía `git check-ignore .claude/staging/test.md`
- **Rollback**: `git restore .gitignore`

### T19: Refinar SC-17d a grep semántico [DONE 2026-05-21]
- **Files**:
  - `.specs/integrate-booster-skills-plugin/verify.sh` (modificar SC-17d)
  - `.specs/integrate-booster-skills-plugin/spec.md` §3 SC-17 description
- **LOC**: ~5 LOC delta
- **Owner**: `[AGENT]`
- **Cambio**: SC-17d actual `grep -qF "override local Booster"` (cosmético) → **multi-string grep validando que los 3 archivos están descritos PROXIMOS a la palabra "override"**:
  ```bash
  # Nuevo SC-17d: validación semántica
  grep -A 10 "agents/code-reviewer.md" CLAUDE.md | grep -qi "override"
  grep -A 10 "agents/security-auditor.md" CLAUDE.md | grep -qi "override"
  grep -A 10 "agents/sre-oncall.md" CLAUDE.md | grep -qi "override"
  ```
- **Acceptance**: SC-17d refined pasa con el contenido actual de CLAUDE.md (ya documenta los 3 con "override")
- **Rollback**: `git restore .specs/integrate-booster-skills-plugin/verify.sh .specs/integrate-booster-skills-plugin/spec.md`

### T20: Documentar squash merge MANDATORY en spec.md (para ship.md downstream) [DONE 2026-05-21]
- **Files**: `.specs/integrate-booster-skills-plugin/spec.md` (actualizar §SHIP-related notes)
- **LOC**: ~10 LOC delta
- **Owner**: `[AGENT]`
- **Cambio**: añadir a §6.2 Reglas del PO o §7.2 Approach task 14 una nota: "**Squash merge MANDATORIO** en `/ship` — no opcional. Justificación: limpia typos cosméticos en commits T13a (`hooks/*`) y T13d (`versionadoç`); presenta un solo commit limpio en main."
- **Acceptance**: spec contiene literal "Squash merge MANDATORIO"; ship.md cuando se produzca lo incluye en su checklist
- **Rollback**: `git restore .specs/integrate-booster-skills-plugin/spec.md`

### T21: Re-ejecutar verify.sh + nuevo orphan-refs check [DONE 2026-05-21]
- **Files**:
  - `.specs/integrate-booster-skills-plugin/verify.sh` (extender con SC-NUEVOS para T15-T20)
  - `.specs/integrate-booster-skills-plugin/verify.md` (sobrescribir con nuevos resultados)
  - `.specs/integrate-booster-skills-plugin/evidence/orphan-refs-check.txt` (nuevo — output del grep exhaustivo)
- **LOC**: ~30 LOC verify.sh + 50 LOC verify.md actualizado
- **Owner**: `[AGENT]`
- **Pasos**:
  1. Añadir a verify.sh: SC-21 (ADR-050 existe con Estado: Accepted), SC-22 (zero orphan refs después de T17 — usando el grep exhaustivo), SC-23 (.gitignore .claude/staging/ cubierto vía línea 131 sin línea 139 explícita)
  2. Ejecutar verify.sh
  3. Sobrescribir verify.md con nuevos resultados (esperado: 26 originales + 3-4 nuevos = ~30 PASS / 0 FAIL / 4 EXTERNAL)
  4. Guardar el output completo del grep orphan-refs en evidence/
- **Acceptance**: verify.sh exit 0 con 0 FAIL; orphan-refs-check.txt confirma zero matches en archivos no-legítimos
- **Rollback**: `git restore .specs/integrate-booster-skills-plugin/verify.sh .specs/integrate-booster-skills-plugin/verify.md` + eliminar `.specs/integrate-booster-skills-plugin/evidence/orphan-refs-check.txt`

### T22: Commit incremental T15-T21 + actualizar plan.md DONE markers [DONE 2026-05-21]
- **Files staged**: todos los archivos modificados por T15-T21
- **Owner**: `[PO]` (commit bloqueado para agent)
- **Comando**:
  ```bash
  git add docs/adr/049-claude-code-plugin-system-adoption.md \
          docs/adr/002-skill-framework-adoption.md \
          docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md \
          README.md AGENTS.md docs/ci-cd.md \
          apps/api/README.md apps/document-service/README.md apps/matching-engine/README.md \
          apps/notification-service/README.md apps/telemetry-processor/README.md \
          apps/telemetry-tcp-gateway/README.md apps/whatsapp-bot/README.md \
          apps/matching-engine/src/main.ts apps/notification-service/src/main.ts apps/document-service/src/main.ts \
          packages/shared-schemas/src/domain/cargo-request.ts \
          .gitignore \
          .specs/integrate-booster-skills-plugin/
  git commit -m "fix(claude): orphan refs + ADR-050 path-remapping + idioma headers ADRs"
  ```
- **Acceptance**: commit nuevo en branch; `git log --oneline -6` muestra 6 commits ahead of main
- **Rollback**: `git reset --soft HEAD~1`

### T23 (era T22 en v2): Re-REVIEW con sub-agents
- **Skill**: `agent-rigor:50-code-review-and-quality` (re-invocar)
- **Owner**: `[AGENT]`
- **Pasos**:
  1. Cooling-off check (si waiver, registrar; si elapsed real, proceder)
  2. Invocar code-reviewer + devils-advocate (segunda iteración)
  3. Verificar que los 19 orphan refs están resueltos
  4. Verificar idioma header
  5. Producir review.md v2 (sobrescribir con nuevo verdict)
- **Acceptance**: verdict APPROVED (o nueva ronda de objeciones específicas)
- **Rollback**: n/a

### T24 (era T23 en v2): SHIP con squash merge mandatorio
- **Skill**: `agent-rigor:64-shipping-and-launch`
- **Owner**: `[AGENT]` prepara cuerpo; `[PO]` ejecuta `gh pr create` + `gh pr merge --squash`
- **Acceptance**: PR mergeado en main vía squash, ADR-049 + ADR-050 live, CLAUDE.md v3 live

### T25 (era T14 / T24 en v2): Post-merge update CURRENT.md
- Sin cambios — task T14 original renombrada por orden

---

## Out-of-band tasks

- **OOB-1**: ADR-049 §Validación checklist 2 ítems `[ ]` → `[x]` se actualizan en T25 (post-merge), no en T15-T22.
- **OOB-2**: Pre-commit commitlint gap para chars no-ASCII al final del summary — crear stub adicional en `.specs/_followups/` durante T22 commit.
- **OOB-3**: Squash merge elimina typos `versionadoç` y `hooks/*` — confirmado en T20 documentación.

---

## Open questions (no bloqueantes)

- **OQ-historic-ADR-status**: ¿Marcar ADR-049 §Validación checklist como `[x]` en T25 o en un commit follow-up? **Resolución**: en T25 post-merge para mantener atomicidad del PR-2.
- **OQ-extra-followup**: ¿Crear stub para commitlint gap (OOB-2) como follow-up #2? **Resolución**: sí, durante T22.

---

## Devils-advocate pass v3 (pre-pasada del propio arquitecto-maestro)

1. **¿Plan v3 cubre TODOS los hallazgos del review?**
   - 5 bloqueantes code-reviewer: T15 (idioma), T17 (orphans Cat A-D, G), T18 (gitignore), T19 (SC-17d), T20+T21 (squash) — ✓
   - 5 bloqueantes devils-advocate: T17 cubre A-D+G; T16 cubre E (ADR-050); F aceptado como historical (residual risk documented); + squash en T20 — ✓
   - Code-reviewer questions/suggestions: ADR-049 §Validación → OOB-1 (T25); SC-13 confidence → verifica en CI tras push T24; evidence tracked → ya confirmado vía commit T13e — ✓

2. **¿Hay riesgo de iteración v4?**
   - Si T17 sed reemplazos rompen sintaxis Markdown o JSDoc: bajo (cambios mecánicos string-to-string). Mitigación: revisar diff antes de T22 commit.
   - Si ADR-050 introduce inconsistencia con ADR-049: bajo (T16 es nuevo doc independiente).
   - Si re-VERIFY (T21) detecta nuevos hallazgos: medio. Mitigación: verify.sh ampliado cubre dimensiones del review.

3. **¿Aceptamos Categoría F (3 historical specs/plans) sin tocar?**
   - Sí. Aceptable como residual risk en review.md actual. PR-3 (migración specs path canónica) puede o no afectarlos en el futuro.

---

## Verificación del plan v3 (sub-checklist skill 20)

- [x] Todas tasks son vertical slices (cada una deja el repo en estado funcional)
- [x] LOC ≤100 por task — todas dentro (T16 ~80 ADR-050 es el más grande, justificable como doc atómico)
- [x] Acceptance trace a SC del spec actualizada
- [x] Rollback plan ejecutable para cada task
- [x] Devils-advocate pre-pasada documentada (sección anterior)

---

## Approval

**Status**: Pendiente.

**Para aprobar**: `APPROVED_PLAN_BY_PO_2026-05-21 v3` con firma textual.

Tras approval: ejecuto T15-T21 inmediatamente (AGENT-heavy con un solo PO commit en T22), después T23 re-REVIEW, después T24 SHIP con squash.

---

## Resumen ejecutivo

- **9 tasks nuevas** (T15-T25 con T25 = T14 original renombrado por orden)
- **Trabajo agent**: ~45 min secuencial para T15-T21
- **Trabajo PO**: 1 commit (T22) + 1 PR create + 1 squash merge
- **Total LOC delta esperado**: ~150 (mayormente ADR-050 + verify.sh extensions)
- **Verdict objetivo post-fix**: APPROVED en T23 re-review → SHIP en T24

---

## Mini-round 3 (T22.5) — aplicado 2026-05-21 post REVIEW v2

PO eligió Opción A (mini-round 3). Tasks ejecutadas:

### T22.5a: Link ADR-050 en CLAUDE.md + marcar [x] en ADR-050:102 [DONE 2026-05-21]
### T22.5b: SC-22 regex enumerado → abierto en verify.sh [DONE 2026-05-21]
### T22.5c: apps/api/README.md:40 imperativo → infinitivo (homogeneizar con 6 otros) [DONE 2026-05-21]
### T22.5d: CLAUDE.md "un skill definido" → "una skill definida" [DONE 2026-05-21]
### T22.5e: Stub `.specs/_followups/castellanizar-adr-headers.md` (S1 follow-up) [DONE 2026-05-21]
### T22.5f: Stub `.specs/_followups/github-branch-protection-squash.md` (S2 follow-up) [DONE 2026-05-21]
### T22.5g: Re-ejecutar verify.sh + verificar 31 PASS / 0 FAIL / 4 EXTERNAL [DONE 2026-05-21]
### T22.5h: Commit incremental fixes mini-round-3 (PO ejecuta) — PENDIENTE [DONE 2026-05-21]
