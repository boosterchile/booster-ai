# Pasada 2 — Security audit

**Fecha**: 2026-05-14
**Auditor**: agent-rigor:security-auditor (Claude)
**Scope**: OWASP Top 10 (2021) + secrets + auth + network + persistence + deps + logging + demo bypass
**Branch / SHA**: `claude/frosty-darwin-0fc803`, tag `pre-audit-2026-05-14`
**Fuentes**: lectura 100% (sin ejecución). Pre-flight `pnpm audit` (0 prod, 1 moderate dev), heurística regex de secrets, grep estructurado de superficies de auth/input/sinks.

---

## 0. Resumen ejecutivo

- **BLOCKING**: 4
- **HIGH**: 8
- **MEDIUM**: 13
- **LOW**: 9
- **INFO**: 7

Total: **41 hallazgos**.

**Takeaway**:

1. El **modo demo está activado por default en producción** (`var.demo_mode_activated = true` en `infrastructure/variables.tf:369`) con un password hardcodeado (`BoosterDemo2026!`) y un endpoint público `POST /demo/login` que mintea Firebase custom tokens. La compartimentación se basa exclusivamente en el filtro `empresas.is_demo=true`: no hay separación física de tenants demo vs prod en la BD. Esto es el riesgo individual más grande.
2. La **autenticación por RUT + clave numérica / PIN no tiene rate-limiting implementado** (sólo está documentado como TODO en `activation-pin.ts:10-11`). PIN de 6 dígitos = 10⁶ combos brute-forceables en horas sin throttling.
3. La **redacción Pino** de PII usa wildcards `*.email`, `*.rut`, etc. que solo matchean en sub-paths; campos top-level (los logs en auth y login lo hacen así) NO se redactan.
4. **Object Retention Lock** en el bucket de documentos legales (DTE 6 años SII) está configurado con `is_locked = false` — el plazo es defeat-able por un admin con permisos GCS.
5. La arquitectura de auth, RLS y multi-tenant es sólida (verifyIdToken con `checkRevoked=true`, scrypt timing-safe, lint-rls custom). El problema es operacional: defaults inseguros y rate-limit pendiente.

---

## 1. Hallazgos por eje

### A01 — Broken Access Control

#### SEC-001 — [BLOCKING] Modo demo activado por default en producción
- **Evidencia**: `infrastructure/variables.tf:366-370` declara `variable "demo_mode_activated"` con `default = true`; `apps/api/src/server.ts:154-159` monta `POST /demo/login` cuando `firebaseAuth` está presente; `apps/api/src/services/seed-demo.ts:86` define `const DEMO_PASSWORD = 'BoosterDemo2026!'` que se asigna a Firebase users reales en producción (`seed-demo.ts:139,149,162`) y se devuelve en el response de `POST /admin/seed/demo` (`seed-demo.ts:291-293`); `apps/api/src/services/seed-demo-startup.ts:142` lo replica para el conductor demo.
- **Descripción**: El flag `DEMO_MODE_ACTIVATED` controla (i) el endpoint público `POST /demo/login` que mintea Firebase custom tokens con `is_demo: true` para "shipper", "carrier", "conductor", "stakeholder" sin auth previa, y (ii) un startup hook (`ensureDemoSeeded`) que crea Firebase Auth users con password `BoosterDemo2026!` en la BD prod. El doble guard documentado (`flag + empresas.is_demo=true`) sólo protege contra emisión de tokens para users no-demo; NO impide que el password sintético funcione como credencial real (Firebase email/password login con `demo-shipper@boosterchile.com` + `BoosterDemo2026!` es válido contra el mismo Firebase project que app.boosterchile.com).
- **Impacto**: Cualquier persona en internet puede (a) llamar `POST /demo/login` y obtener un Firebase ID token con custom claim `is_demo: true` + scope al user demo, accediendo a las superficies de shipper/carrier/conductor/stakeholder; (b) si conoce el email + password sintético, autenticarse via Firebase email/password directamente, obteniendo el mismo acceso pero con persistencia más larga. Aunque sólo escala a datos demo, comparte BD con prod y cualquier query mal-scoped (ver SEC-005) es un bridge.
- **Recomendación**: cambiar `default = false` en `infrastructure/variables.tf:369`. Activar `demo_mode_activated = true` solo en `terraform.tfvars` específico de un entorno con `project_id != booster-ai-494222` o un Cloud Run separado. Adicionalmente: subir el password `DEMO_PASSWORD` a Secret Manager con rotación periódica, o regenerar passwords por seed corrida.

