# T0.5 — Enable GitHub branch protection on `main`

- **Sprint**: 2a
- **Task**: T0.5
- **Ejecutado**: 2026-05-25 12:35 UTC
- **Operador**: PO (`dev@boosterchile.com`) via Claude Code agent con gh CLI scope `repo`
- **Spec trace**: ENABLER para T0 enforcement; cierre P0-R3-2 devils-advocate round 3.
- **Plan trace**: `.specs/sec-001-cierre/plan-sprint-2a.md` §T0.5.

## Comando ejecutado

```bash
gh api repos/boosterchile/booster-ai/branches/main/protection \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["CI Success"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Nota 1 (forma): la sintaxis `-f required_status_checks[contexts][]="..."` planeada originalmente en plan v3 fue reemplazada por JSON via stdin porque GitHub API requiere nested objects + arrays que `gh api -f` no maneja robustamente. Resultado equivalente, semántica idéntica.

Nota 2 (context name — discovery durante build): plan v3 + initial PR #333 commit usaron `"contexts": ["ci-success"]` asumiendo el job key del workflow. GitHub Checks API registra el check con el `name:` field del job (display name), que para nuestro `ci-success` job es **`CI Success`** (con espacio + capital S). Pre-merge de PR #333 fue corregido vía segundo `gh api PUT` con `contexts=["CI Success"]`. Discrepancia trackeada en ledger 2026-05-25T13:04:11Z como `correction` event. Plan-sprint-2a.md + este evidence file actualizados a `"CI Success"` correcto en T7a PR (2026-05-25).

## Verificación post-apply

```bash
gh api repos/boosterchile/booster-ai/branches/main/protection
```

Output (filtered):

```
required_status_checks.strict:     True
required_status_checks.contexts:   ['CI Success']
enforce_admins.enabled:            True
required_approving_review_count:   0
allow_force_pushes.enabled:        False
allow_deletions.enabled:           False
```

## Implicaciones operacionales

- **Direct push a `main` ahora BLOQUEADO** — todo merge requiere PR.
- **PR mergeable cuando**: `ci-success` job en CI workflow retorna success Y branch up-to-date con main (strict mode).
- **`required_approving_review_count: 0`**: PO puede self-merge sin segundo human approval (solo-dev acomodación).
- **`enforce_admins: true`**: PO no puede saltarse el status check (incluso siendo admin). El CI gate aplica a TODOS.
- **`allow_force_pushes: false` + `allow_deletions: false`**: protección contra accidental history rewrite.

## Future maintenance

- Cuando un segundo developer se sume al proyecto, considerar subir `required_approving_review_count` a 1.
- Eventual migración a Terraform IaC tracked en `.specs/_followups/main-branch-protection-terraform-iac.md` (requiere `integrations/github` provider + PAT secret en Secret Manager).

## Effective immediately

Próximo commit (incluyendo este evidence file + T0.5 [DONE] mark en plan-sprint-2a.md) ya NO puede pushear direct a main. Workflow PR-based desde acá hasta cierre Sprint 2a.
