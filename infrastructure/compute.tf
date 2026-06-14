# Cloud Run services + GKE Autopilot (para TCP gateway Teltonika).
# Los Cloud Run arrancan con imagen placeholder — CI/CD los actualiza después.

# =============================================================================
# CLOUD RUN SERVICES (via módulo reusable)
# =============================================================================

locals {
  common_env_vars = {
    NODE_ENV             = var.environment == "prod" ? "production" : "staging"
    LOG_LEVEL            = "info"
    GOOGLE_CLOUD_PROJECT = var.project_id
    SERVICE_VERSION      = "0.0.0"
    # Memorystore Redis — compartido entre services para conversation store +
    # caching de OIDC tokens + rate limiting. Privado por VPC con AUTH +
    # transit encryption (SERVER_AUTHENTICATION) requeridos.
    REDIS_HOST     = google_redis_instance.main.host
    REDIS_PORT     = tostring(google_redis_instance.main.port)
    REDIS_PASSWORD = google_redis_instance.main.auth_string
    REDIS_TLS      = "true"
    # Server CA de Memorystore (SERVER_AUTHENTICATION): cert firmado por CA privada
    # por-instancia que NO está en el bundle público del sistema. Sin pinnearla,
    # ioredis falla con UNABLE_TO_VERIFY_LEAF_SIGNATURE (incidente 2026-06-07 tras
    # el replace de la instancia en ADR-058). Ver packages/config/src/redis-tls.ts.
    # Se inyectan TODOS los server_ca_certs (no solo [0]) para sobrevivir una
    # rotación de CA, durante la cual Memorystore expone el saliente + el entrante
    # a la vez; Node parsea todos los PEM del string.
    REDIS_CA_CERT = join("\n", google_redis_instance.main.server_ca_certs[*].cert)
  }

  common_secrets = {
    DATABASE_URL = google_secret_manager_secret.secrets["database-url"].secret_id
  }

  # Lista de IDs de todas las secret versions que deben existir antes de crear
  # cualquier Cloud Run service que monte secrets. Se pasa a cada módulo via
  # `secret_versions_ready` para que Terraform propague el orden automáticamente.
  # Incluye los 14 placeholders originales + database_url (generado dinámicamente)
  # + las versions del set hotfix-2026-05-14 (6 placeholders + pepper aleatorio)
  # que ya están mounteadas por al menos un service (T7 SEC-001 monta
  # DEMO_SEED_PASSWORD en el api).
  all_secret_versions_ready = concat(
    [for v in values(google_secret_manager_secret_version.placeholder) : v.id],
    [google_secret_manager_secret_version.database_url.id],
    [for v in values(google_secret_manager_secret_version.hotfix_2026_05_14_placeholder) : v.id],
    [google_secret_manager_secret_version.pin_rate_limit_hmac_pepper.id],
  )

  # URLs *.run.app de los Cloud Run services — audience canónica para tráfico
  # interno Cloud Run-to-Cloud Run (el caller arma un OIDC token con audience
  # = la URL del service que va a invocar, y Google la valida contra esta
  # config). Cloud Run nombra cada service como
  # https://<service-name>-<project-number>.<region>.run.app.
  cloud_run_api_url = "https://booster-ai-api-${google_project.booster_ai.number}.${var.region}.run.app"
  cloud_run_bot_url = "https://booster-ai-whatsapp-bot-${google_project.booster_ai.number}.${var.region}.run.app"

  # URL pública canónica del api (post-migración DNS GoDaddy → Cloud DNS).
  # Usada como audience primaria del OIDC token desde el bot, y como webhook
  # URL configurada en Twilio Sender. El LB global rutea api.boosterchile.com
  # al backend del api (y /webhooks/whatsapp* al backend del bot — ver
  # url_map en networking.tf).
  public_api_url = "https://api.${var.domain}"
}

