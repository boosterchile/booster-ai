# Runbook — Crear y operar staging

Staging es un proyecto GCP gemelo de prod, gestionado con el mismo root module de Terraform ([ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md)). Prod usa el prefijo de state `terraform/state`; staging usa `terraform/staging`.

Quién hace qué:

- **Lo ejecuta el PO**: crear el proyecto, facturación, `terraform apply` y secretos.
- **Ya está en el repo**: Terraform, workflows y este runbook.

## Lista de verificación previa (ADR-076)

- [ ] La cuenta que ejecuta tiene `resourcemanager.projectCreator` en la org y `billing.user` en la cuenta de facturación.
- [ ] El ID `booster-ai-stg-494222` está disponible. Si no lo está, elegir otro y actualizarlo en el tfvars y en las variables de GitHub.
- [ ] Copiaste `infrastructure/environments/staging/terraform.tfvars.example` a `terraform.tfvars`, con `billing_account` completo.
- [ ] Revisaste el presupuesto: `monthly_budget_usd = 250`. El costo esperado es USD 150–250/mes (ADR-083).
- [ ] Corriste el `plan` en seco y guardaste la salida en `docs/runbooks/staging-plan-YYYY-MM-DD.txt` antes del `apply`.

## 1. Inicializar el state de staging

```bash
terraform -chdir=infrastructure init -reconfigure \
  -backend-config=environments/staging/backend.hcl
terraform -chdir=infrastructure workspace show   # debe decir "default"
```

`-reconfigure` cambia solo la ubicación del state. **Antes de cualquier comando contra prod**, vuelve con `terraform -chdir=infrastructure init -reconfigure`, sin `-backend-config`.

## 2. Plan en seco y apply

```bash
terraform -chdir=infrastructure plan \
  -var-file=environments/staging/terraform.tfvars -out=staging.plan
# revisar: todo debe ser "create"; ningún recurso con project=booster-ai-494222
terraform -chdir=infrastructure apply staging.plan
```

El primer `apply` crea el proyecto, habilita las APIs y levanta la red, Cloud SQL, Redis, Cloud Run (placeholder), Pub/Sub, KMS, buckets, GKE y la zona DNS `staging.boosterchile.com`. Si falla por APIs que todavía se están propagando, repite el `apply`: es idempotente.

## 3. Secretos

Sigue [`secret-init-runbook.md`](secret-init-runbook.md) apuntando a `--project=booster-ai-stg-494222`:

- **Twilio**: credenciales de prueba, nunca las de prod.
- **Resend**: API key de un dominio de prueba.
- **Firebase**: SA propio.

Los secretos se cargan solo por Terraform o por la consola (CLAUDE.md).

## 4. Delegar el subdominio desde prod

```bash
terraform -chdir=infrastructure output -json dns_zone_name_servers   # aún con el state de staging
terraform -chdir=infrastructure init -reconfigure                     # volver a prod
```

En el `terraform.tfvars` de prod, define `staging_nameservers = [<los 4 NS>]` y ejecuta el `plan`/`apply` de prod (lista de verificación de `terraform-apply.md`). Ese `apply` agrega un solo registro NS, `staging.boosterchile.com`.

El registro DS de DNSSEC para el subdominio es opcional: sin él, la zona de staging se resuelve como no firmada.

## 5. Firebase / Identity Platform

En la consola de Firebase, agrega el proyecto `booster-ai-stg-494222`, crea la app web y copia su configuración (`apiKey`, `appId`, `messagingSenderId`). Registra una key de reCAPTCHA v3 para App Check con el dominio `app.staging.boosterchile.com`. Crea también una API key de Maps restringida a ese mismo dominio.

## 6. GitHub

- **Variables de repositorio**:
  - `STAGING_PROJECT_ID=booster-ai-stg-494222`
  - `STAGING_URL`, con el mismo rol que `PRODUCTION_URL` pero apuntando a staging
- **Environment `staging`**:
  - `STAGING_WIF_PROVIDER` y `STAGING_WIF_SERVICE_ACCOUNT_DEPLOY` (los outputs `wif_provider` y `wif_service_account_deploy` del state de staging)
  - `STAGING_VITE_FIREBASE_API_KEY`, `STAGING_VITE_FIREBASE_APP_ID`, `STAGING_VITE_FIREBASE_MESSAGING_SENDER_ID`
  - `STAGING_VITE_GOOGLE_MAPS_API_KEY`, `STAGING_VITE_RECAPTCHA_SITE_KEY`

Con `STAGING_PROJECT_ID` definida:

- `release-staging.yml` despliega cada push a `main`. Mientras no exista, el job se salta.
- `e2e-staging.yml` (nightly y PRs) pasa a correr contra staging en vez de prod.

## 7. Gateway de telemetría (GKE)

El primer despliegue del gateway sigue [`bootstrap-gke-telemetry-gateway.md`](bootstrap-gke-telemetry-gateway.md) con el clúster de staging. El manifiesto tiene fijas las IPs de prod, así que hay que reemplazarlas por las de staging al aplicarlo:

```bash
IP=$(gcloud compute addresses describe booster-telemetry-lb-ip --region=southamerica-west1 --project=booster-ai-stg-494222 --format='value(address)')
sed -e "s/34.176.238.106/${IP}/" -e "s/booster-ai-494222/booster-ai-stg-494222/g" \
  infrastructure/k8s/telemetry-tcp-gateway.yaml | kubectl apply -f -
```

Desde ahí, Cloud Build actualiza la imagen con `kubectl set image`, igual que en prod.

## 8. Verificación

- [ ] `curl -fsS https://api.staging.boosterchile.com/health` responde 200.
- [ ] Un push a `main` dispara `Deploy staging` y termina en verde.
- [ ] El nightly E2E corre contra staging. Verifícalo en la URL del job.
- [ ] Ningún log de staging contiene datos de prod: staging se puebla solo con seeds.

## Operación

- **Destruir staging** (si se decide): `terraform destroy` con el state de staging y lista de verificación. Cloud SQL tiene `deletion_protection = true` fijo en `data.tf`. Antes del destroy, desactívala solo en la instancia de staging (`gcloud sql instances patch <instancia> --no-deletion-protection --project=booster-ai-stg-494222`). Nunca toques el `.tf` ni prod.
- **Drift**: `terraform-drift.yml` vigila prod. Agregar un job de staging queda pendiente hasta que staging exista (ADR-083 §Consecuencias).
