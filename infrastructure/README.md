# Booster AI — Infrastructure as Code

Toda la infraestructura GCP de Booster AI declarada en Terraform. Cumple los principios de [`CLAUDE.md`](../CLAUDE.md): cero deuda técnica, auditabilidad total, IAM humana en IaC (ADR-010 Booster 2.0), WIF sin SA keys descargadas (lección SEC-2026-04-01).

## Identidad operativa

- **Owner humano único**: `dev@boosterchile.com`
- **Billing Account**: manual — ver `terraform.tfvars.example`
- **Proyecto GCP**: `booster-ai-494222` (el nombre base `booster-ai` ya estaba tomado globalmente; GCP sugirió el sufijo)
- **Región principal**: `southamerica-west1` (Santiago)

## Archivos

| Archivo | Contenido |
|---------|-----------|
| `versions.tf` | Providers Google, Google-beta, Random |
| `backend.tf` | State remoto en GCS `booster-ai-tfstate-494222` |
| `variables.tf` | Todas las variables con defaults sensatos |
| `outputs.tf` | Valores a configurar en GitHub Actions + DNS nameservers |
| `project.tf` | Proyecto GCP + billing + 32 APIs habilitadas + budget alerts |
| `iam.tf` | Humanos (Owner) + SAs (runtime, deployer) + Workload Identity Federation |
| `security.tf` | KMS keyring + 26 secrets shell en `local.secret_names` (valores se llenan con gcloud) |
| `data.tf` | VPC + Cloud SQL + Memorystore + Firestore + 5 BigQuery datasets |
| `messaging.tf` | 7 Pub/Sub topics + DLQ |
| `storage.tf` | Artifact Registry + 3 buckets (documents CMEK + Retention Lock 6 años, uploads-raw, public-assets) |
| `compute.tf` | 8 Cloud Run services (via módulo) + GKE Autopilot para TCP gateway + IP estática |
| `networking.tf` | Cloud DNS + domain mappings + SSL certs managed |
| `monitoring.tf` | Notification channels + uptime checks + alert policies |
| `modules/cloud-run-service/` | Módulo reusable para Cloud Run con startup/liveness probes, secrets, VPC connector |

## Bootstrap (una sola vez, manual)

Antes del primer `terraform apply` necesitas:

### 1. Autenticarse

```bash
gcloud auth login dev@boosterchile.com
gcloud auth application-default login
```

### 2. Crear proyecto + vincular billing

```bash
# Billing account de: gcloud billing accounts list
gcloud projects create booster-ai-494222 --name="Booster AI"
gcloud beta billing projects link booster-ai-494222 --billing-account=XXXXXX-XXXXXX-XXXXXX
gcloud config set project booster-ai-494222
```

### 3. Habilitar APIs bootstrap mínimas

Terraform habilita 26+ APIs automáticamente, pero estas 5 deben estar activas ANTES para que Terraform pueda siquiera leer el estado del proyecto. Es un catch-22 inherente al modelo de GCP:

```bash
gcloud services enable \
  cloudresourcemanager.googleapis.com \
  serviceusage.googleapis.com \
  iam.googleapis.com \
  cloudbilling.googleapis.com \
  billingbudgets.googleapis.com \
  --project=booster-ai-494222

# Esperar ~60s para propagación
sleep 60
```

### 4. Setear quota project en ADC

Sin esto, las APIs de Billing Budgets y otras fallarán porque no saben contra qué project cobrar la quota:

```bash
gcloud auth application-default set-quota-project booster-ai-494222
```

### 5. Crear bucket del state de Terraform

```bash
gsutil mb -p booster-ai-494222 -l southamerica-west1 -c STANDARD gs://booster-ai-tfstate-494222
gsutil versioning set on gs://booster-ai-tfstate-494222
gsutil lifecycle set - gs://booster-ai-tfstate-494222 <<EOF
{
  "lifecycle": {
    "rule": [
      {
        "action": {"type": "Delete"},
        "condition": {"numNewerVersions": 50, "isLive": false}
      }
    ]
  }
}
EOF
```

