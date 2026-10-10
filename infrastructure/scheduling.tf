# Cloud Scheduler jobs — crones internos disparados desde GCP (P3.d y futuros).
#
# Patrón:
#   - SA dedicado (chat-cron-invoker@) con permission roles/run.invoker SOLO
#     sobre el endpoint que ataca. Esto limita el blast radius si la creden
#     del scheduler se filtra (no podría invocar otros endpoints).
#   - Cloud Scheduler firma OIDC con audience = URL del endpoint y email del
#     SA del scheduler.
#   - El api valida claims.email == config.INTERNAL_CRON_CALLER_SA via
#     createAuthMiddleware. Sin este wire el endpoint /admin/jobs/* responde 401.

# -----------------------------------------------------------------------------
# Service Account dedicado para Cloud Scheduler crons internos
# -----------------------------------------------------------------------------
resource "google_service_account" "internal_cron_invoker" {
  account_id   = "internal-cron-invoker"
  display_name = "Internal Cron Scheduler Invoker"
  description  = "SA usado por Cloud Scheduler para invocar /admin/jobs/* en booster-ai-api con OIDC. Limitado a roles/run.invoker SOLO sobre booster-ai-api (no otros services). Ver P3.d."
  project      = google_project.booster_ai.project_id
  depends_on   = [google_project_service.apis]
}