# --- apps/api ---
module "service_api" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-api"
  service_account_email = google_service_account.cloud_run_runtime.email

  # Pre-comercial (<=10 camiones): min=0 acepta cold starts de 5-10s tras
  # inactividad a cambio de ~CLP 50k/mes. Volver a 1 al firmar B2B con SLA.
  # Ver .specs/cost-optimization-precomercial.
  min_instances = 0
  max_instances = 20
  cpu           = "1"
  memory        = "1Gi"

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME        = "booster-ai-api"
    FIREBASE_PROJECT_ID = var.project_id
    # API_AUDIENCE valida los OIDC tokens entrantes. CSV de URLs aceptadas
    # como diseño permanente:
    #   - cloud_run_api_url (*.run.app): tráfico interno Cloud Run-to-Cloud Run
    #     (bot → api). Es el camino canónico — bypass del LB, sin Cloud Armor.
    #   - public_api_url (api.boosterchile.com): por si un caller futuro entra
    #     vía LB y necesita autenticarse con OIDC contra el api (ej. backend
    #     externo que solo conoce la URL pública).
    # Hoy en producción solo el bot llama, y va por *.run.app. La pública
    # queda aceptada defensivamente — su costo es 0 y abre la opción sin
    # tener que modificar el middleware después.
    API_AUDIENCE      = "${local.public_api_url},${local.cloud_run_api_url}"
    ALLOWED_CALLER_SA = google_service_account.cloud_run_runtime.email
    # Origins permitidos al api. La PWA nueva corre en https://app.${var.domain}
    # — sin esto el browser bloquea preflight OPTIONS y todas las requests
    # cross-origin desde el frontend fallan con "Failed to fetch".
    CORS_ALLOWED_ORIGINS = "${local.public_api_url},https://${var.domain},https://www.${var.domain},https://app.${var.domain},https://demo.${var.domain},${local.cloud_run_api_url}"

    # B.8 — dispatcher de notificaciones WhatsApp post-matching.
    # El api comparte el mismo Sender (+19383365293) que el bot — Twilio
    # identifica el sender por From + auth, así que ambos servicios pueden
    # mandar mensajes desde el mismo número. TWILIO_AUTH_TOKEN va por
    # Secret Manager (mismo secret `twilio-auth-token` que el bot).
    TWILIO_FROM_NUMBER = var.twilio_from_number
    # CONTENT_SID_OFFER_NEW + CONTENT_SID_CHAT_UNREAD se mueven a Secret
    # Manager (ver `secrets` block más abajo). Razón del refactor:
    # mantenerlos como variable Terraform causaba drift cuando alguien
    # los cargaba con `-var=...` y el siguiente apply sin override los
    # blanqueaba (incidente 2026-05-07). Ahora viven en Secret Manager,
    # se cargan con `gcloud secrets versions add` y persisten entre
    # applies sin requerir tfvars locales.
    # WEB_APP_URL usa el dominio público del frontend para construir el
    # deep-link al dashboard en el template de WhatsApp.
    WEB_APP_URL = "https://app.${var.domain}"

    # KMS key para firmar certificados de huella de carbono (RSA-PSS 4096
    # SHA256). El servicio emitirCertificadoViaje hace asymmetricSign con
    # esta key cuando un viaje pasa a entregado. Bucket de almacenamiento
    # del PDF firmado: gs://${certificates_bucket}/certificates/. Bucket
    # PROPIO sin retention SII desde 2026-06-11 (sec-h3 §14.1.b): la
    # re-emisión sobrescribe paths y chocaba con la retención de documents.
    CERTIFICATE_SIGNING_KEY_ID = google_kms_crypto_key.certificate_carbono_signing.id
    CERTIFICATES_BUCKET        = google_storage_bucket.certificates.name

    # P3.b — chat SSE realtime. El api publica al topic post-INSERT de
    # mensaje, y los GET /:id/messages/stream crean subscriptions
    # efímeras filtradas por assignment_id.
    CHAT_PUBSUB_TOPIC = google_pubsub_topic.chat_messages.name

    # P3.f — bucket privado para fotos del chat. Sin esto, el endpoint
    # POST /assignments/:id/messages/photo-upload-url responde 503
    # attachments_disabled. Lifecycle 90 días en el bucket borra fotos
    # automáticamente.
    CHAT_ATTACHMENTS_BUCKET = google_storage_bucket.chat_attachments.name

    # P3.d — Cloud Scheduler invoca /admin/jobs/* con OIDC firmado por
    # este SA. El middleware createAuthMiddleware valida claims.email
    # contra esto. Sin esta env var los endpoints /admin/jobs/* responden
    # 401 (configurable en server.ts).
    INTERNAL_CRON_CALLER_SA = google_service_account.internal_cron_invoker.email

    # ADR-033 — Matching engine v2 feature flag + pesos custom. Default
    # `false` mantiene el v1 capacity-only intacto. Flip a `true` cuando
    # los backtests muestren delta favorable. Reversible sin redeploy de
    # código. Ver variables.tf para rollout plan.
    MATCHING_ALGORITHM_V2_ACTIVATED = tostring(var.matching_algorithm_v2_activated)
    MATCHING_V2_WEIGHTS_JSON        = var.matching_v2_weights_json

    # ADR-035 (Wave 4) — Auth universal RUT + clave numérica. Default
    # `false` mantiene el flow legacy email/password. Cuando `true`,
    # `/login` muestra selector de tipo usuario + form RUT+clave para
    # todos los roles (no solo conductor).
    #
    # Rollout staged:
    #   1. PR 1 (foundation backend): flag=false default. Endpoint vivo
    #      sin uso desde UI.
    #   2. PR 2 (este PR — UI selector): flag=false default. Activar en
    #      staging para validar smoke E2E. Si OK, activar en prod.
    #   3. PR 3 (migración 30d): forzar rotación al login siguiente de
    #      usuarios con email/password legacy.
    AUTH_UNIVERSAL_V1_ACTIVATED = tostring(var.auth_universal_v1_activated)

    # ADR-036 (Wave 5) — Wake-word "Oye Booster" para conductor. Default
    # `false`. Activar SOLO después de entrenar el modelo custom con
    # voces chilenas (Wave 5 PR 2). El conductor además debe opt-in en
    # su configuración (default OFF en localStorage).
    WAKE_WORD_VOICE_ACTIVATED = tostring(var.wake_word_voice_activated)

    # Modo demo (subdominio demo.boosterchile.com). Cuando ON, el api
    # habilita POST /demo/login (mintea custom tokens Firebase para las
    # 4 personas demo) y corre auto-seed-demo on startup. Doble guard:
    # esta env var + columna es_demo=true en empresas.
    DEMO_MODE_ACTIVATED = tostring(var.demo_mode_activated)

    # ADR-039 — Site Settings Runtime Configuration. Bucket de assets
    # editables (logos, favicons) subidos desde el admin. Reuso del
    # bucket public_assets existente (no es realmente público por org
    # policy; servimos via signed URLs TTL 7 días desde el api).
    PUBLIC_ASSETS_BUCKET = google_storage_bucket.public_assets.name

    # Allowlist de operadores Booster que pueden entrar a /admin/* del API
    # y /app/platform-admin/* de la PWA. CSV de emails (lower-cased en
    # comparison). Sin esta env var nadie es admin — el código defaultea
    # a array vacío. Era un bug detectado post-stack ADR-033.
    BOOSTER_PLATFORM_ADMIN_EMAILS = var.booster_platform_admin_emails

    # Observability dashboard — spec 2026-05-13. Lee billing_export
    # (BigQuery), Cloud Monitoring API, Twilio Usage, Google Workspace
    # Admin SDK. Feature flag para rollback rápido vía terraform var.
    OBSERVABILITY_DASHBOARD_ACTIVATED  = tostring(var.observability_dashboard_activated)
    BILLING_EXPORT_TABLE               = var.billing_export_table
    GOOGLE_WORKSPACE_DOMAIN            = var.google_workspace_domain
    GOOGLE_WORKSPACE_IMPERSONATE_EMAIL = var.google_workspace_impersonate_email
    # SA dedicada al reader (cero-key, signJwt via IAM Credentials).
    # Definida en iam.tf como google_service_account.observability_workspace_reader.
    GOOGLE_WORKSPACE_READER_SA_EMAIL = google_service_account.observability_workspace_reader.email
    # Precios USD/seat/mes — Workspace API no los expone, configurados
    # como vars Terraform. PO actualiza si Google cambia pricing.
    GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_STARTER    = tostring(var.google_workspace_price_per_seat_usd_starter)
    GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_STANDARD   = tostring(var.google_workspace_price_per_seat_usd_standard)
    GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_PLUS       = tostring(var.google_workspace_price_per_seat_usd_plus)
    GOOGLE_WORKSPACE_PRICE_PER_SEAT_USD_ENTERPRISE = tostring(var.google_workspace_price_per_seat_usd_enterprise)
    MONTHLY_BUDGET_USD                             = tostring(var.monthly_budget_usd)

    # T3 SEC-001 (sec-001-cierre §3 round 4 P1-R4-4 + P0-4) — gating del
    # fail-closed startup cuando runMigrations falla. Default false en
    # Sprint 1 prod (legacy behavior preservada); flip a true en Sprint 2.
    # El env var se lee en apps/api/src/main.ts vía runMigrationsGated.
    # PLAIN env var (no secret) — fix moved aquí desde `secrets` block 2026-05-25:
    # Sprint 1 T3 leftover bug lo dejó en bloque secrets causando que Cloud
    # Run intentara mount un secreto llamado literalmente "false" (= valor
    # de tostring(false)). Apply falló con "Secret projects/.../secrets/false
    # was not found" en el primer Sprint 2a apply 2026-05-25T17:55Z.
    STRICT_MIGRATION_ORDERING = tostring(var.strict_migration_ordering)

    # SEC-001 H1.2 Sprint 2c-B T8 pre-apply (2026-05-29) — activa el flow
    # de admin-approval signup-request rate-limited. Default false en
    # config (apps/api/src/config.ts:booleanFlag(false)); flip a true
    # aquí post ADR-052 Accepted (Sprint 2b T13 canary success) para
    # que el Cloud Function `beforeCreate` blocking-function tenga un
    # destino UX válido cuando rechace signups Google ad-hoc. Sin esto,
    # los rechazados ven "Coming soon" del admin UI sin path forward.
    SIGNUP_REQUEST_FLOW_ACTIVATED = tostring(var.signup_request_flow_activated)
  })
  secrets = merge(local.common_secrets, {
    # Mismo secret que el bot — un solo lugar de verdad para rotaciones.
    # El SA del Cloud Run del api tiene secretAccessor sobre todo el set
    # vía security.tf, así que no hace falta IAM extra.
    TWILIO_ACCOUNT_SID = google_secret_manager_secret.secrets["twilio-account-sid"].secret_id
    TWILIO_AUTH_TOKEN  = google_secret_manager_secret.secrets["twilio-auth-token"].secret_id

    # B.8 — Content SIDs de templates WhatsApp aprobados por Meta.
    # Migrados a Secret Manager (refactor 2026-05-07) — antes vivían
    # como variables Terraform y causaban drift en apply.
    # Cargar con: gcloud secrets versions add content-sid-offer-new \
    #   --data-file=<(echo -n "HX...")
    # Si el secret tiene valor placeholder ROTATE_ME_..., el dispatcher
    # del api loguea warn y skipea — las offers se crean en DB pero el
    # carrier no recibe WhatsApp template hasta que se cargue el real.
    # Ver docs/runbooks/load-content-sids.md.
    CONTENT_SID_OFFER_NEW   = google_secret_manager_secret.secrets["content-sid-offer-new"].secret_id
    CONTENT_SID_CHAT_UNREAD = google_secret_manager_secret.secrets["content-sid-chat-unread"].secret_id
    # Phase 5 PR-L3 — Twilio template `tracking_link_v1` para enviar el
    # link público de tracking al shipper al asignar el trip. Hasta que
    # Meta apruebe (submitted 2026-05-10, SID HXac1ef21ed9423258a2c38dad02f31e41),
    # el secret mantiene placeholder y notify-tracking-link skipea con warn.
    CONTENT_SID_TRACKING = google_secret_manager_secret.secrets["content-sid-tracking"].secret_id

    # P3.c — Web Push VAPID. El api firma cada push con la privada (JWT
    # Authorization header al push service del browser). La pública se
    # incluye en cada push como Crypto-Key header y también la consume
    # el frontend al subscribe. Generadas post-deploy con
    # `npx web-push generate-vapid-keys`.
    WEBPUSH_VAPID_PUBLIC_KEY  = google_secret_manager_secret.secrets["webpush-vapid-public-key"].secret_id
    WEBPUSH_VAPID_PRIVATE_KEY = google_secret_manager_secret.secrets["webpush-vapid-private-key"].secret_id

    # NOTA observability dashboard: el reader SA usa IAM Credentials
    # `signJwt` para producir JWTs DWD on-the-fly (cero-key). No hay
    # secret JSON que montar. El email del reader SA viene de env vars
    # (no de Secret Manager) porque no es sensible.

    # ADR-038: GOOGLE_ROUTES_API_KEY eliminada. apps/api ahora autentica
    # contra Routes API con ADC + header X-Goog-User-Project (el SA del
    # runtime tiene roles/serviceusage.serviceUsageConsumer, suficiente).
    # El secret google-routes-api-key queda en Secret Manager como
    # artefacto histórico — la API key real se elimina con
    # `gcloud services api-keys delete e091850a-d5ea-4941-bcf0-8f966032b58b`
    # post-apply.
    #
    # ADR-037: GEMINI_API_KEY eliminada con el mismo patrón (Vertex AI +
    # ADC con roles/aiplatform.user). API key Booster Gemini ya eliminada
    # post-apply de PR #196.

    # T7 SEC-001 (spec sec-001-cierre §3 H1.4 SC-1.4.2) — password leído
    # por seed-demo.ts y seed-demo-startup.ts cuando DEMO_MODE_ACTIVATED
    # está ON. Reemplaza el literal hardcoded que vivía en
    # `apps/api/src/services/seed-demo.ts:86` + `seed-demo-startup.ts:142`.
    # El secret + IAM bindings + placeholder version `REPLACE_ME_BEFORE_DEPLOY`
    # están declarados en `security-hotfixes-2026-05-14.tf` (importado en
    # T0b PR #316); aquí solo se mountea como env var. La rotación a
    # password real ocurre via `gcloud secrets versions add demo-seed-password`
    # (T7.5 run-once) ANTES de que T8 active el lookup en el código —
    # T7.5 gate de CI bloquea PRs que toquen seed-demo*.ts si version
    # count == 0.
    DEMO_SEED_PASSWORD = google_secret_manager_secret.hotfix_2026_05_14["demo-seed-password"].secret_id

    # T3 SEC-001 Sprint 2a (plan-sprint-2a.md T3, sec-001-cierre §3 H1.1
    # SC-1.1.5) — per-persona demo account passwords. Reemplazan el single
    # DEMO_SEED_PASSWORD path para las UIDs NUEVAS post-disclosure
    # replacement (ADR-053). Co-existen con DEMO_SEED_PASSWORD que sigue
    # cubriendo el path legacy hasta que T4 ejecute el one-shot retire de
    # las UIDs viejas. Mounted como env vars desde los 4 secrets creados
    # en T2; init de version 1 por PO con infrastructure/scripts/
    # init-demo-secrets-2026.sh post terraform apply.
    DEMO_ACCOUNT_PASSWORD_SHIPPER_2026            = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-shipper-2026"].secret_id
    DEMO_ACCOUNT_PASSWORD_CARRIER_2026            = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-carrier-2026"].secret_id
    DEMO_ACCOUNT_PASSWORD_STAKEHOLDER_2026        = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-stakeholder-2026"].secret_id
    DEMO_ACCOUNT_PASSWORD_CONDUCTOR_FIREBASE_2026 = google_secret_manager_secret.hotfix_2026_05_14["demo-account-password-conductor-2026-firebase"].secret_id
  })

  vpc_connector = google_vpc_access_connector.serverless.id

  # Público para que el browser pueda hacer preflight OPTIONS desde la PWA
  # (los CORS preflight no llevan Authorization header — Cloud Run sin
  # allUsers los rechaza con 403 antes de que el middleware CORS responda).
  # La auth real la hace el middleware Firebase Auth a nivel app, no Cloud
  # Run. Mismo patrón que el bot para webhooks Twilio. El override de org
  # policy en org-policies.tf permite allUsers a nivel proyecto.
  public = true

  # ADR-062: solo alcanzable vía GCLB (+ Cloud Armor) y callers internos del
  # proyecto (Cloud Scheduler /admin/jobs, whatsapp-bot→api). Cierra el
  # bypass directo del *.run.app que hacía forjable el XFF (review ola 2).
  # `public=true` se mantiene: el GCLB reenvía tráfico anónimo (preflight
  # CORS, browsers) y el ingress es la barrera de RED, complementaria al IAM.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  secret_versions_ready = local.all_secret_versions_ready

  # T13 SEC-001 Sprint 2b (SC-1.2.3 + ADR-052) — Cloud Build canary deploy
  # gestiona traffic split entre revisiones (deploy-canary --no-traffic +
  # route-canary --to-tags + canary-verify + deploy-api --to-latest). Sin
  # este flag, `terraform apply` revierte el split y mata el canary mid-30min.
  # Scope: solo `service_api`; los otros 8 services siguen con traffic
  # gestionado por Terraform (default false).
  traffic_managed_externally = true

  labels = { app = "api", env = var.environment }
}