#### SEC-002 — [HIGH] `POST /admin/seed/demo` no respeta `DEMO_MODE_ACTIVATED`
- **Evidencia**: `apps/api/src/routes/admin-seed.ts:30-44` define `requirePlatformAdmin` inline sin chequear el flag; `seed-demo.ts:96` corre el seed completo siempre que el caller esté en `BOOSTER_PLATFORM_ADMIN_EMAILS`.
- **Descripción**: Un platform-admin (allowlist por email en config) puede invocar `POST /admin/seed/demo` aunque `DEMO_MODE_ACTIVATED=false`. El handler crea Firebase users en producción + filas en `usuarios/empresas/conductores/...` marcadas `is_demo=true`. No hay barrera intermedia.
- **Impacto**: Si la allowlist se contamina (ver SEC-003) o un admin se compromete, la propagación incluye la introducción de credenciales sintéticas conocidas (`BoosterDemo2026!`) en producción.
- **Recomendación**: agregar guard `if (!appConfig.DEMO_MODE_ACTIVATED) return c.json({ error: 'feature_disabled' }, 503)` al inicio de los handlers POST y DELETE; idealmente refactorizar para usar `requirePlatformAdmin` del middleware compartido con `featureFlag: appConfig.DEMO_MODE_ACTIVATED`.

#### SEC-003 — [HIGH] Auto-provisioning de platform-admin sin verificación de email
- **Evidencia**: `apps/api/src/routes/me.ts:102-117`. La rama de auto-provisión chequea `if (!user && claims.email && isAdminEmail)` SIN exigir `claims.emailVerified` (a diferencia de la rama de account-linking en `me.ts:62` que sí lo exige).
- **Descripción**: En Firebase Auth, un email/password sign-up genera `email_verified: false` por default. Si un atacante registra el email `dev@boosterchile.com` (allowlist) en un proyecto Firebase comprometido o malconfigurado, o el dominio Firebase project tiene email enumeration habilitado, el primer GET `/me` con esa identidad crea automáticamente un row `usuarios` con `is_platform_admin=true`. (Firebase Auth deduplica emails por provider, pero los flows custom claim + email/password tienen edge cases.)
- **Impacto**: Acceso completo a `/admin/*` (seed demo, cobra-hoy, stakeholder-orgs, observability, matching, liquidaciones).
- **Recomendación**: agregar `&& claims.emailVerified` al guard en `me.ts:102`. Para defense-in-depth, en `requirePlatformAdmin` también validar `userContext.user.email === claims.email` para evitar inconsistencias post-link.

#### SEC-004 — [MEDIUM] Modo demo + prod comparten la misma BD sin scope a nivel middleware
- **Evidencia**: `apps/api/src/middleware/user-context.ts:44-49` y `apps/api/src/services/user-context.ts` resuelven memberships sin filtrar `empresas.is_demo`. El criterio `is_demo` solo se aplica en seed-demo y `demo-login`.
- **Descripción**: Una vez logueado un user demo, el contexto que reciben los handlers (offers, trip-requests, vehiculos, etc.) no diferencia entre demo y prod. Cualquier bug en una query que olvide filtrar `empresaId` (que el lint-rls intenta atrapar) cruzaría el límite demo↔real bidireccionalmente.
- **Impacto**: Aislamiento es defensa en profundidad débil — bug-de-1-línea en `where()` mezcla datos.
- **Recomendación**: agregar `is_demo` al `UserContext.activeMembership.empresa` y a los predicados de las queries shipper/carrier (e.g. en `offers.ts`, `trip-requests-v2.ts`, `assignments.ts`); o separar la persistencia demo en un schema PostgreSQL distinto.

#### SEC-005 — [MEDIUM] `requirePlatformAdmin` duplica lógica inline en `admin-seed.ts` y `admin-cobra-hoy.ts`
- **Evidencia**: `apps/api/src/routes/admin-seed.ts:30-44`, `apps/api/src/routes/admin-cobra-hoy.ts:78-98`, `apps/api/src/routes/admin-matching-backtest.ts:69` — todos re-implementan la verificación de allowlist en lugar de usar `middleware/require-platform-admin.ts:54` (que SÍ existe y SÍ verifica feature flag).
- **Impacto**: Drift en guards: `admin-cobra-hoy.ts` chequea `FACTORING_V1_ACTIVATED`, `admin-seed.ts` no chequea `DEMO_MODE_ACTIVATED` (ver SEC-002). Cada handler nuevo tiene riesgo de olvidar un gate.
- **Recomendación**: refactorizar para usar exclusivamente `requirePlatformAdmin` del middleware compartido.