# Permitir que este SA invoque booster-ai-api. Aunque el service está
# como public=true (allUsers run.invoker para CORS preflight), este
# binding explícito documenta la intención y sirve si en el futuro
# revertimos el public.
resource "google_cloud_run_v2_service_iam_member" "scheduler_invoker_api" {
  project  = google_project.booster_ai.project_id
  location = var.region
  name     = "booster-ai-api"
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.internal_cron_invoker.email}"
  depends_on = [
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# P3.d — Cloud Scheduler para fallback WhatsApp del chat
# -----------------------------------------------------------------------------
# Cada 1 minuto, POST /admin/jobs/chat-whatsapp-fallback. El handler
# query-ea mensajes de chat sin leer > 5 min sin notif WhatsApp enviada
# y manda template Twilio al dueño activo de la empresa contraria.
#
# Schedule: cada 1 min (* * * * *) — agresivo pero el handler skipea
# fast si no hay candidatos (1 SELECT corto).
#
# Retry: si el handler falla (5xx o timeout), Cloud Scheduler reintenta
# hasta 3 veces con backoff exponencial.
resource "google_cloud_scheduler_job" "chat_whatsapp_fallback" {
  name        = "chat-whatsapp-fallback"
  description = "Cada 1 min: manda WhatsApp template a destinatarios de mensajes de chat no leídos > 5 min."
  project     = google_project.booster_ai.project_id

  # Cloud Scheduler NO soporta southamerica-west1 (Santiago). La opción
  # LATAM más cercana es southamerica-east1 (São Paulo). Latencia esperada
  # entre regiones: ~30ms via fibra Google. Aceptable para un cron de
  # frecuencia 1 min — el job dispara una request HTTP al api en
  # southamerica-west1, cualquier overhead de cross-region es trivial
  # comparado con el procesamiento del job (query DB + sends Twilio).
  region    = "southamerica-east1"
  schedule  = "* * * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "10s"
    max_backoff_duration = "60s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/chat-whatsapp-fallback"
    # Body vacío — el handler no necesita input.
    body = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      # Audience = URL del Cloud Run (sin path) — Google la valida contra
      # claims.aud en el JWT. Tiene que ser exactamente la URL base.
      audience = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# ADR-029 v1 / ADR-032 — Cloud Scheduler para cobranza Cobra Hoy
# -----------------------------------------------------------------------------
# Tick diario a las 09:00 America/Santiago. El handler:
#   - SELECT adelantos `desembolsado` con fecha_vencimiento ≤ now().
#   - UPDATE → status='mora', mora_desde=now(), append notas_admin.
#
# Volumen esperado en steady state: <50 adelantos/día. Si crece, ajustar
# frecuencia a 2×/día o pasar a un UPDATE bulk en el service.
#
# Si FACTORING_V1_ACTIVATED=false (entornos no-prod por default), el
# handler responde 200 skipped:true sin tocar BD. Cloud Scheduler lo
# considera success y no reintenta.
resource "google_cloud_scheduler_job" "cobra_hoy_cobranza" {
  name        = "cobra-hoy-cobranza"
  description = "Tick diario 09:00 CLT: marca como `mora` los adelantos Cobra Hoy cuyo plazo del shipper venció y siguen `desembolsado`."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "0 9 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/cobra-hoy-cobranza"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# T6a SEC-001 Sprint 2a — Cloud Scheduler diario para TTL alerter
# -----------------------------------------------------------------------------
# Per spec sec-001-cierre §3 H1.1 SC-1.1.6 + plan-sprint-2a T6a.
# Daily 06:00 America/Santiago. El handler:
#   - SELECT firebase_uid FROM cuentas_demo WHERE deshabilitado_en IS NULL.
#   - getUser per UID + compute days_remaining.
#   - Emite structured log `demo.ttl_low` solo si days_remaining ≤ 7.
#   - Redis dedup key TTL 24h evita re-alert mismo día.
# Output log es consumido por google_logging_metric.demo_ttl_low (abajo
# en monitoring.tf).
resource "google_cloud_scheduler_job" "demo_account_ttl_alert" {
  name        = "demo-account-ttl-alert"
  description = "Daily 06:00 Santiago: scan cuentas demo activas + emit log `demo.ttl_low` si TTL <= 7 días. SEC-001 H1.1 SC-1.1.6."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "0 6 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/demo-account-ttl-alert"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# T9 SEC-001 boundary-closure — Cloud Scheduler diario para el reaper IdP
# -----------------------------------------------------------------------------
# Spec .specs/sec-001-h1-2-google-boundary-closure/spec.md SC-G5 + ADR-057.
# Daily 04:00 America/Santiago (off-peak). POST /admin/jobs/reap-inert-idp-accounts.
#
# **Arranca en DRY-RUN**: el handler corre con `REAPER_DESTRUCTIVE=false`
# (config server-side, default OFF) → solo loguea/cuenta lo que haría, NO muta.
# El modo destructivo se habilita seteando la env `REAPER_DESTRUCTIVE=true` en
# el Cloud Run del api (Terraform compute.tf) + redeploy, SOLO tras el gate de
# primer run destructivo (dry-run revisado + sign-off PO). El scheduler no
# controla el modo (una credencial filtrada no puede disparar mutaciones).
#
# Cadencia: diaria. El reaper es idempotente y skipea rápido cuando no hay
# candidatos (la población es self-signup Google sin solicitud, baja). El grace
# de 30 días + disable-before-delete + 2º grace hacen que correr diario sea
# seguro (nada se borra antes de 2 grace windows).
#
# Output: structured logs `reaper.account.*` + `reaper.run.summary`, consumidos
# por google_logging_metric.reaper_account_reaped (monitoring.tf).
resource "google_cloud_scheduler_job" "reap_inert_idp_accounts" {
  name        = "reap-inert-idp-accounts"
  description = "Daily 04:00 Santiago: reaper de cuentas IdP Google inertes (dry-run hasta gate destructivo). SEC-001 boundary-closure SC-G5 / ADR-057."
  project     = google_project.booster_ai.project_id

  # SHIP REVIEW (devils-advocate STRONG-1): arranca **PAUSADO**. Aunque el modo
  # es dry-run (no muta), un primer tick automático a las 04:00 sin supervisión
  # consume quota IdP (listUsers) + 2N queries sobre el pool compartido del api.
  # El PO corre el primer tick MANUAL y observado:
  #   gcloud scheduler jobs run reap-inert-idp-accounts --location=southamerica-east1
  # y recién tras revisar el `reaper.run.summary` lo despausa:
  #   gcloud scheduler jobs resume reap-inert-idp-accounts --location=southamerica-east1
  # (o set paused=false acá + apply). Dry-run y destructivo siguen gateados aparte
  # por REAPER_DESTRUCTIVE.
  paused = true

  region    = "southamerica-east1"
  schedule  = "0 4 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/reap-inert-idp-accounts"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# Gap B5 (ADR-030 §7 + ADR-031) — Cloud Scheduler MENSUAL para cobro de membresías
# -----------------------------------------------------------------------------
# Tick mensual el día 1 a las 08:00 America/Santiago. POST
# /admin/jobs/cobrar-memberships-mensual. El handler:
#   - Si PRICING_V2_ACTIVATED=false → 200 skipped:true sin tocar BD.
#   - SELECT memberships activas en tier pagado (Standard/Pro/Premium).
#   - Crea la factura del periodo (idempotente vía unique parcial empresa+mes) +
#     invoca el MembershipPaymentGateway, y aplica el dunning (≤3 reintentos).
#
# ⚠️ EL RAIL DE PAGO ESTÁ STUBEADO. El gateway default no-op NO mueve dinero:
# deja las facturas en `pending_payment_provider`. Mientras siga stubeado, este
# cron es de bajo riesgo (solo materializa facturas devengadas + dunning), pero
# arranca **PAUSADO** por ser un cron financiero: el PO corre el primer tick
# MANUAL y observado antes de despausar:
#   gcloud scheduler jobs run cobrar-memberships-mensual --location=southamerica-east1
#   gcloud scheduler jobs resume cobrar-memberships-mensual --location=southamerica-east1
# (o set paused=false acá + apply). Cuando exista `payment-provider` real,
# inyectar el gateway real en server.ts antes de despausar.
#
# Cadencia mensual: como un tick procesa todo el backlog del periodo y reintenta
# el dunning de facturas pendientes, también puede correrse más seguido (ej.
# diario) si se quieren reintentos más densos. Mensual cubre el caso base de
# emitir la cuota del mes.
resource "google_cloud_scheduler_job" "cobrar_memberships_mensual" {
  # INERTE por decisión del PO (2026-07): con count=0 el cron NO se crea — el
  # bloque queda declarado como diseño, sin instancia en GCP. Activarlo
  # (var.cobro_mensual_activado = true) es una decisión de NEGOCIO del PO:
  # dispara el cobro mensual de membresías (movimiento de dinero real). NO se
  # toca la lógica interna (schedule/uri/payload/paused): solo su activación.
  count = var.cobro_mensual_activado ? 1 : 0

  name        = "cobrar-memberships-mensual"
  description = "Mensual día 1 08:00 Santiago: factura las cuotas de membresía de carriers en tier pagado + dunning. ⚠️ rail de pago STUBEADO (no mueve dinero). Gap B5 / ADR-030 §7 / ADR-031."
  project     = google_project.booster_ai.project_id

  # Arranca PAUSADO (cron financiero): primer tick manual + observado por el PO.
  paused = true

  region    = "southamerica-east1"
  schedule  = "0 8 1 * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/cobrar-memberships-mensual"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}

# -----------------------------------------------------------------------------
# W1.5 (runbook activación onboarding) — Cloud Scheduler diario para el
# reaper del usuario Firebase huérfano del onboarding admin-provisioned
# -----------------------------------------------------------------------------
# Spec .specs/onboarding-flow-redesign/spec.md §9 (riesgo huérfano) + plan T1.7.
# Daily 04:45 America/Santiago. POST /admin/jobs/reap-orphan-onboarding-firebase.
#
# Offset elegido: el bloque off-peak 04:00-04:30 ya tiene 2 jobs
# (`reap_inert_idp_accounts` @ 04:00, `purgar_posiciones_movil` @ 04:30) —
# 04:45 mantiene 15 min de separación de ambos vecinos para no competir por
# el pool de conexiones compartido del api.
#
# **Arranca en DRY-RUN + PAUSADO** (mismo gate que `reap_inert_idp_accounts`):
# el handler corre con `ONBOARDING_ORPHAN_REAPER_DESTRUCTIVE=false` (config
# server-side, default OFF) → solo loguea/cuenta lo que haría, NO borra
# usuarios Firebase ni marca filas. El modo destructivo se habilita seteando
# la env en el Cloud Run del api (Terraform compute.tf) + redeploy — hoy esa
# env NO está cableada ahí a propósito (mismo patrón que REAPER_DESTRUCTIVE):
# el flip es un apply dedicado posterior, no parte de este PR.
#
# Este job reemplaza el trigger MANUAL (`tsx
# apps/api/src/jobs/reap-orphan-onboarding-firebase.ts`) que era la única
# forma de correrlo hasta ahora — el riesgo "huérfano Firebase" del spec §9
# queda mitigado automáticamente una vez el PO corre el primer tick manual y
# despausa (ver runbook docs/corfo/hito-2/runbook-activacion-onboarding.md).
resource "google_cloud_scheduler_job" "reap_orphan_onboarding_firebase" {
  name        = "reap-orphan-onboarding-firebase"
  description = "Daily 04:45 Santiago: reaper del usuario Firebase huérfano del onboarding admin-provisioned (dry-run hasta gate destructivo). onboarding-flow-redesign T1.7."
  project     = google_project.booster_ai.project_id

  # SHIP REVIEW pattern (mismo criterio que reap_inert_idp_accounts): arranca
  # PAUSADO. El PO corre el primer tick MANUAL y observado:
  #   gcloud scheduler jobs run reap-orphan-onboarding-firebase --location=southamerica-east1
  # y recién tras revisar el summary lo despausa:
  #   gcloud scheduler jobs resume reap-orphan-onboarding-firebase --location=southamerica-east1
  paused = true

  region    = "southamerica-east1"
  schedule  = "45 4 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 3
    min_backoff_duration = "60s"
    max_backoff_duration = "300s"
    max_doublings        = 2
  }

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/reap-orphan-onboarding-firebase"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }

  depends_on = [
    google_project_service.apis,
    module.service_api,
  ]
}

# Purga diaria de posiciones GPS de browser (retención 30d, preservando la
# última posición por vehículo — spec feat-retencion-posiciones-movil).
# La tabla crecía sin límite (auditoría 2026-06-09, seguimiento BD).
resource "google_cloud_scheduler_job" "purgar_posiciones_movil" {
  name        = "purgar-posiciones-movil"
  description = "Daily: retención 30d de posiciones_movil_conductor (preserva última por vehículo)."
  project     = google_project.booster_ai.project_id

  region    = "southamerica-east1"
  schedule  = "30 4 * * *"
  time_zone = "America/Santiago"

  retry_config {
    retry_count          = 2
    min_backoff_duration = "120s"
    max_backoff_duration = "600s"
    max_doublings        = 1
  }

  depends_on = [google_project_service.apis, module.service_api]

  http_target {
    http_method = "POST"
    uri         = "${local.cloud_run_api_url}/admin/jobs/purgar-posiciones-movil"
    body        = base64encode("{}")
    headers = {
      "Content-Type" = "application/json"
    }

    oidc_token {
      service_account_email = google_service_account.internal_cron_invoker.email
      audience              = local.cloud_run_api_url
    }
  }
}