# --- apps/web (PWA) ---
module "service_web" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-web"
  service_account_email = google_service_account.cloud_run_runtime.email

  # ADR-034: tráfico real ~100 req/día (~0.001 RPS). Cold start 5-10s tolerable
  # para landing pública. Si el tráfico crece 10× → volver a min=1.
  min_instances = 0
  max_instances = 10
  memory        = "512Mi"

  env_vars = {
    NODE_ENV = "production"
  }

  # PWA estática servida con nginx — debe ser pública para que cualquier
  # browser anónimo pueda cargar el bundle. La auth la maneja Firebase a
  # nivel cliente (las VITE_FIREBASE_* viajan en el bundle por diseño).
  # El override de org policy en org-policies.tf permite allUsers a nivel
  # proyecto, así que la binding está autorizada.
  public = true

  # ADR-062: servida 100% vía GCLB (app/demo/marketing domain). Sin callers
  # directos al run.app → canary seguro del posture internal-and-cloud-LB.
  ingress = "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "web", env = var.environment }
}

# NOTA: `module "service_marketing"` (Cloud Run booster-ai-marketing) fue
# eliminado en 2026-05-13. Era un placeholder (imagen `gcr.io/cloudrun/
# placeholder`) sin código fuente real ni IAM policy, conectado al LB via
# backend `backend-booster-ai-marketing` y NEG marketing — tampoco recibía
# tráfico porque DNS apex/www no apuntaban al LB. Auditoría de dominios
# confirmó código IaC muerto.
#
# Reemplazo: apex/www ahora apuntan al LB y el url_map hace redirect 301
# a app.boosterchile.com (ver path_matcher "marketing" en networking.tf).
# Cuando exista proyecto marketing real, recrear el módulo + backend.

