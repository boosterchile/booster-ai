# Runbook — Crear y operar staging

Staging es un proyecto GCP gemelo de prod, gestionado con el mismo root module de Terraform ([ADR-083](../adr/083-staging-gemelo-y-extraccion-con-shadow.md)). Cada entorno tiene su bucket de state: prod usa `booster-ai-tfstate-494222` (prefijo `terraform/state`) y staging `booster-ai-tfstate-stg-494222` (prefijo `terraform/staging`).

Quién hace qué:

- **Lo ejecuta el PO**: crear el proyecto, facturación, `terraform apply` y secretos.
- **Ya está en el repo**: Terraform, workflows y este runbook.

## Lista de verificación previa (ADR-076)

- [ ] El bucket de state de staging existe: `gcloud storage buckets describe gs://booster-ai-tfstate-stg-494222`. Lo crea el `apply` de **prod** (`infrastructure/tfstate-staging.tf`); si no existe, corre primero el `plan`/`apply` de prod, que debe mostrar solo esa alta.
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

**Proyecto de cuota en el arranque.** El tfvars de ejemplo trae `quota_project_id = "booster-ai-494222"`. Sin esa línea el primer `apply` falla al crear el proyecto con «Project 'projects/booster-ai-stg-494222' not found or deleted»: el proveedor factura cada llamada contra el proyecto del entorno, que todavía no existe. Cuando el `apply` termine completo, quita la línea y corre un `plan`: debe decir «No changes».

El primer `apply` crea el proyecto, habilita las APIs y levanta la red, Cloud SQL, Redis, Cloud Run (placeholder), Pub/Sub, KMS, buckets, GKE y la zona DNS `staging.boosterchile.com`. Si falla por APIs que todavía se están propagando, repite el `apply`: es idempotente.

## 3. Secretos

**Antes del primer deploy** (es decir, antes de crear la variable `STAGING_PROJECT_ID` en GitHub), carga al menos `twilio-account-sid` con un Account SID de prueba (`AC…`). El `apply` lo crea con un placeholder y tres servicios lo validan al arrancar: api, notification-service y whatsapp-bot. El primer `apply` no falla por esto, porque los servicios nacen con una imagen placeholder; el primer deploy real sí.

El chequeo `check-validated-secret-placeholders.mjs` sobre el plan del primer `apply` de staging debe listar **solo** `twilio-account-sid`. Si lista algún `content-sid-*`, falta `content_sid_ready = {}` en tu `terraform.tfvars`.

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
  - `STAGING_API_URL=https://api.staging.boosterchile.com` — el API, sin slash final. La usa `release-staging.yml` para construir la PWA, registrar el webhook y probar `/health`. Si falta, el deploy falla en su primer paso.
  - `STAGING_URL=https://app.staging.boosterchile.com` — la PWA. Es la `BASE_URL` de Playwright en `e2e-staging.yml`, igual que `PRODUCTION_URL` en prod.
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
- **State separado**: el state de prod guarda la contraseña de la base en texto plano. Por eso staging tiene bucket propio y ninguna identidad de staging recibe acceso al de prod. No apuntes `tfstate_bucket` ni `backend.hcl` de staging al bucket de prod.
- **Drift**: `terraform-drift.yml` vigila prod. Agregar un job de staging queda pendiente hasta que staging exista (ADR-083 §Consecuencias).

## Gaps conocidos (auditoría docs 2026-11-16)

Checklist en seco completo: [`docs/handoff/2026-11-16-staging-checklist-adr083.md`](../handoff/2026-11-16-staging-checklist-adr083.md). Resumen:

| Ítem | Quién | Estado |
|---|---|---|
| Terraform + workflows + este runbook en `main` | Repo | **Listo** |
| Proyecto `booster-ai-stg-494222`, billing, `apply`, secretos, Firebase | **PO** | Pendiente |
| Environment GitHub `staging` (hoy solo existe `production`) | **PO** | Pendiente — créalo antes de cargar las vars de §6 |
| Vars repo `STAGING_PROJECT_ID` / `STAGING_API_URL` / `STAGING_URL` | **PO** | Pendiente — sin `STAGING_PROJECT_ID`, `release-staging.yml` se salta |
| Ambigüedad `STAGING_URL` (API en deploy vs PWA en E2E) | Repo | **Resuelta el 2026-11-23**: el deploy usa `STAGING_API_URL`; `STAGING_URL` queda para la PWA |
| Regla de Cloud Armor con el host de prod fijo | Repo | **Resuelta el 2026-11-23**: usa `api.${var.domain}` |
| Permisos de `cursor-agent@` sobre una SA que staging no tiene | Repo | **Resuelta el 2026-11-23**: solo se crean con `environment = "prod"` |
| El primer `apply` no podía crear el proyecto (era su propio proyecto de cuota) | Repo | **Resuelta el 2026-11-24**: `quota_project_id` durante el arranque |
| El tfvars de staging montaba los cinco content-sid con placeholder | Repo | **Resuelta el 2026-11-23**: `content_sid_ready = {}` en el ejemplo. Quien ya copió el tfvars debe agregar esa línea |
| Staging podía leer el state de prod (bucket compartido) | Repo + **PO** | **Resuelta el 2026-11-23**: bucket propio, creado por el `apply` de prod de ese día |
| Job drift de staging | Repo (después de que exista el entorno) | Pendiente declarado |
| Nightly E2E contra prod | Deuda CLAUDE.md | Hasta que exista `STAGING_URL` |
