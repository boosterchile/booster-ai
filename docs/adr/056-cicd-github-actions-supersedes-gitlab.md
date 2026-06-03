# ADR-056 — CI/CD en GitHub Actions (supersede ADR-020 GitLab)

**Status**: Accepted
**Date**: 2026-06-03
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (agente de desarrollo)
**Supersedes**: [ADR-020 — Estrategia CI/CD: GitLab.com shared runners](./020-ci-cd-strategy.md)
**Related**: [ADR-001 Stack](./001-stack-selection.md) · inventario ADR-vs-prod ([`.specs/adr-vs-prod-inventory/inventory.md`](../../.specs/adr-vs-prod-inventory/inventory.md), finding 🔴 ADR-020) · follow-up [`.specs/_followups/adr-020-supersede-gitlab-to-github-actions.md`](../../.specs/_followups/adr-020-supersede-gitlab-to-github-actions.md)

---

## Contexto

**ADR-020 (2026-05-05) documentó una migración del repo de GitHub a GitLab** (`boosterchile-group/booster-ai`) con CI en GitLab.com shared runners + `.gitlab-ci.yml`, y declaró "inertes" los workflows de GitHub Actions.

Esa migración **fue revertida o abandonada sin que ningún ADR lo documentara**. El inventario ADR-vs-prod (2026-06-03) verificó empíricamente el estado real, que se mantiene a esta fecha:

- `git remote get-url origin` → **`https://github.com/boosterchile/booster-ai.git`** (GitHub, no GitLab).
- **No existe `.gitlab-ci.yml`** en el árbol del repo.
- El CI/CD corre **100% en GitHub Actions** (`.github/workflows/*.yml`, activos y editados en 2026-06; verificados en vivo, incl. PR #401 de esta semana).
- El gate de merge/deploy real es **GitHub branch protection + el GitHub Environment `production`** (`required_reviewers`), no la policy GitLab `only_allow_merge_if_pipeline_succeeds`.

ADR-020 quedó como **decisión cerrada que describe una plataforma inexistente** — riesgo medio (no externo, no explotable): un colaborador que lo lea seguiría instrucciones de un CI que no existe. El propio ADR-020 §"Criterio de migración" anticipó que un cambio de plataforma se documenta con "un nuevo ADR que supersede este". Este ADR lo hace.

> No se edita ADR-020 in-place (CLAUDE.md: los ADR son decisiones cerradas; se supersede, no se editan). Anotar ADR-020 con un marcador `Superseded by ADR-056` en su encabezado requiere aprobación explícita del PO (los `docs/adr/*.md` están en la lista "NUNCA toco sin permiso").

## Decisión

**La plataforma de CI/CD de Booster AI es GitHub Actions**, sobre GitHub-hosted runners (`ubuntu-latest`). Node `24`, pnpm `9.15.4` (env `NODE_VERSION`/`PNPM_VERSION` en `ci.yml`).

### Workflows reales (`.github/workflows/`)

| Workflow | Trigger | Contenido |
|---|---|---|
| `ci.yml` | PR + push a `main` (concurrency cancel-in-progress) | jobs `setup` → `lint` (Biome), `typecheck` (tsc), `test` (Test + Coverage ≥80%), `integration-tests` (Postgres + Redis), `build` (turbo) |
| `security.yml` | PR + push | gitleaks (secret scan), npm audit (HIGH+), CodeQL (javascript-typescript), Trivy (filesystem + config), SBOM (Generate SBOM), guards demo-seed / is-demo |
| `release.yml` | push a `main` | Changesets (`version-or-publish`) → job `deploy-production` con `environment: production` (**gate de aprobación humana `required_reviewers`**) → WIF (`workload_identity_provider`) → `gcloud builds submit --config=cloudbuild.production.yaml` (canary 1%→30min→100%) |
| `e2e-staging.yml` | nightly + PR (paths `apps/web`/`apps/api`) | Playwright + axe-core (a11y) en el container oficial `mcr.microsoft.com/playwright` (fix del cuelgue webkit, 2026-06-03). Corre contra `BASE_URL`; los tests se **skipean sin `E2E_USER_*`**. No bloquea merge. |
| `sprint-2c-build-gate.yml`, `sprint-2c-handler-completeness.yml`, `sprint-2c-b-deploy-gate.yml` | PR/push | gates específicos del Sprint 2c (ADR-052/054) |

### Gates

- **Merge a `main`**: GitHub branch protection con required status checks (los jobs bloqueantes de `ci.yml` + security). Reemplaza el `only_allow_merge_if_pipeline_succeeds` de GitLab.
- **Deploy a prod**: aprobación humana en el GitHub Environment `production` (`required_reviewers`, enforced desde 2026-05-29) → Cloud Build canary. El step `canary-verify` es placeholder (`exit 0`): la promoción se observa/decide humanamente (ver inventario finding #1).

## Qué de ADR-020 queda obsoleto vs. qué sigue válido

**Obsoleto (GitLab-específico, sin efecto):** GitLab.com shared runners, `.gitlab-ci.yml`, validación de cuenta GitLab, `only_allow_merge_if_pipeline_succeeds`, los criterios de migración a `gitlab-runner` self-hosted (1-5), las métricas de "minutos GitLab / cuota 400 min".

**Sigue válido (conceptual):** el principio de "mínima deuda operacional para el volumen actual, evolucionar con datos no especulación"; la nota de que el E2E requiere `E2E_USER_*` para no skipear (sigue cierto — los tests skipean sin esas vars); que un eventual cambio a runners self-hosted se decide con un ADR nuevo (en GitHub Actions el equivalente sería self-hosted runners, hoy innecesario — `ubuntu-latest` alcanza).

## Consecuencias

### Positivas
- La documentación de CI/CD refleja la realidad; se elimina el drift que confundía onboarding/operación.
- Queda explícito el gate real (branch protection + Environment `production`), alineado con CLAUDE.md §Deploy.

### Negativas / deuda
- ADR-020 sigue en el repo sin marcador de superseded hasta que el PO autorice anotarlo (mitigado: este ADR lo supersede explícitamente y el inventario lo registra).
- El `canary-verify` placeholder (`exit 0`) sigue siendo deuda conocida (inventario finding #1) — fuera de scope de este ADR.

## Referencias
- [ADR-020](./020-ci-cd-strategy.md) (superseded)
- [ADR-001 Stack](./001-stack-selection.md)
- `.github/workflows/{ci,security,release,e2e-staging}.yml`
- `cloudbuild.production.yaml`