# --- apps/matching-engine ---
module "service_matching_engine" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-matching-engine"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 0
  max_instances = 10

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-matching-engine"
    REDIS_HOST   = google_redis_instance.main.host
    REDIS_PORT   = tostring(google_redis_instance.main.port)
  })
  secrets = local.common_secrets

  vpc_connector = google_vpc_access_connector.serverless.id

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "matching-engine", env = var.environment }
}

# --- apps/telemetry-processor (Pub/Sub PULL consumer / StreamingPull) ---
module "service_telemetry_processor" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-telemetry-processor"
  service_account_email = google_service_account.cloud_run_runtime.email

  # Pub/Sub PULL consumer (StreamingPull dentro del container:
  # apps/telemetry-processor/src/main.ts → `subscription.on('message')`). NO es push:
  # las subscriptions `telemetry-events-processor-sub` y `crash-traces-processor-sub`
  # no tienen pushConfig.
  #
  # ⚠️ min_instances=1 + cpu_idle=false son OBLIGATORIOS, no optimización: el loop de
  # pull NO es request-driven, así que con min=0 la instancia escala a cero (nadie
  # consume) y con cpu_idle=true queda CPU-throttled entre requests (el pull se starvea).
  # Causa del incidente 2026-06-07 (telemetría caída ~26h con la config previa min=0 +
  # "push consumer"). La recurrencia ahora la detecta `telemetry_consumer_stalled_p1`
  # (telemetry-monitoring.tf) en ~35min. Coincide con el fix de runtime (revisión 00312).
  min_instances = 1
  max_instances = 50
  cpu_idle      = false
  cpu           = "2"
  memory        = "1Gi"
  concurrency   = 10 # control de rate a Firestore/BigQuery

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-telemetry-processor"
    REDIS_HOST   = google_redis_instance.main.host
    REDIS_PORT   = tostring(google_redis_instance.main.port)
    # Wave 2 B3 — crash trace persistence
    GCS_CRASH_TRACES_BUCKET          = google_storage_bucket.crash_traces.name
    BIGQUERY_CRASH_DATASET           = google_bigquery_dataset.telemetry.dataset_id
    BIGQUERY_CRASH_TABLE             = google_bigquery_table.crash_events.table_id
    PUBSUB_SUBSCRIPTION_CRASH_TRACES = google_pubsub_subscription.crash_traces_processor.name
  })
  secrets = local.common_secrets

  vpc_connector = google_vpc_access_connector.serverless.id

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "telemetry-processor", env = var.environment }
}

