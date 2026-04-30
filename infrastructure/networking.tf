# Networking — Cloud DNS + Global External HTTPS Load Balancer + Serverless NEGs + Cloud Armor
#
# Por qué no `google_cloud_run_domain_mapping`:
#  - La API legacy no está disponible en southamerica-west1.
#  - La arquitectura recomendada TRL 10 para producción comercial es LB global con NEGs serverless.
#  - Beneficios: Cloud Armor WAF, CDN opcional, rate limiting, logging unificado, health checks,
#    y resuelve el constraint org policy que bloquea `allUsers` en Cloud Run directo.
#
# Referencia: https://cloud.google.com/load-balancing/docs/https/setting-up-https-serverless

# =============================================================================
# CLOUD DNS — zona para boosterchile.com
# =============================================================================

resource "google_dns_managed_zone" "main" {
  name        = "booster-ai-zone"
  project     = google_project.booster_ai.project_id
  dns_name    = "${var.domain}."
  description = "Zona DNS de Booster AI — ${var.domain}"
  visibility  = "public"

  dnssec_config {
    state = "on"
  }

  labels = {
    env        = var.environment
    managed_by = "terraform"
  }

  depends_on = [google_project_service.apis]
}

# =============================================================================
# GLOBAL IP — IP estática para el Load Balancer público
# =============================================================================

resource "google_compute_global_address" "lb_ipv4" {
  name         = "booster-ai-lb-ipv4"
  project      = google_project.booster_ai.project_id
  address_type = "EXTERNAL"
  ip_version   = "IPV4"

  depends_on = [google_project_service.apis]
}

# =============================================================================
# MANAGED SSL CERTIFICATE — Google-managed para todos los dominios del producto
# =============================================================================

# Cert managed con nombre dinámico para soportar rotación de dominios sin
# downtime. Cambiar `domains` regenera `random_id.cert_suffix` (gracias al
# `keepers`), lo que produce un nombre nuevo de cert. Combinado con
# `create_before_destroy`, terraform crea el cert nuevo, repunta el
# `target_https_proxy.main`, y solo después destruye el viejo. Sin esto, el
# destroy del cert falla con `resourceInUseByAnotherResource`.
resource "random_id" "cert_suffix" {
  byte_length = 4
  keepers = {
    domains = "api.${var.domain}"
  }
}

resource "google_compute_managed_ssl_certificate" "main" {
  provider = google-beta
  project  = google_project.booster_ai.project_id
  name     = "booster-ai-cert-${random_id.cert_suffix.hex}"

  managed {
    # Solo los dominios que apuntan al LB de Booster AI.
    # apex/www/app/demo viven en Booster 2.0 (AWS GA, ghs, Firebase) y no
    # se sirven desde este LB → no incluir aquí o el cert managed queda en
    # FAILED_NOT_VISIBLE para esos dominios.
    domains = [
      "api.${var.domain}",
    ]
  }

  lifecycle {
    create_before_destroy = true
  }

  depends_on = [google_project_service.apis]
}

# =============================================================================
# SERVERLESS NEGs — un NEG por cada Cloud Run service expuesto públicamente
# =============================================================================

resource "google_compute_region_network_endpoint_group" "api" {
  name                  = "neg-booster-ai-api"
  project               = google_project.booster_ai.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = module.service_api.name
  }
}

resource "google_compute_region_network_endpoint_group" "web" {
  name                  = "neg-booster-ai-web"
  project               = google_project.booster_ai.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = module.service_web.name
  }
}

resource "google_compute_region_network_endpoint_group" "marketing" {
  name                  = "neg-booster-ai-marketing"
  project               = google_project.booster_ai.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = module.service_marketing.name
  }
}

resource "google_compute_region_network_endpoint_group" "whatsapp_bot" {
  name                  = "neg-booster-ai-whatsapp-bot"
  project               = google_project.booster_ai.project_id
  region                = var.region
  network_endpoint_type = "SERVERLESS"

  cloud_run {
    service = module.service_whatsapp_bot.name
  }
}

# =============================================================================
# CLOUD ARMOR — WAF policy baseline (rate limiting + OWASP preset)
# =============================================================================

