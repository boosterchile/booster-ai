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

# Single source of truth de los dominios del cert. Si cambia, el
# `random_id.cert_suffix` se regenera (vía keepers) y se crea un cert
# nuevo con nombre distinto, evitando colisión con el viejo.
locals {
  cert_domains = [
    "api.${var.domain}",
    "app.${var.domain}",
    "demo.${var.domain}",
    var.domain,           # apex (boosterchile.com) — landing comercial (redirect a app)
    "www.${var.domain}",  # www  → redirect a app
  ]
}

# Cert managed con nombre dinámico para soportar rotación de dominios sin
# downtime. Cambiar `local.cert_domains` regenera `random_id.cert_suffix`
# (gracias al `keepers`), lo que produce un nombre nuevo de cert. Combinado
# con `create_before_destroy`, terraform crea el cert nuevo, repunta el
# `target_https_proxy.main`, y solo después destruye el viejo. Sin esto, el
# destroy del cert falla con `resourceInUseByAnotherResource`.
resource "random_id" "cert_suffix" {
  byte_length = 4
  keepers = {
    domains = join(",", local.cert_domains)
  }
}

resource "google_compute_managed_ssl_certificate" "main" {
  provider = google-beta
  project  = google_project.booster_ai.project_id
  name     = "booster-ai-cert-${random_id.cert_suffix.hex}"

  managed {
    # Dominios que apuntan al LB de Booster AI. Cada nuevo dominio que se
    # agregue tiene que tener el A record en Cloud DNS apuntando al LB
    # ANTES de incluirlo acá (en local.cert_domains arriba), sino el cert
    # queda en FAILED_NOT_VISIBLE (lección de task #34).
    #
    # apex/www siguen en Booster 2.0 (AWS GA, Google Sites) y no se sirven
    # desde este LB. demo se migró al LB en 2026-05-13 (modo demo PWA).
    domains = local.cert_domains
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

  # Allow mutaciones autenticadas al api — el cuerpo de POST/PUT/PATCH al api
  # contiene datos chilenos legítimos (RUTs con guión "12345678-9", direcciones)
  # que disparan falsos positivos en OWASP CRS rules de SQLi:
  #   - id942200: detecta `or 1=1` y patterns similares
  #   - id942432: detecta sequence de chars que parecen SQL comments (--)
  # El "-9" final del RUT cae como SQL comment.
  #
  # Defensa restante (no perdida):
  #   1. Firebase Auth middleware valida Bearer token de Firebase ID
  #      (apps/api/src/middleware/firebase-auth.ts) ANTES de cualquier handler.
  #   2. Zod schema valida cada field del body — rechaza shapes inválidos.
  #   3. Drizzle ORM usa parameterized queries — SQL injection no es factible.
  #   4. CORS limita orígenes a app.boosterchile.com + URLs internas.
  #
  # GETs al api siguen evaluándose por OWASP (no llevan body, falso positivo
  # en query string es raro).
  rule {
    action   = "allow"
    priority = "390"
    match {
      expr {
        # Cloud Armor matcher language NO soporta .lower() — la expression
        # anterior silenciosamente nunca matcheó (rule existía pero false
        # siempre). Browsers mandan Host header en lowercase, y curl también,
        # entonces comparación exacta funciona en práctica.
        #
        # Bypass TOTAL para hostname api (todos los métodos). La defensa
        # real la hace el api a nivel app:
        #   1. Firebase Auth middleware valida Bearer token Firebase ID
        #      ANTES de cualquier handler.
        #   2. Zod schema valida cada field del body — rechaza shapes
        #      inválidos.
        #   3. Drizzle ORM usa parameterized queries — SQL injection no
        #      es factible.
        #   4. CORS limita orígenes a app.boosterchile.com + URLs internas.
        #
        # Trade-off: GETs al api también bypass WAF. Aceptable porque la
        # superficie de ataque GET sin auth es prácticamente nula
        # (middleware Firebase Auth rebota antes).
        expression = "request.headers['host'] == 'api.boosterchile.com'"
      }
    }
    description = "Allow api host — defensa via Firebase Auth + zod + Drizzle"
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
  #
  # Exclusiones SQLi (rules cookie/args-based con falsos positivos en JWTs):
  #   - id942421 "Restricted SQL Character Anomaly Detection (cookies): # of
  #     special characters exceeded (3)"
  #   - id942431 "Restricted SQL Character Anomaly Detection (args): # of
  #     special characters exceeded (6)"
  #   - id942432 "Restricted SQL Character Anomaly Detection (args): # of
  #     special characters exceeded (12)"
  #
  # Por qué se excluyen: los cookies de Firebase Auth (ID token JWT firmado en
  # base64url) contienen rutinariamente >3 caracteres "especiales" (`-`, `_`,
  # `=`, `.`, `;`), lo que dispara id942421 y devuelve 403 al PWA en
  # app.boosterchile.com. Observado 2026-05-10 en producción: la regla
  # bloqueaba `/`, `/sw.js` y `/favicon.ico` para cualquier usuario con cookies
  # de sesión. id942431/id942432 son las hermanas que evalúan args/headers y
  # disparan con los mismos JWTs cuando viajan en Authorization header o query
  # string (caso típico del refresh flow de Firebase).
  #
  # SQLi se evalúa con `evaluatePreconfiguredWaf` (no `evaluatePreconfiguredExpr`)
  # porque solo la primera honra `opt_out_rule_ids`. La sintaxis vieja
  # `evaluatePreconfiguredExpr('sqli-v33-stable', [ids...])` se acepta pero
  # ignora silenciosamente las exclusiones (verificado en logs 2026-05-10).
  # `sensitivity: 1` mantiene el comportamiento del preset legacy (CRS 3.3
  # paranoia level 1, las rules más mainstream).
  #
  # Defensa restante (SQLi):
  #   - Resto del preset sqli-v33-stable: id942100/200/300 (SQL meta-characters),
  #     id942110-160 (SQL keywords y union-based), id942180-260 (boolean-based,
  #     time-based, stacked queries), id942270-340 (UNION SELECT, INTO OUTFILE),
  #     id942350-410 (MySQL/Postgres specific patterns) — todo esto sigue activo.
  #   - Drizzle ORM con parameterized queries en el api.
  #   - Zod schemas validan shape de body antes de tocar BD.
  #   - Firebase Auth middleware filtra requests sin token válido.
  rule {
    action   = "deny(403)"
    priority = "500"
    match {
      expr {
        expression = "evaluatePreconfiguredExpr('xss-v33-stable') || evaluatePreconfiguredWaf('sqli-v33-stable', {'sensitivity': 1, 'opt_out_rule_ids': ['owasp-crs-v030301-id942421-sqli', 'owasp-crs-v030301-id942431-sqli', 'owasp-crs-v030301-id942432-sqli']}) || evaluatePreconfiguredExpr('rce-v33-stable') || evaluatePreconfiguredExpr('lfi-v33-stable') || evaluatePreconfiguredExpr('scannerdetection-v33-stable')"
      }
    }
    description = "OWASP Top 10 preset deny — excluye SQLi cookie/args char-anomaly (Firebase JWTs)"
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
  name    = "booster-ai-url-map"
  project = google_project.booster_ai.project_id
  # Default service para hosts/paths sin match explícito. Apuntamos al
  # backend web (PWA) que tiene su propio 404 controlado por TanStack
  # Router. Antes era el backend marketing que era un placeholder vacío.
  default_service = google_compute_backend_service.web.id

  host_rule {
    hosts        = ["api.${var.domain}"]
    path_matcher = "api"
  }
  host_rule {
    hosts        = ["app.${var.domain}"]
    path_matcher = "app"
  }
  host_rule {
    hosts        = ["demo.${var.domain}"]
    path_matcher = "demo"
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

  # demo.boosterchile.com — mismo backend que app. El bundle web detecta
  # el host header en runtime y renderiza UI de modo demo. NO hay backend
  # service separado: cualquier desync entre app y demo sería un footgun
  # (deploys mismatcheados).
  path_matcher {
    name            = "demo"
    default_service = google_compute_backend_service.web.id
  }

  # apex (boosterchile.com) + www.boosterchile.com — redirect 301 a
  # app.boosterchile.com mientras no exista un landing comercial dedicado.
  # Reversible: cuando haya proyecto marketing real, cambiar
  # `default_url_redirect` por `default_service` apuntando al nuevo
  # backend. NO usamos backend marketing porque era placeholder vacío
  # (eliminado en este PR).
  path_matcher {
    name = "marketing"
    default_url_redirect {
      host_redirect          = "app.${var.domain}"
      redirect_response_code = "MOVED_PERMANENTLY_DEFAULT"
      strip_query            = false
      https_redirect         = true
    }
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

# === apex + www: migrados al LB de Booster AI ===
#
# Histórico hasta 2026-05-13:
#   apex → A 13.248.243.5, 76.223.105.230 (AWS GA, GoDaddy Website Builder
#          Booster 2.0 con landing "Próximo lanzamiento")
#   www  → CNAME ghs.googlehosted.com (Google Sites Booster 2.0, 503)
#
# Auditoría de dominios identificó que Booster AI ya está live (api/app/
# demo operativos) pero el primer punto de contacto comercial seguía
# sirviendo content de Booster 2.0/legacy inconsistente con la marca
# actual. El servicio Cloud Run `booster-ai-marketing` además era un
# placeholder vacío (`gcr.io/cloudrun/placeholder`), código IaC muerto.
#
# Decisión: apex + www apuntan al LB. El URL map de Booster AI hace
# redirect 301 a app.boosterchile.com mientras no exista un landing
# comercial dedicado. Reversible cuando haya proyecto marketing real:
# basta cambiar el url_redirect por backend_service.
resource "google_dns_record_set" "apex" {
  name         = "${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

resource "google_dns_record_set" "www" {
  name         = "www.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

# app → Cloud Run booster-ai-web vía Global HTTPS LB.
#
# La PWA Booster AI nueva (apps/web, Vite + React + Firebase Auth) se sirve
# desde acá. El LB rutea host=app.boosterchile.com → backend_service.web →
# Cloud Run booster-ai-web (ver url_map "main" + path_matcher "app").
#
# Histórico: hasta 2026-05-02 este record era CNAME → big-cabinet-482101-s3
# .web.app (Firebase Hosting de Booster 2.0). Migrado al LB cuando la PWA
# nueva quedó deployada. Booster 2.0 sigue accesible directamente en
# https://big-cabinet-482101-s3.web.app si se necesita rescatar algo.
#
# IMPORTANTE: agregar app.${var.domain} a domains del cert managed
# (google_compute_managed_ssl_certificate.main) en un APPLY POSTERIOR,
# después de que este record propague (~5 min). Si se hace en el mismo
# apply, el cert puede quedar FAILED_NOT_VISIBLE (lección de task #34).
resource "google_dns_record_set" "app" {
  name         = "app.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
}

# demo → Cloud Run booster-ai-web vía Global HTTPS LB.
#
# Mismo backend que app.boosterchile.com — la PWA detecta el host header
# (demo.* vs app.*) en runtime y muestra UI de modo demo. El endpoint
# /demo/login del api (api.boosterchile.com) crea sesiones efímeras sin
# Firebase Auth; el frontend lo invoca con CORS desde demo.*.
#
# Histórico: hasta 2026-05-13 este record era CNAME → ghs.googlehosted.com
# (Google Sites de Booster 2.0). Migrado al LB de Booster AI cuando se
# habilitó modo demo (feat/demo-mode-subdominio). El binding en el Google
# Site legacy queda huérfano (sin tráfico) — no requiere acción.
#
# IMPORTANTE (lección task #34): aplicar este record en un APPLY APARTE
# antes de agregar demo.${var.domain} a local.cert_domains. Si el cert
# se intenta provisionar antes de que Google vea el A record propagado,
# queda FAILED_NOT_VISIBLE y hay que regenerarlo (cert_suffix rotación).
resource "google_dns_record_set" "demo" {
  name         = "demo.${var.domain}."
  project      = google_project.booster_ai.project_id
  managed_zone = google_dns_managed_zone.main.name
  type         = "A"
  ttl          = 3600
  rrdatas      = [google_compute_global_address.lb_ipv4.address]
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