# --- apps/notification-service ---
module "service_notification" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-notification-service"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 0
  max_instances = 20

  # Notification-service es stub hasta que tenga implementación. NO monta
  # secrets de Meta WhatsApp Cloud API (deprecated post-Fase 6.4 — el envío
  # de mensajes WA va via Twilio en el bot). Cuando se implemente, montar los
  # secrets que realmente use (probablemente Twilio + email/SMS providers).
  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-notification-service"
  })

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "notification-service", env = var.environment }
}

# --- apps/sms-fallback-gateway (Wave 2 Track B4) ---
# Webhook receiver de Twilio para SMS fallback cuando el FMC150 no
# tiene GPRS y manda evento Panic via SMS.
module "service_sms_fallback_gateway" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-sms-fallback-gateway"
  service_account_email = google_service_account.cloud_run_runtime.email

  # Cold-start OK — los webhooks de Twilio toleran ~5s de latency.
  # min_instances=0 reduce costo en periodos sin SMS (idealmente 99%
  # del tiempo).
  min_instances = 0
  max_instances = 10
  cpu           = "1"
  memory        = "512Mi"

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME           = "booster-ai-sms-fallback-gateway"
    PUBSUB_TOPIC_TELEMETRY = google_pubsub_topic.telemetry_events.name
    # WEBHOOK_PUBLIC_URL: la URL canónica que Twilio tiene configurada
    # en su Console. El validator HMAC la usa como string base.
    # Cuando el LB enrute /webhooks/sms-fallback, cambiar a la URL
    # pública. Por ahora queda como variable.
    WEBHOOK_PUBLIC_URL = var.sms_fallback_webhook_url
  })

  secrets = merge(local.common_secrets, {
    # Mismo Twilio account que usa el bot — un solo set de credenciales.
    TWILIO_AUTH_TOKEN = google_secret_manager_secret.secrets["twilio-auth-token"].secret_id
  })

  # public=true porque Twilio postea desde su infra al webhook. La
  # firma HMAC es la barrera de seguridad (no IAM/OIDC).
  public = true

  # ADR-062: SE MANTIENE en ALL a propósito (NO endurecer). Twilio postea
  # directo a su URL *.run.app y este servicio NO tiene NEG en el GCLB —
  # restringir el ingress rompería la ingesta de SMS de respaldo. Decisión
  # explícita, no omisión. Endurecer requiere primero frontear con GCLB.
  ingress = "INGRESS_TRAFFIC_ALL"

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "sms-fallback-gateway", env = var.environment, wave = "2" }
}

