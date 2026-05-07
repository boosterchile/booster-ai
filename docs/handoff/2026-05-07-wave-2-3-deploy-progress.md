# Handoff — Wave 2/3 deploy progress (2026-05-07)

Estado del deploy de Wave 2/3 al cierre de la sesión 2026-05-07. Para
retomar desde otra máquina (Macbook u otro).

## TL;DR

- **Infra GCP de Wave 2/3 100% desplegada via Terraform**.
- **API Cloud Run sano en rev 67+** con secrets desde Secret Manager.
- **No hay devices Teltonika productivos llegando al gateway todavía** —
  el sistema `booster-ai` nuevo está sin tráfico real (la telemetría
  vive en sistema legacy o aún no se migró). No hay regresión, solo hay
  preparación.
- **2 cleanups tactical pendientes** + **DNS/LB IP mismatch a resolver
  antes de conectar primer device**.

## Cómo retomar desde otra máquina

### 1. Setup local

```bash
git clone git@gitlab.com:boosterchile-group/booster-ai.git
cd booster-ai
git pull origin main

# Pre-requisitos:
brew tap hashicorp/tap
brew install hashicorp/tap/terraform
brew install --cask gcloud-cli  # si no estaba

gcloud auth login dev@boosterchile.com
gcloud auth application-default login   # ADC para Terraform
gcloud config set project booster-ai-494222
gcloud components install cloud-sql-proxy --quiet
```

### 2. Recrear `terraform.tfvars.local`

Es gitignored — no vive en el repo. Recrearlo localmente con:

```bash
cd infrastructure
cat > terraform.tfvars.local <<'EOF'
billing_account = "019461-C73CDE-DCE377"
sms_fallback_webhook_url = ""
EOF
```

(El `billing_account` lo ves con `gcloud beta billing accounts list --filter='OPEN=True'` si lo necesitás verificar.)

### 3. Verificar que terraform plan sale clean

```bash
terraform init
terraform plan -var-file=terraform.tfvars.local -out=/tmp/plan
tail -10 /tmp/plan.log
```

Esperado: `Plan: 0 to add, 1 to change, 0 to destroy.` (el `1 to change`
es probablemente el `__DEPLOY_TIMESTAMP` del API que falta cleanup —
ver §4 abajo).

## Estado de la infra (lo que está aplicado)

### Recursos creados ✅

| Categoría | Recurso |
|---|---|
| KMS | `crash-traces-cmek` (rotación 90d) |
| GCS | `booster-ai-494222-crash-traces-prod` (CMEK + retention 7 años + versioning) |
| BigQuery | tabla `telemetry.crash_events` (partitioned + clustered) |
| Pub/Sub topics | `crash-traces`, `telemetry-events-safety-p0`, `-security-p1`, `-eco-score`, `-trip-transitions` |
| Pub/Sub subs | 5 subscriptions con DLQ + retry policies |
| Secret Manager | `content-sid-offer-new` (v3 = `HXa30e82ea818a72d08bb12a4214610a86`), `content-sid-chat-unread` (v2 = `HX00000000000000000000000000000000` dummy) |
| Cloud Run | `booster-ai-sms-fallback-gateway` (sin webhook configurado todavía) |
| GKE Autopilot | `booster-ai-telemetry-dr` en `us-central1` |
| Network LB DR | IP estática `136.116.208.86` |
| DNS | `telemetry-dr.boosterchile.com` → `136.116.208.86` |
| Logging metrics | 8 metrics con labels (device_records, tcp_resets, parser_errors, crash_events, unplug_events, gnss_jamming_critical, sms_fallback_received, crash_trace_persistence_failures) |
| Alert policies | 6 policies (3 P0 + 1 P1 + 1 P2 + 1 crash_trace_failure) |
| Dashboard | `telemetry_overview` |

### IAM bindings nuevos

- `cloud_run_runtime` SA → `roles/storage.objectAdmin` en `crash-traces` bucket.
- `cloud_run_runtime` SA → `roles/bigquery.dataEditor` en dataset `telemetry`.
- `gcs-encrypter` SA → `roles/cloudkms.cryptoKeyEncrypterDecrypter` en KMS `crash-traces-cmek`.

## Pendientes tactical (low priority)

### 1. Cleanup del `__DEPLOY_TIMESTAMP` del API

Durante el debug del startup probe failure puse una env var `__DEPLOY_TIMESTAMP` para forzar revisión nueva. Ya cumplió su propósito pero queda como drift cosmético. Quitar:

```bash
gcloud run services update booster-ai-api \
  --remove-env-vars=__DEPLOY_TIMESTAMP \
  --region=southamerica-west1 \
  --project=booster-ai-494222
```

### 2. Borrar la rev 65 fallida del API

Esa fue la primera rev del API tras secret refactor que fallaba startup probe (placeholder `ROTATE_ME` en CONTENT_SID_CHAT_UNREAD). Como la rev 67+ ya sirve, podemos limpiar:

```bash
gcloud run revisions delete booster-ai-api-00065-mt7 \
  --region=southamerica-west1 \
  --project=booster-ai-494222 \
  --quiet
```

## DNS / Service IP mismatch — IMPORTANTE antes de conectar primer device

### Estado actual

```
DNS telemetry.boosterchile.com   →  34.176.238.106  (IP estática reservada `booster-telemetry-lb-ip`)
K8s Service External IP           →  34.176.126.66   (IP ephemeral del LB)
```

Los dos no matchean. Si un device se conecta a `telemetry.boosterchile.com:5027` resuelve a `34.176.238.106` que **NO** está asignada al gateway K8s.

### Fix: asignar IP estática al Service

