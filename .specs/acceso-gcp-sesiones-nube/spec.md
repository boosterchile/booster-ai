# Spec: acceso-gcp-sesiones-nube

- Author: Felipe Vicencio (con Claude)
- Date: 2026-10-23
- Status: **Pedida por el PO el 2026-10-23** («Opción B») tras la auditoría de costos. Toca `org-policies.tf` e `iam.tf` (archivos protegidos: política de organización y service account); el merge y el apply necesitan su visto.
- ADR: [ADR-086](../../docs/adr/086-excepcion-llave-sa-sesiones-claude-nube.md) acota ADR-001 («nunca descargar SA keys») para esta excepción.
- Origen: la auditoría de costos (`.specs/presupuesto-clp/`) no pudo leer GCP desde la nube. Se probaron tres caminos y los tres fallaron: el token del proxy (sin credencial configurada), una llave de SA (bloqueada por `iam.disableServiceAccountKeyCreation`) y el conector BigQuery (OAuth roto, ref. `ofid_8d7b76dd8ee1ce99`).

## 1. Objetivo

Que las sesiones de Claude Code en la nube puedan leer GCP (`gcloud`, `bq`, APIs REST) sin que una llave entre al contenedor y sin tocar nada.

## 2. Diseño

| Pieza | Dónde | Por qué |
|---|---|---|
| Excepción a `iam.disableServiceAccountKeyCreation`, solo en `booster-ai-494222` | `org-policies.tf` | Es la única política que impide la llave. Mismo patrón que `allow_public_iam`. |
| SA `claude-cloud-readonly` con `viewer`, `bigquery.jobUser`, `serviceusage.serviceUsageConsumer` | `iam.tf` | Solo lectura. Sin Secret Manager, sin escritura. |
| `roles/billing.viewer` sobre `019461-C73CDE-DCE377` | `gcloud` (runbook) | El SA de drift no lee IAM de facturación; en Terraform sería drift perpetuo. |
| Llave JSON del SA | Creada a mano, cargada como **Network secret** del entorno Default de Claude, tipo «GCP access token (with Service Account Key)», hosts `*.googleapis.com` | El proxy de Anthropic guarda la llave y firma cada request. El contenedor solo ve el placeholder `CLOUDSDK_AUTH_ACCESS_TOKEN=proxy-…` que ya trae. |

Lo que NO se hace: guardar la llave en Terraform, en el repo, en variables de entorno del entorno de Claude, ni pegarla en un chat.

## 3. Criterios de éxito

- [ ] SC-1: `terraform plan` muestra 1 política, 1 SA y 3 bindings a crear; nada que cambiar ni destruir.
- [ ] SC-2: `gcloud iam service-accounts keys create` funciona para `claude-cloud-readonly` y sigue fallando para cualquier SA de otro proyecto de la org.
- [ ] SC-3: desde una sesión nueva en la nube, `gcloud projects describe booster-ai-494222` y una consulta `bq` al billing export responden; `gcloud run services update …` falla con 403.
- [ ] SC-4: la llave no aparece en el repo, en el state ni en el contenedor (`env | grep -i key` sin resultados).

## 4. Runbook (PO, después del merge)

```bash
# 1. Apply acotado
cd infrastructure
terraform plan -var=billing_account=019461-C73CDE-DCE377 -var=resend_api_key_ready=true \
  -target=google_org_policy_policy.allow_sa_keys \
  -target=google_service_account.claude_cloud_readonly \
  -target=google_project_iam_member.claude_cloud_readonly_roles -out=sa.plan
terraform apply sa.plan

# 2. Facturación (fuera de Terraform) y llave
SA=claude-cloud-readonly@booster-ai-494222.iam.gserviceaccount.com
gcloud billing accounts add-iam-policy-binding 019461-C73CDE-DCE377 \
  --member=serviceAccount:$SA --role=roles/billing.viewer
gcloud iam service-accounts keys create ~/Desktop/claude-cloud-readonly.json --iam-account=$SA
```

3. En claude.ai/code → entorno **Default** → **Edit** → **Network secrets** → **Add secret**: tipo «GCP access token (with Service Account Key)», hosts `*.googleapis.com`, pegar el contenido del JSON, **Add**.
4. Borrar el archivo: `rm ~/Desktop/claude-cloud-readonly.json`.
5. Abrir una sesión nueva en la nube y correr los chequeos de SC-3 y SC-4.

Si el formulario no ofrece el tipo «GCP access token», lo tiene que agregar un Owner de la organización en claude.ai.

## 5. Rotación y revocación

- Rotación anual: `gcloud iam service-accounts keys create` → reemplazar el Network secret → `gcloud iam service-accounts keys delete <id-viejo>`.
- Revocar: borrar el Network secret y `gcloud iam service-accounts keys list/delete`. El SA puede quedar sin llaves.

## 6. Riesgo aceptado

La política existe para que no circulen llaves. La excepción es por proyecto, la llave es de solo lectura, vive en el proxy de Anthropic y no en el contenedor, y se rota. Decisión del PO.
