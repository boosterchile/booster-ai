# Followup: Cloud Run canary traffic tag accumulation cleanup

**Created**: 2026-05-28 (Sprint 2b T13-fix DA v1 P1 residual)
**Owner**: PO (Felipe Vicencio)
**Priority**: P1

> ✅ **RESUELTO (2026-06-22)** vía **Opción A** — el step `deploy-api` de
> `cloudbuild.production.yaml` ahora, tras `update-traffic --to-latest`, remueve los
> tags `canary-signup-*` viejos (preserva el de ESTE deploy). **FAIL-SAFE**: corre
> POST-promoción (ningún canary tag sirve tráfico ya) y si el parseo falla solo loguea
> `WARN` — NUNCA rompe el deploy (peor caso: los tags siguen acumulando como hoy). YAML
> validado (`deploy-api` id/waitFor preservados). El owner lo valida en el 1er canary
> real. Cierra el footgun de quota a ~50 tags.

## Problem

Sprint 2b T13 canary lane creates a per-deploy traffic tag `canary-signup-<sha12>` via `gcloud run services update --tag=...` on `booster-ai-api`. Cloud Run retains the tag on the revision until explicitly removed. With daily deploys, tags accumulate.

Cloud Run hard limits relevant here:
- **1000 revisions** per service (oldest get auto-deleted when above).
- **Tags persist** on revisions whether traffic is routed or not. A revision with a stale tag still counts toward operational ceiling for tag-based traffic-update commands.

Neither `deploy-canary`, `route-canary`, `canary-verify`, nor `deploy-api` step in the current T13 pipeline removes the previous deploy's `canary-signup-<sha12>` tag. After 100+ deploys the service has 100+ stale canary tags, each occupying tag-namespace + revision metadata.

## Why this is P1 not P2

- DA v1 of T13-fix correctly flagged this as P1.
- T13 was DONE 2026-05-26 with no cleanup mechanism; T13-fix (2026-05-28) didn't add one because its scope was the tag-length defect.
- Booster's deploy cadence (multiple PRs/day) puts the quota hit within weeks, not months.
- Detection lag: the first symptom is `route-canary` step failing with "tag already in use" or `update-traffic` quota errors — surfaces during canary procedure, not before. That means the next canary deploy AFTER quota hit will fail at runtime, blocking the very mechanism that's supposed to validate deploys.

## Options

- **A — Remove old canary tag during deploy-api**: in the final `deploy-api` step, before `--to-latest`, call `gcloud run services update-traffic booster-ai-api --remove-tags=$(gcloud run revisions list ... --filter='tags ~ canary-signup-' --format='value(metadata.name)' | tail -n +2)`. Keeps the most recent canary tag for audit, removes older ones. ~15 LOC.
- **B — Add a separate scheduled cleanup job**: Cloud Scheduler → small Cloud Function that runs daily and removes canary tags older than N days. Decouples cleanup from deploy timing. ~50 LOC + Terraform.
- **C — Use a single rotating tag (`canary` instead of `canary-signup-<sha>`)**: the deploy-canary step adds `--tag=canary --remove-tags-other` (if supported) or pre-removes. Eliminates accumulation entirely. Breaks the per-deploy audit trail unless the commit label provides equivalent identification.

Recommendation: **A** as the cheapest unblock, with **C** as an ADR-worthy redesign for the next quarter. **B** is overengineering for this cadence.

## Triggering condition for prioritization

Bump from P1 to P0 when either:
- The first `route-canary` step fails with `tag already in use` on a fresh deploy.
- Cloud Run service `booster-ai-api` has >50 tags on inactive revisions.
- The service is within 100 of its 1000-revision quota.

Monitor via `gcloud run revisions list --service=booster-ai-api --filter='-status.conditions.type=Active' --format='value(metadata.name)' | wc -l` weekly.

## Medición 2026-06-05 (post-deploy SEC-001 boundary-closure)

Observado en el traffic split de `booster-ai-api` (vía `gcloud run services describe`, región southamerica-west1): **10 revisiones con tag `canary-signup-<sha12>`** acumuladas (una por deploy, desde fines de mayo hasta `db0c00b`), todas en 0% salvo la última (`00367-jor`, 100%). Lejos aún del umbral P0 (>50), pero confirma la acumulación lineal: 10 tags a la fecha. Sigue P1; revisar el conteo en la cadencia semanal.