resource "google_compute_security_policy" "waf" {
  name        = "booster-ai-waf"
  project     = google_project.booster_ai.project_id
  description = "WAF policy para el LB público — OWASP preset + rate limiting"

  # Default rule: permitir
  rule {
    action   = "allow"
    priority = "2147483647"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    description = "default allow"
  }

  # Rate limiting: máximo 1000 req/min por IP
  rule {
    action   = "rate_based_ban"
    priority = "1000"
    match {
      versioned_expr = "SRC_IPS_V1"
      config {
        src_ip_ranges = ["*"]
      }
    }
    rate_limit_options {
      conform_action = "allow"
      exceed_action  = "deny(429)"
      enforce_on_key = "IP"
      rate_limit_threshold {
        count        = 1000
        interval_sec = 60
      }
      ban_duration_sec = 600
    }
    description = "rate limit 1000 req/min por IP, ban 10 min"
  }

  # Allow webhooks externos (Twilio, etc.) — prioridad MÁS ALTA que OWASP.
  # En Cloud Armor evalúa de menor priority a mayor; 400 < 500, así que esta
  # regla ALLOW corre antes que el OWASP deny.
  #
  # Por qué se necesita: el rule `scannerdetection-v33-stable` falsea positivo
  # con cuerpos de webhook Twilio (form-encoded con MessageSid hex, números E.164,
  # AccountSid). Resultado observado: Twilio recibe 403 del WAF antes de que el
  # bot pueda validar la firma X-Twilio-Signature.
  #
  # Defensa restante: la firma HMAC del webhook (verifyTwilioSignature en
  # apps/whatsapp-bot/src/routes/webhook.ts) valida que el request realmente
  # vino de Twilio + el body no fue alterado. Si la firma falla → 403 desde el
  # bot. Sin firma válida ningún caller puede inyectar tráfico pretendiendo ser
  # Twilio.
  rule {
    action   = "allow"
    priority = "400"
    match {
      expr {
        expression = "request.path.startsWith('/webhooks/')"
      }
    }
    description = "Allow /webhooks/* — bypass OWASP scanner detection (Twilio etc.)"
  }

  # OWASP preset — XSS, SQLi, RCE, LFI, scanner detection
  rule {
    action   = "deny(403)"
    priority = "500"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable') || evaluatePreconfiguredExpr('sqli-v33-stable') || evaluatePreconfiguredExpr('rce-v33-stable') || evaluatePreconfiguredExpr('lfi-v33-stable') || evaluatePreconfiguredExpr('scannerdetection-v33-stable')"
      }
    }
    description = "OWASP Top 10 preset deny"
  }

  adaptive_protection_config {
    layer_7_ddos_defense_config {
      enable          = true
      rule_visibility = "STANDARD"
    }
  }
}

# =============================================================================
# BACKEND SERVICES — uno por Cloud Run service, apuntando a su NEG
# =============================================================================