#### SEC-006 — [MEDIUM] Endpoint `/me` opera sin `userContextMiddleware` y resuelve user via firebase_uid SIN re-validar email post-link
- **Evidencia**: `apps/api/src/server.ts:197` aplica solo `firebaseAuthMiddleware` a `/me` raíz. `me.ts:62-86` ejecuta account linking sobre `users.email` cuando hay `claims.emailVerified=true`, pero no requiere que el firebase user tenga el mismo proveedor que el row existente.
- **Descripción**: Si un atacante toma over un Google account cuyo email coincide con un usuario legacy registrado vía email/password, el sólo loguearse con Google linkea su `firebaseUid` al row existente. La explotabilidad depende de la solidez del proveedor (Google account hijack es atacable vía SIM swap, weak recovery).
- **Impacto**: account takeover potencial post-account-takeover de Google.
- **Recomendación**: registrar el `provider` (e.g. `password`, `google.com`) del usuario en BD; durante linking, exigir step-up (confirmar password legacy) si los providers difieren.

#### SEC-007 — [LOW] `/admin/observability/*` filtra el cron caller SA detrás del mismo middleware que `/admin/jobs/*`
- **Evidencia**: `apps/api/src/server.ts:278-297` monta `/admin/jobs/*` con `cronAuthMiddleware` (SA-to-SA), correcto. Pero los routers admin-{seed,cobra-hoy,observability,...} en `server.ts:359-450` se chequean con `firebaseAuth + userContext + requirePlatformAdmin` (lista de emails) — riesgo si la lista crece y un email queda. Sin hallazgo accionable inmediato, pero la mezcla `email allowlist` vs `SA token` para superficies "admin" similares aumenta la superficie de error.
- **Recomendación**: documentar en CLAUDE.md o ADR la matriz: caller humano → BOOSTER_PLATFORM_ADMIN_EMAILS; caller máquina → cronAuthMiddleware. Hoy se intuye.

---

### A02 — Cryptographic Failures

#### SEC-008 — [MEDIUM] Hash scrypt parámetros explícitos del hash NO se validan al verificar
- **Evidencia**: `apps/api/src/services/clave-numerica.ts:62-74` y `apps/api/src/services/activation-pin.ts:88-100` aceptan cualquier `N/r/p` parseado del string almacenado y lo pasan a `scryptSync`. Si un atacante puede sembrar un hash con N=1 (trivial de calcular), un eventual verify con `clave` arbitraria pasaría la barrera de costo.
- **Descripción**: scenario realista requiere write-access al hash en BD (SQLi, compromise), pero como defensa en profundidad debería rechazar `N < 2^14`.
- **Recomendación**: validar `N >= 2**14 && r === 8 && p === 1` antes de derivar; rechazar formato sino.

#### SEC-009 — [MEDIUM] PIN de activación: 3 bytes raw % 10^6 — bias de modulo
- **Evidencia**: `apps/api/src/services/activation-pin.ts:39-41`. El comentario dice "3 bytes = 0..16M, módulo 10^6 con bias <0.001%". El cálculo real lee 4 bytes (`readUInt32BE(0)`) y aplica módulo 10⁶ → bias real ≈ 1.5×10⁻⁷ (despreciable para 1 uso), pero el comentario es inconsistente y `Math.random()` se usa correctamente.
- **Impacto**: irrelevante (bias insignificante para PIN single-use). Documentación contradictoria.
- **Recomendación**: alinear comentario con el código (lee 4 bytes, no 3); opcionalmente, rejection sampling cuando `buf > 4_294_000_000`.

#### SEC-010 — [LOW] KMS retention lock del bucket de documentos NO está bloqueado (`is_locked = false`)
- **Evidencia**: `infrastructure/storage.tf:145` — `is_locked = false`. Hay comentario explícito "CAMBIAR A true MANUALMENTE después de validar".
- **Impacto**: la retención de 6 años para DTE/SII puede deshabilitarse por un GCS admin. Bloquear es operación irreversible — comprensible la prudencia, pero el comentario lleva semanas sin resolverse.
- **Recomendación**: priorizar el lock manual en staging primero (donde el período de retención es menos costoso) y agregar checklist al cierre de TRL10.

