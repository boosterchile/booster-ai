# Ship: integrate-booster-skills-plugin

- **Spec**: `.specs/integrate-booster-skills-plugin/spec.md` v4 (APPROVED_BY_PO_2026-05-20)
- **Plan**: `.specs/integrate-booster-skills-plugin/plan.md` v3 + T22.5 addendum
- **Review**: `.specs/integrate-booster-skills-plugin/review.md` v2 (Verdict: **APPROVED** post mini-round 3)
- **Date**: 2026-05-21
- **Version**: N/A (PR-2 es chore meta-work — no toca producto)
- **Branch**: `chore/integrate-booster-skills-plugin`
- **Commits**: 7 ahead of main (`d463cd2`, `e869d30`, `dcc1f52`, `7df06b3`, `fda0c3d`, `7f4e30d`, `f105825`)
- **Squash merge**: **MANDATORIO** (per spec v4 §6.2, T20)

---

## 12-point checklist (adaptado a chore meta-work)

| # | Checkpoint | Estado | Notas |
|---|---|---|---|
| 1 | CI green on merge commit | ⏳ pending push | Validar `gh run list --branch main --limit 1` post-merge |
| 2 | Changelog updated | ⊘ N/A | Booster AI no tiene CHANGELOG.md a nivel de repo (verificado empíricamente). PR-2 no introduce features de producto. |
| 3 | Version bumped | ⊘ N/A | Sin package version del repo Booster cambiando. Plugin booster-skills sigue en v0.1.0 (futuro PR-1.5 → v0.2.0 con Chile compliance). |
| 4 | Migration guides referenced | ✓ | ADR-050 path-remapping table sirve como migration guide para referencias en ADRs históricos. CLAUDE.md §Capas adicionales locales documenta el override pattern. |
| 5 | Feature flags configured | ⊘ N/A | No hay code path nuevo a flag-gear; cleanup de docs/dirs. |
| 6 | Rollback plan documented | ✓ | Ver §Rollback procedure abajo |
| 7 | Migrations reversible | ⊘ N/A | Sin DB migrations en PR-2 |
| 8 | Telemetry in place | ⊘ N/A | Sin nuevos endpoints/operaciones. Cleanup observability ya existe (.claude/ledger preserved) |
| 9 | Config/secrets in place | ⊘ N/A | Sin nuevas env vars / secrets |
| 10 | Documentation updated | ✓ | CLAUDE.md v3 (326→335 líneas), ADR-049 (Estado Accepted), ADR-002 (Superseded by ADR-049), ADR-050 (nuevo), docs/plugins/REPORTE (replicabilidad), 13 archivos con orphan refs actualizados |
| 11 | Communication ready | ✓ | PR description con `## Evidencia` literal (output `/plugin list`, diff CLAUDE.md, git status, tree antes/después). No-public proyecto, no requiere blog post. |
| 12 | Rollback rehearsed | ⊘ N/A | Chore meta-work no toca auth/money/data integrity. Rollback es `git revert` simple |

**Resumen**: 4 ✓ aplicables + 8 ⊘ N/A + 1 ⏳ pending CI = checklist satisfecho para naturaleza del PR.

---

## Rollback procedure

Si tras merge a `main` se detecta problema material (improbable dado verify.sh PASS):

### Caso 1: rollback total

```bash
# Si el squash commit en main es <sha>, revertirlo:
git revert <sha>
git push origin main

# Reinstalar copias locales si plugin falla:
# Las copias originales están en commits f105825..dcc1f52 (pre-T13a-T13e)
# git checkout <commit-pre-PR-2> -- .claude/commands/ .claude/agents/ skills/ hooks/

# Plugin instalado mantiene los originales como backup natural (bit-perfect identical, verificado en T2)
cp ~/.claude/plugins/cache/booster-skills/booster-skills/0.1.0/agents/*.md .claude/agents/
```

### Caso 2: rollback parcial (e.g., CLAUDE.md merge causó confusión)

```bash
# Restaurar solo CLAUDE.md
git checkout c1122b6 -- CLAUDE.md  # último commit pre-PR-2 main
git commit -m "revert(claude): restaurar CLAUDE.md v2 pre-PR-2"

# Plugin sigue activo; cleanup .claude/ se preserva
```

### Caso 3: reinstalar plugin si se desinstala

