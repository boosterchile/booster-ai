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
| `security.tf` | KMS keyring + 15 secrets shell (valores se llenan con gcloud) |
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

Terraform crea los shells vacíos. Los valores reales se agregan via gcloud (nunca via código):

```bash
# Ejemplo — para cada secret, agregar su valor real:
echo -n "<valor_real>" | gcloud secrets versions add gemini-api-key --data-file=-
echo -n "<valor_real>" | gcloud secrets versions add whatsapp-access-token --data-file=-
echo -n "<valor_real>" | gcloud secrets versions add dte-provider-api-key --data-file=-
# ... etc para los 15 secrets
```

Lista completa de secrets a poblar:

- `firebase-admin-key` — JSON de service account Firebase (si aplica local)
- `database-url` — autopoblado por Terraform al crear Cloud SQL
- `gemini-api-key` — obtener en [AI Studio](https://aistudio.google.com/apikey)
- `anthropic-api-key` — opcional, para fallback Claude
- `backend-legacy-maps-key` — obtener en [APIs Credentials](https://console.cloud.google.com/apis/credentials) (Geocoding + Elevation, ver ADR-009 2.0)
- `frontend-maps-key` — Maps JavaScript API con HTTP referrer restriction
- `whatsapp-app-secret` — Meta Business Manager
- `whatsapp-access-token` — Meta (token de larga duración)
- `whatsapp-phone-number-id` — Meta
- `whatsapp-business-account-id` — Meta
- `dte-provider-api-key` — Bsale (u otro DTE provider chileno)
- `dte-provider-client-secret` — mismo provider
- `flow-api-key` — [Flow.cl](https://www.flow.cl/docs/api.html)
- `flow-secret-key` — Flow
- `jwt-signing-key` — `openssl rand -base64 64` local
- `sentry-dsn` — opcional

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
