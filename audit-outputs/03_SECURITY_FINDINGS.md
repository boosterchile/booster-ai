# 03 — Security Findings (Booster AI)

**Sesión**: `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`
**Subagent**: `security-scanner`
**Generado**: 2026-05-19T02:30Z
**Naturaleza**: estática read-only, sin reproducir secrets en cleartext.

**Metodología**:
- Grep por patrones canónicos (AWS/Google API keys, JWT secrets, conn strings con password, BEGIN PRIVATE KEY).
- Revisión manual de paths críticos: `apps/api/src/{server,config,middleware}.ts`, `apps/api/src/routes/*`, `apps/whatsapp-bot/src/routes/`, `apps/telemetry-tcp-gateway/src/`, `infrastructure/*.tf`, `cloudbuild*.yaml`.
- Cross-check de IAM + Secret Manager (`infrastructure/iam.tf`, `infrastructure/security.tf`).
- Validación de Zod parsing en cada route handler + Pino redaction.
- `gitleaks` no está instalado localmente; la CI lo ejecuta (`.github/workflows/security.yml`) y el repo expone `.gitleaks.toml` con allowlist documentado.

---

## P0 — Críticos

**Ninguno detectado.**

Verificado:
- No hay claves privadas (`BEGIN PRIVATE KEY`), service-account JSON, `sk-…`, `ghp_…`, `xox[bp]-`, `glpat-`, AWS `AKIA…` ni connection strings con credenciales en el repo (excepto el placeholder de tests `apps/api/test/setup.ts:32` con `postgresql://test:test@localhost`, dev-only).
- Las dos claves `AIzaSy…` que aparecen en `cloudbuild.production.yaml:312,326`, `deploy-phase-2.sh:154,162` y `docs/adr/014-google-maps-api-key.md:76` son **públicas-por-diseño** (Firebase Web API Key + Google Maps JS Key restringida por HTTP referrer). Rationale completo en `.gitleaks.toml` y en `apps/web/Dockerfile`. No constituyen secret leak (Firebase Web keys "are not used for security" — están protegidas por Security Rules + dominio autorizado).
- Auth JWT (server-to-server y user-facing) **firma criptográficamente verificada** vía `google-auth-library` (`apps/api/src/middleware/auth.ts:69`) y `firebase-admin.verifyIdToken(token, true)` con `checkRevoked=true` (`apps/api/src/middleware/firebase-auth.ts:87`). RS256/ES256. Algoritmo no se deja al cliente.
- SQL injection: Drizzle + `pg` parametrizados en todos los handlers. Los dos usos de `sql.raw(...)` (`apps/api/src/db/migrator.ts:134,173,176`, `apps/api/src/services/chat-whatsapp-fallback.ts:103`) operan sobre constantes hardcoded o contenido de archivos SQL en disco; no hay path desde user input.
- `process.env.*` directo sólo aparece en `main.ts` (bootstrap) y `jobs/*` (jobs no-HTTP). Todos los flujos HTTP pasan por `@booster-ai/config` con Zod schemas.

---

## P1 — Altos

### P1-1. Falta de security headers en el frontend (`apps/web/nginx.conf.template:1-55`)

- **Categoría**: Security headers / CSP / HSTS.
- **Evidencia (redacted)**: `nginx.conf.template` sólo emite `Cache-Control`. No hay `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Tampoco aparecen en `infrastructure/networking.tf` (LB no setea response headers custom). El backend Hono usa `secureHeaders()` (defaults), pero el PWA servido por nginx queda sin defensas básicas contra clickjacking, MIME-sniffing, mixed-content, ni CSP.
- **Impacto**: clickjacking (sin `X-Frame-Options: DENY` un atacante puede iframe `app.boosterchile.com`), MIME-sniffing, falta de fuerza HTTPS persistente (sin HSTS un user que tipea `http://` puede ser MITM-ed en la primera visita), sin CSP cualquier XSS reflejado (low likelihood en SPA + Zod, pero no nulo) ejecuta sin restricción.
- **Recomendación**: añadir bloque global en `apps/web/nginx.conf.template`:
  ```
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "geolocation=(self), camera=(self), microphone=(self)" always;
  add_header Content-Security-Policy "default-src 'self'; connect-src 'self' https://api.boosterchile.com https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.firebaseio.com; img-src 'self' data: https://*.googleusercontent.com https://maps.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://*.gstatic.com https://maps.googleapis.com; frame-ancestors 'none'" always;
  ```
  Validar CSP con `Report-Only` por 48h antes de enforcement. Geolocation/camera/microphone son necesarios para PWA driver — restringir a `self`.

