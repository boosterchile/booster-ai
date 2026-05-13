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

# Key dedicada para firmar certificados de huella de carbono (GLEC v3.0).
# Separada de `document_signing` por audit trail limpio: cada propósito su
# key. Si en el futuro un auditor pide rotar o investigar firmas de
# carbono, no se mezcla con las firmas de actas de entrega o DTEs.
#
# Algoritmo: RSA_SIGN_PKCS1_4096_SHA256.
#   - 4096 bits para horizonte 10 años (consistente con `document_signing`).
#   - PKCS#1 v1.5 padding (no PSS) por interoperabilidad universal: Adobe
#     Reader, OpenSSL, Java JCE, node-forge — todos lo manejan sin
#     parámetros ASN.1 explícitos. PSS exige hashAlgorithm + MGF +
#     saltLength en el AlgorithmIdentifier del cert X.509 y del SignerInfo
#     PKCS7, lo que rompe validadores PAdES viejos que no soportan
#     id-RSASSA-PSS.
#   - PKCS#1 v1.5 está OK para signing en NIST SP 800-131A (la debilidad
#     de Bleichenbacher es solo en encryption, no signing).
#   - Determinístico (misma firma para mismo input) → reproducible para
#     auditores.
# La public key se expone en el endpoint público GET /certificates/:tracking/verify
# para que cualquier auditor externo valide las firmas con OpenSSL.
resource "google_kms_crypto_key" "certificate_carbono_signing" {
  name     = "certificate-carbono-signing"
  key_ring = google_kms_key_ring.main.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "RSA_SIGN_PKCS1_4096_SHA256"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# IAM least-privilege para la key de carbono — el binding global ya da
# encrypter/decrypter para CMEK (suficiente para el bucket documents) pero
# NO da signer. Lo agregamos solo a esta key específica para no abrir
# signing sobre todas las keys del keyring.
resource "google_kms_crypto_key_iam_member" "cloud_run_certificate_signer" {
  crypto_key_id = google_kms_crypto_key.certificate_carbono_signing.id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
}

# publicKeyViewer adicional para que el endpoint /verify pueda exponer la
# public key sin caching local (la lee de KMS en cada request o cachea en
# memoria 5 min).
resource "google_kms_crypto_key_iam_member" "cloud_run_certificate_viewer" {
  crypto_key_id = google_kms_crypto_key.certificate_carbono_signing.id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${google_service_account.cloud_run_runtime.email}"
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

# Trivy IaC AVD-GCP-0066: CMEK para los buckets operacionales (uploads_raw,
# public_assets, chat_attachments) que NO son de retencion legal como
# documents. Una sola key compartida porque el caso de uso es el mismo
# (cifrado en reposo de blobs operacionales) y simplifica IAM.
# Si en el futuro algun bucket necesita audit isolation, separar.
resource "google_kms_crypto_key" "storage_operational" {
  name            = "storage-operational-cmek"
  key_ring        = google_kms_key_ring.main.id
  rotation_period = "7776000s" # 90 dias

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key_iam_member" "gcs_encrypter_operational" {
  crypto_key_id = google_kms_crypto_key.storage_operational.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

# Trivy IaC AVD-GCP-0040: CMEK para boot disks de VMs (bastion). Compute
# Engine usa el SA de servicio per-project para encryption.
resource "google_kms_crypto_key" "compute_disk" {
  name            = "compute-disk-cmek"
  key_ring        = google_kms_key_ring.main.id
  rotation_period = "7776000s" # 90 dias

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "SOFTWARE"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Compute Engine system SA — necesario para que GCE pueda cifrar/descifrar
# boot disks con la key (cuando bastion arranca o re-encrypts post-rotation).
resource "google_kms_crypto_key_iam_member" "gce_disk_encrypter" {
  crypto_key_id = google_kms_crypto_key.compute_disk.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"
  member        = "serviceAccount:service-${google_project.booster_ai.number}@compute-system.iam.gserviceaccount.com"
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

    # AI providers
    # NOTA: gemini-api-key eliminada en ADR-037 — el backend ahora usa
    # Vertex AI Gemini con ADC (workload identity del SA cloud_run_runtime).
    # Cero API keys para Gemini.
    "anthropic-api-key", # por si usamos Claude como fallback en ai-provider

    # Maps Platform (ADR-009 del 2.0: key legacy Geocoding + Elevation)
    "backend-legacy-maps-key",
    "frontend-maps-key",

    # WhatsApp Business — Meta Cloud API directo (DEPRECATED en Fase 6.4).
    # Conservados como opción de fallback si se decide cancelar Twilio. NO se
    # montan en ningún Cloud Run service (notification-service tampoco — los
    # mounts se removieron post-migración Twilio). Ver ADR-006 amendment.
    # REVIEW: 2026-10-30 — si para esa fecha siguen sin uso, remover de este
    # local + del placeholder version + correr terraform apply para destruir.
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

    # Verify token Meta webhook handshake (DEPRECATED en Fase 6.4 junto al
    # resto). REVIEW: 2026-10-30 (mismo gate que los otros 4 secrets Meta).
    "whatsapp-webhook-verify-token",

    # Twilio WhatsApp BSP (Fase 6.4) — el número físico está en Twilio, así que
    # el bot usa Twilio API en lugar de Meta Cloud API directo. Auth Token se
    # usa tanto para Basic auth en el envío como para HMAC del webhook.
    "twilio-account-sid",
    "twilio-auth-token",

    # Twilio Content SIDs (templates WhatsApp aprobados por Meta). Migrados
    # desde variables Terraform a Secret Manager (refactor 2026-05-07) para
    # evitar que un apply sin override en tfvars blanquee el live value.
    # Cada template tiene formato HX + 32 hex chars y se carga con:
    #   echo -n "HX..." | gcloud secrets versions add content-sid-offer-new --data-file=-
    # offer-new es B.8 (notificación de oferta al carrier). chat-unread es P3.d
    # (fallback WhatsApp para mensajes no leídos).
    "content-sid-offer-new",
    "content-sid-chat-unread",
    # Phase 5 PR-L3 — template `tracking_link_v1` para enviar el link
    # público de tracking al shipper cuando un trip se asigna. Body:
    # "Tu carga {{1}} ya tiene transportista" + botón URL con {{4}} =
    # token UUID. Categoría Meta: Utility (informa post-acción del
    # usuario). SID Twilio creado: HXac1ef21ed9423258a2c38dad02f31e41
    # (submitted to Meta 2026-05-10, approval ~24-48h).
    "content-sid-tracking",

    # Web Push VAPID (P3.c) — generadas con `npx web-push generate-vapid-keys`
    # post-deploy y subidas con `gcloud secrets versions add`. La pública se
    # inyecta tanto al api (para mandar push) como al web (para subscribe del
    # browser); la privada SOLO al api.
    "webpush-vapid-public-key",
    "webpush-vapid-private-key",

    # NOTA: google-routes-api-key eliminada en ADR-038 — el backend ahora
    # autentica contra Routes API con ADC + header X-Goog-User-Project (SA
    # cloud_run_runtime tiene serviceusage.serviceUsageConsumer). Cero
    # API keys para Routes API.
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