#### SEC-011 — [INFO] Firma de certificados RSA_SIGN_PKCS1_4096_SHA256 + KMS — adecuado
- **Evidencia**: `infrastructure/security.tf:68-81`. PKCS#1 v1.5 (no PSS) por interoperabilidad PAdES — documentado en comments. Aceptable, dentro de NIST SP 800-131A.
- **Sin acción**: nota informativa.

#### SEC-012 — [INFO] No detecté algoritmos débiles (MD5/SHA1/DES/RC4) en código de producción
- **Evidencia**: `crypto.createHmac('sha1', ...)` aparece sólo en `apps/sms-fallback-gateway/src/twilio-signature.ts:49` y `packages/whatsapp-client/...` — SHA-1 dentro de HMAC sigue siendo aceptable per FIPS 180-4 (Twilio webhook spec lo exige). Sin hallazgo.

---

### A03 — Injection

#### SEC-013 — [INFO] Drizzle ORM es parametrized end-to-end; usos de `sql.raw` están acotados
- **Evidencia revisada**: `apps/api/src/db/migrator.ts:134,173-176` (DDL hardcoded), `apps/api/src/services/chat-whatsapp-fallback.ts:103` (`sql.raw(String(UNREAD_THRESHOLD_MINUTES))` con constante `const UNREAD_THRESHOLD_MINUTES = 5` en línea 53, inmutable verificado).
- **Sin acción**: cumple.

#### SEC-014 — [LOW] Job `merge-duplicate-users.ts` construye SQL via interpolación de identificadores hardcoded
- **Evidencia**: `apps/api/src/jobs/merge-duplicate-users.ts:90-91, 191-192, 204` usa `client.query(\`SELECT count(*) FROM ${fk.table} WHERE ${fk.col} = $1\`, ...)` con `fk` proviniendo de la constante `FK_REFS` (líneas 46-55).
- **Impacto**: hoy no es explotable porque `FK_REFS` es estática. Pero si un futuro PR mueve `FK_REFS` a configuración o BD, el patrón se convierte en SQLi.
- **Recomendación**: usar Drizzle con tablas tipadas en el job o un allowlist runtime; documentar en comment que `FK_REFS` debe permanecer literal.

#### SEC-015 — [INFO] No hay sinks `exec`/`spawn`/`eval` con input usuario
- **Verificado**: grep en `apps/`, `packages/` no encontró usos.

---

### A04 — Insecure Design

#### SEC-016 — [HIGH] Auto-seed de demo corre sobre la BD productiva en startup
- **Evidencia**: `apps/api/src/services/seed-demo-startup.ts:33-93`. Si `DEMO_MODE_ACTIVATED=true` (que es el default — ver SEC-001), `ensureDemoSeeded` crea Firebase users (`createUser` con password sintético) y entidades en la BD productiva.
- **Descripción**: ningún check separa "BD prod" de "BD demo" — la única señal es la env var. Si Terraform aplica al entorno equivocado, o si el operador clone el setup, el seed corre sin barrera. El error de seed se loggea pero NO impide el startup.
- **Impacto**: contaminación de BD productiva con credenciales conocidas + entidades sintéticas. Difícil de revertir (FKs).
- **Recomendación**: además de SEC-001, agregar un sanity check: si `NODE_ENV='production'` && `DEMO_MODE_ACTIVATED=true`, exigir además `ALLOW_DEMO_IN_PRODUCTION=yes` explícito; sino, log fatal y skip.

#### SEC-017 — [MEDIUM] `POST /demo/login` filtro de stakeholder es por email hardcoded
- **Evidencia**: `apps/api/src/routes/demo-login.ts:253-262` (`eq(users.email, 'demo-stakeholder@boosterchile.com')`).
- **Descripción**: el email es real (`@boosterchile.com`), no en dominio `.invalid` reservado. Si alguien crea ese email en Workspace, la prueba `users.email = ...` matchea contra cualquier user (no demo). Mitigado porque el seed lo crea con `is_demo`, pero el lookup en `demo-login.ts` NO filtra por `org.is_demo` (a diferencia de shipper/carrier que filtran `empresas.isDemo=true`).
- **Recomendación**: filtrar por `eq(organizacionesStakeholder.isDemo, true)` o columna análoga; alternativamente usar dominio `.invalid` para stakeholder demo email.

---

### A05 — Security Misconfiguration

