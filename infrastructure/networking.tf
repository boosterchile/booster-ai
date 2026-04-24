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

resource "google_compute_managed_ssl_certificate" "main" {
  provider = google-beta
  project  = google_project.booster_ai.project_id
  name     = "booster-ai-managed-cert"

  managed {
    domains = [
      var.domain,
      "www.${var.domain}",
      "app.${var.domain}",
      "api.${var.domain}",
    ]
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

  # WhatsApp webhook path — puede ir en el api.* o subdominio dedicado si se prefiere
  # Por ahora via api.boosterchile.com/webhooks/whatsapp
  path_matcher {
    name            = "api"
    default_service = google_compute_backend_service.api.id
    path_rule {
      paths   = ["/webhooks/whatsapp", "/webhooks/whatsapp/*"]
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
# DNS RECORDS — apuntan a la IP global del LB
# =============================================================================

resource "google_dns_record_set" "apex" {
  name         = "${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

resource "google_dns_record_set" "www" {
  name         = "www.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

resource "google_dns_record_set" "app" {
  name         = "app.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

resource "google_dns_record_set" "api" {
  name         = "api.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

# Telemetry gateway — IP fija separada (TCP directo, no LB HTTPS)
resource "google_dns_record_set" "telemetry" {
  name         = "telemetry.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 300
  rrdatas      = [google_compute_address.telemetry_lb.address]
}

# SPF record para email outbound
resource "google_dns_record_set" "spf" {
  name         = "${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "TXT"
  ttl          = 3600
  rrdatas      = ["\"v=spf1 include:_spf.google.com ~all\""]
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