## Primer apply

```bash
cd infrastructure/

# 1. Configurar variables locales
cp terraform.tfvars.example terraform.tfvars
# Editar terraform.tfvars con tu billing_account real

# 2. Init (descarga providers + conecta al state remoto)
terraform init

# 3. Plan (revisar qué se va a crear)
terraform plan -out=tfplan

# 4. Apply (crea todo). Primera vez: 15-25 minutos.
terraform apply tfplan
```

## Post-apply — configurar GitHub Actions

Los outputs de Terraform alimentan las variables de GitHub:

```bash
# Obtener outputs clave
terraform output wif_provider
terraform output wif_service_account_deploy

# Configurar en GitHub UI → Settings → Secrets and variables → Actions → Variables:
#   WIF_PROVIDER                 = <valor de wif_provider>
#   WIF_SERVICE_ACCOUNT_DEPLOY   = <valor de wif_service_account_deploy>
#   STAGING_URL                  = https://staging.boosterchile.com
#   PRODUCTION_URL               = https://app.boosterchile.com
```

## Post-apply — llenar secretos en Secret Manager

> ⚠️ **Disciplina de apply + secrets validados por formato**: ver
> [`docs/runbooks/terraform-apply.md`](../docs/runbooks/terraform-apply.md).
> Un secret validado por `.regex` en `config.ts` (`content-sid-*` → `^HX`,
> `twilio-account-sid` → `^AC`) **no debe montarse con su placeholder `ROTATE_ME_*`**:
> falla el arranque del service ("Refusing to start", INC-2026-06-19). Cargá el valor
> real ANTES de montarlo; el flag `var.content_sid_ready` (A7) lo mantiene sin montar
> hasta entonces, y el preflight `check-validated-secret-placeholders` (gate en
> `terraform-drift.yml`) ataja el caso.

Terraform crea los shells de `local.secret_names` en `security.tf` (26 nombres). Los valores reales se agregan con gcloud, nunca en código. `database-url` y `redis-auth` no reciben placeholder `ROTATE_ME_*`: su versión real la gestiona `data.tf` (password de Cloud SQL y `auth_string` de Memorystore). El resto nace con `ROTATE_ME_<NOMBRE>_PLACEHOLDER`; `ignore_changes` evita que un apply posterior pise el valor ya rotado.

```bash
# Ejemplo — valor real, nunca el placeholder ROTATE_ME_*:
echo -n "<valor>" | gcloud secrets versions add <nombre> --data-file=-
# Si imprime "ROTATE_ME_...", el valor real aún no está cargado:
gcloud secrets versions access latest --secret=<nombre>
```

Inventario exacto de `local.secret_names` (nombres y propósito; sin valores):

### Firebase y datos

- `firebase-admin-key` — JSON del service account Firebase Admin, si hace falta fuera de Cloud Run.
- `database-url` — versión real en `data.tf`. Sin placeholder.
- `redis-auth` — `auth_string` de Memorystore; versión real `redis_auth` en `data.tf`. Sin placeholder.

### Proveedores de IA y mapas