```bash
gcloud container clusters get-credentials booster-ai-telemetry \
  --region=southamerica-west1 --project=booster-ai-494222

kubectl patch service telemetry-tcp-gateway -n telemetry \
  --type=merge \
  -p '{"spec": {"loadBalancerIP": "34.176.238.106"}}'

# Verificar 30-60s después:
kubectl get svc -n telemetry telemetry-tcp-gateway
# EXTERNAL-IP debería ser 34.176.238.106 (puede tardar hasta 5min en estabilizar)
```

### Persistir el cambio en el repo

Agregar `loadBalancerIP` al manifest K8s para que no se pierda en
re-applies. Editar `infrastructure/k8s/telemetry-tcp-gateway.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: telemetry-tcp-gateway
spec:
  type: LoadBalancer
  loadBalancerIP: "34.176.238.106"   # ← agregar esta línea
  externalTrafficPolicy: Local
  ...
```

Idem para `telemetry-tcp-gateway-tls.yaml` (si lo creás post-cert-manager,
agregar `loadBalancerIP` con la IP correspondiente del Service TLS).

Y para el DR cluster, `telemetry-tcp-gateway-dr.yaml`:

```yaml
spec:
  loadBalancerIP: "136.116.208.86"
```

Commit + push + MR + merge + redeploy.

## Próximos pasos operacionales (en orden)

Sigue el runbook `docs/runbooks/wave-2-3-deploy.md` — secciones:

1. **§3** K8s primary + DR (cert-manager, gateway deploy con loadBalancerIP fixed).
2. **§4** Twilio webhook + apply final con `sms_fallback_webhook_url`.
3. **Smoke test E2E con UN device de lab** (no productivo todavía):
   - Cargar Wave 1 cfg en device de lab apuntando a `telemetry.boosterchile.com:5027`.
   - Verificar handshake IMEI completado en logs:
     ```bash
     kubectl logs -n telemetry deployment/telemetry-tcp-gateway --tail=20 -f
     ```
   - Verificar AVL packet → Pub/Sub → processor → `telemetria_puntos`:
     ```bash
     gcloud sql connect booster-ai-pg-07d9e939 --user=postgres \
       --project=booster-ai-494222 --database=booster_ai
     SELECT MAX(timestamp_device) FROM telemetria_puntos WHERE imei = '<imei lab>';
     ```
4. Cargar Wave 2 cfg en mismo device de lab (con Network Ping + 14 AVL IDs Low Priority + SMS Number Twilio). Verificar que sigue procesando.
5. **§5** Wave 2 rollout a flota productiva.
6. **§6.1** Load test G2.3 (capacity gate).
7. Cargar SID real al `content-sid-chat-unread` cuando Meta apruebe (`docs/runbooks/load-content-sids.md`).
8. **§3.2** + **§5.2** Wave 3 (TLS + DR backup) tras G2.3 verde y Wave 2 estable >7d.
9. **§6.2** DR failover test G3.4.

## MRs mergeados en esta sesión

| MR | Branch | Descripción |
|---|---|---|
| !34 | `chore/cleanup-tfvars-local-from-tracking` | (no merged — hay agujero, ver !35) |
| !35 | `refactor/content-sid-secrets` | Mover `content_sid_*` de variables Terraform a Secret Manager |
| !36 | `fix/wave-2-3-apply-errors` | (cerrada — leak de tfvars.local accidental, reemplaza !37) |
| !37 | `fix/wave-2-3-apply-errors-v2` | Hotfix 5 errores apply Wave 2/3 + cierra leak gitignore |

(Los MRs !24-!33 son los del Wave 2/3 y deploy runbook, ya mergeados antes.)

## Logs/comandos útiles para cuando retomes

### Ver últimos logs del gateway

```bash
gcloud container clusters get-credentials booster-ai-telemetry \
  --region=southamerica-west1 --project=booster-ai-494222

kubectl logs -n telemetry deployment/telemetry-tcp-gateway \
  --tail=50 --since=10m
```

### Ver últimos records persistidos en BD

```bash
INSTANCE=$(gcloud sql instances list --project=booster-ai-494222 \
  --format='value(name)' | head -1)

gcloud sql connect $INSTANCE --user=postgres \
  --project=booster-ai-494222 --database=booster_ai
```

```sql
SELECT MAX(timestamp_device), COUNT(*) FROM telemetria_puntos
  WHERE timestamp_device > NOW() - INTERVAL '1 day';
```

### Ver alert policies activas

```bash
gcloud monitoring policies list --project=booster-ai-494222 \
  --filter='displayName~"P0|P1|P2"' \
  --format='table(displayName,enabled)'
```

### Verificar Secret Manager content-sid

```bash
gcloud secrets versions access latest --secret=content-sid-offer-new \
  --project=booster-ai-494222
gcloud secrets versions access latest --secret=content-sid-chat-unread \
  --project=booster-ai-494222
```

## Observación importante

**No hay devices Teltonika productivos reportando al sistema `booster-ai`
en los últimos 30 días** (verificado en logs Cloud Logging). Eso significa
que toda la infra Wave 2/3 que desplegamos hoy es preparación para cuando
se conecten los primeros devices vía la migración Wave 2.

Esto cambia las prioridades: no hay urgencia de "rollback" ni "fix
emergencia". El próximo paso es **smoke test con UN device de lab** antes
de tocar nada productivo. Detalle en docs/runbooks/wave-2-3-deploy.md §6.

## Contacto / handoff

- Owner: Felipe Vicencio (`dev@boosterchile.com`)
- Project GCP: `booster-ai-494222`
- Tag branch para retomar: cualquiera desde `main` (post-merge MR !37).