# --- apps/whatsapp-bot ---
module "service_whatsapp_bot" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-whatsapp-bot"
  service_account_email = google_service_account.cloud_run_runtime.email

  # ADR-034: tráfico real ~19 req/día. Twilio (no Meta — la migración cambió de
  # proveedor) reintenta el webhook con backoff exponencial 3× si responde >15s,
  # por lo que cold starts de 5-10s no pierden mensajes. Cuando volumen supere
  # ~1 msg/min sostenidos, volver a min=1.
  min_instances = 0
  max_instances = 20

  # Fase 6.4 — bot migró a Twilio API (el número +1 938-336-5293 está en Twilio).
  # TWILIO_ACCOUNT_SID y TWILIO_FROM_NUMBER son env vars; TWILIO_AUTH_TOKEN
  # va por Secret Manager.
  #
  # TWILIO_WEBHOOK_URL debe coincidir EXACTAMENTE con la URL configurada en
  # Twilio console (porque Twilio firma con la URL). Post-migración DNS, la
  # URL canónica es https://api.boosterchile.com/webhooks/whatsapp — el LB
  # global rutea ese path al bot (ver url_map.path_matcher "api" en
  # networking.tf).
  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME = "booster-ai-whatsapp-bot"
    # bot → api vía el LB público (api.boosterchile.com), NO el *.run.app.
    # Cambiado 2026-06-14 (ADR-062): el api pasa a ingress
    # INTERNAL_LOAD_BALANCER, por lo que su *.run.app deja de ser alcanzable
    # como service-to-service (el egress del bot es PRIVATE_RANGES_ONLY → el
    # run.app es IP pública → saldría a internet y el ingress interno lo
    # rechaza). El LB SÍ es un origen aceptado por internal-and-cloud-LB.
    # El motivo histórico de usar run.app (evitar el falso positivo de
    # scannerdetection del WAF) ya NO aplica: la regla ALLOW priority-390 de
    # Cloud Armor (networking.tf) bypassa el WAF para host==api.boosterchile.com.
    # El api valida ambos audiences (API_AUDIENCE, compute.tf:95). Trade-off:
    # un hop de LB (~ms) — aceptable por el endurecimiento de red del api.
    API_URL           = local.public_api_url
    API_OIDC_AUDIENCE = local.public_api_url
    # TWILIO_FROM_NUMBER: variable porque cambia entre sandbox y producción.
    # Sandbox compartido (+14155238886) hasta que +19383365293 esté
    # registrado como WhatsApp Sender via Meta business verification (runbook
    # docs/runbooks/twilio-sender-registration.md).
    TWILIO_FROM_NUMBER = var.twilio_from_number
    # TWILIO_WEBHOOK_URL debe matchear EXACTAMENTE la URL configurada en
    # Twilio Sender (Inbound URL) porque la firma X-Twilio-Signature se
    # computa sobre esta URL + sorted body params. Si no coincide → 403.
    # Post-migración: api.boosterchile.com (LB rutea /webhooks/whatsapp* al
    # backend del bot via url_map.path_matcher en networking.tf).
    TWILIO_WEBHOOK_URL = "${local.public_api_url}/webhooks/whatsapp"
  })

  secrets = {
    TWILIO_ACCOUNT_SID = google_secret_manager_secret.secrets["twilio-account-sid"].secret_id
    TWILIO_AUTH_TOKEN  = google_secret_manager_secret.secrets["twilio-auth-token"].secret_id
    # ADR-037: GEMINI_API_KEY eliminada. El bot WhatsApp no usa Gemini en
    # código — era binding huérfano.
  }

  # Necesario para llegar a Redis (172.25.0.4) que vive en VPC privado.
  # Sin esto, las conexiones a Memorystore Redis fallan con ETIMEDOUT.
  vpc_connector = google_vpc_access_connector.serverless.id

  public = true # webhook público — Twilio postea sin IAM; el bot valida X-Twilio-Signature

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "whatsapp-bot", env = var.environment }
}