### P1-2. Rate limiting marcado TODO en `/public/tracking/:token` (`apps/api/src/routes/public-tracking.ts:13-18`)

- **Categoría**: DoS / token enumeration mitigation.
- **Evidencia (redacted)**: comentario explícito `**Rate limiting**: TODO post-deploy con Cloud Armor o middleware propio. Por ahora confiamos en la opacidad UUID + el threshold de tokens enumerables (122 bits). Pre-MVP es aceptable; antes de publicarlo masivamente metemos cap (ej. 60 req/min por IP por token).`
- **Impacto**: aunque `infrastructure/networking.tf:160-180` aplica rate limiting global Cloud Armor (1000 req/min/IP, ban 10 min), no hay tope por **token**. Un attacker con un token válido puede pollear sin restricción (~16 req/seg sostenidos) y exfiltrar telemetría parcial. La superficie es limitada (plate parcial, ETA, sin driver/precio) pero el comentario explícito reconoce gap pre-launch público.
- **Recomendación**: implementar bucket per-token en Redis (TTL 60s, cap 60 req) antes de cualquier publicación masiva de tracking links a shippers/consignees externos. La regla actual de Cloud Armor protege contra scraping IP-wide pero no contra abuso de un token legítimo. Adicionalmente endurecer la respuesta 404 para tokens malformados (regex UUID v4 antes de query DB) — ya implícito en el handler pero verificar.

### P1-3. Cloud Armor WAF bypassed totalmente para hostname `api.boosterchile.com` (`infrastructure/networking.tf:198-225`)

- **Categoría**: WAF coverage gap (decisión documentada, requiere monitor).
- **Evidencia (redacted)**: rule priority 390 `expression = "request.headers['host'] == 'api.boosterchile.com'"` con `action = "allow"`. Comentario admite: *"Bypass TOTAL para hostname api (todos los métodos). La defensa real la hace el api a nivel app: 1. Firebase Auth middleware… 2. Zod schema… 3. Drizzle ORM… 4. CORS…"*.
- **Impacto**: cualquier exploit que pasara el WAF (OWASP CRS) para `api.*` queda dependiente exclusivamente de Firebase Auth + Zod + Drizzle. Las defensas son válidas, pero perder un layer (defense-in-depth) significa que un bug en cualquiera de los 3 escala directo a impact. Trade-off justificado por falsos positivos con RUTs chilenos (`-9` parsed como SQL comment), pero queda como deuda permanente.
- **Recomendación**: largo plazo, mantener excepciones CRS finas en lugar de bypass total. Corto plazo: añadir métricas Cloud Logging para `api.boosterchile.com` con alertas en payloads `Content-Length > 1MB` o patrones SQLi sintácticos, y revisar trimestralmente si la lista de reglas con falso positivo se puede acotar a `(id942200, id942432)` con `versioned_expr` + `opt_out_rule_ids`. (Ver `~/.claude/memory/reference_cloud_armor_opt_out_syntax.md`.)

### P1-4. CORS allowlist sin staging-domain explícito + permisivo a 5 URLs (`apps/api/src/server.ts:102-108` + `infrastructure/compute.tf:84`)

- **Categoría**: CORS scope.
- **Evidencia (redacted)**: `cors({ origin: config.CORS_ALLOWED_ORIGINS, credentials: true })` con CSV `${local.public_api_url},https://${var.domain},https://www.${var.domain},https://app.${var.domain},https://demo.${var.domain},${local.cloud_run_api_url}`. Combinación `credentials: true` con allowlist explícita (no `*`) es **correcta** según CORS spec (no es la violación clásica). Sin embargo, `demo.boosterchile.com` está en producción como origin válido, y `cloud_run_api_url` (la URL `*.run.app`) también — esa URL es predictible si alguien conoce el project number.
- **Impacto**: bajo en sí. La auth es Bearer (no cookies), entonces `credentials: true` no fortalece nada real (Authorization header se envía explícito por el cliente, no automáticamente). El riesgo es que un atacante que registre un dominio similar al de `*.run.app` no puede — Google lo controla. Pero `credentials: true` debería quitarse si no se usan cookies para minimizar surface.
- **Recomendación**: poner `credentials: false` (no usan cookies — verificado en grep: cero `Cookie` headers en `apps/api/src`). Beneficio: el browser no envía credentials cross-origin, simplifica el modelo, evita CSRF si en el futuro se añaden cookies por error.

