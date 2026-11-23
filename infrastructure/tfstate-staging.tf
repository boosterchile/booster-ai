# =============================================================================
# STATE DE STAGING — bucket propio (ADR-083)
# =============================================================================
# El state de prod guarda en texto plano la contraseña de Postgres (data.tf
# arma DATABASE_URL con ella). Si staging usara el bucket de prod, su SA de
# drift recibiría lectura sobre el bucket entero (iam.tf,
# google_storage_bucket_iam_member.terraform_drift_state) y con ella la
# credencial de la base de prod. Con un bucket aparte, ninguna identidad de
# staging recibe acceso al state de prod.
#
# Vive en el proyecto de prod porque el proyecto de staging lo crea el primer
# apply de staging, que ya necesita un backend. Solo se declara en prod: el
# state de staging no se gestiona a sí mismo.

variable "staging_tfstate_bucket" {
  description = "Bucket GCS del state de staging. Lo crea el apply de prod; staging lo usa como backend (environments/staging/backend.hcl)."
  type        = string
  default     = "booster-ai-tfstate-stg-494222"
}

resource "google_storage_bucket" "tfstate_staging" {
  count = var.environment == "prod" ? 1 : 0

  name          = var.staging_tfstate_bucket
  project       = google_project.booster_ai.project_id
  location      = var.region
  storage_class = "STANDARD"

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Versioning: un state corrupto o pisado se recupera de la versión anterior.
  versioning {
    enabled = true
  }

  encryption {
    default_kms_key_name = google_kms_crypto_key.storage_operational.id
  }

  logging {
    log_bucket        = google_storage_bucket.access_logs.name
    log_object_prefix = "tfstate-staging/"
  }

  # Las versiones archivadas del state se conservan 90 días.
  lifecycle_rule {
    condition {
      age        = 90
      with_state = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }

  labels = {
    managed_by = "terraform"
    env        = "staging"
    purpose    = "tfstate"
  }
}
