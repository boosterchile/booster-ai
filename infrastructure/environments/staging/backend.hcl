# Backend de staging (ADR-083). Bucket propio, que crea el apply de PROD
# (infrastructure/tfstate-staging.tf): staging no recibe acceso al state de prod,
# que guarda la contraseña de la base.
#   terraform -chdir=infrastructure init -reconfigure -backend-config=environments/staging/backend.hcl
# Volver a prod: `terraform -chdir=infrastructure init -reconfigure` (sin -backend-config).
bucket = "booster-ai-tfstate-stg-494222"
prefix = "terraform/staging"