#### SEC-018 — [MEDIUM] `secureHeaders()` sin configuración explícita de CSP/HSTS/Permissions-Policy
- **Evidencia**: `apps/api/src/server.ts:110` invoca `secureHeaders()` sin overrides. Los defaults de `hono/secure-headers` incluyen CSP `default-src 'self'`, X-Frame-Options DENY, HSTS max-age=15552000, etc. Aceptables, pero la API responde JSON — no necesita CSP estricto. Lo que **falta** es endurecer el response (e.g. `Cache-Control: no-store` en endpoints sensibles).
- **Impacto**: cookies bearer-token-via-header reduce riesgo XSS-driven, pero `Cache-Control` ausente en endpoints como `/me` o `/me/liquidaciones` puede dejar respuestas con PII en proxies/caches.
- **Recomendación**: agregar `c.header('Cache-Control', 'no-store')` en endpoints de PII; revisar default CSP del helper.

#### SEC-019 — [HIGH] Cloud Armor exempt total del host `api.boosterchile.com` deja OWASP fuera
- **Evidencia**: `infrastructure/networking.tf:198-225` — regla priority 390 allow-all para `request.headers['host'] == 'api.boosterchile.com'`. Comentario lo justifica por falsos positivos con RUTs ("12345678-9" parece SQL comment).
- **Descripción**: cualquier ataque a `api.boosterchile.com` (XSS reflejado vía error page, SQLi en endpoints no auth-gated como `/feature-flags`, `/public/*`, etc.) bypasea WAF. La defensa real declarada es Firebase Auth + Zod + Drizzle, lo cual cubre la mayoría — pero los endpoints públicos (feature-flags, public-tracking, demo-login) no tienen Firebase Auth.
- **Impacto**: superficie de ataque amplia para endpoints sin auth. El rate-limit 1000/min/IP queda como única defensa contra brute-force enumeration de tokens en `/public/tracking/:token`.
- **Recomendación**: en vez de allow-all por host, exempt sólo paths con falsos positivos conocidos (`/trip-requests-v2`, `/cargas/nueva`, etc. — endpoints con RUT en body). Mantener OWASP en `/feature-flags`, `/public/*`, `/demo/*`.

#### SEC-020 — [MEDIUM] `secureHeaders` default no setea `X-Permitted-Cross-Domain-Policies` ni `Cross-Origin-*`
- **Verificado**: defaults de hono/secure-headers ≥1.x sí setean COOP/COEP en algunos casos, pero no `Permissions-Policy`. Para una API B2B esto es bajo riesgo, pero estandarizar permite endurecer.
- **Recomendación**: configurar `secureHeaders({ permissionsPolicy: { camera: [], microphone: [], geolocation: [] } })` o aceptar como nota.

#### SEC-021 — [LOW] WAF excluye `id942421/431/432` por colisión con cookies JWT Firebase
- **Evidencia**: `infrastructure/networking.tf:264-294`. Documentado a fondo, exclusión justificada. La regla mantiene paranoia level 1 con `evaluatePreconfiguredWaf` (correcto, según memoria del usuario `reference_cloud_armor_opt_out_syntax`).
- **Sin acción**: defensa restante adecuada.

---

### A06 — Vulnerable & Outdated Components

#### SEC-022 — [LOW] `esbuild` ≤0.24 dev-server CVE (moderate) — solo afecta `pnpm dev`
- **Evidencia**: pre-flight `pnpm audit` reportó 1 MODERATE (esbuild dev server).
- **Impacto**: solo si dev expone su dev server a internet (no es el caso en este flow). Sin acción en producción.
- **Recomendación**: dependabot ya está activo (`.github/dependabot.yml`); permitir upgrade automatic al próximo minor.

#### SEC-023 — [INFO] `pnpm.overrides` no detecté en root `package.json`
- **Verificado**: no hay `pnpm.overrides`. Sin acción.

#### SEC-024 — [INFO] Deps crypto-sensible: `node-forge`, `pdf-lib`, `@signpdf/*`, `web-push`, `firebase-admin`, `googleapis` — versiones actuales sin CVEs altos
- **Sin acción**.

---

### A07 — Identification & Authentication

