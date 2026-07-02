# Followup: github-branch-protection-squash

> ✅ **RESUELTO / acceptance ya cumplido (verificado 2026-06-22)**. `gh api repos/boosterchile/booster-ai`
> retorna `allow_squash_merge=true`, `allow_merge_commit=false`, `allow_rebase_merge=false` →
> **squash es el ÚNICO método de merge posible** a nivel repo. El acceptance criteria del
> stub ("la UI de PR solo ofrece 'Squash and merge'; `gh pr merge --merge`/`--rebase` rechaza")
> **ya se cumple** — el outcome operacional está enforced, vía la restricción de merge-methods
> del repo (equivalente, y de hecho más fuerte que una branch-protection rule, para este fin).
> Nada que ejecutar.

**Status**: ✅ RESUELTO (acceptance ya cumplido a nivel repo)
**Created**: 2026-05-21
**Triggered by**: Devils-advocate REVIEW round 2 — S2 finding ("Squash merge MANDATORIO en spec §6.2 es declarativo, NO enforceado a nivel de plataforma. PO podría ejecutar `gh pr merge --merge` por accidente y typos cosméticos quedan permanentes en main")
**Estimated effort**: 5-10 min (configurar branch protection rule en GitHub UI o vía gh CLI)

---

## Objetivo

Configurar branch protection rule en `boosterchile/booster-ai` que REQUIERA squash merge como único método permitido para PRs a `main`. Esto enforza operacionalmente el spec §6.2 ("Squash merge MANDATORIO en `/ship`") en lugar de depender de disciplina humana.

## Trigger (cuándo ejecutar)

- Inmediatamente post-merge de PR-2 (deuda residual S2 de review v2).
- O como parte de un sprint de hardening de repo (Mini-Sprint 0 OTel u otro).

## Inputs requeridos

- Acceso admin a `boosterchile/booster-ai` (Felipe es owner).
- GitHub CLI (`gh`) instalado y autenticado, o acceso a la UI de GitHub.
- Conocimiento de la branch protection rule actual de `main` (puede haber otras reglas activas — verificar antes de cambiar).

## Procedimiento

### Opción A: GitHub UI

1. Navegar a `https://github.com/boosterchile/booster-ai/settings/branches`.
2. Editar la regla existente de `main` (o crearla si no existe).
3. En "Require a pull request before merging":
   - ✓ Allow squash merging
   - ☐ Allow merge commits (desmarcar)
   - ☐ Allow rebase merging (desmarcar)
4. (Opcional) "Require linear history" para forzar squash.
5. Save changes.

### Opción B: gh CLI

```bash
gh api -X PATCH /repos/boosterchile/booster-ai/branches/main/protection \
  -F required_pull_request_reviews.allow_squash_merge=true \
  -F required_pull_request_reviews.allow_merge_commit=false \
  -F required_pull_request_reviews.allow_rebase_merge=false
```

(Verificar API actual de gh — el endpoint puede haber cambiado.)

## Acceptance criteria

- En UI de PR: el botón "Merge pull request" solo ofrece "Squash and merge" (no "Create a merge commit" ni "Rebase and merge").
- Si alguien intenta `gh pr merge --merge` o `--rebase`, GitHub rechaza con error.
- Verificación: crear PR de test (incluso vacío) y comprobar que UI solo muestra squash.

## Riesgo / consideraciones

- **Bloquea PR mergers actuales**: si hay PRs abiertos esperando merge con método distinto, esos PRs ya no pueden hacerse vía esos métodos. Coordinar con PO antes de aplicar.
- **Romper convención de equipo**: si otro miembro del equipo hace PRs con merge commits regularmente, esto los obliga a cambiar. Booster es single-developer actualmente, no aplica.
- **Settings.json local**: si Claude Code tiene config local para `/agent-rigor:ship` que asume otro método, hay que actualizar. Verificar `.claude/settings.json` y skill `64-shipping-and-launch`.

## Prompt para sesión futura (copy/paste)

```
Retomar followup en .specs/_followups/github-branch-protection-squash.md.

Contexto: PR-2 documentó "Squash merge MANDATORIO" en spec §6.2 pero no lo enforzó vía branch protection. Este followup configura la rule en GitHub.

Pasos:
1. Verificar branch protection actual de boosterchile/booster-ai main.
2. Aplicar Opción A (UI) o Opción B (gh CLI) — yo recomiendo UI por claridad visual.
3. Validar con PR de test.

Estimado: 5-10 min.
```

## Notas

- Alta prioridad si en el período post-PR-2 se detecta otro PR con typos en commits (el risk se materializa).
- Si pasa >30 días sin ejecutar, el risk acumulado de typos en main aumenta.