```bash
/plugin marketplace add boosterchile/booster-skills
/plugin install booster-skills@booster-skills
/reload-plugins
/plugin list  # confirmar ambos activos
```

---

## Post-deploy verification plan

Como PR-2 es chore meta-work (no toca código de producción), "post-deploy" significa "post-merge a main + sesión fresca de Claude Code":

| Métrica | Valor esperado | Cómo observar |
|---|---|---|
| `/plugin list` en sesión fresca | `agent-rigor@agent-rigor` + `booster-skills@booster-skills` ambos enabled | comando dentro de Claude Code post-merge |
| `find skills .claude/commands .claude/agents hooks` | retorna vacío o errors "No such file" | terminal en checkout main |
| `agents/` raíz | 3 archivos (code-reviewer, security-auditor, sre-oncall) | `ls agents/*.md` |
| CI workflows pasan | ci.yml + security.yml + release.yml verde | GitHub Actions tab |
| Sesión nueva Claude Code lee CLAUDE.md sin errores | agent inicia sin fallos por refs rotas | abrir nueva sesión, pedir `/agent-rigor:spec test-feature` |

Ventana de observación: **2 horas post-merge** (no se requiere 24h porque no hay tráfico de usuarios afectado).

---

## Pre-pasada devils-advocate sobre /ship (auto-aplicada)

1. **¿Squash merge MANDATORIO está enforceado?**
   - Spec §6.2 lo declara. Stub `.specs/_followups/github-branch-protection-squash.md` traquea la configuración de branch protection rule post-merge.
   - **Riesgo residual**: si PO ejecuta `gh pr merge --merge` por accidente, typos cosméticos quedan permanentes. Mitigación: `gh pr merge --squash` documentado explícitamente en §Comando exacto.

2. **¿El PR descripción tiene la sección `## Evidencia` requerida por spec §6.2?**
   - Sí, ver §PR body abajo. Incluye output literal `/plugin list`, diff stats, git log, tree before/after.

3. **¿CI verde post-push está garantizado?**
   - Probable: 0 archivos TS modificados, lint+typecheck no toca docs. `pnpm test` corre tests existentes (sin nuevos).
   - **Riesgo**: pre-commit hooks ya pasaron localmente; CI usa los mismos hooks. Empíricamente safe.

4. **¿Hay alguna deuda no documentada llegando a main?**
   - Typos commits T13a/T13d: absorbidos por squash merge → main limpio
   - 28 ADRs en inglés (S1): tracked en stub follow-up
   - Squash enforcement (S2): tracked en stub follow-up
   - **No hay deuda silenciosa**. Todo está auditado.

---

## Comando exacto para PO ejecutar (T24)

