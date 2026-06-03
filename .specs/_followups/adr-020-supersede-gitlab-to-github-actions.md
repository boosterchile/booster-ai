# Follow-up — Superseder ADR-020 (GitLab ficticio → GitHub Actions real)

**Origen**: inventario ADR-vs-prod 2026-06-03 (`.specs/adr-vs-prod-inventory/inventory.md`, finding 🔴 ADR-020).
**Tipo**: deuda documental / contrato. **Riesgo**: medio (no externo, no explotable). **Estado**: ✅ **RESUELTO 2026-06-03** — escrito [`docs/adr/056-cicd-github-actions-supersedes-gitlab.md`](../../docs/adr/056-cicd-github-actions-supersedes-gitlab.md) que supersede ADR-020. **Pendiente menor**: anotar ADR-020 con marcador `Superseded by ADR-056` (requiere OK del PO — editar `docs/adr/*.md` está restringido).

## Problema

ADR-020 ("Estrategia CI/CD: GitLab.com shared runners", Status=Accepted) afirma **textualmente**:
- *"El repositorio Booster AI se migró desde GitHub a GitLab (`boosterchile-group/booster-ai`) en mayo de 2026."*
- *"Supersedes: La configuración de GitHub Actions en `.github/workflows/*.yml` quedó inerte tras la migración del repo a GitLab."*
- Pipeline mínimo en `.gitlab-ci.yml` (4 stages) sobre runners GitLab SaaS.

**Realidad verificada (2026-06-03):**
- `git remote -v` → `origin = https://github.com/boosterchile/booster-ai.git` (GitHub).
- **No existe** `.gitlab-ci.yml` en el repo.
- El CI corre 100% en **GitHub Actions** (`.github/workflows/`: ci.yml, release.yml, security.yml, e2e-staging.yml, sprint-2c-*.yml — activos y editados 2026-06-02/03; verificados toda la sesión, incl. PR #401).
- El gate de deploy real es el GitHub Environment `production` (`required_reviewers`), no una config GitLab.

La migración a GitLab **nunca ocurrió o se revirtió** sin ADR que lo documente. ADR-020 describe una plataforma de CI/CD inexistente.

## Por qué importa

Un dev nuevo (o el propio PO en otra máquina) que lea ADR-020 seguiría instrucciones de un CI que no existe (configurar `.gitlab-ci.yml`, runners GitLab, `only_allow_merge_if_pipeline_succeeds`). Onboarding/operación rotos. Es el drift narrativa-vs-realidad más grande del inventario.

## Acción propuesta (NO ejecutada)

Escribir un ADR nuevo (siguiente número libre, ≥056) que **supersede ADR-020**:
- Documente que el repo está en GitHub con CI en GitHub Actions (revertir la narrativa GitLab).
- Liste los workflows reales y el gate `production`.
- Marque ADR-020 como `Superseded by ADR-0XX`.

No editar ADR-020 in-place (los ADR son inmutables; se supersede). No toca infra ni código — es doc.
