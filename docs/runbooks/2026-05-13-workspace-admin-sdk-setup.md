# Runbook — Configurar Google Workspace Admin SDK con Domain-Wide Delegation

**Fecha**: 2026-05-13
**Audiencia**: Felipe Vicencio (Super-admin de Workspace `boosterchile.com`)
**Tiempo estimado**: ~15 minutos
**Prerequisito**: ser **Super Admin** en `admin.google.com`

Este runbook habilita que el backend de Booster AI (Cloud Run) lea licencias + seats activos de Google Workspace via **Domain-Wide Delegation (DWD)** sin necesidad de credenciales de usuario humano.

---

## Por qué necesitamos esto

El Dashboard Observabilidad (`/app/platform-admin/observability`) muestra:
- Seats activos de Workspace por plan
- Costo mensual estimado del Workspace (seats × precio configurado)

Workspace Admin SDK requiere autenticación con OAuth Domain-Wide Delegation — el Service Account de Cloud Run "impersona" al Super Admin del Workspace y lee licencias de solo-lectura.

**Scope solicitado**: `https://www.googleapis.com/auth/admin.directory.subscription.readonly` + `https://www.googleapis.com/auth/admin.directory.user.readonly` (read-only, no puede modificar nada).

---

## Pasos

### Paso 1 — Crear Service Account en GCP

Service Account dedicada (separada del runtime SA del Cloud Run para least-privilege):

```bash
gcloud iam service-accounts create observability-workspace-reader \
  --display-name="Observability Workspace Reader" \
  --description="Lee seats + licencias Workspace via Admin SDK DWD. Solo-lectura. Usado por /admin/observability/usage." \
  --project=booster-ai-494222
```

Anota el email que se crea: `observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com`

### Paso 2 — Crear key JSON de la SA

```bash
gcloud iam service-accounts keys create /tmp/workspace-reader-key.json \
  --iam-account=observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com \
  --project=booster-ai-494222
```

⚠️ Esta key es sensible. NO la committeas al repo. La vas a subir a Secret Manager en el paso 5 y después la borras de tu laptop.

### Paso 3 — Obtener el Client ID de la SA

Workspace identifica la SA por su **Client ID numérico** (≠ email).

```bash
gcloud iam service-accounts describe observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com \
  --project=booster-ai-494222 \
  --format="value(oauth2ClientId)"
```

Anota el número que devuelve (e.g. `109876543210987654321`).

### Paso 4 — Autorizar la SA en Workspace Admin Console

Esto es el paso manual de la consola web. **Necesitas ser Super Admin de `boosterchile.com`**.