#### SEC-025 — [BLOCKING] Sin rate-limiting en `/auth/login-rut`, `/auth/driver-activate`, `/login*`
- **Evidencia**: grep en `apps/api/src/` por `rateLimit|throttle|loginAttempts` — 0 resultados; `apps/api/src/services/activation-pin.ts:10-11` comenta "rate-limiting por RUT (5 intentos / 15 min, ver D9 PR-B)" pero **no está implementado**.
- **Descripción**: el PIN es de 6 dígitos (10⁶), la clave numérica también 6 dígitos. Sin rate-limit, un atacante puede brute-force 10⁶ combinaciones en horas vs un endpoint que responde 200/401 sin throttling. El Cloud Armor global rate-limit de 1000 req/min/IP (`networking.tf:159-180`) reduce la velocidad a 60k/hora, pero un botnet de 100 IPs cubre el keyspace en minutos.
- **Impacto**: account takeover via brute-force de clave/PIN sobre un RUT conocido.
- **Recomendación**: implementar rate-limit por (RUT, IP) con Redis (`ioredis` ya está integrado), p.ej. 5 intentos / 15min por RUT y 50/min por IP. Considerar exponential backoff + lockout temporal post-N fails con notificación al user.

#### SEC-026 — [HIGH] Login RUT vs Firebase ID token: la verificación de status del user es post-clave
- **Evidencia**: `apps/api/src/routes/auth-universal.ts:78-86` (correcto: rechaza usuarios `suspendido`/`eliminado` antes de verificar clave); pero `auth-driver.ts:91-117` solo verifica `firebaseUid` pendiente. Si un user fue suspendido y aún no se le revocó el PIN, el endpoint sigue creando un Firebase user con password = PIN del usuario.
- **Recomendación**: agregar check `if (user.status !== 'pendiente_verificacion') return 410 already_activated` antes de cualquier hash comparison.

#### SEC-027 — [MEDIUM] Tokens custom Firebase no expiran explícitamente desde el server
- **Evidencia**: `auth-driver.ts:242`, `auth-universal.ts:166`, `demo-login.ts:123` invocan `createCustomToken(uid, claims)` sin TTL específico.
- **Descripción**: Firebase custom tokens TTL default = 1 hora; aceptable. Pero si el cliente lo persiste mal (localStorage), el riesgo es comparable a un Bearer token.
- **Recomendación**: documentar en handoff que el cliente debe ejecutar `signInWithCustomToken` inmediatamente; agregar TTL más corto si Firebase lo soporta.

#### SEC-028 — [MEDIUM] Driver synthetic email = `drivers+<rutSinSeparadores>@boosterchile.invalid` es **predecible**
- **Evidencia**: `apps/api/src/routes/auth-driver.ts:23-25` y `apps/api/src/routes/auth-universal.ts:22-24`. Conociendo el RUT, el email Firebase es derivable.
- **Descripción**: si un atacante puede invocar `signInWithEmailAndPassword(syntheticEmail, password)` sobre Firebase directamente (sin pasar por el API), brute-force se convierte en password-guessing contra Firebase Auth, que tiene su propio rate-limit pero igualmente más débil que un endpoint server-controlado.
- **Recomendación**: deshabilitar email/password sign-in para users-conductor (usar solo signInWithCustomToken); o agregar prefijo random al sintético tras activate.

#### SEC-029 — [LOW] Password sintético `BoosterDemo2026!` no rota
- **Evidencia**: `apps/api/src/services/seed-demo.ts:86`, también `seed-demo-startup.ts:142`. Mismo valor para todos los demo users en cualquier corrida.
- **Recomendación**: subir a Secret Manager con rotación; o generar por seed-run y devolver al admin que lo invocó.

---

### A08 — Software & Data Integrity Failures

#### SEC-030 — [BLOCKING] Retention Policy del bucket `documents` no está locked
- **Evidencia**: `infrastructure/storage.tf:142-146`. `retention_period = 189216000` (6 años) está, pero `is_locked = false`. El comment dice "CAMBIAR A true MANUALMENTE después de validar".
- **Descripción**: el lock es irreversible. SII Chile exige 6 años retención de DTE. Sin lock, un admin con permiso `roles/storage.admin` puede modificar la policy y eliminar documentos antes del plazo. Cumplimiento en riesgo.
- **Impacto**: legal/compliance. Acción explícita de un admin malicioso → pérdida de evidencia auditable.
- **Recomendación**: ejecutar el `gcloud storage buckets update --lock-retention-policy` ahora. Si hay riesgo de testing residual, hacerlo primero en staging y agendar el prod lock con fecha cierta.

