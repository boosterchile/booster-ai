# ADR-053: Frontend Security Headers \+ CSP Strict \+ Nonce

- **Fecha**: 2026-05-19  
- **Status**: Accepted  
- **Decisores**: Felipe Vicencio (PO)  
- **Tags**: security, csp, hsts, headers, frontend, sprint-2, p1

---

## Contexto y problema

La auditoría arquitectónica 2026-05-19 (sesión `21c07e7c-e6f9-4de9-9c1d-f819e6b5d5d7`, ver ADR-054 / PR \#303) identificó el hallazgo P1 **R-006** documentado en `audit-outputs/03_SECURITY_FINDINGS.md`:

`apps/web` no emite headers de seguridad estándar. Falta `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

Esto viola el **Principio §7 "Seguridad por defecto"** de `CLAUDE.md` y deja al frontend expuesto a:

1. **XSS** (cross-site scripting): sin CSP, cualquier script externo inyectado se ejecuta.  
2. **Clickjacking**: sin `X-Frame-Options` o `frame-ancestors`, el sitio puede embedderse en iframes maliciosos.  
3. **Protocol downgrade attacks**: sin HSTS, primer request HTTP es vulnerable a MITM.  
4. **Information leakage**: sin `Referrer-Policy`, URLs internas filtran a terceros.  
5. **Privilege overreach**: sin `Permissions-Policy`, APIs sensibles del navegador (camera, microphone, geolocation, accelerometer) quedan disponibles por default.

Para TRL 10, compliance pre-launch (DTE SII, GLEC v3.0) y la postura "Seguridad por defecto", la mitigación es obligatoria antes de exponer el frontend a usuarios externos.

### Stack frontend confirmado (auditoría empírica)

- **Vite** \+ **React** SPA en `apps/web`.  
- **Firebase Auth \+ App** (SDK web).  
- **@vis.gl/react-google-maps** (Maps JS API).  
- **@tremor/react** (UI components, Tailwind compilado bundle local).

Este perímetro define los `*-src` permitidos de la CSP.

---

## Decisión

Implementar **CSP strict con nonce \+ HSTS preload \+ reporting a Cloud Logging vía endpoint propio \+ headers complementarios estándar**, según las siguientes 5 secciones.

### 1\. Content-Security-Policy (Strict \+ Nonce)

Header emitido por `apps/api` al servir `index.html` o por el reverse proxy frente a `apps/web`:

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{random}' 'strict-dynamic';
  style-src 'self' 'nonce-{random}' https://fonts.googleapis.com;
  img-src 'self' data: blob: https://*.gstatic.com https://maps.googleapis.com https://maps.gstatic.com https://*.googleusercontent.com https://lh3.googleusercontent.com;
  font-src 'self' https://fonts.gstatic.com;
  connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebaseinstallations.googleapis.com;
  frame-src 'self' https://*.firebaseapp.com https://accounts.google.com;
  worker-src 'self' blob:;
  manifest-src 'self';
  base-uri 'self';
  form-action 'self';
  frame-ancestors 'none';
  upgrade-insecure-requests;
  report-uri /api/security/csp-report;
  report-to csp-endpoint;
```

**Justificación del whitelist**:

| Directiva | Dominio | Justificación |
| :---- | :---- | :---- |
| `script-src` | `'self' 'nonce-{random}' 'strict-dynamic'` | Solo scripts propios \+ scripts con nonce válido. `'strict-dynamic'` permite que scripts confiables carguen otros scripts sin re-listing. |
| `style-src` | `'self' 'nonce-{random}' fonts.googleapis.com` | Tailwind compilado al bundle (cae en `'self'`). Inline styles dinámicos requieren nonce. Google Fonts permitido para CSS de fonts. |
| `img-src` | Maps \+ Firebase Storage | Maps tiles desde `maps.gstatic.com`, avatares Firebase desde `*.googleusercontent.com`. |
| `font-src` | `fonts.gstatic.com` | Google Fonts binarios. |
| `connect-src` | Firebase REST APIs | Auth, Firestore, Functions endpoints (`*.googleapis.com` cubre la mayoría). |
| `frame-src` | Firebase Auth iframe \+ Google OAuth | Para flujos de auth con redirect. |
| `frame-ancestors 'none'` | — | Bloquea embedding en iframes externos (sustituto moderno de `X-Frame-Options: DENY`). |
| `upgrade-insecure-requests` | — | Promueve automáticamente HTTP→HTTPS en requests internos. |

### 2\. Reporting de violaciones — endpoint propio en apps/api

Crear `apps/api/src/security/csp-report.ts`:

- Endpoint POST `/api/security/csp-report` (sin auth, idempotente, rate-limited a 100/min/IP).  
- Recibe payload JSON conforme a [CSP Level 3 Reporting API](https://www.w3.org/TR/CSP3/#reporting).  
- Loggea con pino estructurado (campo `csp_violation: true`, severidad `warning`).  
- Pino-http → Cloud Logging (consistente con ADR-050).  
- Incluye `correlation_id` si está presente, para correlacionar con trazas OTel.

Header complementario en respuestas HTML:

```
Reporting-Endpoints: csp-endpoint="https://api.booster.cl/api/security/csp-report"
```

**Alertas**: configurar en Cloud Monitoring una alerta si la tasa de CSP violations \> 10/min sostenido (indica posible ataque activo o regresión de CSP).

### 3\. HSTS preload

Header en todas las respuestas HTTPS de `apps/web`:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
```

**Requisitos previos para inscribirse en la HSTS preload list** ([hstspreload.org](https://hstspreload.org/)):

1. ✓ Servir certificado TLS válido (asumido vía Cloud Run \+ managed cert).  
2. ✓ Redirigir HTTP → HTTPS en mismo host (verificar config de Cloud Run / load balancer).  
3. ✓ Servir todos los subdominios sobre HTTPS (auditar inventario de subdominios `*.boosterchile.com`).  
4. ✓ Servir HSTS header con max-age \>= 1 año, includeSubDomains, preload.

**Plan de inscripción**:

- Fase A: deploy del header en producción.  
- Fase B: 2 semanas de validación sin regresiones (monitoring de errores TLS, logs de redirects).  
- Fase C: submit a [hstspreload.org/?domain=boosterchile.com](https://hstspreload.org/).  
- Fase D: tras inclusión en la preload list, monitorear \~6-8 semanas para que llegue a release estable de Chrome/Firefox.

**Reversibilidad**: lenta. Una vez en la preload list, la salida toma varios meses (publicación de versión sin el dominio \+ actualización de navegadores en el parque). Decisión consciente: para Booster AI con visión TRL 10 \+ multi-año de operación, el commitment a HTTPS-only es permanente por diseño.

### 4\. Headers complementarios estándar

Todas las respuestas HTML/JS/CSS emiten:

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: accelerometer=(), autoplay=(), camera=(), display-capture=(), encrypted-media=(), fullscreen=(self), geolocation=(self), gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), picture-in-picture=(), publickey-credentials-get=(self), screen-wake-lock=(), sync-xhr=(self), usb=(), web-share=(self), xr-spatial-tracking=()
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

**Notas**:

- `Permissions-Policy` con `geolocation=(self)` porque rutas/mapas requieren ubicación; `payment=()` cerrado porque actualmente no hay pagos browser-side.  
- `X-Frame-Options: DENY` es redundante con `frame-ancestors 'none'` pero se mantiene por compatibilidad con navegadores legacy.  
- `Cross-Origin-*` previene side-channel attacks tipo Spectre.

### 5\. Implementación técnica

**Modo de servir headers**:

- **Producción**: middleware Hono en `apps/api` que actúa como reverse proxy de `apps/web` (sirve `index.html` con nonces inyectados, proxy de `/assets/*` para JS/CSS estáticos).  
- **Desarrollo**: Vite plugin custom que inyecta nonce en `index.html` durante HMR. CSP en modo `Content-Security-Policy-Report-Only` para no bloquear iteración rápida.  
- **Staging**: enforcement total \+ reporting, igual que producción.

**Nonce generation**:

- Generado por request usando `crypto.randomBytes(16).toString('base64')`.  
- Inyectado en `<script nonce="{nonce}">` y `<style nonce="{nonce}">` de `index.html` antes de servir.  
- Header CSP construido dinámicamente con el mismo nonce.

**Verificación E2E**:

- Playwright tests con `page.evaluate(() => document.head.querySelector('meta[http-equiv="Content-Security-Policy"]'))` y validación de headers en `page.on('response')`.  
- `curl -I https://app.boosterchile.com/` debe retornar los 6 headers (CSP, HSTS, X-Frame-Options, X-CTO, Referrer-Policy, Permissions-Policy).

---

## Consecuencias

### Positivas

- Mitigación efectiva de XSS (CSP strict bloquea injection de scripts).  
- Mitigación de clickjacking (`frame-ancestors 'none'`).  
- Mitigación de MITM en first-load (HSTS preload).  
- Mitigación de information leakage (`Referrer-Policy`).  
- Mitigación de privilege overreach (`Permissions-Policy`).  
- Compliance con OWASP Top 10 (A05:2021 Security Misconfiguration).  
- Visibilidad de tentativas de injection vía CSP reports en Cloud Logging.  
- Trust score elevado en herramientas de auditoría (securityheaders.com, observatory.mozilla.org).

### Negativas

- Complejidad operativa: infra de generación de nonces por request.  
- Latencia adicional mínima por header generation (\~0.1ms estimado).  
- Reversibilidad HSTS preload lenta (meses).  
- Dev workflow ajuste: HMR de Vite con CSP requiere modo Report-Only en dev.

### Riesgos

- **Regresión de UI por CSP**: si Tremor o algún componente inyecta inline styles JS dinámicos sin nonce, romperá visualmente. Mitigación: 1 semana de soak testing con CSP Report-Only antes de enforcement.  
- **Bloqueo de servicios externos no listados**: si se agrega una dependencia nueva (e.g., Sentry, Datadog RUM), requerirá update de CSP. Mitigación: documentar el flujo de cambio en `apps/web/README.md` \+ checklist obligatorio en PR template para deps frontend nuevas.

### Trabajo futuro

- Migrar a [CSP Level 3 trusted types](https://www.w3.org/TR/CSP3/#trusted-types) (mitigación de DOM-based XSS).  
- Integración con Sentry o equivalente para auto-clasificación de CSP reports (ruido vs señal).  
- Política equivalente para `apps/api` (CORS, Permissions-Policy en endpoints API).

---

## Plan de implementación

| Fase | Tarea | Estimación | Owner | Bloqueante |
| :---- | :---- | :---- | :---- | :---- |
| 1 | Endpoint `/api/security/csp-report` en `apps/api` con rate-limit | 0.5d | TBD | Ninguno |
| 2 | Middleware Hono nonce generator | 1d | TBD | Fase 1 |
| 3 | Reverse proxy de `apps/web` con inyección de nonces en `index.html` | 1d | TBD | Fase 2 |
| 4 | Headers complementarios \+ Permissions-Policy en middleware | 0.5d | TBD | Fase 3 |
| 5 | Vite plugin para dev mode (Report-Only) | 0.5d | TBD | Independiente |
| 6 | Playwright E2E tests de validación de headers | 0.5d | TBD | Fase 4 |
| 7 | Soak testing en staging (1 semana CSP Report-Only) | 7d | TBD | Fase 6 |
| 8 | Enforcement en producción | 0.5d | TBD | Fase 7 |
| 9 | Inscripción en HSTS preload list (tras 2 semanas validación prod) | 0.5d | TBD | Fase 8 \+ 14d soak |

**Total esfuerzo directo**: \~4-5 días. **Calendario incluyendo soak**: \~3-4 semanas hasta enforcement completo.

**Sprint**: Sprint 2 (después de cerrar Sprint 1 ejecutivo del ADR-050).

---

## Alternativas consideradas

### Alternativa 1: CSP pragmática con `'unsafe-inline'` en `style-src`

- **Rechazada por el PO en decisión estructural**. Decisión 1 \= "Strict \+ nonce" (B), no "Pragmático" (C). `'unsafe-inline'` deja ventana abierta a CSS injection que puede usarse para data exfiltration vía background-image, attribute selectors, etc.

### Alternativa 2: HSTS estándar sin preload

- **Rechazada por el PO en decisión estructural**. Decisión 3 \= "Sí, HSTS preload" (A), no "Solo HSTS standard" (B).

### Alternativa 3: Sin reporting de violaciones

- **Rechazada por el PO en decisión estructural**. Decisión 2 \= "Cloud Logging vía endpoint propio" (A), no "Sin reporting" (C). Sin reporting, las violaciones reales (ataques o regresiones) pasan inadvertidas hasta que un usuario reporta UI rota.

### Alternativa 4: Headers servidos solo desde CDN (Cloud Armor / Cloud CDN custom headers)

- **Rechazada como sustituto, viable como complemento**. CSP con nonce requiere generación dinámica por request — imposible vía CDN estático. Cloud Armor puede emitir HSTS, Permissions-Policy, Referrer-Policy estáticos como **defense in depth** adicional, pero CSP debe vivir en el servidor de aplicación.

### Alternativa 5: WAF (Cloud Armor) en lugar de CSP

- **Rechazada como sustituto, complementaria**. WAF detecta patrones de ataque en requests, CSP previene ejecución de scripts maliciosos ya cargados. Son capas distintas y complementarias.

### Alternativa 6: CSP en `<meta>` tag del HTML (en lugar de header HTTP)

- **Rechazada**. CSP en `<meta>` no soporta `frame-ancestors`, `report-uri`, `report-to`, `sandbox`. Header HTTP es el único modo completo.

---

## Referencias

- `CLAUDE.md` §7 Seguridad por defecto  
- `audit-outputs/03_SECURITY_FINDINGS.md` (R-006)  
- ADR-050 (observabilidad — `correlation_id` en CSP reports)  
- ADR-054 (Arquitecto Maestro Migration, PR \#303)  
- PR \#304 (skill activation)  
- PR \#305 (ADR-050)  
- [OWASP CSP Cheatsheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)  
- [hstspreload.org](https://hstspreload.org/) — submission para HSTS preload list  
- [CSP Level 3 Reporting API](https://www.w3.org/TR/CSP3/#reporting)  
- [Permissions-Policy explainer](https://github.com/w3c/webappsec-permissions-policy)  
- [Cross-Origin-Opener-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cross-Origin-Opener-Policy)

