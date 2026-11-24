terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 6.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

# Proyecto de cuota (billing_project): normalmente el propio proyecto. En el
# PRIMER apply de un entorno nuevo ese proyecto todavía no existe, y con
# user_project_override toda llamada se factura contra él: la primera
# (comprobar permisos sobre la cuenta de facturación) falla con «Project not
# found». var.quota_project_id permite apuntar a un proyecto que ya existe
# solo durante ese arranque. Ver docs/runbooks/staging.md.
provider "google" {
  project = var.project_id
  region  = var.region

  # Billing Budgets y algunas APIs de quota requieren quota project explícito
  # cuando se autentica via user ADC. Production-grade practice TRL 10.
  billing_project       = coalesce(var.quota_project_id, var.project_id)
  user_project_override = true
}

provider "google-beta" {
  project = var.project_id
  region  = var.region

  billing_project       = coalesce(var.quota_project_id, var.project_id)
  user_project_override = true
}
