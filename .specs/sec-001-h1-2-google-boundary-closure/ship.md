# Ship: sec-001-h1-2-google-boundary-closure (Stream A)

- Spec: [`spec.md`](./spec.md) (Status: Reviewed)
- Review: [`review.md`](./review.md) (Verdict: **Approved for /ship (dry-run)**)
- Date: 2026-06-05
- Version: apps/api `0.0.0` (private, no publicado — deploy vía Cloud Build, no npm)
- Modelo de release: **merge a `main` → `release.yml` → aprobación humana en GitHub Environment `production` → Cloud Build canary**. No hay tag manual.

## R-SHIP (resuelto — decisión PO: merge main→rama + 1 PR delineado)

La rama era multi-sesión (25 commits previos de docs/housekeeping + el feature). Resolución:
- `git merge main` → **sin conflictos** (App Check #401 tocó `apps/web`/substitutions; el decomiso removió la lane blocking-fn; regiones distintas en cloudbuild). Merge commit `4ce5dbb`.
- Verificado post-merge: cloudbuild tiene App Check (`VITE_RECAPTCHA_SITE_KEY`) **y** sin lane auth-blocking; harness OK (40 mounts); `terraform validate` Success; `git diff main HEAD -- apps/web` = **0** (web idéntico a main).
- **1 PR** cuyo body separa "Feature: boundary-closure (código)" de "Bundled: docs/inventory/housekeeping" (ADR-055/056, inventario, follow-ups, specs Draft de otras features — todo docs/config, ningún feature de código no relacionado).

## Checklist (12 puntos)

- [ ] **1. CI verde en el merge commit** — ⏳ **PENDIENTE de confirmar con el run de Actions sobre el head del PR** (devils-advocate SHIP: no marcar ✓ con evidencia local). Evidencia local: suite del feature (`@booster-ai/api`) **1407 passed | 2 skipped** (skips ajenos); `tsc` + Biome + `terraform validate` limpios. **Web**: 67 fallos LOCALES por App Check (`indexedDB is not defined` en jsdom), **preexistentes** — `git diff main HEAD -- apps/web` = **0** (web idéntico a main; #401 ya en main). Probabilidad de regresión web ≈ nula, pero **el gate del merge es el run verde de CI sobre el PR, no la corrida local** → el PO confirma el run antes de mergear.
- [x] **2. Changelog** — N/A: monorepo con Changesets; `apps/api` privado `0.0.0` (no publicado). Cambio interno de seguridad/infra, documentado en ADR-057 + este ship.md + body del PR. CI no exige changeset.
- [x] **3. Version bump** — N/A (paquete privado no versionado; deploy por imagen Cloud Build, no SemVer de consumidor).
- [x] **4. Migration guides** — N/A: sin breaking de API pública. ADR-057 documenta el cambio de dirección (supersede ADR-054).
- [x] **5. Feature flags** — `REAPER_DESTRUCTIVE` (config server-side, **default false = dry-run**). El reaper ship-ea con el modo destructivo OFF. Además (devils-advocate SHIP-1) el **Cloud Scheduler arranca `paused = true`**: el PO corre el 1er tick MANUAL y observado (`gcloud scheduler jobs run`) antes de despausar — ni siquiera el dry-run corre solo sin supervisión.
- [x] **6. Rollback plan** — documentado abajo (revert del PR + disable del scheduler; cuentas disabled restaurables; decomiso reversible vía revert + tag de archivo).
- [x] **7. Migraciones reversibles** — N/A: **sin migraciones DB** (el feature no toca schema). Cambios de infra (scheduler/metric add, blocking-fn remove) reversibles vía `terraform apply` del revert; fuente blocking-fn archivada en tag `archive/auth-blocking-functions-2026-06-04`. `disable-before-delete` del reaper es reversible (`disabled:false`).
- [x] **8. Telemetría** — `reaper.run.summary` + `reaper.account.*` (structured logs, email hasheado) + log-based metric `sec001/reaper_account_reaped` (filtra `destructive=true`) + alert policy volumen >20/h (`monitoring.tf`). El harness CI es la telemetría del boundary (falla el build).
- [x] **9. Config/secrets** — Sin secretos nuevos. `REAPER_DESTRUCTIVE` no necesita setearse (default OFF). El scheduler reusa el SA `internal-cron-invoker`; el runtime SA del api ya tiene `firebaseauth.admin`. ⚠️ **Requiere `terraform apply` per-entorno** (scheduler + metric + decomiso) — gate operacional PO.
- [x] **10. Documentación** — ADR-057 (Accepted) + ADR-054 anotado superseded + runbook anotado decomisado + `docs/archive/auth-blocking-functions.md` + `t10-decommission-analysis.md` + CURRENT.md actualizado + SC-1.2.2 → MET.
- [x] **11. Comunicación** — release notes vía body del PR (delineado). Cambio interno de seguridad; sin comunicación externa.
- [x] **12. Rollback rehearsed** — [waiver: el reaper ship-ea en **dry-run** + **scheduler pausado** (no muta ni corre solo); el ensayo de rollback del modo destructivo es parte del **gate de 1er run destructivo** (dry-run revisado + sign-off PO), donde sí se ensaya con datos. El rollback del ship dry-run es trivial: revert del PR (código) + el scheduler ya está paused, sin datos mutados. El rollback de infra (state) está detallado abajo con su pre-condición de `terraform plan`.]

## Rollback procedure

> **Dos planos distintos (devils-advocate SHIP-2)**: `release.yml` (push a main) redeploya la **imagen del api** (código), **NO** corre `terraform apply`. La infra (scheduler, metric, decomiso) se aplica/revierte **a mano** con `terraform apply` per-entorno. `gh pr revert` revierte el *código* del .tf en el repo, pero el estado real de GCP solo cambia con un apply.

> **PRE-condición de este apply (no del gate destructivo)**: correr `terraform plan` en dev/staging/prod ANTES de aplicar y confirmar que solo hay el `create` del scheduler+metric y el `destroy`/`update` esperado del decomiso (ver `t10-decommission-analysis.md` §1-2: state-rm vs destroy + IAM-reuse). Si el plan muestra un `destroy` de `google_cloudfunctions_function.before_create` con estado tainted/huérfano → decidir `state rm` vs dejar destruir **antes** de aplicar.

```bash
# --- Feature (dry-run) post-merge ---
# 1. El scheduler arranca paused → no corre solo. Si ya se despausó y molesta:
gcloud scheduler jobs pause reap-inert-idp-accounts --location=southamerica-east1 --project=booster-ai-494222
#    (OJO: pause manual crea drift vs el state si paused=true en .tf ya estaba; re-alinear en el próximo apply.)

# 2. Revert del CÓDIGO del api (handler/predicado/runner): release.yml redeploya la imagen.
gh pr revert <PR#>   # o git revert -m 1 4ce5dbb && push

# 3. Revert de la INFRA (scheduler/metric/decomiso) — NO lo hace release.yml:
#    revert de los .tf + `terraform apply` per-entorno. Si hay que restaurar la blocking-fn:
git checkout archive/auth-blocking-functions-2026-06-04 -- apps/auth-blocking-functions
#    + terraform apply (re-crea la función shell + wire). Verificar state coherente post-apply.

# --- Si YA se habilitó REAPER_DESTRUCTIVE=true y borró de más ---
# 4. Las cuentas DISABLED (paso 1 del disable-before-delete) son restaurables:
#    auth.updateUser(uid, { disabled: false }) — ver runbook.
# 5. Las DELETED son irreversibles → por eso el gate (dry-run + sign-off + cap maxDeletesPerRun=50
#    + alerta volumen + review 24h) precede la activación destructiva.
```

## Post-deploy verification plan (primeras 24-48h tras merge + terraform apply)

- **Harness CI**: el check `route-default-deny` corre en cada PR (security.yml) — verde.
- **Scheduler dry-run**: tras el 1er tick (04:00 Santiago), confirmar en Cloud Logging el event `reaper.run.summary` con `destructive:false` y los conteos (scanned/disable/skip). NO debe haber `reaper.account.delete` con `destructive:true` (modo destructivo OFF).
- **Métrica/alerta**: `sec001/reaper_account_reaped` debe quedar en 0 (filtra destructive=true; en dry-run no cuenta). La alerta NO debe dispararse.
- **SC-1.2.2 MET**: el boundary niega acceso a un token Google no-provisionado (audit T1 cero GAP); sin regresión en `/me`, `/empresas` (GATED-CLOSED).
- **Sin impacto** en el flujo signup-request vivo ni en el login Google (el botón sigue funcionando; las cuentas nuevas quedan inertes, no bloqueadas).

## Gate de 1er run destructivo (antes de `REAPER_DESTRUCTIVE=true`)

Checklist de residuales del REVIEW (`review.md` §REVIEW) + spec §11:
1. dry-run revisado (varios ticks) + **sign-off PO**.
2. F2 (stale-claim): evaluar generation-counter o aceptar formalmente.
3. F-uid (logs): confirmar retención de logs aceptable (Ley 19.628).
4. I-auth: binding `run.invoker` restrictivo sobre `/admin/jobs` + test integración "no-token → 401".
5. Calibrar `maxDeletesPerRun` (default 50) contra el volumen observado en dry-run.
6. T4: run de clasificación contra prod + decisión PO por cada INERT.
7. `terraform plan` per-entorno limpio (dev/staging/prod).
8. **F3 (devils-advocate SHIP)**: el gate es de **proceso, no de mecanismo** — nada técnico impide setear `REAPER_DESTRUCTIVE=true` salteándose estos puntos (mitigado materialmente por cap 50 + doble grace + alerta de volumen + scheduler paused). Recomendación a evaluar: ligar la activación a un 2º control auditable (env de sign-off, o revisión humana del `terraform plan` que muestre el flip). Registrar la decisión en ADR-057.

## Follow-up no relacionado detectado en el merge

- **App Check (#401) web tests fallan en local** por `indexedDB is not defined` (App Check init en jsdom). Pasan en CI (#401 mergeó verde). No es de esta feature, pero conviene un follow-up para que la suite web corra en local sin App Check real (mock/gate del init en test env).
