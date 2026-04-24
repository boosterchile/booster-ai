# Terraform state remoto en GCS bucket (creado manualmente en bootstrap).
# Bucket: booster-ai-tfstate-494222 (sufijo numérico porque nombres GCS son globales)
# Versioning on, lifecycle con retention de versiones antiguas.

terraform {
  backend "gcs" {
    bucket = "booster-ai-tfstate-494222"
    prefix = "terraform/state"
  }
}