---

## P2 — Medios

### P2-1. Inconsistencia en allowlist gitleaks (`./.gitleaks.toml:28-30` vs `deploy-phase-2.sh:154,162` y `docs/adr/014-google-maps-api-key.md:76`)

- **Categoría**: Drift de configuración (no es leak — keys públicas-por-diseño).
- **Evidencia (redacted)**: `.gitleaks.toml` excluye sólo `cloudbuild\.production\.yaml`. Las mismas dos keys `AIzaSy…` (Firebase Web + Maps) aparecen también en `deploy-phase-2.sh` y `docs/adr/014-google-maps-api-key.md`. Si gitleaks corre full-scan (no diff), las matchearía.
- **Impacto**: cosmético — pre-commit + CI corren en diff-mode (no full-scan retroactivo). Pero un audit futuro o un fork con full-scan dispararía falsos positivos.
- **Recomendación**: extender `paths` del allowlist a `deploy-phase-2\.sh` y `docs/adr/014-google-maps-api-key\.md` o, mejor, mover las dos substitutions a un `cloudbuild.shared.env` versionado y referenciar desde ambos sitios para evitar drift de valor (si rotan la key prod, hay 3 lugares para actualizar).

### P2-2. `sql.raw` en migrator inserta hash + timestamp interpolados (`apps/api/src/db/migrator.ts:177`)

- **Categoría**: Interpolación SQL con datos derivados.
- **Evidencia (redacted)**: `` `INSERT INTO "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}" ("hash", "created_at") VALUES ('${hash}', ${entry.when})` ``. `hash` es `crypto.createHash('sha256')...digest('hex')` (controlled), `entry.when` proviene del journal JSON que vive en el repo. No es user-controlled.
- **Impacto**: nulo bajo el threat model actual (el journal está bajo control de devs + CI). Pero el patrón es brittle — si en el futuro el journal viniera de fuera del repo (ej. migrations descargadas), habría SQLi trivial.
- **Recomendación**: refactor a `sql\`INSERT … VALUES (${hash}, ${entry.when})\`` (Drizzle parameter binding) para eliminar la categoría completa. Costo: ~2 líneas.

### P2-3. Logs con `email` plano en `seed-demo.ts` (`apps/api/src/services/seed-demo.ts:589`)

- **Categoría**: PII en logs (mitigada por Pino redaction).
- **Evidencia (redacted)**: `logger.info({ email, firebaseUid }, 'Demo Firebase user created');`. `email` está en `redactionPaths` (`packages/logger/src/redaction.ts:30` — `'*.email'`).
- **Impacto**: bajo. Pino auto-redacta a `[Redacted]`. Riesgo residual: si el logger se monta sin `redact:` (e.g. en tests o en un script que importa `createLogger` con override).
- **Recomendación**: añadir test de regresión que confirme `redactionPaths` se aplican siempre (parece que `packages/logger/src/redaction.test.ts` ya cubre — verificar). Considerar redactar también `firebaseUid` porque es identificador estable que correlaciona usuarios across logs.

### P2-4. Endpoint `/demo/login` mintea Firebase custom tokens sin captcha ni rate limit propio (`apps/api/src/routes/demo-login.ts:73`)