resource "google_compute_backend_service" "api" {
  name                  = "backend-booster-ai-api"
  project               = google_project.booster_ai.project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.waf.id

  backend {
    group = google_compute_region_network_endpoint_group.api.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_backend_service" "web" {
  name                  = "backend-booster-ai-web"
  project               = google_project.booster_ai.project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.waf.id

  backend {
    group = google_compute_region_network_endpoint_group.web.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_backend_service" "marketing" {
  name                  = "backend-booster-ai-marketing"
  project               = google_project.booster_ai.project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.waf.id

  # CDN habilitado para marketing site (SEO + performance)
  enable_cdn = true
  cdn_policy {
    cache_mode                   = "CACHE_ALL_STATIC"
    default_ttl                  = 3600
    client_ttl                   = 3600
    max_ttl                      = 86400
    negative_caching             = true
    serve_while_stale            = 86400
    signed_url_cache_max_age_sec = 0
  }

  backend {
    group = google_compute_region_network_endpoint_group.marketing.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

resource "google_compute_backend_service" "whatsapp_bot" {
  name                  = "backend-booster-ai-whatsapp-bot"
  project               = google_project.booster_ai.project_id
  protocol              = "HTTPS"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  security_policy       = google_compute_security_policy.waf.id

  backend {
    group = google_compute_region_network_endpoint_group.whatsapp_bot.id
  }

  log_config {
    enable      = true
    sample_rate = 1.0
  }
}

# =============================================================================
# URL MAP — rutea por host al backend service correcto
# =============================================================================

resource "google_compute_url_map" "main" {
  name            = "booster-ai-url-map"
  project         = google_project.booster_ai.project_id
  default_service = google_compute_backend_service.marketing.id # apex + www → marketing

  host_rule {
    hosts        = ["api.${var.domain}"]
    path_matcher = "api"
  }
  host_rule {
    hosts        = ["app.${var.domain}"]
    path_matcher = "app"
  }
  host_rule {
    hosts        = ["${var.domain}", "www.${var.domain}"]
    path_matcher = "marketing"
  }

  # Webhook paths del bot (Twilio inbound + status callback) — todos los
  # paths /webhooks/* se rutean al backend del whatsapp-bot, no al api default.
  # El api se accede directo via *.run.app desde el bot (no por LB).
  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.api.id
    path_rule {
      paths = [
        "/webhooks/whatsapp",
        "/webhooks/whatsapp/*",
        "/webhooks/twilio-status",
        "/webhooks/twilio-status/*",
      ]
      service = google_compute_backend_service.whatsapp_bot.id
    }
  }

  path_matcher {
    name            = "app"
    default_service = google_compute_backend_service.web.id
  }

  path_matcher {
    name            = "marketing"
    default_service = google_compute_backend_service.marketing.id
  }
}

# =============================================================================
# HTTPS PROXY + FORWARDING RULE
# =============================================================================

resource "google_compute_target_https_proxy" "main" {
  name             = "booster-ai-https-proxy"
  project          = google_project.booster_ai.project_id
  url_map          = google_compute_url_map.main.id
  ssl_certificates = [google_compute_managed_ssl_certificate.main.id]
}

resource "google_compute_global_forwarding_rule" "https" {
  name                  = "booster-ai-https-fwd"
  project               = google_project.booster_ai.project_id
  ip_address            = google_compute_global_address.lb_ipv4.address
  ip_protocol           = "TCP"
  port_range            = "443"
  target                = google_compute_target_https_proxy.main.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# HTTP → HTTPS redirect (80 → 443)
resource "google_compute_url_map" "http_redirect" {
  name    = "booster-ai-http-redirect"
  project = google_project.booster_ai.project_id

  default_url_redirect {
    redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
    https_redirect         = true
    strip_query            = false
  }
}

resource "google_compute_target_http_proxy" "redirect" {
  name    = "booster-ai-http-proxy-redirect"
  project = google_project.booster_ai.project_id
  url_map = google_compute_url_map.http_redirect.id
}

resource "google_compute_global_forwarding_rule" "http_redirect" {
  name                  = "booster-ai-http-fwd-redirect"
  project               = google_project.booster_ai.project_id
  ip_address            = google_compute_global_address.lb_ipv4.address
  ip_protocol           = "TCP"
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect.id
  load_balancing_scheme = "EXTERNAL_MANAGED"
}

# =============================================================================
# DNS RECORDS
# =============================================================================
#
# `boosterchile.com` es zona compartida entre Booster 2.0 (legacy) y Booster AI.
# Decisión post-migración (runbook docs/runbooks/dns-migration-godaddy-to-cloud-dns.md):
#
#   apex / www / app / demo  → Booster 2.0 (preservar destinos actuales).
#   api / telemetry          → Booster AI (LB global + telemetry gateway).
#   marketing (futuro)        → Booster AI (cuando exista el sitio).
#   MX, SPF, DKIM, DMARC, verifications → email Workspace.
#
# TTL en 3600s (1h) — valor de producción. Durante la migración (Fase 5 del
# runbook) estuvo en 300s para permitir rollback rápido; tras validar E2E
# (BOO-M6LO3H + email entrante post-corte ok) se subió al valor estable.
# Si una emergencia exige cambio rápido, bajar a 300s vía Terraform apply +
# esperar TTL viejo + cambiar destino + re-subir a 3600.
#
# DKIM (`google._domainkey`) está PENDIENTE de confirmación. El selector
# "google" actual no devuelve nada en GoDaddy → o bien DKIM no está
# configurado en Workspace, o el selector tiene otro nombre. Ver runbook
# Fase 1/5: confirmar en admin.google.com → Apps → Gmail → Authenticate
# email antes del corte de NS.

# === Booster 2.0 — preservar destinos legacy ===
# Apex apunta a las IPs de AWS Global Accelerator (Booster 2.0 landing).
resource "google_dns_record_set" "apex" {
  name         = "${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas = [
    "13.248.243.5",
    "76.223.105.230",
  ]
}

# www → Google Sites (Booster 2.0)
resource "google_dns_record_set" "www" {
  name         = "www.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "CNAME"
  ttl          = 3600
  rrdatas      = ["ghs.googlehosted.com."]
}

# app → Firebase Hosting (Booster 2.0 webapp legacy)
resource "google_dns_record_set" "app" {
  name         = "app.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "CNAME"
  ttl          = 3600
  rrdatas      = ["big-cabinet-482101-s3.web.app."]
}

# demo → Google Sites (Booster 2.0 demo site)
resource "google_dns_record_set" "demo" {
  name         = "demo.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "CNAME"
  ttl          = 3600
  rrdatas      = ["ghs.googlehosted.com."]
}

# === Booster AI ===
resource "google_dns_record_set" "api" {
  name         = "api.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

# Telemetry gateway — IP fija separada (TCP directo, no LB HTTPS)
resource "google_dns_record_set" "telemetry" {
  name         = "telemetry.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas      = [google_compute_address.telemetry_lb.address]
}

# === Email — Google Workspace ===
# MX records — prioridades exactas de Workspace.
resource "google_dns_record_set" "mx" {
  name         = "${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "MX"
  ttl          = 3600
  rrdatas = [
    "1 aspmx.l.google.com.",
    "5 alt1.aspmx.l.google.com.",
    "5 alt2.aspmx.l.google.com.",
    "10 alt3.aspmx.l.google.com.",
    "10 alt4.aspmx.l.google.com.",
  ]
}

# Apex TXT — Cloud DNS no permite múltiples TXT records con el mismo name;
# hay que agruparlos en un único record con varias strings. Combina:
#   - SPF (autorización de envío saliente para email Workspace).
#   - google-site-verification (ownership de Search Console / Workspace).
#   - google-gws-recovery (recovery del dominio en caso de pérdida de admin).
resource "google_dns_record_set" "apex_txt" {
  name         = "${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "TXT"
  ttl          = 3600
  rrdatas = [
    "\"v=spf1 include:_spf.google.com ~all\"",
    "\"google-site-verification=Aljua0U_VGag3O-odYXPN-PXlASoPNFAHOb8EHgCvec\"",
    "\"google-gws-recovery-domain-verification=65980720\"",
  ]
}

# DMARC — política actual del dominio (heredada de GoDaddy).
resource "google_dns_record_set" "dmarc" {
  name         = "_dmarc.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "TXT"
  ttl          = 3600
  rrdatas      = ["\"v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;\""]
}

# DKIM `google._domainkey` — public key de Workspace para firma DKIM saliente.
#
# Generado por Workspace (admin.google.com → Apps → Gmail → Authenticate
# email) con selector "google", 2048-bit RSA. NO es secret — DKIM es
# públicamente legible por diseño (los receptores lo leen vía DNS para
# validar firmas en mails entrantes desde @boosterchile.com).
#
# El valor de 410 chars excede el límite de 255 char-string del protocolo
# DNS para TXT records. Se split en 2 chunks de "..." dentro del rrdata —
# Cloud DNS y los resolvers concatenan automáticamente al servir.
#
# IMPORTANTE: este record también debe estar publicado en GoDaddy ANTES
# del corte de NS (para que Workspace pueda verificar y activar el firmado
# DKIM contra el authoritative actual). Después del corte, Cloud DNS sirve
# el mismo record sin interrupción del firmado.
resource "google_dns_record_set" "dkim_google" {
  name         = "google._domainkey.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "TXT"
  ttl          = 3600
  rrdatas = [
    "\"v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmy6sJ27VCnUj9VTQq9ESBGtCGWQ2egzNYJngC1Mnk8lAeZCmGLfmyNBx2auiQliHfpKa5ZTnjtjP11hRkCCzGhgVoae9LiZ+PKNNNijsSirUJI199f8Zrue3wV3m85lGJtKrICpkEAZxBaDGkj114CEn6GvYkABGdYyXfilSZsz9ULSuidTWtEzrTACGd23EC\" \"CdInOrQ6Gwxk10Z58TDfcs3I43a6B2EMWGnSsPyShDlT85OOOnzcIQuN4BFP0qzZ+4VrM0zl+GsBv3OykPQ0YSVcMRbR/WwPhBLepMh5VZ7gac55BruaxYQFxRIDOyhrPbVJN3ZN7jqRKlwkmDLIQIDAQAB\"",
  ]
}

# =============================================================================
# PERMITIR QUE EL LB INVOQUE LOS CLOUD RUN (replacement de "allUsers")
# =============================================================================
#
# Los Cloud Run services están con public=false (no allUsers). El tráfico entra
# por el LB, que usa la SA del Google Frontend (SA managed de Google).
# No se requiere IAM binding explícito: con un backend service HTTPS serverless,
# el LB invoca el Cloud Run con su propia identidad interna.
#
# IMPORTANTE: este patrón solo funciona si NO hay Ingress del Cloud Run restringido.
# Por defecto Cloud Run acepta "internal-and-cloud-load-balancing" que permite LB invocation
# sin allUsers. Si alguien cambia ingress a "internal" puro, el LB no puede entrar.
