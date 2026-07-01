# Follow-up: Migrate `main` branch protection to Terraform IaC

- **Created**: 2026-05-25
- **Source**: Sprint 2a T0.5 acceptance (`.specs/sec-001-cierre/plan-sprint-2a.md`).
- **Priority**: P2 (functional protection is en place via manual `gh api`; IaC migration es ritualization para CLAUDE.md "Terraform 100% IaC" compliance).
- **Status**: Open.

## Context

Sprint 2a T0.5 enabled branch protection on `main` via manual `gh api` one-shot (evidence: `.specs/sec-001-cierre/sprint-2a-evidence/t0-5-branch-protection.md`). The protection is fully functional pero NO está bajo Terraform control — viola spirit de CLAUDE.md "Terraform 100% IaC" rule.

GitHub Terraform provider NO está en uso en `infrastructure/versions.tf` (solo `hashicorp/google`). Adding it requires:

1. Add `integrations/github` provider to `infrastructure/versions.tf` y `infrastructure/main.tf`.
2. Create GitHub Personal Access Token (PAT) con `admin:repo` scope.
3. Store PAT en Secret Manager (`github-admin-pat` o similar).
4. Reference via `data.google_secret_manager_secret_version` en Terraform.
5. Write `github_branch_protection` resource matching current state.
6. `terraform import` para reconcile sin recrear.
7. Verify `terraform plan` 0 diff post-import.

## Estimación

- ~80-120 LOC (Terraform + secret + import script).
- ~3-4h wall-clock incluyendo PAT creation + secret seeding + import + verification.
- Plus operational: PAT rotation cadence (anual? semestral?), break-glass procedure si PAT compromised.

## Bloqueantes / decisions a tomar

- PAT scope mínimo: `admin:repo` para branch protection; suficiente o sobre-permissivo?
- PAT owner: dueño humano (PO) vs GitHub App (better, evita personal PAT pero requiere setup más complejo).
- Lifecycle: anual rotation? Cloud Scheduler reminder?

## Trade-off vs current manual state

| Aspecto | Manual `gh api` (actual) | Terraform IaC (este follow-up) |
|---|---|---|
| Functional protection | ✓ idéntica | ✓ idéntica |
| Audit trail | gh audit log + ledger entry | Terraform state + git history |
| Reproducibility en otro repo | Manual command repeat | `terraform apply` |
| Drift detection | Manual `gh api GET` periódico | `terraform plan` automated |
| CLAUDE.md compliance | ✗ deviation justified | ✓ cumple |
| Cost | 0 | PAT lifecycle + secret rotation overhead |

## Recommendation

Defer hasta Sprint 3+ o hasta que entre segundo developer al proyecto (cuando audit trail Terraform IaC empieza a tener valor real para coordinación). Priority P2 — non-blocking para SEC-001 cierre.

## Estado actual verificado (2026-06-22) — insumo para encodear cuando se ejecute

`gh api` (read-only) capturó la config viva de `main`, lista para traducir a
`github_branch_protection` cuando el owner provea el PAT + agregue el provider GitHub:

- **Merge methods (repo)**: `allow_squash_merge=true`, `allow_merge_commit=false`,
  `allow_rebase_merge=false` (squash-only — ver [[github-branch-protection-squash]]).
- **Branch protection `main`**: `enforce_admins=true`; `required_status_checks.contexts=["CI Success"]`;
  `required_pull_request_reviews` con `required_approving_review_count=0`,
  `dismiss_stale_reviews=false`, `require_code_owner_reviews=false`, `require_last_push_approval=false`.

Sigue **owner-gated**: requiere provider `integrations/github` + PAT con scope admin (secreto
del owner) + `terraform import` de la protección existente. El agente no puede aportar el PAT
ni crear el provider; el snapshot de arriba es el insumo para hacerlo seguro sin loosen la protección.
