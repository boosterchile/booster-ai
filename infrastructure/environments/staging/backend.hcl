# Backend de staging (ADR-083). Mismo bucket de state que prod, prefijo propio:
#   terraform -chdir=infrastructure init -reconfigure -backend-config=environments/staging/backend.hcl
# Volver a prod: `terraform -chdir=infrastructure init -reconfigure` (sin -backend-config).
bucket = "booster-ai-tfstate-494222"
prefix = "terraform/staging"
