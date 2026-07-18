# ship — Migración a pnpm 10

## Estado

- Rama: `feat/migrate-pnpm-10` (worktree aislado `.claude/worktrees/migrate-pnpm-10`, base `origin/main` @ b10519c).
- PR: **abierto, NO mergeado.** El merge lo aprueba y ejecuta el PO (frontera: quality gate de CI, CLAUDE.md). Al aprobar, el PO pasa ADR-075 a Accepted.

## Cambios (todos inseparables — mismo PR)

| Archivo | Cambio |
|---|---|
| `package.json` | `packageManager` → `pnpm@10.34.4`; `engines.pnpm` → `>=10.0.0`; **campo `pnpm` eliminado** (overrides + onlyBuiltDependencies) |
| `.github/workflows/{ci,e2e-pr,release}.yml` | `PNPM_VERSION` → `10.34.4` |
| `.github/workflows/{security,e2e-staging}.yml` | `pnpm/action-setup` `version` → `10.34.4` (7+1 ocurrencias) |
| `pnpm-lock.yaml` | regenerado con pnpm 10 (resultó **idéntico** — la resolución no cambió) |
| `docs/adr/075-migracion-pnpm-10.md` | nuevo (Proposed) |

`pnpm-workspace.yaml` **no cambia** (ya era la fuente correcta; ahora es la única).

## Coordinación

- No colisiona con #598 (telemetría) ni con `feat/lint-rls-services-jobs` (#609): esta rama solo toca config raíz + workflows + ADR, ningún archivo de `apps/`/`packages/` fuente.
- Rebase trivial si otra rama toca `package.json`/workflows antes del merge.

## Post-merge — nota para devs locales

Con el campo `pnpm` removido, **solo pnpm 10 lee los overrides**. Quien tenga Corepack toma `pnpm@10.34.4` automáticamente vía `packageManager`. Quien use un pnpm 9 de Homebrew debe actualizar (`corepack use pnpm@10` o `brew upgrade pnpm`) — si no, un `pnpm install` local con pnpm 9 dropea overrides (mismo riesgo que motiva ADR-075). `engines.pnpm >=10.0.0` lo avisa (advisory; no hay `.npmrc` con engine-strict).
