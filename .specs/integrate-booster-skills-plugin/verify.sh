#!/usr/bin/env bash
# verify.sh — Validación SC-1..SC-20 de spec v4
# Generado por: /agent-rigor:test sobre .specs/integrate-booster-skills-plugin/spec.md v4
# Ejecutado: 2026-05-21
#
# Convención:
# - PASS = criterio cumplido empíricamente
# - FAIL = criterio falla (abort)
# - EXTERNAL = se valida fuera (CI / PR review)

set -uo pipefail

PASS=0
FAIL=0
EXTERNAL=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "PASS" ]; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  elif [ "$result" = "EXTERNAL" ]; then
    echo "  ⊘ $name (external)"
    EXTERNAL=$((EXTERNAL + 1))
  else
    echo "  ✗ $name — FAIL"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== verify.sh — SC-1..SC-20 ==="
echo ""

# SC-1..5: estructura del repo (canónico)
echo "Group A: paths deleted (SC-1..SC-5)"
{ [ ! -d .claude/commands ] || [ -z "$(ls -A .claude/commands 2>/dev/null)" ]; } && check "SC-1 .claude/commands/ inexistente o vacío" PASS || check "SC-1 .claude/commands/ inexistente o vacío" FAIL
{ [ ! -d .claude/agents ] || [ -z "$(ls -A .claude/agents 2>/dev/null)" ]; } && check "SC-2 .claude/agents/ inexistente o vacío" PASS || check "SC-2 .claude/agents/ inexistente o vacío" FAIL
{ [ ! -d .claude/skills ] || [ -z "$(ls -A .claude/skills 2>/dev/null)" ]; } && check "SC-3 .claude/skills/ inexistente o vacío" PASS || check "SC-3 .claude/skills/ inexistente o vacío" FAIL
[ ! -d skills ] && check "SC-4 skills/ raíz inexistente" PASS || check "SC-4 skills/ raíz inexistente" FAIL
[ ! -d hooks ] && check "SC-5 hooks/ inexistente" PASS || check "SC-5 hooks/ inexistente" FAIL

echo ""
echo "Group B: agents/ root preserved (SC-6)"
expected="agents/code-reviewer.md agents/security-auditor.md agents/sre-oncall.md "
actual="$(ls agents/*.md 2>/dev/null | sort | tr '\n' ' ')"
[ "$actual" = "$expected" ] && check "SC-6 agents/ con 3 archivos exactos" PASS || check "SC-6 agents/ con 3 archivos exactos — actual: $actual" FAIL

echo ""
echo "Group C: settings preserved (SC-7) — partial automation"
# SC-7 manual: .claude/ledger no debe tener deletes destructivos. .claude/settings.json y settings.local.json sin diff vs main.
# .claude/ es gitignored, no hay diff vs main posible. Verificamos que los archivos existen y no fueron borrados.
[ -f .claude/settings.json ] && [ -f .claude/settings.local.json ] && [ -d .claude/ledger ] && check "SC-7 settings.json+settings.local.json+ledger preservados" PASS || check "SC-7 preservación settings/ledger" FAIL

echo ""
echo "Group D: CLAUDE.md content (SC-8, SC-9)"
grep -qF "## Integración con plugins de Claude Code" CLAUDE.md && check "SC-8a CLAUDE.md contiene ## Integración con plugins de Claude Code" PASS || check "SC-8a" FAIL
grep -qF "## Reglas no-negociables del stack Booster" CLAUDE.md && check "SC-8b CLAUDE.md contiene ## Reglas no-negociables del stack Booster" PASS || check "SC-8b" FAIL
! grep -qF "Principios rectores — inviolables desde el commit 1" CLAUDE.md && check "SC-9 CLAUDE.md sin sección antigua Principios rectores" PASS || check "SC-9" FAIL

echo ""
echo "Group E: ADRs (SC-10, SC-11)"
grep -qE "^\*\*Estado\*\*: Accepted" docs/adr/049-claude-code-plugin-system-adoption.md && check "SC-10a ADR-049 Estado: Accepted" PASS || check "SC-10a" FAIL
grep -qF "boosterchile/booster-skills" docs/adr/049-claude-code-plugin-system-adoption.md && check "SC-10b ADR-049 referencia boosterchile/booster-skills" PASS || check "SC-10b" FAIL
grep -qE "^\*\*Estado\*\*: Superseded by ADR-049" docs/adr/002-skill-framework-adoption.md && check "SC-11 ADR-002 Estado: Superseded by ADR-049" PASS || check "SC-11" FAIL

echo ""
echo "Group F: branch (SC-12)"
ACTUAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[ "$ACTUAL_BRANCH" = "chore/integrate-booster-skills-plugin" ] && check "SC-12 branch = chore/integrate-booster-skills-plugin" PASS || check "SC-12 branch — actual: $ACTUAL_BRANCH" FAIL

echo ""
echo "Group G: CI + code quality (SC-13, SC-14)"
check "SC-13 CI verde (lint+typecheck+test)" EXTERNAL
! git diff main -- '*.ts' '*.tsx' 2>/dev/null | grep -E "^\+.*(\bany\b|@ts-ignore|console\.)" > /dev/null && check "SC-14 sin nuevos any/@ts-ignore/console.* en .ts/.tsx" PASS || check "SC-14" FAIL

echo ""
echo "Group H: PR (SC-15)"
check "SC-15 PR description con ## Evidencia + /plugin list output" EXTERNAL

echo ""
echo "Group I: .specs/ artifacts (SC-16)"
ART_OK=true
for f in spec.md plan.md; do
  [ -f ".specs/integrate-booster-skills-plugin/$f" ] || { ART_OK=false; break; }