1. Abre [admin.google.com](https://admin.google.com) → login con tu cuenta de super admin
2. Menú izquierdo → **Security** → **Access and data control** → **API controls**
3. En la sección "Domain wide delegation", click **Manage Domain Wide Delegation**
4. Click **Add new**
5. Completar:
   - **Client ID**: el número del paso 3 (e.g. `109876543210987654321`)
   - **OAuth scopes** (CSV, copia-pega exacto):
     ```
     https://www.googleapis.com/auth/admin.directory.subscription.readonly,https://www.googleapis.com/auth/admin.directory.user.readonly
     ```
6. Click **Authorize**

✅ La SA ya puede leer Workspace en modo read-only desde el Cloud Run.

### Paso 5 — Subir la key JSON a Secret Manager

```bash
# Crear el secret (idempotente)
gcloud secrets create google-workspace-admin-credentials \
  --project=booster-ai-494222 \
  --replication-policy=automatic \
  2>/dev/null || echo "Secret ya existe — skip create"

# Subir la versión inicial
gcloud secrets versions add google-workspace-admin-credentials \
  --data-file=/tmp/workspace-reader-key.json \
  --project=booster-ai-494222

# Verificar
gcloud secrets versions access latest \
  --secret=google-workspace-admin-credentials \
  --project=booster-ai-494222 \
  | jq -r '.client_email'
# Debe imprimir: observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com
```

### Paso 6 — Limpiar la key local

```bash
# IMPORTANTE: borrar la key del laptop después de subirla a Secret Manager
rm /tmp/workspace-reader-key.json
shred -u /tmp/workspace-reader-key.json 2>/dev/null || true
```

### Paso 7 — Otorgar accessor al SA del Cloud Run

El runtime SA del Cloud Run (`booster-cloudrun-sa@...`) necesita leer este secret.

```bash
gcloud secrets add-iam-policy-binding google-workspace-admin-credentials \
  --member=serviceAccount:booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor \
  --project=booster-ai-494222
```

Esto se va a aplicar también via Terraform en `infrastructure/security.tf` cuando mergees el PR del dashboard — el comando manual es para que funcione antes del merge.

---

## Verificación

Una vez aplicado el PR del dashboard observability:

```bash
# Endpoint nuevo del API que valida la conectividad Workspace
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://api.boosterchile.com/admin/observability/usage/workspace \
  | jq '.seats_active, .plan_distribution'

# Debe retornar algo como:
# 5
# { "business_standard": 3, "business_starter": 2 }
```

Si retorna `{ "error": "workspace_not_configured" }` → revisar paso 4 (scope autorizado) y paso 5 (secret cargado).

---

## Configurar precios por seat (config Terraform)

Workspace API **NO expone precios productivos** (Google los reserva). Los precios van en variables Terraform que el PO actualiza cuando Google los cambia:

```hcl
# infrastructure/variables.tf (se agregará en C1 del dashboard PR)
variable "google_workspace_price_per_seat_usd_starter" {
  description = "USD/mes por seat Google Workspace Business Starter"
  default     = 6
}

variable "google_workspace_price_per_seat_usd_standard" {
  default = 12
}

variable "google_workspace_price_per_seat_usd_plus" {
  default = 18
}

variable "google_workspace_price_per_seat_usd_enterprise" {
  default = 30  # rough — Enterprise tiene pricing custom
}
```

Si pagas un descuento (educacional, ONG, partnership), edita la variable correspondiente en `infrastructure/terraform.tfvars` (local, no committed).

---

## Rotación de la key (recomendado cada 90 días)

```bash
# Listar keys existentes
gcloud iam service-accounts keys list \
  --iam-account=observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com \
  --project=booster-ai-494222

# Generar nueva key
gcloud iam service-accounts keys create /tmp/new-key.json \
  --iam-account=observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com

# Subir como nueva versión del secret
gcloud secrets versions add google-workspace-admin-credentials \
  --data-file=/tmp/new-key.json

# Eliminar key vieja (después de validar que la nueva funciona)
gcloud iam service-accounts keys delete <OLD_KEY_ID> \
  --iam-account=observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com

# Limpiar
rm /tmp/new-key.json
```

---

## Troubleshooting

| Error | Causa | Fix |
|---|---|---|
| `403 Not Authorized to access this resource/api` | Scope no autorizado en Workspace Admin Console | Re-hacer Paso 4 con los scopes exactos |
| `404 Domain not found` | DWD configurada con dominio incorrecto | El subject del OAuth flow debe ser un email de `@boosterchile.com` con rol admin |
| `401 Invalid credentials` | Key JSON corrupta o secret mal cargado | Re-hacer Paso 5 |
| `400 Invalid impersonation principal` | La SA no tiene `iam.serviceAccountTokenCreator` sobre sí misma | `gcloud iam service-accounts add-iam-policy-binding observability-workspace-reader@... --member=serviceAccount:observability-workspace-reader@... --role=roles/iam.serviceAccountTokenCreator` |

---

## Estado actual de servicios Booster que pagas (referencia para configurar precios)

Verifica tu billing actual en [admin.google.com → Billing](https://admin.google.com/ac/billing/subscriptions) para confirmar qué plan tienes y cuántos seats.

Para el dashboard, **solo necesitamos que la SA pueda contar seats por plan**. El precio sale de las variables Terraform.

---

🤖 Generado para Claude session 2026-05-13 implementación dashboard observability
