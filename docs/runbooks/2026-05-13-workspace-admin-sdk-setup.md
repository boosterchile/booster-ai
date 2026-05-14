# Runbook — Configurar Google Workspace Admin SDK con Domain-Wide Delegation

**Fecha**: 2026-05-13 (revisado 2026-05-13: cambio a zero-key)
**Audiencia**: Felipe Vicencio (Super-admin de Workspace `boosterchile.com`)
**Tiempo estimado**: ~10 minutos (solo 1 paso manual en admin.google.com)
**Prerequisito**: ser **Super Admin** en `admin.google.com`

Este runbook habilita que el backend de Booster AI (Cloud Run) lea
licencias + seats activos de Google Workspace via **Domain-Wide
Delegation (DWD)** sin necesidad de credenciales de usuario humano y
**sin JSON keys** descargadas (cumple `iam.disableServiceAccountKeyCreation`
org policy de Booster).

---

## Por qué necesitamos esto

El Dashboard Observabilidad (`/app/platform-admin/observability`) muestra:
- Seats activos de Workspace por plan
- Costo mensual estimado del Workspace (seats × precio configurado)

Workspace Admin SDK requiere autenticación con OAuth Domain-Wide
Delegation — pero **NO necesita una JSON key local**. En vez de eso,
usamos IAM Credentials `signJwt`:

1. SA dedicada `observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com`
2. Runtime SA `booster-cloudrun-sa@...` tiene `iam.serviceAccountTokenCreator` sobre la reader SA
3. En runtime, el código:
   - Construye un JWT con `iss=<reader SA>`, `sub=<admin email>`, scopes Admin SDK
   - Lo firma vía IAM Credentials API (la private key vive solo dentro de GCP)
   - Lo intercambia por un access token vía OAuth 2 (`grant_type=jwt-bearer`)
   - Usa ese access token para llamar Admin SDK + Licensing API

**Cero key descargada. Cero secreto en Secret Manager. Cero rotación manual.**

**Scopes solicitados**:
- `https://www.googleapis.com/auth/admin.directory.user.readonly`
- `https://www.googleapis.com/auth/apps.licensing`

---

## Pasos

### Paso 1 — SA dedicada creada (ya existe)

La SA `observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com`
se crea automáticamente vía Terraform (`infrastructure/iam.tf` →
`google_service_account.observability_workspace_reader`).

Si necesitas crearla manualmente (antes de `terraform apply`):

```bash
gcloud iam service-accounts create observability-workspace-reader \
  --display-name="Observability Workspace Reader" \
  --description="Lee seats + licencias Workspace via Admin SDK DWD. Zero-key." \
  --project=booster-ai-494222
```

### Paso 2 — Otorgar tokenCreator al runtime SA (ya en Terraform)

Cubierto por `google_service_account_iam_member.cloudrun_can_impersonate_workspace_reader`.

Manual (si necesitas que funcione antes de `terraform apply`):

```bash
gcloud iam service-accounts add-iam-policy-binding \
  observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com \
  --member=serviceAccount:booster-cloudrun-sa@booster-ai-494222.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator \
  --project=booster-ai-494222
```

### Paso 3 — Obtener el Client ID de la SA

Workspace identifica la SA por su **Client ID numérico** (≠ email).

```bash
gcloud iam service-accounts describe \
  observability-workspace-reader@booster-ai-494222.iam.gserviceaccount.com \
  --project=booster-ai-494222 \
  --format="value(oauth2ClientId)"
```

**Valor actual (2026-05-13)**: `111745462454884197415`

### Paso 4 — Autorizar la SA en Workspace Admin Console ⚠️ MANUAL

Este es el único paso manual. **Necesitas ser Super Admin de `boosterchile.com`**.

