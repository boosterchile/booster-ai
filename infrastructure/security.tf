# KMS + Secret Manager.
# Secretos se crean como "shell vacío" via Terraform; los valores se agregan
# con gcloud al hacer onboarding. TF no contiene valores sensibles.

# =============================================================================
# KMS — keyring y keys para CMEK
# =============================================================================

resource "google_kms_key_ring" "main" {
  name     = "booster-ai-keyring"
  location = var.region
  project  = google_project.booster_ai.project_id

  depends_on = [google_project_service.apis]
}

# Key para cifrar buckets de documentos (SII Retention Lock + CMEK, ADR-007)
resource "google_kms_crypto_key" "documents" {
  name            = "documents-cmek"
  key_ring        = google_kms_key_ring.main.id
  rotation_period = "7776000s" # 90 días

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Key para firmas digitales de documentos (actas de entrega, certificados ESG)
resource "google_kms_crypto_key" "document_signing" {
  name     = "document-signing"
  key_ring = google_kms_key_ring.main.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "RSA_SIGN_PKCS1_4096_SHA512"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Permitir a Cloud Storage usar la key para CMEK
data "google_storage_project_service_account" "gcs" {
  project = google_project.booster_ai.project_id
}

resource "google_kms_crypto_key_iam_member" "gcs_encrypter" {
  crypto_key_id = google_kms_crypto_key.documents.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

# =============================================================================
# SECRET MANAGER — shells vacíos. Los valores se setean con gcloud:
#   echo -n "value" | gcloud secrets versions add <name> --data-file=-
# =============================================================================

locals {
  secret_names = [
    # Firebase Admin SDK (si se requiere archivo JSON en entornos no-Cloud-Run)
    "firebase-admin-key",

    # Database
    "database-url",

    # Gemini / AI
    "gemini-api-key",
    "anthropic-api-key", # por si usamos Claude como fallback en ai-provider

    # Maps Platform (ADR-009 del 2.0: key legacy Geocoding + Elevation)
    "backend-legacy-maps-key",
    "frontend-maps-key",

    # WhatsApp Business (ADR-006)
    "whatsapp-app-secret",
    "whatsapp-access-token",
    "whatsapp-phone-number-id",
    "whatsapp-business-account-id",

    # DTE provider (Bsale u otros, ADR-007)
    "dte-provider-api-key",
    "dte-provider-client-secret",

    # Flow.cl (pagos, ADR-010)
    "flow-api-key",
    "flow-secret-key",

    # JWT signing (si aplica para backend-to-backend, complementario a Firebase)
    "jwt-signing-key",

    # Observability
    "sentry-dsn", # opcional

    # Thin slice Fase 6 — verify token custom para handshake inicial de Meta webhook
    # Generar con: openssl rand -hex 32 | gcloud secrets versions add whatsapp-webhook-verify-token --data-file=-
    "whatsapp-webhook-verify-token",
  ]
}

resource "google_secret_manager_secret" "secrets" {
  for_each = toset(local.secret_names)

  secret_id = each.value
  project   = google_project.booster_ai.project_id

  replication {
    auto {}
  }

  labels = {
    managed_by = "terraform"
    env        = var.environment
  }

  depends_on = [google_project_service.apis]
}

# Versión placeholder obligatoria: Cloud Run rechaza mount de secret sin versions.
# El valor real se rota manualmente con:
#   echo -n "<valor>" | gcloud secrets versions add <name> --data-file=-
# Los placeholders se detectan con:
#   gcloud secrets versions access latest --secret=<name>
# Si devuelve "ROTATE_ME_..." el valor real aún no se puso.
#
# Excepción: database-url se gestiona en data.tf con el password real (Cloud SQL crea la cuenta).
resource "google_secret_manager_secret_version" "placeholder" {
  for_each = toset([
    for name in local.secret_names : name
    if name != "database-url" # database-url se setea en data.tf con password generado
  ])

  secret      = google_secret_manager_secret.secrets[each.value].id
  secret_data = "ROTATE_ME_${upper(replace(each.value, "-", "_"))}_PLACEHOLDER"

  lifecycle {
    # Una vez rotado el secret con valor real, Terraform no debe sobrescribirlo.
    ignore_changes = [secret_data, enabled]
  }
}

# Cloud Run runtime SA puede leer todos los secrets (ya tiene roles/secretmanager.secretAccessor a nivel proyecto)
# Permisos específicos por secret si se necesita más granularidad en el futuro.