```bash
cd /Volumes/Pendrive128GB/Booster-AI/.claude/worktrees/flamboyant-jones-42a39b

# 1. Push del branch al remote
git push -u origin chore/integrate-booster-skills-plugin

# 2. Crear PR con body que incluye sección Evidencia (heredoc)
gh pr create \
  --title "chore(claude): integrate booster-skills plugin and cleanup local components" \
  --body "$(cat <<'EOF'
## Summary

Adopt the 3-layer Claude Code plugin system per ADR-049, removing local copies of skills, agents, slash-commands, and hooks now provided by the plugins `agent-rigor@0.2.0` and `booster-skills@0.1.0`.

- Spec: `.specs/integrate-booster-skills-plugin/spec.md` v4 (APPROVED_BY_PO_2026-05-20)
- Plan: `.specs/integrate-booster-skills-plugin/plan.md` v3 + T22.5
- Review: `.specs/integrate-booster-skills-plugin/review.md` v2 (Verdict: APPROVED)

## Changes

**Deleted** (now provided by plugins):
- \`.claude/commands/{build,plan,review,ship,spec,test}.md\` → \`/agent-rigor:*\`
- \`.claude/agents/{6 generic auditor agents}\` → \`booster-skills:*\` namespaced
- \`skills/{6 directories}\` → migrated to booster-skills plugin (PR-1)
- \`hooks/session-start.md\` → replaced by agent-rigor SessionStart hook

**Preserved** as Booster local overrides:
- \`agents/code-reviewer.md\` — extends \`agent-rigor:code-reviewer\` with ADR Booster discipline
- \`agents/security-auditor.md\` — extends \`agent-rigor:security-auditor\` with Ley 19.628, SII/DTE, modelo Uber-like
- \`agents/sre-oncall.md\` — único override (sin equivalente en plugins): SLOs + observabilidad GCP

**Added**:
- \`docs/adr/049-claude-code-plugin-system-adoption.md\` — decisión arquitectónica + §Replicabilidad
- \`docs/adr/050-skills-and-commands-path-remapping-post-plugin-adoption.md\` — tabla mapping path-antiguo → namespacing-nuevo para ADRs históricos
- \`docs/plugins/REPORTE-migracion-booster-skills-v0.1.0.md\` — ejemplo trabajado replicabilidad
- \`.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md\` — stub Chile compliance migration
- \`.specs/_followups/castellanizar-adr-headers.md\` — stub idioma headers 28 ADRs
- \`.specs/_followups/github-branch-protection-squash.md\` — stub squash enforcement

**Modified**:
- \`CLAUDE.md\` (235 → 335 líneas) — §Integración con plugins, §Reglas no-negociables, §Estructura repo v3, §Capas adicionales locales (G6 documentation)
- \`docs/adr/002-skill-framework-adoption.md\` — Status: Superseded by ADR-049 + Supersedence Note
- \`README.md\`, \`AGENTS.md\` — refs \`skills/\` → plugins
- 7 × \`apps/*/README.md\` — refs \`skills/adding-cloud-run-service/SKILL.md\` → \`booster-skills:adding-cloud-run-service\`
- 3 × \`apps/*/src/main.ts\` — JSDoc comments updated
- \`docs/ci-cd.md\` — refs actualizadas (\`skills/writing-tests\` → \`agent-rigor:31-test-driven-development\`, \`skills/incident-response\` → \`booster-skills:incident-response\`)
- \`packages/shared-schemas/src/domain/cargo-request.ts\` — JSDoc ref actualizada
- \`.gitignore\` — sin redundancia \`.claude/staging/\`
- ADR-049 + ADR-002 headers castellanizados (Estado/Fecha en lugar de Status/Date)

## Evidencia

### \`/plugin list\` output literal (post-PR-1)

\`\`\`
Installed plugins:

  ❯ agent-rigor@agent-rigor
    Version: 0.2.0
    Scope: user
    Status: ✔ enabled

  ❯ booster-skills@booster-skills
    Version: 0.1.0
    Scope: project
    Status: ✔ enabled
\`\`\`

### Verify.sh result: **31 PASS / 0 FAIL / 4 EXTERNAL**

\`\`\`
Group A: paths deleted (SC-1..SC-5)        — 5/5 PASS
Group B: agents/ root preserved (SC-6)      — 1/1 PASS
Group C: settings preserved (SC-7)          — 1/1 PASS
Group D: CLAUDE.md content (SC-8, SC-9)     — 3/3 PASS
Group E: ADRs (SC-10, SC-11)                — 3/3 PASS
Group F: branch (SC-12)                     — 1/1 PASS
Group G: CI + code quality (SC-13, SC-14)   — 1 PASS / 1 EXTERNAL
Group H: PR (SC-15)                         — 1 EXTERNAL
Group I: .specs/ artifacts (SC-16)          — 2 PASS / 2 EXTERNAL
Group J: G6 agents/ documented (SC-17)      — 4/4 PASS
Group K: G4 Replicabilidad (SC-18)          — 3/3 PASS
Group L: G7 .gitignore (SC-19)              — 1/1 PASS
Group M: G5 followup stub (SC-20)           — 1/1 PASS
Group N: T15-T20 fixes (SC-21..SC-23)       — 5/5 PASS

Resumen: 31 PASS / 0 FAIL / 4 EXTERNAL
VERDICT: PASS
\`\`\`

Exit code: 0. Ver \`.specs/integrate-booster-skills-plugin/verify.md\` para detalle completo.

### git status final (post-merge esperado)

Working tree clean post-merge. Branch \`chore/integrate-booster-skills-plugin\` mergeable a main vía **squash**.

### Tree antes/después (high-level)

**Antes** (pre-PR-2 main):
- \`.claude/commands/\` (6 archivos)
- \`.claude/agents/\` (6 archivos, gitignored)
- \`skills/\` (6 dirs)
- \`hooks/session-start.md\`
- \`agents/\` (3 archivos: code-reviewer, security-auditor, sre-oncall — preserved)
- \`CLAUDE.md\` v2 (235 líneas)

**Después** (post-PR-2 main):
- \`.claude/{ledger,settings.json,settings.local.json,worktrees,staging}\` (sin commands/agents/skills locales)
- \`agents/\` (3 archivos preserved + documentados en CLAUDE.md como overrides locales)
- \`docs/adr/049-...md\` (nuevo)
- \`docs/adr/050-...md\` (nuevo)
- \`docs/plugins/REPORTE...md\` (nuevo)
- \`.specs/integrate-booster-skills-plugin/\` (audit trail completo: spec v1-v4, plan v2-v3, verify, review, ship)
- \`.specs/_followups/\` (3 stubs: agents-v0.2.0, castellanizar-adrs, branch-protection-squash)
- \`CLAUDE.md\` v3 (335 líneas con §Integración con plugins + §Reglas no-negociables + §Capas adicionales locales + §Estructura repo v3)

### Diff stats

7 commits ahead of main (squash merge collapsará a 1 commit en main):
- f105825 docs(claude): consolidar CLAUDE.md con integracion plugins y reglas stack
- 7f4e30d docs(adr): ADR-049 adopcion plugins Claude Code; ADR-002 superseded
- fda0c3d chore(git): excluir .claude/staging/ de versionadoç [typo absorbido]
- 7df06b3 docs(specs): spec v4 + plan + verify + review + ship + followups stub
- dcc1f52 chore(claude): borrar .claude/commands/, skills/, hooks/
- e869d30 fix(claude): orphan refs + ADR-050 path-remapping + idioma headers ADRs
- d463cd2 fix(claude): review v2 findings B1-B3-C1 + S1-S2 follow-up stubs

## Test plan

- [ ] CI workflows pasan (ci.yml + security.yml + release.yml verde)
- [ ] Post-merge: sesión nueva Claude Code carga ambos plugins
- [ ] Post-merge: \`find skills .claude/commands .claude/agents hooks\` retorna vacío
- [ ] Post-merge: \`/plugin list\` confirma plugins activos
- [ ] Post-merge (2h watch): no fallos por refs rotas en logs
- [ ] T25 post-merge: actualizar \`docs/handoff/CURRENT.md\` con cierre del refactor

## Squash merge MANDATORIO

Per spec v4 §6.2: \`gh pr merge --squash\` (NO \`--merge\` ni \`--rebase\`). Justificación: absorbe typos cosméticos en commits intermedios y presenta historia limpia en main.

Suggested squash commit message:

\`\`\`
chore(claude): integrate booster-skills plugin and cleanup local components

Adopt 3-layer Claude Code plugin system (agent-rigor + booster-skills)
per ADR-049, removing local copies now provided by plugins.

See .specs/integrate-booster-skills-plugin/spec.md v4 for full context.

Closes integrate-booster-skills-plugin

🤖 Generated with Claude Code
\`\`\`

## Follow-ups creados

- \`.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md\` — Chile compliance migration al plugin v0.2.0 (OQ-1 promovida desde spec)
- \`.specs/_followups/castellanizar-adr-headers.md\` — 28 ADRs históricos con headers en inglés (S1 del review v2)
- \`.specs/_followups/github-branch-protection-squash.md\` — configurar branch protection rule para enforce squash merge (S2 del review v2)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"

# 3. Esperar CI verde (GitHub Actions)
gh pr view --json statusCheckRollup --jq '.statusCheckRollup'
gh pr checks  # interactivo

# 4. Squash merge MANDATORIO
gh pr merge --squash --auto

# 5. Post-merge: verificar
git checkout main
git pull
git log --oneline -3
# Esperado: 1 nuevo commit "chore(claude): integrate booster-skills plugin and cleanup local components"

# 6. Configurar branch protection para enforce squash (residual S2)
# Ver .specs/_followups/github-branch-protection-squash.md
```

---

## Self-postmortem (24h post-merge — agent prepara, PO completa)

Tres líneas:
1. **Qué funcionó**: <a completar 24h post-merge>
2. **Qué sorprendió**: <a completar>
3. **Qué haría diferente**: <a completar>

Añadido a `ship.md` post-completion.

---

## Status

**Status**: Pendiente push + PR create + squash merge.

**Spec status update post-merge**: cambiar de `APPROVED_BY_PO_2026-05-20 v4` a `Shipped 2026-05-21 (PR-2 merged)`. Se hace en T25 (post-merge update CURRENT.md).