- **Categoría**: Auth surface pública.
- **Evidencia (redacted)**: dos guards: `DEMO_MODE_ACTIVATED` flag + `empresas.es_demo=true` filter en BD. Ningún captcha, ningún throttle por IP (sólo el global Cloud Armor 1000/min).
- **Impacto**: si en el futuro `DEMO_MODE_ACTIVATED=true` se filtra a producción (ej. por error de Terraform), un atacante podría mint custom tokens para personas demo. Las personas demo no acceden a data real (segundo guard), entonces el blast radius queda contenido.
- **Recomendación**: dejar como está (double-guard es buena defensa). Considerar añadir log explícito de **CADA login demo** en producción (`logger.warn` con `path + sourceIp`) para detectar abuso temprano. Validar quarterly que `DEMO_MODE_ACTIVATED` está en `false` en prod (`infrastructure/environments/prod/*.tfvars`).

### P2-5. Open enrollment del TCP gateway acepta IMEI desconocidos (`apps/telemetry-tcp-gateway/src/imei-auth.ts:46-65`)

- **Categoría**: Auth de devices IoT (decisión documentada).
- **Evidencia (redacted)**: si `vehiculos.teltonika_imei` no matchea, el device queda en `dispositivos_pendientes` y la conexión NO se cierra. Comentario admite trade-off: facilita onboarding piloto, pero permite que cualquier IP pueda mantener conexión TCP abierta enviando codec8 packets que el processor descarta.
- **Impacto**: DoS limitado al socket budget del gateway (GKE Autopilot escala, pero hay costo). No hay impact en datos (sin `vehicleId`, el processor descarta).
- **Recomendación**: añadir métrica + alerta `pending_devices_growth_rate > N/day` para detectar bursts. Cambiar a strict-mode (`config.STRICT_IMEI_AUTH=true`) cuando se llegue a escala (post-TRL-9). Documentado.

### P2-6. `BOOSTER_PLATFORM_ADMIN_EMAILS` defaultea a `''` (`apps/api/src/config.ts:543-551`)

- **Categoría**: Fail-closed default (validación).
- **Evidencia (redacted)**: si Cloud Run prod arranca sin la env var, `requirePlatformAdmin` siempre devuelve 403. Bien por sí — fail-closed. Pero no hay test de regresión que esa env esté siempre en `prod.tfvars`.
- **Recomendación**: añadir step en CI/CD que verifique `BOOSTER_PLATFORM_ADMIN_EMAILS` está seteado en prod environment Terraform, similar al check existente. (No es bug, es proceso.)

---

## Verificación de stack

| Declarado (CLAUDE.md / SESSION) | Verificado en código | Estado |
|---|---|---|
| Backend Hono 4 sobre Cloud Run | `apps/api/src/server.ts:3-5` (Hono import), `apps/api/Dockerfile` Cloud Run target | ✅ confirmado |
| Cliente DB `pg` Cloud SQL (no Neon) | `apps/api/src/db/client.ts` usa `pg.Pool`; cero referencias a `@neondatabase` | ✅ confirmado |
| Frontend React 18 + Vite 6 + `@tanstack/react-router` | `apps/web/src/router.tsx` + `apps/web/package.json` + `vite.config.ts` | ✅ confirmado |
| `packages/config` con Zod | `packages/config/src/parseEnv.ts` + `schemas/{common,database,redis,gcp,firebase}.ts` | ✅ confirmado |
| Secret Manager en prod | `infrastructure/security.tf:261-299`; placeholders con `ROTATE_ME_*` | ✅ confirmado |
| Sin `maps.config.ts` (frontend usa Vite env) | `apps/web/src/lib/env.ts:33` + `apps/web/src/lib/firebase.ts:19` (`import.meta.env.VITE_*` via Zod) | ✅ confirmado |
| ADR-001 stack canónico | `apps/api/src/middleware/auth.ts` usa `google-auth-library` (no `jsonwebtoken`) | ✅ confirmado |
| Auth zero-trust JWT | RS256/ES256 con JWKS Google (server-to-server) + Firebase ID token con `checkRevoked=true` (user-facing) | ✅ confirmado |
| gitleaks pre-commit + CI | `.gitleaks.toml` + `.github/workflows/security.yml` referencia | ✅ confirmado (gitleaks binary no instalado localmente; CI corre) |
| Pino redaction de PII | `packages/logger/src/redaction.ts:13-60` cubre 30+ paths (credentials + PII Ley 19.628 + payment) | ✅ confirmado |
| Cloud Armor WAF activo | `infrastructure/networking.tf:141-225` con rate limit 1000/min + OWASP CRS + bypass `api.*` host (documentado) | ✅ confirmado con caveats (P1-3) |
| IAM least-privilege | `infrastructure/iam.tf:34-235` SAs separados (runtime, deployer, bastion, workspace-reader) sin owner/editor wildcards | ✅ confirmado |
| Servicios Cloud Run no-allUsers | `infrastructure/networking.tf:686-696` LB ↔ SA invoker pattern | ✅ confirmado |