#### SEC-031 — [LOW] Audit log de stakeholder access (`stakeholderAccessLog`) presente; verificar coverage
- **Evidencia**: tabla declarada en schema (`apps/api/src/db/schema.ts:1115` aprox.) y mencionada como "append-only audit log" en `scripts/lint-rls.mjs:42`. No revisé exhaustivamente que TODOS los reads de stakeholder data lo escriban.
- **Recomendación**: pasada futura: confirmar que las superficies stakeholder (zones, k-anonymized data) insertan en `stakeholder_access_log` consistentemente.

---

### A09 — Security Logging and Monitoring Failures

#### SEC-032 — [HIGH] Pino redaction paths usan `*.xxx` que no matchean campos top-level
- **Evidencia**: `packages/logger/src/redaction.ts:13-60`. Patterns como `*.email`, `*.rut`, `*.phone`, `*.fullName`. Pino redaction con wildcard `*.email` matchea `{ user: { email: ... } }`, pero NO `{ email: ... }` top-level.
- **Hallazgos relacionados (logs con PII top-level)**:
  - `apps/api/src/routes/auth-universal.ts:110, 152, 171` — `logger.info({ rut, ... })`, `logger.error({ err, rut })` — `rut` NO se redacta.
  - `apps/api/src/routes/auth-driver.ts:154, 250` — idem.
  - `apps/api/src/routes/me.ts:118-120` — `logger.info({ email, userId }, 'platform admin auto-provisioned ...')` — `email` NO se redacta.
- **Impacto**: PII (RUT, email) en Cloud Logging plano. Violación de Ley 19.628 Chile + GDPR proportionality.
- **Recomendación**: agregar paths top-level a `redactionPaths`: `'email'`, `'rut'`, `'phone'`, `'whatsappE164'`, `'fullName'`, etc. Tests de unit con `expect(JSON.stringify(loggerOutput)).not.toContain('123456-7')`.

#### SEC-033 — [MEDIUM] Logs de auth fail no incluyen IP / user-agent para correlación
- **Evidencia**: `auth-universal.ts:110`, `auth-driver.ts:115-117`. Los logs `'login-rut: clave incorrecta'` solo incluyen rut + tipo_hint, no IP ni UA.
- **Impacto**: investigación post-incident requiere cruce manual con LB logs.
- **Recomendación**: agregar IP (de `c.req.header('x-forwarded-for')`) y UA al log de fail.

#### SEC-034 — [MEDIUM] Stack traces de error pueden filtrar al cliente
- **Evidencia**: `apps/api/src/routes/admin-seed.ts:61` y `admin-seed.ts:76` (`detail: (err as Error).message` en response 500). Idem `admin-matching-backtest.ts:158`. La `message` puede contener detalles de schema BD u otros.
- **Impacto**: information disclosure.
- **Recomendación**: nunca devolver `err.message` en 500 al cliente — solo log internamente y responder `{ error: 'internal_server_error' }`. El `app.onError` global (`server.ts:509-512`) hace lo correcto; los routes admin lo bypassean.

---

### A10 — Server-Side Request Forgery (SSRF)

#### SEC-035 — [MEDIUM] `computeRoutes` envía `destinationAddress` del trip a Google Routes API
- **Evidencia**: `apps/api/src/services/compute-route-eta.ts:204-218`, `apps/api/src/services/routes-api.ts`.
- **Descripción**: `destinationAddress` viene del shipper al crear el trip (input usuario). Se concatena en JSON body al endpoint Google Routes. No es SSRF clásico (URL es fija, googleapis.com), pero el payload incluye strings arbitrarios. Riesgo bajo: Google parsea geocoding-ready string.
- **Recomendación**: validar longitud máxima del address (`z.string().max(500)`) y normalizar antes de enviar.

#### SEC-036 — [LOW] `fx-rate-service.ts` y `workspace-admin-client-googleapis.ts` hacen outbound a hosts fijos
- **Evidencia**: `apps/api/src/services/observability/fx-rate-service.ts:130` → `MINDICADOR_URL` constante; `workspace-admin-client-googleapis.ts:105,125` → IAM Credentials + OAuth Google endpoints fijos.
- **Sin acción**: hosts no controlados por usuario.

#### SEC-037 — [INFO] No detecté ningún endpoint que haga fetch a URL controlada por user
- **Verificado**: webhooks/dispatchers (`notify-tracking-link`, `notify-offer`, `chat-whatsapp-fallback`) hablan con Twilio (host fijo). Sin SSRF surface.

---

### Secrets / credenciales

