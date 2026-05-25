# T7.5 evidence — Secret init + CI gate operativo

**Fecha**: 2026-05-25 00:18-00:25 UTC (sesión 2026-05-24 PDT)
**Operador**: Claude Opus 4.7 (headless via ADC token de `dev@boosterchile.com`)
**Spec**: `.specs/sec-001-cierre/plan.md` T7 + T7.5 + T8 (cadena H1.4 cerrada)

---

## 1. Pre-condiciones

- T7 (#324 `396edf0`), T7.5 (#325 `f3b21e6`), T8 (#326 `d2d6efb`) mergeados a `main`.
- `terraform apply` de T7+T7.5 **deferred** post-merge — gate CI de T7.5 fallaba con `PERMISSION_DENIED secretmanager.versions.list` en cada PR que tocaba `seed-demo*.ts` (chicken-and-egg: viewer grant introducido por el mismo PR no aplicado todavía).
- `demo-seed-password` tenía 1 version con payload exacto `REPLACE_ME_BEFORE_DEPLOY` (placeholder de T0b apply 2026-05-14).
- ADC user (`dev@boosterchile.com`) tiene `secretmanager.admin` sobre el secret per `security-hotfixes-2026-05-14.tf:138`.

## 2. Acciones ejecutadas

### 2.1 Terraform apply (T7+T7.5)

```bash
TOKEN_FILE=/tmp/gcloud-adc-token
gcloud auth application-default print-access-token > "$TOKEN_FILE"
cd infrastructure
GOOGLE_OAUTH_ACCESS_TOKEN="$(cat $TOKEN_FILE)" terraform plan \
  -var-file=terraform.tfvars.local -out=/tmp/t8-plan.tfplan
# Plan: 1 to add, 11 to change, 0 to destroy.
GOOGLE_OAUTH_ACCESS_TOKEN="$(cat $TOKEN_FILE)" terraform apply /tmp/t8-plan.tfplan
```

**Resources tocados (12 total)**:

| # | Recurso | Acción | Origen |
|---|---|---|---|
| 1 | `google_secret_manager_secret_iam_member.demo_seed_password_github_deployer_viewer` | **add** | T7.5.1 — viewer grant SA `github-deployer` |
| 2 | `google_monitoring_dashboard.telemetry_overview` | modify (cosmético JSON) | drift pre-existente |
| 3 | `google_secret_manager_secret.hotfix_2026_05_14["demo-seed-password"]` | modify (annotation update) | T8 — purpose annotation refactor |
| 4 | `module.service_api.google_cloud_run_v2_service.service` | modify (env var add) | T7 — DEMO_SEED_PASSWORD mount |
| 5-12 | 8× `module.service_*.terraform_data.wait_for_secret_versions` | modify (deps cascade) | T7 — `all_secret_versions_ready` extendido |

**Verificación post-apply**: `terraform plan` retorna `Plan: 0 to add, 1 to change, 0 to destroy` (solo el dashboard cosmético).

### 2.2 Init demo-seed-password (replace placeholder)

Ejecutado vía REST API por gcloud reauth interactivo en headless mode. Equivalente a `bash infrastructure/scripts/init-demo-seed-password.sh`:

```bash
TOKEN=$(cat /tmp/gcloud-adc-token)
# Idempotency check: latest = REPLACE_ME_BEFORE_DEPLOY → proceed
NEW_PW=$(openssl rand -base64 32)
NEW_PW_B64=$(printf '%s' "$NEW_PW" | base64)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "{\"payload\":{\"data\":\"$NEW_PW_B64\"}}" \
  "https://secretmanager.googleapis.com/v1/projects/booster-ai-494222/secrets/demo-seed-password:addVersion"
```

**Resultado**:
- Version 2 creada (`state: ENABLED`, `createTime: 2026-05-25T00:18:38.878814Z`).
- Version 1 (placeholder) sigue ENABLED para safe rollback (lifecycle `ignore_changes`).

### 2.3 Restart Cloud Run api revision

Equivalente a `gcloud run services update booster-ai-api` — forzar nueva revision para que mountee la nueva latest version del secret:

```bash
TIMESTAMP=$(date -u +%s)
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  --data "{\"template\":{\"annotations\":{\"booster-ai/secret-rotation-trigger\":\"$TIMESTAMP\"}}}" \
  "https://run.googleapis.com/v2/projects/booster-ai-494222/locations/southamerica-west1/services/booster-ai-api?updateMask=template.annotations"
```

**Resultado**:
- Pre-update latest ready revision: `booster-ai-api-00298-vm6`.
- Post-update latest ready revision: `booster-ai-api-00299-znv` (CONDITION_SUCCEEDED en `Ready`, `Active`, `ContainerHealthy`, `MinInstancesProvisioned`).
- Env var mount verificado en la nueva revision:

```
DEMO_MODE_ACTIVATED = false
DEMO_SEED_PASSWORD = {secretKeyRef: {secret: demo-seed-password, version: latest}}
```

**Riesgo de crash**: cero. Con `DEMO_MODE_ACTIVATED=false`, `ensureDemoSeeded` retorna early y `getDemoPassword` nunca se invoca. El env var queda mountado pero inactivo hasta el cutover Sprint 3 H1.6.

### 2.4 Re-run CI workflow Security en PR #326

```bash
RUN_ID=$(gh run list --workflow=security.yml --branch=feat/sec-001-t8-seed-demo-env-lookup --limit=1 --json databaseId --jq '.[0].databaseId')
# Run ya estaba en progreso (auto-triggered); polling hasta completar.
```

**Resultado**: gate `Demo seed password — version exists` ✅ **SUCCESS**. PR #326 mergeStateStatus: CLEAN, 15/15 checks SUCCESS, MERGEABLE.

## 3. Drift residual post-resolución

Único drift remanente: `google_monitoring_dashboard.telemetry_overview` (JSON cosmético formatter; pre-existente al SEC-001 cierre). No relacionado con la cadena H1.4.

## 4. SC traceability cerrada

- ✅ **SC-1.4.2** (T7): secret existe + IAM SA api + Felipe admin + env var mount Cloud Run.
- ✅ **SC-1.4.4** (T8 + T7.5 apply): version count >= 1 verificado por gate WIF + literal eliminado del repo.
- ✅ **P0-5** (round 1): T8 NO puede mergear con secret vacío — gate `check-secret-version-exists` operativo.
- ✅ **P0-C** (round 2): viewer grant via WIF, no SA keys, fail-closed loudly.