- `anthropic-api-key` — secreto reservado en `security.tf`. No hay package `ai-provider` en el repo y el código de producto no lo lee.
- `backend-legacy-maps-key` — Geocoding + Elevation (ADR-009 del 2.0), en [APIs Credentials](https://console.cloud.google.com/apis/credentials).
- `frontend-maps-key` — Maps JavaScript API con restricción por HTTP referrer.

### WhatsApp Business — Meta Cloud API (DEPRECATED, Fase 6.4)

Conservados como fallback si se cancela Twilio. **No se montan** en ningún Cloud Run service (tampoco en notification-service: esos mounts salieron en la migración a Twilio). Ver amendment de ADR-006.

**REVIEW: 2026-10-30.** Si para esa fecha siguen sin uso, sacarlos de este local y de la versión placeholder, y correr `terraform apply` para destruirlos.

- `whatsapp-app-secret`
- `whatsapp-access-token`
- `whatsapp-phone-number-id`
- `whatsapp-business-account-id`
- `whatsapp-webhook-verify-token` — handshake del webhook Meta. Mismo gate de revisión **2026-10-30**.

### Twilio WhatsApp BSP (Fase 6.4)

El número físico está en Twilio. El auth token sirve para Basic auth del envío y para el HMAC del webhook. `twilio-account-sid` se valida con `^AC`: el placeholder `ROTATE_ME_*` montado tumba el arranque.

- `twilio-account-sid`
- `twilio-auth-token`

### Content SIDs de Twilio (gate `var.content_sid_ready`)

Templates WhatsApp aprobados por Meta, formato `HX` + hex. Cada uno se carga con `gcloud secrets versions add` (procedimiento en [`docs/runbooks/load-content-sids.md`](../docs/runbooks/load-content-sids.md)).

El mount en `service_api` lo gatea `var.content_sid_ready` (A7, INC-2026-06-19): `true` monta el secret; `false` o ausente lo deja sin montar. Montar el placeholder `ROTATE_ME_*` no degrada a solo-push: `config.ts` exige `^HX[a-fA-F0-9]+$` y el servicio responde «Refusing to start». Solo el valor ausente (no montado) o vacío degrada.

- `content-sid-offer-new` — notificación de oferta al transportista (B.8).
- `content-sid-chat-unread` — fallback WhatsApp de mensajes no leídos (P3.d).
- `content-sid-tracking` — template `tracking_link_v1` (link público de tracking al asignar un viaje).
- `content-sid-safety-alert` — template `safety_alert` (crash / unplug / jamming). Gate explícito: `var.content_sid_ready["content-sid-safety-alert"]`. No montar hasta tener el `HX` real.
- `content-sid-activacion-conductor` — WhatsApp de activación del conductor (`activacion_conductor_v2`, Utility, sin PIN). Mismo candado: el placeholder no se monta; el flag `content_sid_ready` autoriza el mount solo con el `HX` aprobado. Detalle en el runbook de content SIDs.

### Pagos, JWT y observabilidad

- `flow-api-key` — [Flow.cl](https://www.flow.cl/docs/api.html) (ADR-010).
- `flow-secret-key` — Flow.cl.
- `jwt-signing-key` — firma backend-to-backend, complementaria a Firebase. Generar en local con `openssl rand -base64 64`.
- `sentry-dsn` — opcional.
- `datadog-api-key` — Agent de Datadog en GKE (ADR-071: infra + logs, sin APM). **No se monta** en Cloud Run. El Secret de Kubernetes `datadog-secret` se materializa en el bootstrap del cluster: `setup-datadog.sh` lee `gcloud secrets versions access latest --secret=datadog-api-key`. GSM es la fuente; el owner rota el placeholder con `echo -n "<dd-api-key>" | gcloud secrets versions add datadog-api-key --data-file=-`.

### Web Push VAPID (P3.c)

Par generado post-deploy con `npx web-push generate-vapid-keys` y subido con `gcloud secrets versions add`. La pública va al api (envío) y al web (suscripción del browser). La privada va solo al api.

- `webpush-vapid-public-key`
- `webpush-vapid-private-key`

### Onboarding admin-provisioned (W1.5)

- `onboarding-token-signing-secret` — HMAC del token one-shot (`ONBOARDING_TOKEN_SIGNING_SECRET`, `apps/api/src/services/onboarding-token.ts`). El placeholder `ROTATE_ME_*` mide ≥ 32 bytes (pasa el min-length) y cae en la denylist del prefijo `ROTATE_ME_`. El preflight `check-validated-secret-placeholders` no cubre este secret (solo formatos con regex). Antes del flip, verificar a mano que `gcloud secrets versions access latest --secret=onboarding-token-signing-secret` no imprime `ROTATE_ME_...`. Runbook: [`docs/corfo/hito-2/runbook-activacion-onboarding.md`](../docs/corfo/hito-2/runbook-activacion-onboarding.md).

### Fuera de `local.secret_names` (no recrear)

- `gemini-api-key` — eliminada (ADR-037). Gemini va por Vertex AI con ADC del SA `cloud_run_runtime`.
- Secretos del proveedor DTE (Bsale u otros) — retirados (ADR-069). El endpoint se removió; ya no están en el local.
- `google-workspace-admin-credentials` — reemplazado por IAM Credentials `signJwt` (org policy `iam.disableServiceAccountKeyCreation`). El SA `observability-workspace-reader` vive en `iam.tf`.
- `google-routes-api-key` — eliminada (ADR-038). Routes API usa ADC y el header `X-Goog-User-Project`.

## Post-apply — configurar DNS del dominio

Terraform crea la zone Cloud DNS. Los nameservers que Terraform genera deben configurarse en el registrador de `boosterchile.com`:

```bash
terraform output dns_zone_name_servers
```

Ir al dashboard del registrador y configurar esos 4 nameservers como los autoritativos. Propagación: 1-48 horas.

## Retention Lock (Cloud Storage SII 6 años)

Terraform crea el bucket con `retention_period = 6 años` pero `is_locked = false` para permitir modificaciones durante setup inicial. **Después de validar que todo funciona, lockear manualmente**:

```bash
gsutil retention lock gs://booster-ai-494222-documents-prod
# CUIDADO: esto es IRREVERSIBLE. Una vez lockeado, el retention no puede acortarse.
```

Hacer esto cuando el producto tenga usuarios reales y el formato de archivos esté estable.

## Costo estimado mensual

Con el sizing default (`db-custom-2-7680` + `STANDARD_HA` Redis + 8 Cloud Run min-instances según config):

| Servicio | Costo aprox USD/mes |
|----------|---------------------|
| Cloud SQL (HA regional) | $170 |
| Memorystore Redis STANDARD_HA 1GB | $45 |
| GKE Autopilot (1 pod telemetry gateway activo) | $30-50 |
| Cloud Run (8 services, min-instances variable) | $50-150 según tráfico |
| Cloud Storage + CMEK | $10-30 |
| BigQuery (bajo volumen inicial) | $5-20 |
| Pub/Sub | $5-15 |
| Cloud DNS + NLB + egress | $10-20 |
| Cloud Monitoring + Logging | $5-20 |
| **Total inicial** | **~$330-520/mes** |

Budget alert configurado en $500/mes (ajustable en `terraform.tfvars`). Escala con tráfico real.

## Destruir (solo dev/staging, **nunca prod**)

```bash
# Primero, remover prevent_destroy en recursos críticos si es necesario
terraform destroy
```

El proyecto GCP mismo tiene `prevent_destroy = true` en Terraform. Para destruirlo hay que editar `project.tf` manualmente y re-applicar — protección intencional.

## Disaster recovery

Documentado en `docs/runbooks/dr-plan.md` (pendiente — crear después del primer deploy). Cobertura:
- Cloud SQL point-in-time recovery (7 días de transaction logs)
- Firestore PITR activo
- Cloud Storage versioning + retention lock
- Backups de Terraform state (bucket versionado)

## Referencias

- [ADR-001 Stack](../docs/adr/001-stack-selection.md)
- [ADR-005 Telemetría](../docs/adr/005-telemetry-iot.md) — por qué GKE para TCP gateway
- [ADR-007 Documentos Chile](../docs/adr/007-chile-document-management.md) — retention lock
- [ADR-010 Modelo identidad Booster 2.0](../../Booster-2.0/.agent/knowledge/ADR-010-identity-model.md) — IAM via IaC
- [SEC-2026-04-01](../../Booster-2.0/.agent/knowledge/SECURITY_INCIDENT_2026-04.md) — por qué WIF sin SA keys
- Workload Identity Federation docs: https://cloud.google.com/iam/docs/workload-identity-federation