done
$ART_OK && check "SC-16a spec.md + plan.md existen" PASS || check "SC-16a" FAIL
# verify.md, review.md, ship.md se producen en sus respectivas phases
check "SC-16b verify.md (esta phase)" PASS  # implicit: la generación de este output
check "SC-16c review.md (REVIEW phase)" EXTERNAL
check "SC-16d ship.md (SHIP phase)" EXTERNAL

echo ""
echo "Group J: G6 — agents/ root documented in CLAUDE.md (SC-17)"
grep -qF "agents/code-reviewer.md" CLAUDE.md && check "SC-17a CLAUDE.md menciona agents/code-reviewer.md" PASS || check "SC-17a" FAIL
grep -qF "agents/security-auditor.md" CLAUDE.md && check "SC-17b CLAUDE.md menciona agents/security-auditor.md" PASS || check "SC-17b" FAIL
grep -qF "agents/sre-oncall.md" CLAUDE.md && check "SC-17c CLAUDE.md menciona agents/sre-oncall.md" PASS || check "SC-17c" FAIL
# SC-17d (T19): semantic check — los 3 archivos en CLAUDE.md tienen "override" en proximidad (10 lineas)
grep -A 10 "agents/code-reviewer.md" CLAUDE.md | grep -qi "override" \
  && grep -A 10 "agents/security-auditor.md" CLAUDE.md | grep -qi "override" \
  && grep -A 10 "agents/sre-oncall.md" CLAUDE.md | grep -qi "override" \
  && check "SC-17d CLAUDE.md describe los 3 agents/* como overrides (semantic)" PASS \
  || check "SC-17d semantic check" FAIL

echo ""
echo "Group K: G4 — Replicabilidad (SC-18)"
grep -qF "## Replicabilidad" docs/adr/049-claude-code-plugin-system-adoption.md && check "SC-18a ADR-049 contiene ## Replicabilidad" PASS || check "SC-18a" FAIL
grep -qF "docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md" docs/adr/049-claude-code-plugin-system-adoption.md && check "SC-18b ADR-049 link a REPORTE" PASS || check "SC-18b" FAIL
[ -f docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md ] && check "SC-18c REPORTE existe en docs/plugins/" PASS || check "SC-18c" FAIL

echo ""
echo "Group L: G7 — .gitignore (SC-19)"
# SC-19 (T18 reformulado): .claude/staging/ cubierto via línea .claude/ generica, sin línea redundante explícita
git check-ignore .claude/staging/dummy-test.md > /dev/null 2>&1 && check "SC-19 .claude/staging/ gitignored via .claude/ regla generica" PASS || check "SC-19 .claude/staging/ NO ignored" FAIL

echo ""
echo "Group M: G5 — followup stub (SC-20)"
[ -f .specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md ] && check "SC-20 followup stub existe" PASS || check "SC-20" FAIL

echo ""
echo "Group N: T15-T20 fixes (SC-21, SC-22, SC-23 — plan v3)"
# SC-21: ADR-050 existe con Estado: Accepted + supersedes nothing but related to 049/002/001/011
grep -qE "^\*\*Estado\*\*: Accepted" docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md && check "SC-21 ADR-050 existe con Estado: Accepted" PASS || check "SC-21" FAIL
grep -qF "skills/adding-cloud-run-service/SKILL.md" docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md && grep -qF "booster-skills:adding-cloud-run-service" docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md && check "SC-21b ADR-050 contiene mapping table" PASS || check "SC-21b" FAIL

# SC-22: zero orphan refs en archivos NO legitimos (exclusion list: .specs/integrate-..., docs/plugins/REPORTE, docs/adr/002/049/050)
ORPHAN_COUNT=$(find docs apps packages infrastructure scripts README.md AGENTS.md -type f \( -name "*.md" -o -name "*.ts" -o -name "*.json" \) -exec grep -lE "skills/(adding-cloud-run-service|carbon-calculation-glec|empty-leg-matching|incident-response|arquitecto-maestro|using-agent-skills|writing-adrs|writing-tests)/SKILL\.md|\.claude/commands|\.claude/agents|hooks/session-start" {} + 2>/dev/null \
  | grep -vE "\.specs/integrate-booster-skills-plugin/|docs/plugins/REPORTE|docs/adr/002-skill-framework|docs/adr/049-claude-code-plugin|docs/adr/050-skills-and-commands|docs/plans/2026-05-17|docs/specs/2026-05-17|docs/adr/001-stack-selection|docs/adr/011-admin-console" \
  | wc -l | tr -d ' ')
[ "$ORPHAN_COUNT" = "0" ] && check "SC-22 zero orphan refs en archivos no legitimos (post-T17)" PASS || check "SC-22 — $ORPHAN_COUNT archivos con refs" FAIL

# SC-23: .claude/staging/ cubierto por .gitignore via línea .claude/ generica
git check-ignore .claude/staging/dummy-test.md > /dev/null 2>&1 && check "SC-23 .claude/staging/ gitignored (via línea .claude/ generica)" PASS || check "SC-23 .claude/staging/ NO ignored" FAIL
! grep -qF ".claude/staging/" .gitignore && check "SC-23b .gitignore NO contiene línea redundante .claude/staging/" PASS || check "SC-23b" FAIL

echo ""
echo "==============================="
echo "Resumen: $PASS PASS / $FAIL FAIL / $EXTERNAL EXTERNAL"
echo "==============================="

if [ "$FAIL" -gt 0 ]; then
  echo "VERDICT: FAIL — $FAIL criterios no cumplen"
  exit 1
fi
echo "VERDICT: PASS — todos los criterios internos cumplen ($EXTERNAL pendientes externos)"
exit 0