#### SEC-038 — [LOW] Heurística regex (post-pre-flight) — sin hits adicionales
- **Verificado**: `grep -rEi "(api[_-]?key|secret|password|token|bearer)\s*[:=]"` en `apps/`, `packages/`, `infrastructure/`. Los matches son nombres de campos / config (sin valores), strings de error, o placeholders (`ROTATE_ME_*`).
- **Sin acción**: pre-commit con gitleaks documentado en `.husky/pre-commit:6-15` cubre el riesgo de hardcoded secrets futuros (con warning si gitleaks no está instalado localmente).

#### SEC-039 — [LOW] `terraform.tfvars` gitignored, `.tfvars.example` checked-in y sin secrets
- **Verificado**: `.gitignore:25-29` ignora `.env*` salvo `.env.example`; `infrastructure/terraform.tfvars.example` revisado, no contiene valores reales.
- **Sin acción**.

#### SEC-040 — [INFO] `BOOSTER_RUT` default en config = `'76.000.000-0'` (placeholder)
- **Evidencia**: `apps/api/src/config.ts:374`. Mientras Booster Chile SpA no esté constituida, este valor llega a DTEs. Riesgo de emisión a SII con RUT inválido si por descuido se deja en prod.
- **Recomendación**: en startup, si `NODE_ENV='production'` && `DTE_PROVIDER !== 'disabled'` && `BOOSTER_RUT === '76.000.000-0'` → fail-fast.

---

### Persistencia

#### SEC-041 — [INFO] CMEK en GCS (documents, public_assets, uploads_raw, access_logs) + Cloud SQL — encryption-at-rest cumple
- **Verificado** en `infrastructure/security.tf:18-162` y `infrastructure/storage.tf`. KMS rotation 90 días. `prevent_destroy=true` en keys.

---

## 2. Top 10 hallazgos ordenados por severidad × impacto

| # | ID | Sev | Título | Impacto |
|---|---|---|---|---|
| 1 | SEC-001 | BLOCKING | Modo demo activado por default en producción con password hardcoded | Cualquiera obtiene Firebase token + acceso a tenant demo; password sintético es válido en Firebase Auth real |
| 2 | SEC-025 | BLOCKING | Sin rate-limit en `/auth/login-rut`, `/auth/driver-activate` | Brute-force PIN/clave de 6 dígitos en horas |
| 3 | SEC-030 | BLOCKING | Retention Policy del bucket `documents` `is_locked=false` | Admin malicioso puede borrar DTE pre-6-años, violando SII Chile |
| 4 | SEC-016 | HIGH→BLOCKING | Auto-seed demo corre sobre BD productiva al startup | Contaminación de BD prod con credenciales conocidas si flag mal-aplicado |
| 5 | SEC-002 | HIGH | `POST /admin/seed/demo` no respeta `DEMO_MODE_ACTIVATED` | Admin compromised → seed demo en prod aunque flag esté off |
| 6 | SEC-003 | HIGH | Auto-provisioning de platform-admin sin `claims.emailVerified` | Account takeover vía email no verificado en allowlist |
| 7 | SEC-019 | HIGH | Cloud Armor exempt total del host `api.boosterchile.com` | Endpoints públicos (feature-flags, demo-login, public-tracking) sin WAF |
| 8 | SEC-032 | HIGH | Pino redaction `*.foo` no matchea campos top-level (RUT/email loggeados) | PII en Cloud Logging viola Ley 19.628 + GDPR |
| 9 | SEC-026 | HIGH | Driver activate no chequea user.status pre-PIN verification | Conductor suspendido puede re-activarse con su PIN viejo |
| 10 | SEC-034 | MEDIUM | Stack traces leak via `detail: err.message` en /admin/* | Information disclosure |

---

## Apéndice — Verdict

- **3 BLOCKING** + **1 HIGH escalable a BLOCKING** (SEC-016) deben resolverse antes de que el demo de Corfo (2026-05-18) o el cierre TRL10 se firmen como "secure".
- **Sin findings** en: A03 Injection (parametrized OK), A06 (sin CVE prod), A10 SSRF crítico, secrets en repo (gitleaks pre-commit + heurística pasaron), file traversal (sin sinks `fs.readFile` con input usuario en apps/api/src/services/).
- **Defensa que sí funciona**: Firebase verifyIdToken con `checkRevoked`, scrypt timing-safe (`crypto.timingSafeEqual`), Drizzle parametrized, lint-rls custom para IDOR, Twilio HMAC signature verification, CORS allowlist explícito (no `*`), CSP via secureHeaders, HSTS via LB, KMS para signing de certificados.