# --- apps/document-service ---
module "service_document" {
  source = "./modules/cloud-run-service"

  project_id            = google_project.booster_ai.project_id
  region                = var.region
  service_name          = "booster-ai-document-service"
  service_account_email = google_service_account.cloud_run_runtime.email

  min_instances = 0
  max_instances = 10
  memory        = "1Gi" # OCR puede requerir más RAM

  env_vars = merge(local.common_env_vars, {
    SERVICE_NAME     = "booster-ai-document-service"
    DOCUMENTS_BUCKET = google_storage_bucket.documents.name
    UPLOADS_BUCKET   = google_storage_bucket.uploads_raw.name
    SIGNING_KEY_NAME = google_kms_crypto_key.document_signing.id
  })
  secrets = merge(local.common_secrets, {
    DTE_PROVIDER_API_KEY       = google_secret_manager_secret.secrets["dte-provider-api-key"].secret_id
    DTE_PROVIDER_CLIENT_SECRET = google_secret_manager_secret.secrets["dte-provider-client-secret"].secret_id
  })

  public = false

  secret_versions_ready = local.all_secret_versions_ready

  labels = { app = "document-service", env = var.environment }
}

# =============================================================================
# GKE AUTOPILOT — para telemetry-tcp-gateway (conexiones TCP persistentes)
# ADR-005: Cloud Run no sirve TCP, necesitamos K8s.
# =============================================================================