1. Abre [admin.google.com](https://admin.google.com) → login con cuenta super admin
2. Menú izquierdo → **Security** → **Access and data control** → **API controls**
3. En "Domain wide delegation", click **Manage Domain Wide Delegation**
4. Click **Add new**
5. Completar:
   - **Client ID**: `111745462454884197415`
   - **OAuth scopes** (CSV, copia-pega exacto):
     ```
     https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/apps.licensing
     ```
6. Click **Authorize**

✅ Listo. La SA ya puede leer Workspace en read-only desde Cloud Run.

### Paso 5 — Verificación

Una vez deployado el PR del dashboard observability:

```bash
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  https://api.boosterchile.com/admin/observability/usage/workspace \
  | jq '.available, .activeSeats, .seatsBySku'
```

Debe retornar:
- `available: true`
- `activeSeats: <N>`
- `seatsBySku: { "1010020028": N, ... }` (o vacío si Workspace gratuito)

Si retorna `available: false` con `reason: "..."`:
- "workspace admin client not initialized" → falta env var `GOOGLE_WORKSPACE_READER_SA_EMAIL` (cubierto por Terraform)
- "403 Not Authorized" → re-hacer Paso 4 con scopes exactos
- "401 Invalid credentials" → verificar `iam.serviceAccountTokenCreator` binding (Paso 2)
- "Bad Request: Invalid sub" → email `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL` no es admin del dominio

---

## Configurar precios por seat (config Terraform)

Workspace API **NO expone precios productivos** (Google los reserva). Los
precios van en variables Terraform que el PO actualiza cuando Google los
cambia (revisar trimestralmente en [workspace.google.com/pricing](https://workspace.google.com/pricing)):

```hcl
# infrastructure/variables.tf
variable "google_workspace_price_per_seat_usd_starter"     { default = 6 }
variable "google_workspace_price_per_seat_usd_standard"    { default = 12 }
variable "google_workspace_price_per_seat_usd_plus"        { default = 18 }
variable "google_workspace_price_per_seat_usd_enterprise"  { default = 30 }
```

Si hay descuento (educacional, ONG, partnership), edita la variable
correspondiente en `infrastructure/terraform.tfvars` (local, no commited).

---

## Cambios desde versión anterior del runbook

La versión inicial (commit C1) usaba un Service Account JSON key
cargado en Secret Manager (`google-workspace-admin-credentials`). Eso
no funciona en Booster porque la org policy
`iam.disableServiceAccountKeyCreation` bloquea creación de keys.

**Refactor 2026-05-13** (commit C7):
- Eliminado secret `google-workspace-admin-credentials`
- Eliminado env var `GOOGLE_WORKSPACE_CREDENTIALS_JSON`
- Agregado env var `GOOGLE_WORKSPACE_READER_SA_EMAIL`
- Agregado IAM binding `cloudrun_can_impersonate_workspace_reader`
- Adapter usa IAM Credentials `signJwt` + OAuth 2 token exchange

Ventajas: cero rotación de keys, cero secreto sensible en Secret
Manager, cumple cero-trust principle.

---

## Troubleshooting

| Error | Causa | Fix |
|---|---|---|
| `403 Not Authorized to access this resource/api` | Scope no autorizado en Workspace Admin Console | Re-hacer Paso 4 con scopes exactos |
| `400 Bad Request: Invalid sub` | `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL` no es admin del dominio | Usar un email super-admin de Workspace |
| `permission denied: signJwt` | Falta `iam.serviceAccountTokenCreator` binding | Re-correr Paso 2 |
| `404 Domain not found` | DWD configurada con dominio incorrecto | El subject del OAuth flow debe ser email de `@boosterchile.com` con rol admin |
| `available: false, reason: workspace admin SDK config incompleta` | Faltan env vars en Cloud Run | Verificar `GOOGLE_WORKSPACE_DOMAIN`, `GOOGLE_WORKSPACE_IMPERSONATE_EMAIL`, `GOOGLE_WORKSPACE_READER_SA_EMAIL` en Cloud Run revision |

---

🤖 Generado para Claude session 2026-05-13 implementación dashboard observability
