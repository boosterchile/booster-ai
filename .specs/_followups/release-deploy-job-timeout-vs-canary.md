# Follow-up — `release.yml` deploy-production: timeout (30m) < canary (30m) → run "cancelled" engañoso

**Origen**: deploy de App Check (PR #401) 2026-06-04 — el GHA run figuró `cancelled` pero el deploy fue exitoso.
**Tipo**: CI/CD reliability / observabilidad. **Riesgo**: medio (no rompe el deploy, pero el estado MIENTE → riesgo de re-lanzar innecesariamente o creer que falló). **Estado**: ✅ **RESUELTO** — `release.yml:87` ya tiene `timeout-minutes: 75` (fix 2026-06-12, opción #1 con margen: gate ~10 + build ~15 + canary 30 + verify/promoción ~10 + smoke). El run ya refleja el estado real y el smoke final corre.

## Problema (causa raíz confirmada)

- `.github/workflows/release.yml:70` — el job `deploy-production` tiene **`timeout-minutes: 30`**.
- `cloudbuild.production.yaml:155` — el step de deploy hace **canary 1% → espera 30 min → 100%**.
- El step `Trigger Cloud Build (production)` (`release.yml:84`) corre `gcloud builds submit` que **streamea el build de forma síncrona** (~build 5-10 min + canary 30 min + promote).

⇒ El job **siempre** supera su `timeout-minutes: 30` (el canary solo ya son 30 min). GitHub mata el step al llegar al timeout → el run queda **`cancelled`**, PERO el Cloud Build sigue server-side y termina **SUCCESS**, aplicando el deploy igual.

## Evidencia (2026-06-04)

- Run `#26903303075` (App Check): step "Trigger Cloud Build" = `cancelled`, smoke test `skipped`, run = `cancelled`.
- Cloud Build regional `4e48d918` (commit `9b4a44c8`, App Check) = **SUCCESS**.
- `booster-ai-web` → revisión `00312-x79`, 100% tráfico, **App Check verificado en el bundle live**.
- Mismo patrón en el run del 2026-05-29 (`a0db6e65` SUCCESS, run cancelled).

## Impacto

- El estado del run es **engañoso**: dice `cancelled`/falla cuando el deploy fue exitoso. Riesgo: re-lanzar el deploy sin necesidad, o creer que no se desplegó. Además el step `Smoke test — API health` (post-build) queda `skipped` → se pierde esa verificación.

## Fixes (NO ejecutados — elegir)

1. **Mínimo (recomendado)**: subir `timeout-minutes` del job `deploy-production` a **~50-60 min** (build ~10 + canary 30 + promote + margen). Cambio de 1 línea; el run reflejaría el estado real (success/fail) y el smoke test correría.
2. **Async + poll**: `gcloud builds submit --async` + step que pollea el build por ID hasta completar (desacopla el stream del timeout). Más robusto ante reinicios del runner, más código.
3. **Desacoplar el canary**: mover la observación de 30 min fuera del Cloud Build síncrono (ej. job/step separado o verificación posterior). Refactor mayor.

## Segunda reproducción 2026-06-05 (SEC-001 boundary-closure, PR #402+#403)

Patrón **reproducido idéntico** y ahora con duración medida que sustenta el fix #1:

- Run `#27027572287` (`#437`, commit `db0c00b`): job `Deploy to production` corrió **17:02:32 → 17:32:47 = ~30m15s** → cortado por `timeout-minutes: 30`. Step `Trigger Cloud Build` = `cancelled`, `Smoke test` = `skipped`, run = `cancelled`.
- Cloud Build regional `d61e54bc` (commit `db0c00b`) = **SUCCESS**, corrió 17:03:34 → **17:41:57 = ~38 min** (build + canary 30m + promote). El build **sobrevivió** al cancel del job de GHA y aplicó el deploy.
- `booster-ai-api` → revisión `00367-jor` (tag `canary-signup-db0c00b29ddc`), **100% tráfico**. Verificación post-deploy sana (0 errores, 0 5xx).

⇒ **Dato duro para el fix #1**: el job tarda ~38 min reales; `timeout-minutes: 30` es insuficiente por ~8 min. Subir a **~50 min** deja margen. Esto ya ocurrió 3 veces (2026-05-29, 2026-06-04, 2026-06-05) → el estado `cancelled` engañoso es sistemático, no anecdótico.

## Relación

- Liga con el **finding #1 del inventario** (`canary-verify` placeholder `exit 0`) y con [`docs/adr/056-cicd-github-actions-supersedes-gitlab.md`](../../docs/adr/056-cicd-github-actions-supersedes-gitlab.md) (CI/CD vigente).
- No bloquea: el deploy de App Check quedó live igual. Es deuda de reliability/observabilidad del pipeline.