### Decisiones de diseño verificadas como seguras

- **No cookies**: cero `Cookie`/`Set-Cookie` en `apps/api/src`. Toda auth es `Authorization: Bearer …`. Elimina CSRF como vector relevante.
- **Twilio webhook**: firma HMAC-SHA1 verificada (`apps/whatsapp-bot/src/routes/webhook.ts:58`) antes de cualquier procesamiento. Sin signature → 403.
- **Custom token Firebase para drivers/personas demo**: minted sólo bajo guard de BD (`empresas.es_demo` / `conductores.estado`) — segundo factor estructural más allá de la flag.
- **Gemini sin API key**: ADC + Vertex AI (`apps/api/src/services/gemini-client.ts:1-50`). Cumple ADR-037, sin secret rotation surface.
- **VAPID Web Push**: pública en `vapid-public-key` endpoint (por diseño), privada en Secret Manager (`infrastructure/security.tf:244`).
- **Zod en boundaries**: cada `c.req.json()` en `apps/api/src/routes` está acoplado a `safeParse`/`zValidator` en la misma función. Sólo 2 casos de `c.req.json()` directo (admin-cobra-hoy.ts:167, admin-matching-backtest.ts:86), ambos validados inmediato post-parse.

---

## Cross-references

- **`02_DEPENDENCIES.md`** (si existe): cross-check `google-auth-library`, `firebase-admin`, `pg`, `drizzle-orm`, `hono` CVEs. No bloquear este informe — la seguridad de auth depende de versiones recientes de `google-auth-library` (≥ 9.x) y `firebase-admin` (≥ 12.x). Pre-commit `pnpm audit --json` y CI `.github/workflows/security.yml` (gitleaks + npm audit) ya cubren esto.
- **`05_TECH_DEBT_REGISTRY.md`** (futuro): registrar:
  - Falta CSP/HSTS/X-Frame-Options en frontend (P1-1).
  - Rate limit per-token en `/public/tracking` (P1-2).
  - WAF bypass `api.*` host (P1-3) — review trimestral.
  - Refactor `sql.raw` a parameter binding (P2-2).
  - Open enrollment IMEI strict-mode flag (P2-5).
  - CORS `credentials: false` (P1-4 — quick win).
- **ADRs relacionados**: ADR-037 (Vertex AI ADC), ADR-038 (Routes API ADC), ADR-014 (Maps key pública), ADR-009 (Maps OAuth — ya migrado a ADC), ADR-010 (IaC IAM). Sin ADR específico para CSP frontend — proponer ADR nuevo al cerrar P1-1.

---

## Resumen ejecutivo

- **P0**: 0 hallazgos.
- **P1**: 4 hallazgos (security headers, rate limit per-token, WAF bypass, CORS credentials).
- **P2**: 6 hallazgos.

**Hallazgo más crítico (sin P0)**: **P1-1 — Frontend nginx sin CSP/HSTS/X-Frame-Options.** Quick fix de ~10 líneas en `apps/web/nginx.conf.template`; impacto: bloquea clickjacking, MIME-sniffing y MITM en first-visit. Toda referencia a secrets en este informe se mantiene redactada conforme `SESSION_CLAUDE.md §Manejo de secrets`.

El estado de seguridad de Booster AI es **alto** para un repo greenfield pre-TRL-10: la auth está bien diseñada (RS256 JWKS + verifyIdToken con checkRevoked), Pino redacta PII por defecto, Drizzle elimina SQL injection, IAM tiene least-privilege con custom roles para superficies estrechas, y Secret Manager está canonical via Terraform. Los gaps son frontera (headers nginx, rate limit puntual) y trade-offs documentados (WAF bypass api.*, open enrollment IMEI), no defectos estructurales.