resource "google_container_cluster" "telemetry" {
  name     = "booster-ai-telemetry"
  project  = google_project.booster_ai.project_id
  location = var.region

  enable_autopilot    = true
  deletion_protection = true

  network    = google_compute_network.vpc.id
  subnetwork = google_compute_subnetwork.private.id

  ip_allocation_policy {
    cluster_secondary_range_name  = "gke-pods"
    services_secondary_range_name = "gke-services"
  }

  master_authorized_networks_config {
    # Subnet privada para nodos GKE (acceso interno).
    cidr_blocks {
      cidr_block   = "10.10.0.0/20"
      display_name = "booster-ai-private-subnet"
    }

    # Cloud Build private worker pool (Trivy IaC #17, AVD-GCP-0049).
    # Workers viven en este peering range (/24) y pueden hacer kubectl
    # set image al deploy del gateway desde cloudbuild.production.yaml.
    cidr_blocks {
      cidr_block   = "${google_compute_global_address.cloudbuild_pool_range.address}/${google_compute_global_address.cloudbuild_pool_range.prefix_length}"
      display_name = "cloudbuild-private-pool"
    }

    # IAP TCP forwarding range — operadores acceden via:
    #   gcloud compute start-iap-tunnel ... && kubectl ...
    # IAP CIDR 35.235.240.0/20 es publicado por Google y estable.
    # Ref: https://cloud.google.com/iap/docs/using-tcp-forwarding
    cidr_blocks {
      cidr_block   = "35.235.240.0/20"
      display_name = "iap-tcp-forwarding"
    }

    # IPs de operadores adicionales (laptops corp, oficina, VPN egress).
    # Default empty — populate via terraform.tfvars:
    #   gke_operator_authorized_cidrs = ["192.0.2.42/32", "203.0.113.0/24"]
    dynamic "cidr_blocks" {
      for_each = var.gke_operator_authorized_cidrs
      content {
        cidr_block   = cidr_blocks.value.cidr
        display_name = cidr_blocks.value.name
      }
    }
  }

  # DNS-based control plane endpoint (ADR-058 / CD del gateway). Habilita acceso
  # al master via DNS + IAM (sin depender de red/VPC peering, que es no-transitivo
  # entre el pool de Cloud Build y el master). Permite que el pool same-region y
  # operadores con container.developer corran kubectl. master_authorized_networks
  # (arriba) sigue protegiendo el endpoint IP; el DNS endpoint se gobierna por IAM.
  control_plane_endpoints_config {
    dns_endpoint_config {
      allow_external_traffic = true
    }
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = "172.16.0.0/28"

    # Necesario para que Cloud Build private pool (peering distinto) y operadores
    # via IAP TCP puedan alcanzar el master interno (172.16.0.2) cross-region.
    # Sin esto, el VPC peering al master no propaga rutas a la peering del pool.
    # Ver PR #73 + post-apply manual gcloud update 2026-05-09.
    master_global_access_config {
      enabled = true
    }
  }

  release_channel {
    channel = "STABLE"
  }

  workload_identity_config {
    workload_pool = "${google_project.booster_ai.project_id}.svc.id.goog"
  }

  logging_config {
    enable_components = ["SYSTEM_COMPONENTS", "WORKLOADS"]
  }

  monitoring_config {
    enable_components = ["SYSTEM_COMPONENTS"]
    managed_prometheus {
      enabled = true
    }
  }

  resource_labels = {
    env        = var.environment
    managed_by = "terraform"
    purpose    = "telemetry-tcp-gateway"
  }

  depends_on = [google_project_service.apis]
}

# IP estática externa para el Network Load Balancer TCP de Teltonika
resource "google_compute_address" "telemetry_lb" {
  name    = "booster-telemetry-lb-ip"
  project = google_project.booster_ai.project_id
  region  = var.region

  description = "IP pública estática para el Network LB TCP del gateway Teltonika. Configurar esta IP en los dispositivos Teltonika."

  depends_on = [google_project_service.apis]
}
