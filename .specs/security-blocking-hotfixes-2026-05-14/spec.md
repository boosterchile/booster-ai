# Spec: security-blocking-hotfixes-2026-05-14

- Author: Felipe Vicencio (with agent-rigor)
- Date: 2026-05-14
- Status: **Approved (2026-05-14T21:45Z)** — H1 retooled reaprobada; OQs Q16/Q19/Q20/Q22 cerradas; R21 + R22 (git history compromise + monitoring) añadidos; ADR-032 referenciado; **PF-1/PF-2/PF-3'/PF-4/PF-5/PF-5.1 ejecutados con decisiones cerradas 2026-05-14T21:45Z**. H2/H3 sin cambios.
- Linked: `/Volumes/Pendrive128GB/Booster-AI/.specs/audit-2026-05-14/security.md` — auditoría de seguridad (SHA256 `ea8f258dca391836142165b9ac46de71d1b4c254d2a7309c84f533f4d371add4`). El archivo vive en la copia principal del repo, no en el worktree.
- Verificación Firebase Auth (snapshot inicial 2026-05-14T18:14Z + **re-verificación 2026-05-14T21:15Z vía PF-5 que corrigió la lista**): tenant `booster-ai-494222` tiene 10 usuarios; **4 cuentas con `customClaims.is_demo=true`** (NO 3 — la snapshot inicial omitió al conductor):
  1. UID `nQSqGqVCHGUn8yrU21uFtnLvaCK2` — `demo-shipper@boosterchile.com` — persona=`shipper`.
  2. UID `Uxa37UZPAEPWPYEhjjG772ELOiI2` — `demo-stakeholder@boosterchile.com` — persona=`stakeholder`.
  3. UID `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1` — `demo-carrier@boosterchile.com` — persona=`carrier`.
  4. UID `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` — `drivers+123456785@boosterchile.invalid` — persona=`conductor`. RUT subyacente `12345678-5` (`DEMO_CONDUCTOR_RUT`). Creado por `seed-demo-startup.ts:ensureConductorDemoActivated`. **Auth pattern (PF-5.1 verificado 2026-05-14T21:30Z)**: el seed comenta "flujo demo entra via custom token, no via signInWithEmailAndPassword" (línea 105-107), pero el password Firebase `BoosterDemo2026!` ESTÁ seteado (línea 142) y es vector de auth válido vía `signInWithEmailAndPassword` directo del SDK Firebase. **CASE A confirmado**: password operacional simétrico con los otros 3 owners; el conductor entra al scope de hardening con la misma rotación + TTL claim. Sin `activation_pin_hash` (limpiado por `ensureConductorDemoActivated:176`), el flow `/driver-activate` retorna 401 para esta cuenta — el vector explotable es exclusivamente el password Firebase. Las 4 cuentas sin `disabled=true`, último sign-in en últimas ~6h desde IPs server-side de Cloud Run (no externas). Uso confirmado como QA interno del sprint demo D1.

> **Naturaleza del cambio**: patch de emergencia. NO es una feature. Compila los 3 hotfixes BLOCKING en un solo ciclo agent-rigor para reducir el time-to-fix sin sacrificar disciplina (spec → plan → build con tests → deploy → verify).

---

## 1. Objective

Cerrar los tres hallazgos BLOCKING de la auditoría de seguridad del 2026-05-14 antes del próximo ciclo de uso operativo en producción. Cada uno es explotable hoy:

- **H1 — DEMO_MODE en producción + 4 cuentas demo sin governance**: el default de Terraform (`demo_mode_activated = true`) está activo en prod, lo que habilita el endpoint `POST /demo/login`, el auto-seed de cuentas demo, y la activación del rol demo en el backend. El password literal `BoosterDemo2026!` está hardcodeado en `apps/api/src/services/seed-demo.ts:86` Y `seed-demo-startup.ts:142`. **Decisión revisada 2026-05-14T18:30Z + ampliada 2026-05-14T21:30Z (post-PF-5.1)**: las 4 cuentas `demo-shipper@`, `demo-carrier@`, `demo-stakeholder@boosterchile.com` + `drivers+123456785@boosterchile.invalid` (conductor demo) son fixtures legítimos del sprint demo D1 (Van Oosterwyk) y NO se eliminan. El fix se reformula como **hardening + governance**: (a) password rotation forzada vía Admin SDK; (b) TTL aplicado vía custom claim `expires_at`; (c) tenant Identity Platform con self-signup OFF para evitar que se sumen cuentas no controladas; (d) auditoría obligatoria del enforcement del claim `is_demo` en todos los endpoints de write del backend (para garantizar que las cuentas demo no puedan modificar datos reales aunque su sesión sea legítima); (e) seed migrado a leer password desde Secret Manager. La ruta `POST /demo/login` (bypass de password sin autenticación) sí se apaga vía `DEMO_MODE_ACTIVATED=false`. Documentación nueva en `docs/qa/demo-accounts.md` y `docs/qa/is-demo-enforcement-audit.md`.
- **H2 — PIN auth sin rate-limit**: el endpoint `POST /auth/driver-activate` (`apps/api/src/routes/auth-driver.ts:65`) verifica un PIN de 6 dígitos numéricos (espacio = 10⁶) sin throttle. Comentario en `activation-pin.ts:10` referencia rate-limit "D9 PR-B" que NO existe en el árbol. Brute force online de un PIN al ~50ms/intento = ~14 horas worst-case para enumerar 10⁶, mucho menos en práctica con paralelismo. Resultado: cualquier RUT placeholder (estado `pendiente_invitacion` con `activation_pin_hash` seteado) es secuestrable.
- **H3 — Bucket DTE sin Retention Lock**: `infrastructure/storage.tf:145` declara `retention_policy { retention_period = 189216000; is_locked = false }` con comentario "CAMBIAR A true MANUALMENTE". Sin lock, el `retention_period` es mutable o eliminable vía Terraform/consola: cualquiera con permisos `storage.buckets.update` puede acortar la retención o borrar el bucket entero. La normativa SII Chile exige conservar DTEs 6 años; un actor interno comprometido o un error operativo puede destruir evidencia legal.

El cambio NO añade funcionalidad nueva. Restaura postura defensiva mínima.

## 2. Why now

- Los 3 hallazgos son **defectos de postura defensiva confirmados por lectura de código y configuración** (no son hipótesis): `infrastructure/variables.tf:369` muestra `default = true`; `apps/api/src/services/seed-demo.ts:86` muestra el literal en claro; `infrastructure/storage.tf:145` muestra `is_locked = false`. Que existan signals de explotación activa en logs es una pregunta abierta — §12 Q12 propone forensia limitada. La urgencia se basa en **superficie expuesta verificada**, no en evidencia de actor activo. (Atendiendo devils-advocate #16: ajusté el framing de "explotable HOY como hecho activo" a "exposición verificada estructuralmente"; nada del fix cambia, pero no inflamos urgencia sin evidencia.)
- Booster-AI tiene usuarios reales en producción (Wave 3 activa con dispositivos Teltonika reportando telemetría — ver memoria `reference_wave_3_v2_secuencia.md`). No es un sandbox.
- CLAUDE.md §"Principios rectores" §1 prohíbe deuda técnica desde day 0 y §7 exige "seguridad por defecto". Los 3 BLOCKING violan ambos.
- El cuarto hotfix posible (rotar credenciales demo expuestas en `docs/` y handoffs commiteados) sigue desde H1 — si no lo cerramos junto, el password rotado del repo queda en el historial git.

## 3. Success criteria

Cada criterio es verificable con un comando o request concreto post-deploy.

### H1 — Demo mode apagado + hardening de cuentas demo

**H1.0 — Demo mode flag y endpoint público (sin cambios respecto a draft original)**
- [ ] **PROOF PRIMARIO**: `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.boosterchile.com/demo/login -H 'content-type: application/json' -d '{"persona":"shipper"}'` → `404`. (Live endpoint, no env-describe; resuelve devils-advocate #15.)
- [ ] **PROOF SECUNDARIO**: la revisión activa de Cloud Run `api-prod` tiene resuelto `DEMO_MODE_ACTIVATED=false`. Comando: `gcloud run revisions describe <revision> --region=<region> --format=json | jq '.spec.containers[0].env[],.spec.containers[0].envFrom[]'` revela el origen (literal o secret) y, si es secret, `gcloud secrets versions access` confirma valor `false`.
- [ ] El default de `infrastructure/variables.tf:369` es `false`.
- [ ] **El literal `BoosterDemo2026!` (y cualquier variante "BoosterDemo2026") no aparece en HEAD**: `git grep -F 'BoosterDemo2026'` retorna 0 matches en código, docs/, handoffs/, infra/. Git history retiene el literal — asumido residual en §9 R4, neutralizado por la rotación de Auth (H1.1).

**H1.1 — Hardening de las 4 cuentas demo existentes (NO eliminación, NO disable)**
Las **4 UIDs** (confirmadas por PF-5 ejecutado 2026-05-14T20:30Z + PF-5.1 ejecutado 2026-05-14T21:00Z):
1. `nQSqGqVCHGUn8yrU21uFtnLvaCK2` — `demo-shipper@boosterchile.com`, persona shipper.
2. `Uxa37UZPAEPWPYEhjjG772ELOiI2` — `demo-stakeholder@boosterchile.com`, persona stakeholder.
3. `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1` — `demo-carrier@boosterchile.com`, persona carrier.
4. **`Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3`** — `drivers+123456785@boosterchile.invalid`, persona conductor (añadida 2026-05-14T21:00Z).

**Pattern de auth del conductor demo (PF-5.1)**: usa AMBOS paths. (a) Primario en flujo demo: custom token vía `POST /demo/login` (mintea con `firebaseAuth.createCustomToken` en `apps/api/src/routes/demo-login.ts`). (b) Secundario / fallback en login normal: `signInWithEmailAndPassword` con email sintético `drivers+123456785@boosterchile.invalid` + password directo `BoosterDemo2026!` (seteado por `apps/api/src/services/seed-demo-startup.ts:148` que también borra el `activationPinHash` en línea 176). El password directo NO es bootstrap-only — es vector activo y forma parte de la superficie del spray attack. Por tanto las 4 cuentas reciben tratamiento simétrico (rotation, TTL, revoke, secret en Secret Manager).

Las 4 cuentas permanecen activas como fixtures de QA del sprint D1.
- [ ] **TTL vía custom claim — 30 días** (cerrado 2026-05-14T19:30Z por Felipe, OQ Q16). Cada cuenta recibe el claim `expires_at` (ISO-8601 UTC) con valor inicial `now + 30 días`, aplicado vía `auth.setCustomUserClaims(uid, { ...existing, expires_at: '<ISO>' })`. Rationale: ventana acotada para evitar fixture permanente (CLAUDE.md §1).
- [ ] **Cron de aviso pre-expiración (T-TTL-WARN)**: nuevo task en plan — `infrastructure/scripts/demo-account-ttl-alerter.ts` (~30 LOC) ejecutado por Cloud Scheduler diario. Lee customClaims de las 4 UIDs, calcula `days_remaining`. Si `days_remaining ≤ 7` para alguna UID, dispara aviso por canal SRE (Slack webhook o equivalente) con: UID, persona, días restantes, comando exacto de renovación. Idempotente (no spam: avisa día -7, -3, -1, 0). Métrica `demo.account.ttl_remaining_days` con alerta Cloud Monitoring si `min < 3`. Mitiga R19 y es la contrapartida operativa al TTL corto.
- [ ] **Backend bloquea login expirado**: middleware standalone `apps/api/src/middleware/demo-expires.ts` (cerrado 2026-05-14T19:30Z por Felipe, OQ Q20 / Q18). Hook order: post-firebaseAuth, pre-router. Lee `claims.expires_at`; si presente y `Date.now() > Date.parse(claims.expires_at)` → `401 demo_account_expired`. Early return si `!claims.expires_at` (cero impacto en cuentas no-demo). Tests unitarios cubren claim vivo, expirado, sin claim, formato inválido.
- [ ] **Refresh tokens revocados** para las 4 UIDs vía `auth.revokeRefreshTokens(uid)` del Admin SDK ANTES del deploy del backend con el middleware de TTL. Cualquier custom token emitido pre-revoke queda inválido en la siguiente verificación de refresh. (Resuelve devils-advocate #7.)
- [ ] **Password rotation forzada**: las **4 cuentas** reciben password nueva vía `auth.updateUser(uid, { password: <random128bit> })`. Password nueva queda en Secret Manager — naming **`demo-account-password-shipper`**, **`demo-account-password-carrier`**, **`demo-account-password-stakeholder`**, **`demo-account-password-conductor`** (4º añadido 2026-05-14T21:00Z post-PF-5.1, OQ Q19 / Q17 ampliada). IAM por separado por secret (blast radius reducido). Password viejo (`BoosterDemo2026!`) queda inválido inmediatamente. **Nota conductor**: aunque el flow demo primario usa custom token y no necesita el password directo, la rotation cierra el vector de spray contra el path `signInWithEmailAndPassword` que el frontend (`login-conductor.tsx:85`) usa como fallback.
- [ ] **Documentación operativa**: `docs/qa/demo-accounts.md` (path nuevo) contiene por cada UID: email, persona, propósito, dueño/operador, fecha de creación, fecha de expiración (=`expires_at`), criterio para suspensión, comando para renovar TTL, comando para rotar password, puntero al secret de Secret Manager. Sin secretos en el archivo — solo punteros.

**H1.2 — Identity Platform: self-signup OFF en el tenant**
- [ ] Setting de Identity Platform → Sign-in providers → Email/Password → "Allow new accounts to sign up" = **OFF**. Verificación: `curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: booster-ai-494222" "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.signIn'` muestra el flag de disable account creation en true (comando exacto a confirmar en /plan; la fuente de verdad es el toggle en consola Firebase).
- [ ] A partir de aquí, solo Admin SDK (con service account autorizada) puede crear cuentas. Auto-signup desde la PWA queda apagado.
- [ ] El setting se aplica vía Terraform (`google_identity_platform_config` resource) si está disponible en el provider actual; si no, se documenta como cambio manual con captura en `docs/qa/demo-accounts.md` y se abre TODO de IaC en §12.

**H1.3 — Enforcement estructural del claim `is_demo` (approach decidido: middleware HTTP global)**

**Decisión 2026-05-14T21:45Z (Felipe, post-PF-1)**: PF-1 reveló **56 write endpoints / 0% enforcement actual**. Magnitud + uniformidad invalida el approach per-endpoint. **Approach final: middleware HTTP global con allowlist explícita**, NO per-endpoint (56 tasks era desproporcionado), NO Drizzle interceptor (HTTP-layer es la defensa correcta; query interceptor responde a problema distinto y tiene risk de bypass via raw queries).

Output obligatorio antes de cerrar H1: `docs/qa/is-demo-enforcement-audit.md` con tabla `path → método → cubierto por middleware global (Y) o allowlist explícita con justificación`.

Implementación en plan v3.1 como **5 tasks T9.0–T9.5**:
- **T9.0**: `apps/api/src/middleware/is-demo-enforcement.ts` con 3 modos (`requireNotDemo` / `requireNotDemoOrSandbox` / `explicitAllow`).
- **T9.1**: wire global en `apps/api/src/main.ts` (default `requireNotDemo` aplicado a TODOS los POST/PUT/PATCH/DELETE).
- **T9.2**: `apps/api/src/middleware/is-demo-allowlist.ts` (lista de paths abiertos a demos; estado inicial vacío o casi).
- **T9.3**: audit doc `docs/qa/is-demo-enforcement-audit.md` con los 56 endpoints + cómo cubiertos.
- **T9.4**: integration tests E2E sobre 5-10 endpoints muestreados (demo → 403; no-demo → 200).
- **T9.5**: observabilidad — métrica `auth.is_demo.blocked` + structured logging por endpoint denegado (correlationId, path, persona; NO body).

Criterios de cierre:
- [ ] **PF-1 confirma 56 endpoints, 100% sin enforcement actual**. Plan v3.1 T9.0–T9.5 entrega cobertura por default a TODOS via middleware global.
- [ ] T9.4 integration tests verdes sobre muestreo de 5-10 endpoints.
- [ ] T9.3 audit doc commiteado.
- [ ] T9.2 allowlist explícita con comentario inline justificando cada entry.
- [ ] **0 endpoints HIGH sin política** = trivialmente cierto post-T9.1 (middleware global = default reject).
- [ ] El audit doc se commitea junto con el fix; entradas se actualizan si /plan o /build añaden endpoints.

**Plan v3 → v3.1: T9.0 y T9.x marcados "deferred hasta T8"**.

**H1.4 — Seed con password fijo: investigación y migración a Secret Manager**
Investigación obligatoria (resultado documentado en /plan):
- [ ] Búsqueda exhaustiva en `apps/api/src/`, `packages/`, `scripts/`, `infrastructure/`, `.github/workflows/` por referencias a los 3 emails (`demo-shipper@`, `demo-carrier@`, `demo-stakeholder@boosterchile.com`) y al literal `BoosterDemo2026`. Output: lista de archivo:línea con cada match.
- [ ] **Identificar el seed source**: si existe un script (`seed-demo.ts`, `seed-demo-startup.ts`, etc.) que crea/garantiza las cuentas, queda identificado y referenciado.
- [ ] **Migración a Secret Manager**: el seed lee el password desde `process.env.DEMO_SEED_PASSWORD`, que en Cloud Run viene de un secret nuevo `demo-seed-password` (Terraform resource + IAM binding solo al service account del API + QA). El seed CRASHEA si la env no está set y `DEMO_MODE_ACTIVATED=true` (no acepta fallback al literal). Default si no está disponible: el seed NO corre, no genera fallback con password trivial.
- [ ] Si el grep encuentra password fijo en código fuera del seed (helpers de test, fixtures duplicados), se rota igual al patrón Secret Manager.

**H1.5 — Forensia limitada de literal expuesto + monitoring sostenido**
- [ ] **One-shot pre-rotation** (parte de T12a + OPS-X-PASSWORD-SPRAY-RETROACTIVE): scan de Cloud Logging / Identity Platform audit logs últimos 60 días buscando logins exitosos con el password `BoosterDemo2026!` contra cuentas no-demo + password-spray controlado sobre **TODO** el universo no-demo del tenant (no muestreo). Limitación conocida: Firebase no loggea el password en audit logs (es por diseño); el scan se hace por proxy. Resultado documentado antes de marcar H1 como `done`. Si hay match → escala a R17 (incident response).
- [ ] **Monitoring sostenido 90 días post-deploy** (OPS-Y — ver §9 R21 expansión): Cloud Logging filter + Pub/Sub topic `password-spray-alerts` + Cloud Function `password-spray-incident-trigger` que dispara R17 ante cualquier intento detectado de `signInWithPassword` con el literal. Owner: Felipe. Criterio de cierre triple: 90 días sin matches + rotación verificada + Secret Manager deployed. Ante match: pausa todo, ejecuta incident response, notifica usuario afectado, evalúa reporte regulatorio.

**H1.6 — Criterios consolidados (resumen ejecutable para verificación)**
- [ ] `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.boosterchile.com/demo/login` → **`404`**.
- [ ] Tenant Identity Platform: **self-signup OFF** (Admin API confirma).
- [ ] Las 4 cuentas demo: **`expires_at` presente en customClaims, password rotada (literal viejo inválido), documentadas en `docs/qa/demo-accounts.md`**.
- [ ] **`docs/qa/is-demo-enforcement-audit.md` generado, revisado, 0 endpoints write con severity HIGH**.
- [ ] **Seed lee password desde Secret Manager** (`DEMO_SEED_PASSWORD` env → secret `demo-seed-password`). No hay fallback al literal en código.
- [ ] `git grep -F 'BoosterDemo2026'` en HEAD del repo entero retorna **0 resultados**.

### H2 — Rate-limit en PIN auth
- [ ] `POST /auth/driver-activate` retorna `429 too_many_attempts` después de **5 intentos al endpoint** (éxito o fallido) por RUT en ventana de **15 minutos**, con header `Retry-After` en segundos. **Semántica locked**: todos los intentos cuentan (éxito + fallido); el éxito limpia el lockout para el próximo ciclo sin retro-borrar el counter histórico. (Resuelve devils-advocate #1.)
- [ ] El counter por RUT vive en Redis (instancia ya provisionada — `apps/api/src/services/observability/cache.ts:44` confirma `ioredis` configurado vía `REDIS_HOST/PORT/PASSWORD/TLS`). Key namespace: `rl:pin-activate:<rutNormalizado>`.
- [ ] La operación INCR + PEXPIRE + read TTL se ejecuta como **un solo `EVAL` con script Lua atómico** (single round trip), no como dos comandos secuenciales. Benchmark adjunto al PR demuestra overhead p95 ≤ 5ms en Cloud Run → Memorystore LAN. (Resuelve devils-advocate #12.)
- [ ] Comportamiento ante Redis caído = **fail-closed con degradación a limiter in-process** (per-instance, 3 intentos/hora hard cap). Un circuit breaker abre tras 3 fallos consecutivos de Redis en 30s y se cierra cuando un health check de Redis vuelve verde. Métrica `rate_limiter.fallback_active=1` durante degradación. (Resuelve devils-advocate #2.)
- [ ] Intento fallido número 5 dispara: (a) lockout durante 15 min, (b) métrica OpenTelemetry `auth.pin.lockout` con label `rut_hmac` (HMAC-SHA256 con pepper de Secret Manager, NO truncate-SHA256), (c) log estructurado WARN con `correlationId` únicamente, sin RUT en claro ni hash. (Resuelve devils-advocate #10.)
- [ ] Cuando un éxito sigue a ≥3 fallos en la misma ventana, emitir log `auth.pin.suspicious_success` severity ERROR + métrica con alerta SRE. (Resuelve devils-advocate #11.)
- [ ] Carrier-side PIN regeneration (endpoint existente en `conductores.ts`) **resetea** la key `rl:pin-activate:<rutNormalizado>` como parte del flow de regeneración. (Resuelve devils-advocate #9.)
- [ ] El comentario engañoso "ver D9 PR-B" en `apps/api/src/services/activation-pin.ts:10` queda eliminado o reemplazado por referencia al módulo real.
- [ ] Tests unitarios con mock de `ioredis` cubren: éxito, intento fallido contado, 5 intentos → lockout, ventana expira → counter resetea, Redis caído → degradación a in-process limiter, regeneración de PIN resetea counter, suspicious-success log emitido.
- [ ] Test de integración levanta un Redis real (vía testcontainer o `redis-server` en CI) y valida el flujo completo + el script Lua.

### H3 — Retention Lock en bucket DTE
- [ ] `gcloud storage buckets describe gs://booster-ai-documents-prod --format='value(retentionPolicy.isLocked)'` retorna `true`.
- [ ] `retention_period` = **`189216000` segundos exactos** (6 años calendario desde la fecha de emisión de cada DTE individual). Cálculo: `6 × 365.25 × 86400 = 189216000`. Marco legal: **Ley N° 19.799** (Documentos Electrónicos y Firma Electrónica) + **Ley N° 20.727** (Ley de Facturación Electrónica) + resoluciones SII relacionadas. Clock origin = emisión del DTE individual (no fin de año fiscal). Confirmado por Felipe 2026-05-14 (cerrado §12 Q11). Justificación replicada en ADR-031.
- [ ] El comentario "CAMBIAR A true MANUALMENTE" desaparece de `infrastructure/storage.tf`. Es reemplazado por nota de irreversibilidad.
- [ ] El plan de despliegue documenta explícitamente que la operación es **irreversible** y registra la confirmación humana (firma en PR + ADR de constancia).
- [ ] Pre-flight check de `gcloud storage objects list --recursive` confirma que ningún objeto tiene una `temporaryHold` o `retention.retainUntilTime` mayor al período objetivo (`now + retention_period_segundos`), lo cual haría fallar el lock.
- [ ] **Plan diff isolation**: `terraform plan` para el apply de H3 muestra EXACTAMENTE un cambio: `retention_policy.is_locked: false → true`. Cero cambios colaterales — específicamente `retention_period` no se modifica en el mismo plan. Si está mal, **primer apply** corrige `retention_period`, **segundo apply** flipea `is_locked`. (Resuelve devils-advocate #4.)
- [ ] **Validación previa en bucket real con período de 6/7 años**, no en scratch bucket de 60s. Si no existe staging bucket equivalente, se crea uno con el mismo módulo `gcs-bucket` + mismo período (NO lockado) y se aplica el lock allí primero. (Resuelve devils-advocate #14.)

## 4. User-visible behaviour

Ninguno de los 3 hotfixes cambia UX para usuarios legítimos de producción.

- **H1**: usuarios de prod (`app.boosterchile.com`) no usan el flow demo. La PWA detecta `host=demo.*` para mostrar selector; eso queda apagado. Si alguien navega a `demo.boosterchile.com` después del cambio, la PWA muestra `/login` normal y el backend devuelve `404` a `/demo/login`. **Las 4 cuentas demo siguen activas** para QA interno (sprint D1) con login estándar contra `app.boosterchile.com` usando el password rotado; el operador/QA recupera el password actual desde Secret Manager. Quien intente loguear con `BoosterDemo2026!` recibe `401 invalid_credentials` (password ya inválido). Las próximas demos públicas usarán un entorno separado con credenciales rotadas dinámicamente — ver §5.
- **H2**:
  - Driver legítimo activa con PIN correcto al primer intento → comportamiento idéntico (200 con `custom_token`).
  - Driver tipea PIN incorrecto < 5 veces → mismo `401 invalid_credentials` actual.
  - Driver tipea PIN incorrecto 5 veces → `429 too_many_attempts` con cuerpo `{ "error": "too_many_attempts", "retry_after_seconds": <s> }` y header HTTP `Retry-After`.
  - El cliente PWA (`/app/conductor/login`) debe mostrar mensaje en español: *"Demasiados intentos. Intenta de nuevo en X minutos. Si olvidaste tu PIN, contacta a tu transportista."*. (Ajuste del cliente queda en scope.)
- **H3**: invisible al usuario final. Cambia postura del bucket. Implicación operativa: durante 6 años, ningún operador puede borrar/acortar la política. Cualquier intento desde consola/Terraform/`gsutil` falla con `409 retentionPolicyNotMutable`.

## 5. Out of scope

Listado explícito de cosas que NO se hacen en este ciclo, para evitar scope creep:

- **Re-arquitectura del modo demo**. Borrar `seed-demo.ts` y la ruta `/demo/login` completas queda para un ADR separado. Acá solo se apaga el flag y se neutralizan credenciales filtradas.
- **Eliminación de las 3 cuentas demo**. Decisión revisada 2026-05-14T18:30Z: las cuentas se hardenean (TTL + password rotada + docs/qa/), NO se eliminan ni se deshabilitan. El delete o disable definitivo queda atado a la decisión futura sobre el modo demo (mismo ADR separado).
- **Migración del audit `is_demo` a OPA / Cedar / política externa**. La auditoría H1.3 deja la postura actual documentada; convertirla en política como código queda como follow-up.
- **Rate-limit global** sobre todos los endpoints del API. Acá se cubre **únicamente** `POST /auth/driver-activate`. (El servicio similar `clave-numerica.ts` tiene el mismo patrón scrypt y probablemente necesita rate-limit también — ver §12.)
- **WAF / Cloud Armor rules nuevas**. Existe configuración previa (ver memoria `reference_cloud_armor_opt_out_syntax.md`). No se toca acá.
- **Auditoría retro de logs** para determinar si alguien explotó alguno de los tres ya. (Lo hacemos como tarea aparte; el spec entrega los hotfixes, no la forensia.)
- **Mover el bucket DTE a Bucket Lock vía CMEK key rotation policies**. La política de retención queda lock-on con la KMS key ya existente.
- **Migración de PINs activos** (los users con `activation_pin_hash` ya seteado). Los counters arrancan limpios; intentos previos no cuentan.
- **Tocar staging.tfvars / dev.tfvars**. Si no existen (confirmado: solo `terraform.tfvars.example`), no se crean acá.
- **CI/CD hooks nuevos** que bloqueen `grep -F 'BoosterDemo'` en futuros commits — esa regla a `gitleaks` queda como follow-up.

## 6. Constraints

1. **Cumplimiento normativo** — SII Chile exige preservar DTEs 6 años (ADR-007). H3 alinea infra con requisito legal.
2. **Continuidad de servicio** — los 3 hotfixes deben aplicarse sin downtime de `api-prod`. El API ya recibe tráfico de drivers Wave 3 reportando telemetría.
3. **Type safety end-to-end** (CLAUDE.md §5) — el rate-limiter debe exponer una interface tipada en `packages/` o `apps/api/src/services/` y consumirse desde el route handler sin `any`.
4. **Observabilidad desde el primer endpoint** (CLAUDE.md §6) — H2 emite log estructurado + métrica + (idealmente) span OpenTelemetry desde el primer commit; no "lo agregamos después".
5. **Sin secretos en repo** (CLAUDE.md §"Principios rectores" §1) — el password demo en `seed-demo.ts:86` es un secreto explotable. No se sustituye por `process.env.DEMO_PASSWORD || 'BoosterDemo2026!'`; el literal sale por completo.
6. **Irreversibilidad de H3** — `is_locked = true` no se puede deshacer con Terraform ni consola. La política queda inmutable hasta que cada objeto cumpla su retention. Esto es feature, no bug; debe documentarse en ADR de constancia.
7. **Performance del rate-limiter** — overhead por request debe ser < 10ms p95 (un `INCR` + `EXPIRE` Redis local LAN ≈ 1-2ms). No se acepta solución que añada > 50ms a la ruta.
8. **Compatibilidad backwards** — el shape de respuesta `401 invalid_credentials` actual no cambia. Solo se añade `429 too_many_attempts` como respuesta nueva.
9. **No tocar el path `/admin/seed`** que tiene su propia ruta y autenticación distinta.
10. **PII en logs** — el RUT NO se loggea en claro. Se hashea (SHA-256 truncado a 16 hex) o se omite. Solo el `correlationId` y un identificador hashed quedan en el log.

## 7. Approach

Una sola feature, tres hotfixes con dependencias mínimas. El plan se descompone en `/plan` en tareas atómicas; acá la forma:

### H1 — Demo mode off + hardening de cuentas demo (orden: PRIMERO, es el riesgo más fácil de explotar)

**Subfases**: H1.0 apaga el endpoint público; H1.1–H1.4 ponen governance a las cuentas demo que se mantienen para QA D1; H1.5 ejecuta forensia limitada.

#### Orden de despliegue H1 (NO NEGOCIABLE — derivado de hallazgo seed-en-startup 2026-05-14T19:00Z)

**Crítico**: `ensureDemoSeeded()` se importa en `apps/api/src/index.ts:11` y corre en cada cold-start de Cloud Run si `DEMO_MODE_ACTIVATED=true`. El seed actual hace `await firebaseAuth.updateUser(firebaseUid, { password: 'BoosterDemo2026!' })` (`seed-demo-startup.ts:147-149`), lo que **sobrescribe cualquier rotación de password** ejecutada en H1.1 al próximo cold-start. Por tanto el orden ESTRICTO es:

| Fase | Subfase | Acción | Por qué primero |
|---|---|---|---|
| **1** | H1.0 | `DEMO_MODE_ACTIVATED=false` + `terraform apply` prod + cold-start verificado con la nueva env | Apaga el seed automático. Sin esto, cualquier rotación posterior se evapora al próximo restart. |
| **2** | H1.4 | Seed refactoreado para leer `DEMO_SEED_PASSWORD` desde Secret Manager + crashea fail-fast si env unset & flag true. Merge + deploy. | Aunque alguien re-flipee accidentalmente `DEMO_MODE_ACTIVATED=true`, el seed ya no resucita el literal `BoosterDemo2026!`. Defensa en profundidad. |
| **3** | H1.1 | Rotation passwords + TTL claim + revoke refresh tokens (vía `harden-demo-accounts.ts`). Middleware `demo-expires.ts` mergeado y deployado. | Sin riesgo de overwrite: el seed no corre (H1.0) y aunque corriera no usaría literal (H1.4). |
| **4** | **paralelo** | H1.2 (self-signup OFF), H1.3 (audit `is_demo` + middleware `is-demo-enforcement.ts`), H1.5 (forensia + spray retroactivo per R21) | Independientes entre sí; pueden ir en paralelo una vez fases 1–3 cierran. **H1.5 spray retroactivo (OPS-X) corre ANTES de la rotación H1.1** porque la rotación destruye evidencia — ver §9 R21. |

**Implicación para `/plan`**: el plan v2 actual tiene `T7` (= H1.0 = flag flip) como ÚLTIMA task de Phase A con deps `T4 + OPS-1 + T5 + T6 + T12a`. Eso es **incompatible con este orden** y se debe corregir en una v3 — el plan v3 debe poner `T7` como PRIMERA task de código de Phase A (con deps solo en PF-1..PF-5 + T1 inventario + T12a forensia/spray retroactivo). El re-ordering rompe la cadena `OPS-1 → T6 → T7` y la reemplaza por `T1 → T12a (OPS-X spray) → T7 → T6 → T2/T3 → OPS-1 → T4 → (T5, T8, T9.x en paralelo) → T10 → T11 → T12b`. Detalles concretos a resolver al re-correr `/agent-rigor:plan`.

**H1.0 — Apagar demo mode flag y endpoint público**
1. **Cambiar default**: `infrastructure/variables.tf:369` → `default = false`. Actualizar el comentario de líneas 364-365 (que dice "default true para demo Corfo 2026-05-18") para reflejar la nueva postura.
2. **Verificar overrides**: revisar que no exista ningún `.tfvars` que setee `demo_mode_activated = true`. Confirmado por grep previo — `terraform.tfvars.example` ni siquiera lo lista.
3. **Mapear todos los lectores de `DEMO_MODE_ACTIVATED`** (resuelve H1.4 conceptual): grep estructurado por `DEMO_MODE_ACTIVATED` y `demo_mode_activated` en `apps/`, `packages/`, `infrastructure/`. Para cada match, documentar qué controla:
   - (a) Bypass público `/demo/login` (login sin password). → con flag=false el endpoint debe retornar 404 (confirmado en test existente `apps/api/test/unit/demo-login.test.ts:91`).
   - (b) Auto-seed de cuentas demo al startup (creación inicial). → con flag=false el seed NO corre; las cuentas ya creadas siguen porque viven en Firebase Auth, no en RAM.
   - (c) Activación del rol/persona demo en el backend (lógica de autorización que da a `is_demo` privilegios extra). → debe quedar desactivada por defecto. El claim `is_demo` debe ser un MARCADOR de cuenta restringida, no un boost de privilegios. La auditoría H1.3 lo verifica.
   - Output: tabla en `docs/qa/demo-mode-flag-map.md` (o adjunta al plan) por cada uso del flag.
4. **Deploy del flag**: `terraform apply` en prod → la siguiente release de Cloud Run recibe `DEMO_MODE_ACTIVATED=false`.

**H1.1 — Hardening Firebase Auth (en este orden)**
5. **Inventario y verificación de las 4 UIDs**: confirmar que los UIDs y claims actuales son los esperados (script reusable basado en la query Identity Platform `accounts:query` ya validada hoy en sesión). Snapshot guardado en `docs/qa/demo-accounts.md` como "estado pre-hardening".
6. **Revocar refresh tokens**: `auth.revokeRefreshTokens(uid)` para las 4 UIDs ANTES de tocar password o claims. Esto fuerza al próximo refresh de ID token a fallar, sin esperar al expiry natural.
7. **Rotación de password**: `auth.updateUser(uid, { password: <crypto.randomBytes(32).toString('base64url')> })` para cada uno. Password resultante se escribe directo a Secret Manager con `gcloud secrets create demo-account-password-<persona> --replication-policy=automatic` — **naming exacto**: `demo-account-password-shipper`, `demo-account-password-carrier`, `demo-account-password-stakeholder` (cerrado 2026-05-14T19:30Z por Felipe). IAM binding por separado por secret: operador + QA + service account del API si es necesario para tests E2E. El password NO se loggea a stdout, NO se commitea.
8. **Aplicar TTL via custom claim `expires_at`**: `auth.setCustomUserClaims(uid, { ...existing, expires_at: '<ISO>' })`. Default `now + 30 días`; valor exacto se confirma en /plan tras alinear con QA.
9. **Middleware de TTL en backend**: nuevo archivo (path concreto en /plan, ej. `apps/api/src/middleware/demo-account-ttl.ts`) que lee `claims.expires_at` de cada request autenticado y responde `401 demo_account_expired` si está vencido. Tests unitarios con cuenta viva, expirada, y sin claim (caso no-demo) cubren el matrix.

**H1.2 — Identity Platform: self-signup OFF**
10. Toggle vía consola Firebase (`Authentication → Settings → User actions → Enable create accounts: OFF`) **o** vía Admin API `PATCH /admin/v2/projects/booster-ai-494222/config` con el campo correspondiente (decidir en /plan tras leer la doc de Identity Platform Config v2; provisionalmente el toggle de consola es la fuente de verdad).
11. Si Terraform soporta el campo (`google_identity_platform_config` resource), aplicar vía IaC. Si no, dejar el cambio manual + TODO en `infrastructure/` (open question §12) y captura/verificación en `docs/qa/demo-accounts.md`.

**H1.3 — Enforcement estructural del claim `is_demo` (approach actualizado por PF-1 → middleware HTTP global, no per-endpoint)**

**PF-1 ejecutado 2026-05-14T21:00Z** reveló **56 write endpoints en `apps/api/src/routes/` con 0% enforcement de `is_demo`** (100% sin check). Magnitud + uniformidad invalida el approach per-endpoint del draft original. **Decisión 2026-05-14T21:45Z (Felipe)**: T9 se redefine como **5 tasks estructurales** (no 56), implementando middleware HTTP global con allowlist explícita. NO se adopta Drizzle interceptor (HTTP-layer es la defensa correcta para este vector; Drizzle interceptor responde a un problema distinto — auditoría DB — y tiene risk de bypass via raw queries).

12. **T9.0 — Middleware `is-demo-enforcement.ts`** con 3 modos: `requireNotDemo()` (default: 403 si `claims.is_demo === true`), `requireNotDemoOrSandbox(handler)` (alternativa pragmática: dispatch a sandbox de datos demo), `explicitAllow()` (whitelist por endpoint, requiere comentario inline justificando).
13. **T9.1 — Wire global en `apps/api/src/main.ts`** post-firebaseAuth, pre-handlers, con default `requireNotDemo`. Aplicable a TODOS los métodos POST/PUT/PATCH/DELETE salvo allowlist.
14. **T9.2 — `apps/api/src/middleware/is-demo-allowlist.ts`** — lista explícita de paths abiertos a cuentas demo. Estado inicial: vacía o casi vacía (decidir en /plan tras inspección manual de cada endpoint).
15. **T9.3 — Audit doc `docs/qa/is-demo-enforcement-audit.md`**: 56 endpoints + cómo están cubiertos (por defecto vía middleware global; whitelisted explícitos vía allowlist con justificación).
16. **T9.4 — Integration tests E2E** sobre 5-10 endpoints muestreados (cuenta demo → POST → expect 403; cuenta no-demo → POST → 200 regresión).
17. **T9.5 — Observabilidad**: métrica `auth.is_demo.blocked` + structured logging por endpoint denegado (correlationId, path, persona, NO body).

**H1.4 — Seed con password fijo: migración**
15. Búsqueda en repo: `git grep -nE "demo-(shipper|carrier|stakeholder)@boosterchile|BoosterDemo2026"` en `apps/api/src/`, `packages/`, `scripts/`, `infrastructure/`, `.github/workflows/`. Cada match se documenta.
16. Identificar el seed source (probablemente `apps/api/src/services/seed-demo.ts` + `seed-demo-startup.ts` ya conocidos, pero confirmar con el grep).
17. Crear secret `demo-seed-password` en Secret Manager (Terraform `google_secret_manager_secret`). IAM binding: service account de Cloud Run del API + operador. Valor inicial = uno de los passwords rotados en H1.1 (decidir en /plan si los 3 se sirven del mismo secret o uno por persona; default propuesto = uno por persona, alineado con H1.1).
18. Modificar el seed:
    - Leer `process.env.DEMO_SEED_PASSWORD` (o el set por-persona). Si la env no está set y `DEMO_MODE_ACTIVATED=true` → CRASHEA con mensaje claro (`throw new Error('DEMO_SEED_PASSWORD missing — refusing to seed with hardcoded literal')`).
    - Si `DEMO_MODE_ACTIVATED=false` → seed no corre, no aplica fallback.
    - Borrar la constante `DEMO_PASSWORD = 'BoosterDemo2026!'`. Borrar referencias en `docs/demo/guia-uso-demo.md` (líneas 81, 85, 89, 113, 114, 115, 216) y `docs/handoff/2026-05-11-demo-features-night-sprint.md` (líneas 107, 108), reemplazando por instrucciones de cómo obtener el password vía operador/Secret Manager.

**H1.5 — Forensia limitada**
19. Scan de Identity Platform audit logs 60 días pre-deploy buscando logins exitosos sobre UIDs no-demo con patrón temporal sospechoso (limitación: el password no se loggea). Si surge match con UID no-demo + sign-in inusual → escala a R17 (incident response).

**Verify**: ver §3 H1.0–H1.6.

### H2 — Rate-limit PIN auth (orden: SEGUNDO, requiere más código y tests)

1. **Nuevo package** `packages/rate-limiter/` (no service-local) porque ya hay un segundo caller identificado en §5: `clave-numerica.ts` usa el mismo patrón scrypt-PIN y necesita el mismo rate-limit en H4. Construirlo desde día 1 como package evita reescribir el módulo en el siguiente ciclo. (Resuelve devils-advocate #6.) Interface:
   ```ts
   export interface RateLimiter {
     check(key: string): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }>;
     reset(key: string): Promise<void>;
   }
   ```
   Implementación: fixed-window con Redis `INCR` + `EXPIRE` (sliding window aporta poco al caso 5/15min y duplica complejidad).
2. **Configuración** vía `config.ts`: `PIN_RATE_LIMIT_MAX=5`, `PIN_RATE_LIMIT_WINDOW_SECONDS=900`. Defaults explícitos.
3. **Wiring** en `apps/api/src/routes/auth-driver.ts:65`:
   - Antes del `verifyActivationPin`, llamar `rateLimiter.check(\`pin-activate:${rutNormalizado}\`)`.
   - Si `allowed=false` → return `429 { error: 'too_many_attempts', retry_after_seconds }` + header `Retry-After`. NUNCA revelar si el RUT existe (mismo principio que el `401` actual).
   - Si `allowed=true` → ejecutar verificación. Si PIN incorrecto, el `INCR` ya pasó dentro de `check()`, así que el counter avanza solo en checks fallidos? No — INCR siempre. La política "solo fallidos" introduce race conditions; un counter por RUT que cuenta todos los intentos del RUT es simple y correcto. (Decidir en /plan: contar todos vs solo fallidos. Default propuesto: **todos** los intentos al endpoint cuentan, porque un actor legítimo no debería estar enviando 5 PINs en 15 min — eso ya es señal de error UX o ataque.)
4. **Resetear contador** en éxito (PIN correcto) para no penalizar UX si el driver se equivocó una vez y después acertó.
5. **Métricas y alertas**:
   - Counter `auth.pin.attempt` con label `result=success|failed|locked_out`.
   - Counter `auth.pin.lockout` que dispare alerta si > 10 lockouts/hora (Cloud Monitoring alert policy nueva en `infrastructure/monitoring.tf`).
6. **Eliminar el comentario engañoso** "ver D9 PR-B" en `apps/api/src/services/activation-pin.ts:10`.
7. **Tests** (TDD strict en `/build`):
   - Unit con `ioredis-mock` (o `vi.mock('ioredis')` siguiendo el patrón de `apps/api/test/unit/observability/cache.test.ts:14`).
   - Integración: levantar Redis (testcontainer o `docker run redis:7`) + supertest contra el handler.

### H3 — Retention Lock activación (orden: TERCERO, requiere confirmación humana doble)

1. **Cambio**: `infrastructure/storage.tf:145` → `is_locked = true`. Borrar comentario "CAMBIAR A true MANUALMENTE" línea 145. Añadir comentario nuevo:
   ```hcl
   # IRREVERSIBLE. Una vez aplicado, el retention_period no se puede acortar
   # ni eliminar hasta que cada objeto cumpla la retención (6 años SII Chile,
   # ADR-007). Cambios futuros a retention_period en este recurso requieren
   # ADR de superseder + procedimiento manual de migración.
   ```
2. **Pre-flight check** (script `infrastructure/scripts/preflight-retention-lock.sh` o ejecución manual documentada):
   - `gcloud storage objects list gs://booster-ai-documents-prod --recursive --format='value(name,retention.retainUntilTime)'` — verificar que ningún objeto tenga `retainUntilTime > now + 189216000s`.
   - Validar que `retention_period` actual del bucket coincide con `189216000`.
3. **Doble despliegue**: aplicar primero en staging (`booster-ai-staging` o lo que corresponda — si no hay staging bucket equivalente, usar un bucket scratch con `is_locked=true` y `retention_period` corto, ej. 60s, para validar que el código Terraform planea+aplica limpio). Luego en prod con confirmación humana explícita en el PR.
4. **`terraform plan`** debe mostrar el cambio antes de `apply`. Operador (Felipe) firma "go" en el PR.
5. **Aplicar** y verificar `gcloud storage buckets describe`.
6. **ADR de constancia** `docs/adr/031-dte-bucket-retention-lock-activated.md` registrando fecha de aplicación, operador, y reconocimiento de irreversibilidad.

### Orden de despliegue y dependencias

| Orden | Hotfix | Razón |
|---|---|---|
| 1 | H1 (demo mode off + hardening cuentas demo + audit is_demo + seed → Secret Manager) | Reduce surface visible de inmediato (H1.0 apaga endpoint público y cuentas con password viejo). H1.1–H1.4 son más extensos que el draft original pero todos paralelizables; H1.3 (audit) puede tener hallazgos que requieran middleware nuevo y por tanto un segundo deploy. NO bloquea H2/H3. |
| 2 | H2 (rate-limit PIN) | Requiere código nuevo + tests, ~medio día. Independiente de H1. Puede ir en paralelo con H1 si trabajamos con dos cabezas, pero secuencial es seguro. |
| 3 | H3 (retention lock) | Último porque es irreversible y demanda confirmación humana explícita. NO acoplar a otros despliegues — apply propio, ventana propia. |

H1 y H2 son **hot deploys** (no requieren ventana de mantenimiento). H3 también es hot deploy técnicamente (no afecta el dataplane del bucket), pero por su irreversibilidad se hace en horario laboral con Felipe presente.

## 8. Alternatives considered

- **A. Tres specs separados (uno por hotfix)** — Rechazado porque los 3 están explotables hoy. Tres specs duplican overhead de proceso (3 devils-advocate, 3 reviews, 3 ledger trails) y diluyen la urgencia visible. Un solo spec con secciones internas H1/H2/H3 da trazabilidad sin ralentizar el patch.
- **B. Hotfix directo en `main` sin pasar por agent-rigor** (rama, commit, deploy ya) — Rechazado porque viola CLAUDE.md §3 "Process over knowledge" y §"Decisiones en ADRs, no en conversación". El proceso liviano (spec compacto + plan corto + build con tests) cuesta horas, no días, y previene introducir regresiones (ej. romper la ruta de activate al añadir rate-limit). El precedente de "hotfix sin spec" es la deuda que el repo no quiere acumular.
- **C. Rate-limit en memoria (Map en proceso) en vez de Redis** — Rechazado: Cloud Run autoescalea con N instancias; un Map per-instance permite a un atacante distribuir el brute force entre instancias y multiplicar la tasa por N. Redis es ya una dependencia confirmada del API (`ObservabilityCache`, whatsapp-bot conversation store) — la curva de costo es 0.
- **D. Lockout permanente tras N intentos** (no temporal) — Rechazado: penaliza desproporcionadamente al driver legítimo que olvida su PIN. La política "5 en 15min con reset por ventana" es el balance estándar OWASP ASVS 4.0 §V2.2.1.
- **E. Borrar `seed-demo.ts` y `/demo/login` completos en este patch** — Rechazado por scope: la decisión de eliminar el modo demo merece ADR y planificación de cómo correrán las próximas demos (Felipe lo hace en otro entorno, lo hace con seed manual, etc.). Acá solo se apaga el flag y se neutralizan credenciales filtradas.
- **F. Rate-limit por IP en vez de por RUT** — Rechazado: el driver legítimo se loguea desde NAT móvil que comparte IP con miles. Bloquear por IP genera falsos positivos masivos. Por RUT es preciso: 1 RUT = 1 driver objetivo.

## 9. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Aplicar `is_locked=true` con período mayor a archivos pre-existentes con `retention.retainUntilTime` ya futuro → `terraform apply` falla mid-state. | M | M | Pre-flight check obligatorio (§7 H3 paso 2). Apply solo si el check pasa. Plan documenta rollback (revertir el `is_locked=false` en código antes de re-apply). |
| R2 | Apagar demo mode rompe demos en curso o pre-agendadas. | L (Corfo fue 2026-05-18, hoy 2026-05-14 → ya pasó) | L | Comunicación a Felipe + stakeholders pre-deploy (§11). Si hay demo pendiente, se difiere o se levanta entorno demo dedicado. |
| R3 | Redis caído deja al rate-limiter sin estado. | M | H (sin rate-limit el endpoint vuelve al estado "explotable") | **Resuelto por devils-advocate #2**: default = fail-closed con degradación a limiter in-process (per-instance, 3 intentos/hora). Circuit breaker abre tras 3 fallos consecutivos de Redis en 30s, cierra al primer health check verde. Métrica `rate_limiter.fallback_active` dispara alerta SRE. NO fail-open. |
| R4 | El password literal vive en el historial git aun después de borrarlo. | H (es certeza) | M | El password se considera **quemado**. El fix incluye **rotarlo en Firebase Auth** vía `auth.updateUser(uid, { password: <random128bit> })` para las 4 UIDs (H1.1 paso 7). El password nuevo vive solo en Secret Manager; el literal viejo deja de aceptarse en el momento que se aplica la rotación. No usaremos `git filter-repo` — la rotación de Auth es la mitigación verdadera y suficiente. |
| R5 | Lockout 429 por RUT abre vector de DoS: un atacante puede inhabilitar a un driver específico tipeando 5 PINs malos contra su RUT. | M | M | Aceptado como residual: la activación es one-shot (el driver activa una vez y nunca más); el atacante necesita conocer el RUT y la ventana de activación. Métrica de "lockouts anómalos" permite detectar el patrón. Mitigación stretch: el carrier puede regenerar el PIN (ya existe el flow). |
| R6 | El cliente PWA `/app/conductor/login` no maneja el nuevo 429 y muestra un error genérico. | H | L | Scope incluye ajustar el error handling en el frontend del login conductor — tarea explícita en /plan. |
| R7 | `terraform apply` para H1 reinicia Cloud Run y rompe sesiones activas. | L (Cloud Run hace rolling) | L | Cloud Run rolling deploy normal. No requiere ventana. |
| R8 | Forensia post-mortem revela explotación previa. | L (sin evidencia hoy) | H (incidente reportable a usuarios) | Out of scope acá; tarea de forensia separada pero programada para post-deploy de los 3 hotfixes (revisar `Cloud Logging` por actividad sospechosa en `/demo/login` y `/auth/driver-activate` últimos 30 días). |
| R9 | Activar Retention Lock impide borrado legítimo (e.g. usuario solicita "derecho al olvido" GDPR). | L (Chile no aplica GDPR estricto; SII tiene prioridad legal) | M | DTEs son obligación tributaria, no PII opcional. Si llega un requerimiento de borrado, se gestiona por canal legal, no operativo. Documentado en ADR-031. |
| R10 | Devils-advocate detecta gap no anticipado que extiende scope. | M | L | Capturar en §12 y reescopar conscientemente. NO ejecutar hotfix sin cerrar gaps. |
| R11 | Future PR edita `retention_period` y flipea `is_locked` en el mismo plan; el período queda incorrecto e inmutable 6+ años. | L (post-lock) | H (irreversible) | (devils-advocate #4) Plan-diff isolation: el apply de H3 muestra UN solo cambio. CI rule a futuro (post-hotfix): cualquier plan que combine `is_locked: true` con cambio en `retention_period` falla automáticamente. Split en dos applies si hay drift. |
| R12 | Atacante encadena lockout → PIN regeneration → re-lockout para DoS permanente al driver. | M | M | (devils-advocate #9) Carrier-side PIN regeneration **resetea** la key `rl:pin-activate:<rut>`. Test T28 verifica. Alerta SRE si misma RUT acumula >2 ciclos lockout-regenerar en 24h (señal de targeted DoS). |
| R13 | Éxito de PIN tras múltiples fallos enmascara compromiso parcial. | L | M | (devils-advocate #11) Log estructurado `auth.pin.suspicious_success` severity ERROR cuando `success` sigue a ≥3 fallos en la ventana. Counter resetea pero el evento queda registrado para auditoría. |
| R14 | Overhead del rate-limiter sobre la ruta `/auth/driver-activate` excede el budget; SRE relaja timeouts; degradación enmascara fallos. | M | M | (devils-advocate #12) Implementación atómica vía Lua script (single `EVAL`). Benchmark en CI muestra p95 ≤ 5ms LAN. Si excede, build falla y se itera. |
| R15 | Logs revelan identidad de driver locked-out porque "hash" es invertible. | M | M | (devils-advocate #10) HMAC-SHA256 con pepper por entorno en Secret Manager (no truncate-SHA). Solo label `rut_hmac` queda en métricas; el log usa solo `correlationId`. |
| R16 | DNS `demo.boosterchile.com` apunta a Cloud Run incluso post-`DEMO_MODE=false`; un attacker descubre la URL aunque el endpoint retorne 404. | L | L | (devils-advocate suplementario) Aceptado residual: 404 es respuesta neutra. Eliminar el DNS record + subdomain mapping queda como follow-up en el ADR de cierre del modo demo. |
| R17 | Forensia "limitada" descubre que el password leaked se usó contra cuentas reales — incidente reportable bajo Ley 19.628 / 21.719. | L (probabilístico) | H (notificación regulatoria + posibles sanciones) | (devils-advocate #13) §3 H1 incluye scan de Identity Platform audit logs 60 días pre-deploy. Si hay match positivo → escala a incident response, NO se cierra H1 hasta haber notificado a los usuarios afectados y registrado el incidente con autoridad. |
| R18 | Cuentas demo permanecen activas y un endpoint write se escapa de la auditoría H1.3 (gap del grep). Una sesión demo modifica datos productivos. | M | H | Audit H1.3 corre por grep automatizado + revisión manual cruzada. Re-corrida obligatoria tras cada PR que añada o renombre rutas (regla en `.github/workflows/` queda como follow-up). Hasta que la regla CI exista, el cierre de H1 incluye snapshot del grep firmado. |
| R19 | TTL via custom claim `expires_at` no se renueva y QA queda sin acceso a las cuentas demo en medio del sprint D6. | M | L (interno, no afecta prod) | `docs/qa/demo-accounts.md` lista comando para renovar TTL (`auth.setCustomUserClaims(uid, { ...c, expires_at: <new ISO> })`). Recordatorio 7 días antes del expiry vía métrica `demo.account.ttl_remaining_days` con alerta. |
| R20 | Self-signup OFF rompe algún flow legítimo si el frontend hace `createUserWithEmailAndPassword` para usuarios reales. | M | M (UX rota para registro real) | Pre-flight check: grep en `apps/web/` por `createUserWithEmailAndPassword` y otros métodos de signup; si existen, decidir antes de apagar self-signup si esos flows usan Admin SDK (server-side) o el SDK cliente. Si usan cliente → o el toggle queda OFF y se migra el flow a Admin SDK server-side, o queda ON y la control plane queda como manual. Decisión documentada en /plan. |
| R21 | **Compromise del literal `BoosterDemo2026!` en git history público.** El literal vivió 4 días en `main` del repo `boosterchile/booster-ai` (GitHub), commits `8400542` (2026-05-10 23:01 -0400) → `ec86cfd` (2026-05-13 15:43 -0400). Distribución asumida: todo clon del repo entre esas fechas + CI runners + GitHub Actions cache + backups GitHub (~90d retention) + mirror GitLab + GitHub Archive (BigQuery export) + cache de agentes AI. **`gh api repos/.../forks` retornó 0 forks pero ese dato NO captura clones directos, mirrors externos, ni indexación por code-search engines** — la exposición es estructural, no contable. | H (es certeza histórica) | H (password-reuse en cuentas productivas no se detecta sin scan activo) | **Decisión 2026-05-14T19:30Z (ver ADR-032)**: Opción C — aceptar compromise permanente del literal + ejecutar **dos defensas complementarias**: (a) **OPS-X-PASSWORD-SPRAY-RETROACTIVE** dentro de T12a (one-shot, pre-rotation): password-spray sobre TODO el universo no-demo del tenant (no muestreo) con el literal. Si 0 matches → continuar OPS-1. Si ≥1 → R17 incident response; (b) **OPS-Y-PASSWORD-SPRAY-MONITORING** (ver bloque OPS-Y abajo): monitoring sostenido 90 días post-deploy con alerta automatizada que dispara en cualquier intento de `signInWithPassword` que use el literal. Opción B (`git filter-repo`) rechazada por costo de coordinación (rompe SHAs, signatures, agentes IA con clones cacheados) sin reducir el riesgo real (humano que reutilizó password). |

### OPS-Y — Monitoring sostenido password-spray `BoosterDemo2026!` (cierra el ciclo de R21)

| Campo | Valor |
|---|---|
| **Tipo** | OPS task de larga duración (no produce diff a main; vive como infra + alert policies). |
| **Owner** | Felipe Vicencio (solo-dev) hasta que exista equipo de security dedicado. |
| **Duración** | 90 días desde la fecha de deploy de H1 (no 30). Override conservador sobre la práctica común porque el blast radius del literal es desconocido (repo público + indexación). |
| **Acción técnica** | Cloud Logging filter sobre logs de Identity Platform que captura cualquier intento de `signInWithPassword` cuyo payload (o request signature derivada) corresponda al literal `BoosterDemo2026!`. **Limitación conocida**: Firebase no loggea el password en audit logs por diseño; el filter se construye sobre proxies (intentos contra UIDs específicos + fingerprint del request + tasa de fallos sospechosa). Implementación: Cloud Logging sink → Pub/Sub topic `password-spray-alerts` → Cloud Function `password-spray-incident-trigger` que dispara R17 incident response (notification + auto-suspend candidato si match alta confianza). |
| **Criterio de cierre (los TRES deben cumplirse para archivar)** | 1) 90 días corridos sin matches confirmados. 2) Las 4 cuentas demo tienen `password_rotated_at` ≥ fecha-rotación (OPS-1 ejecutado y verificado). 3) Secret Manager `demo-account-password-{shipper,carrier,stakeholder}` + `demo-seed-password` fully deployed con IAM correctos. |
| **Acción ante match** | **Pausa todo el flujo H1/H2/H3 en progreso** (si aún hay tasks abiertas). Ejecutar R17 incident response: suspender cuenta(s) afectada(s) con `disabled=true` vía Admin SDK, forzar password reset (`generatePasswordResetLink`), notificar al usuario afectado por canal de comunicación pre-acordado (email + WhatsApp si aplica), registrar el incidente en `docs/incidents/<fecha>-password-spray-boosterdemo.md`, escalar comunicación regulatoria si aplica (Ley 19.628 / 21.719). NO cerrar el incidente hasta que la cadena de impacto esté entendida. |
| **Métricas asociadas** | `security.password_spray.attempts_total` (counter), `security.password_spray.matches_total` (counter; debería ser 0), `security.password_spray.unique_uids_targeted` (gauge). Dashboard Cloud Monitoring dedicado. |
| **Trazabilidad** | OPS-Y es task separada en plan v3 (no inline con T12a). Deps: `T12b` (post-deploy verification completa) → OPS-Y arranca. ADR-032 documenta la decisión de monitoreo 90d como parte de Opción C. |

## 10. Test list

### H1 — Demo mode off + hardening cuentas demo

**Tests H1.0 (flag y endpoint)**
- T1: unit `apps/api/test/unit/demo-login.test.ts` con `DEMO_MODE_ACTIVATED=false` debe seguir devolviendo `404 not_found` (ya existe línea 90; verificar que sigue verde).
- T2: unit `apps/api/test/unit/seed-demo-startup.test.ts` con `DEMO_MODE_ACTIVATED=false` no debe llamar `seedDemo` (ya existe línea 110; verificar).
- T3: **PROOF PRIMARIO** — integration manual post-deploy: `curl -s -o /dev/null -w '%{http_code}' https://api.boosterchile.com/demo/login -X POST -d '{"persona":"shipper"}' -H 'content-type: application/json'` → 404. Ejecutar tras revisar que la revisión activa de Cloud Run sea la post-deploy (`gcloud run revisions list`).
- T4: `git grep -F 'BoosterDemo2026'` sobre HEAD debe retornar 0 matches en código, docs/, handoffs/, infra/. Git history no se purga (asumido residual R4).
- T6: el comentario del `variables.tf:364-365` está actualizado para reflejar postura "demo OFF por default".

**Tests H1.1 (hardening Firebase Auth)**
- T1.1a: tras correr el hardening, `accounts:query` sobre las 4 UIDs muestra `customClaims.expires_at` presente y futuro. Test repetible con script.
- T1.1b: intento de login con password viejo `BoosterDemo2026!` contra cualquiera de los 3 emails responde `INVALID_LOGIN_CREDENTIALS` (`signInWithPassword` REST). Test ejecutable post-rotación.
- T1.1c: intento de login con password nuevo (leído de Secret Manager) responde 200 + ID token. Verificación del claim `is_demo=true` y `expires_at` presente en el ID token decodificado.
- T1.1d: tras revoke, un refresh token emitido pre-revoke falla con `TOKEN_EXPIRED`/`USER_DISABLED` en el siguiente intercambio. Test E2E con SDK admin.
- T1.1e: unit del middleware TTL — cuenta con `expires_at` futuro pasa; cuenta con `expires_at` pasado responde `401 demo_account_expired`; cuenta sin `expires_at` (no-demo) no se ve afectada.
- T1.1f: `docs/qa/demo-accounts.md` existe, contiene las 4 UIDs, lista TTL configurado y comandos de renovación/rotación.

**Tests H1.2 (self-signup OFF)**
- T1.2a: `curl` al Admin API config `GET /admin/v2/projects/booster-ai-494222/config` retorna el flag `signIn.email.allowNewUsers=false` (o nombre exacto a confirmar en /plan).
- T1.2b: intento de `signInWithEmailAndPassword` con email NO existente NO crea cuenta (response `EMAIL_NOT_FOUND` o equivalente). Antes del cambio, dependiendo de la configuración, podía crear; tras el cambio, jamás crea.

**Tests H1.3 (audit is_demo)**
- T1.3a: `docs/qa/is-demo-enforcement-audit.md` existe, está commiteado.
- T1.3b: el audit lista al menos N endpoints (N=número arrojado por el grep estructurado de POST/PUT/PATCH/DELETE en `apps/api/src/routes/`), todos con `enforced=Y` o whitelisted con justificación.
- T1.3c: integration test sintético con custom token que incluye `is_demo=true` contra una muestra de endpoints HIGH → todos responden `403 demo_account_forbidden`. Whitelisted responden 200.

**Tests H1.4 (seed → Secret Manager)**
- T1.4a: el seed crashea si `DEMO_SEED_PASSWORD` no está set y `DEMO_MODE_ACTIVATED=true`. Test unit con env vacío.
- T1.4b: el seed corre limpio si `DEMO_SEED_PASSWORD` está set y `DEMO_MODE_ACTIVATED=true`. Test unit con env mock.
- T1.4c: `grep -r "BoosterDemo2026"` en el repo entero retorna 0 matches en HEAD (mismo que T4 pero verificación independiente post-migración).

**Tests H1.5 (forensia)**
- T5b: password-spray controlado contra Identity Platform: para cada cuenta no-demo (sample o sweep completo), verificar que el password actual NO es `BoosterDemo2026!`. Cualquier match dispara force-password-reset + notificación al usuario antes de cerrar H1.
- T5c: scan de Identity Platform audit logs 60 días pre-deploy buscando logins sospechosos sobre UIDs no-demo. Resultado: 0 matches (esperado) o lista de UIDs afectadas (escala a incident response per R17).

### H2 — Rate-limit PIN auth
- T7: 5 intentos con PIN incorrecto contra el mismo RUT → último intento responde `429`, los 4 anteriores `401`.
- T8: tras `429`, el siguiente intento (en el mismo minuto) sigue `429` con `Retry-After` correcto (decreciente).
- T9: tras esperar la ventana completa (`PIN_RATE_LIMIT_WINDOW_SECONDS`), el counter resetea y el siguiente intento responde `401`/`200` según corresponda.
- T10: PIN correcto al primer intento → `200` + `custom_token` (regresión: comportamiento legacy intacto).
- T11: PIN correcto al 3er intento (después de 2 fallidos) → `200` + `custom_token` + counter reseteado para futuros intentos.
- T12: RUT inválido sintácticamente sigue devolviendo `401` (no consume cuota, o consume cuota — decidir en /plan). Default: **NO consume** (el handler responde 401 antes de tocar el rate-limiter, evita oracle).
- T13: Redis caído → degradación a in-process limiter (3/hora hard cap); métrica `rate_limiter.fallback_active=1`; alerta SRE registrada. Test con mock que rechaza conexión + assertion sobre la métrica. (fail-CLOSED, no fail-open.)
- T14: dos RUTs distintos no se interfieren (counter independiente por key).
- T15: integración con Redis real (testcontainer) — flujo completo de 6 intentos + ventana expirada + ejecución del Lua script atómico.
- T16: el código no loggea el RUT en claro NI el `rut_hmac` en logs; solo `correlationId`. Métricas pueden llevar `rut_hmac` con HMAC + pepper. Tests assertan ambos.
- T17: el comentario "ver D9 PR-B" no aparece más en el código.
- T28: carrier regenera PIN → key `rl:pin-activate:<rut>` queda eliminada (regression contra DoS por lockout encadenado, devils-advocate #9).
- T29: `auth.pin.suspicious_success` se emite cuando éxito sigue a ≥3 fallos en la ventana; NO se emite cuando éxito sigue a 0-2 fallos (devils-advocate #11).
- T30: benchmark del rate-limiter (Vitest bench o k6 mini-script en CI) demuestra p95 ≤ 5ms LAN sobre 1000 ops (devils-advocate #12).
- T31: HMAC-SHA256(rut, pepper) NO es invertible sin el pepper — test que verifica que un atacante con el output completo y la fórmula no puede recuperar el RUT en ausencia del secret (devils-advocate #10).

### H3 — Retention Lock
- T18: `terraform plan` sobre `storage.tf` muestra **EXACTAMENTE** un cambio: `retention_policy.is_locked: false → true`. Cero cambios colaterales — específicamente `retention_period` NO debe aparecer en el diff. Si aparece, abortar y resolver en un primer apply separado.
- T19: pre-flight script confirma 0 objetos con `retainUntilTime > now + retention_period_segundos` (período definido en §3 H3 tras cerrar §12 Q11).
- T20: post-apply `gcloud storage buckets describe gs://booster-ai-documents-prod --format=json | jq '.retentionPolicy'` retorna `{"retentionPeriod":"<período>","isLocked":true,"effectiveTime":"..."}`.
- T21: intento manual post-apply de bajar `retention_period` vía Terraform falla con `409 retentionPolicyNotMutable`.
- T22: tras aplicar, un `gsutil rm` sobre un objeto reciente del bucket falla con error de retención (sanity check de la política).
- T23: ADR-031 existe en `docs/adr/` con fecha, operador, cita de la norma SII que justifica el período (devils-advocate #3) y nota de irreversibilidad.
- T24bis: validación previa en bucket staging real (mismo módulo + mismo período NO lockado), no en scratch de 60s (devils-advocate #14). Lock aplicado en staging primero, verificado con T20-T22 contra el bucket staging, luego prod.

### Verificación cross-cutting
- T24: `pnpm test --filter=@booster-ai/api` pasa con coverage ≥ 80% (CLAUDE.md §1).
- T25: `pnpm lint` 0 errores, 0 warnings.
- T26: `pnpm typecheck` 0 errores. Sin `any` introducidos.
- T27: `gitleaks detect` post-commit no encuentra el password literal.

## 11. Rollout

### Feature-flagged
- H1: ya está feature-flagged (`DEMO_MODE_ACTIVATED`). El cambio invierte el default.
- H2: NO feature-flag. El rate-limit es defensa por defecto. Configurable via env (`PIN_RATE_LIMIT_MAX`, `PIN_RATE_LIMIT_WINDOW_SECONDS`) para ajuste sin redeploy.
- H3: irreversible. NO feature-flag por definición.

### Migración necesaria
- H1: ninguna (config-only).
- H2: ninguna (Redis ya provisionado, no hay datos legacy).
- H3: ninguna (la política aplica forward; objetos ya retenidos siguen retenidos por el período viejo más el nuevo).

### Plan de rollback

| Hotfix | Rollback |
|---|---|
| H1 | **H1.0 (flag)**: revertir commit + `terraform apply` con `demo_mode_activated=true`. Re-deploy Cloud Run con la env vieja. ~5 min. **H1.1 (hardening)**: NO se rollbackea — el revoke de refresh tokens + password rotada son irreversibles (no se restaura el password viejo `BoosterDemo2026!`, eso es feature). Si QA necesita acceso, lee el password nuevo de Secret Manager. Si por error se aplicó TTL muy agresivo (<24h), renovarlo es 1 comando: `auth.setCustomUserClaims(uid, { ...c, expires_at: <new ISO> })`. **H1.2 (self-signup OFF)**: toggle inverso en consola/API. ~1 min. **H1.3 (audit)**: NO requiere rollback (es solo documentación). El middleware `requireNonDemo` se puede sacar revirtiendo el PR si causa falsos positivos. **H1.4 (seed)**: revertir el commit que cambió `seed-demo.ts`. La env `DEMO_SEED_PASSWORD` queda en Secret Manager (no se borra). Total time-to-rollback H1.0: ~5 min; H1.1–H1.4: parcialmente irreversibles por diseño. |
| H2 | Setear `PIN_RATE_LIMIT_MAX=999999` (efectivamente off) vía env var en Cloud Run. Soluciona en < 2 min sin deploy. Para revertir el código completo: revertir PR y redeploy (~15 min). |
| H3 | **No hay rollback** una vez `is_locked=true` aplicado. Mitigación: si Terraform apply falla parcialmente, se revierte el commit pre-apply. Si apply pasa, el lock vive 6 años. |

### Window de despliegue
- **H1 + H2**: hot deploy en horario laboral. No requieren ventana. Tráfico de drivers Wave 3 sigue durante el rolling.
- **H3**: hot deploy también, pero con **Felipe presente** y una ventana de confirmación corta (≤ 30 min entre `terraform plan` y `terraform apply`) para que la firma humana esté fresca. Coordinar fuera de horarios pico operativos.

### Comunicación
- **Equipo interno** (solo Felipe + agentes): handoff en `docs/handoff/2026-05-14-security-hotfixes.md` post-deploy con resumen + comandos de verificación + métricas pre/post.
- **Stakeholders externos / usuarios**:
  - H1: No notificar usuarios finales (no se rompe nada que ellos usen). Notificar a Felipe (PO) por la decisión del demo subdomain.
  - H2: No notificar usuarios finales. El cambio es defensivo y transparente; quien se golpea con el 429 es atacante o driver que se equivocó 5 veces seguidas, no requiere comms broadcast.
  - H3: **Notificación al equipo de compliance / contabilidad** (si existe) sobre la activación del Retention Lock. Documentar en ADR-031 que la inmutabilidad legal está oficialmente respaldada en infra.
- **Incidente vs. mejora preventiva**: estos hotfixes cierran exposures conocidas, no incidentes confirmados. NO se reporta como incidente al SII salvo que la forensia post-deploy revele explotación previa de DTEs (R8).

### Monitoring post-deploy
- H1: dashboard Cloud Monitoring filtrando `/demo/login` → debe quedar a 0 RPS. Alerta si vuelve a > 0.
- H2: dashboard nuevo o panel en uno existente: serie de `auth.pin.attempt` (success/failed/locked_out) por hora. Alerta si `locked_out` pasa 10/hora (sospecha de brute force coordinado o regresión).
- H3: alerta Cloud Monitoring sobre cualquier evento `storage.buckets.update` contra `booster-ai-documents-prod` (debería ser cero post-lock; si dispara, es intento de manipulación).

## 12. Open questions

A resolver antes de `/plan` o explícitamente diferidas a /plan con criterio. Las que el devils-advocate marcó como bloqueantes están señaladas **[BLOQUEANTE]**. **Estado al 2026-05-14T19:30Z**: Q1, Q5, Q11, Q16, Q19, Q20, Q22 cerrados por Felipe. R21 añadido. ADR-032 referenciado. Spec re-aprobado.

1. ~~[BLOQUEANTE] Audit artefacto~~ — **Cerrado 2026-05-14**: el archivo vive en `/Volumes/Pendrive128GB/Booster-AI/.specs/audit-2026-05-14/security.md` (en la copia principal, no en este worktree). SHA256 `ea8f258dca391836142165b9ac46de71d1b4c254d2a7309c84f533f4d371add4` verificado contra el path absoluto. El spec referencia el archivo por su ruta absoluta hasta que se commitee a este worktree.
2. **`clave-numerica.ts` tiene el mismo patrón scrypt PIN.** Derivado a H4 (spec separado). El package `packages/rate-limiter/` que se construye en H2 sirve a H4 sin refactor.
3. ~~Fail-open vs fail-closed Redis~~ — **Resuelto** (devils-advocate #2): fail-closed con degradación in-process. Reflejado en §3 H2 y §9 R3.
4. ~~Contar todos vs solo fallidos~~ — **Resuelto** (devils-advocate #1): contar todos (éxito + fallido). Reflejado en §3 H2.
5. ~~Disable o delete de las 3 cuentas demo~~ — **Cerrado 2026-05-14T18:30Z por Felipe**: **ninguno**. Las 3 cuentas se mantienen activas como fixtures de QA D1, hardeneadas vía password rotation + `expires_at` claim + audit `is_demo`. Reflejado en §3 H1.1 y §7 H1.1. Disable/delete definitivo queda atado al ADR futuro sobre el modo demo (§5 out-of-scope).
6. ~~Staging real vs scratch bucket~~ — **Resuelto** (devils-advocate #14): se usa staging bucket real con mismo período (sin lock); si no existe, se crea como parte del hotfix. Reflejado en §3 H3 + T24bis.
7. **¿Quién firma "go" para H3?** Default: Felipe Vicencio como PO. Cerrar en /plan.
8. **¿Tocamos el cliente PWA del login conductor en este mismo PR o uno separado?** Recomendación: mismo PR (R6). Confirmar en /plan.
9. **Ventana entre apply staging y apply prod para H3**: default propuesto mismo día. Confirmar en /plan.
10. **¿Hay procesos / scripts internos que se autentican con cuentas demo?** Grep no encontró nada en el repo. Verificar scripts no versionados con Felipe en /plan.
11. ~~[BLOQUEANTE] Retention period correcto~~ — **Cerrado 2026-05-14 por Felipe**: `retention_period = 189216000` segundos exactos (6 años calendario, clock = fecha de emisión de cada DTE individual, no fin de año fiscal). Marco legal: Ley N° 19.799 + Ley N° 20.727 + resoluciones SII relacionadas. Justificación replicada en §3 H3 y debe replicarse en ADR-031.
12. **[BLOQUEANTE — devils-advocate #13, parcialmente] Forensia limitada del literal `BoosterDemo2026!`**: ¿quién corre el scan de Identity Platform audit logs (Felipe? agent con permisos)? ¿Qué método si el password está hasheado en logs y no se puede grep directo? Definir en /plan; sin el resultado no se cierra H1.
13. **Pepper para HMAC del rate-limiter** (devils-advocate #10): nombre del secret en Secret Manager, rotación policy, scope de acceso (solo Cloud Run service account). Definir en /plan.
14. **Circuit breaker thresholds** (devils-advocate #2): "3 fallos consecutivos Redis en 30s" y "3 intentos/hora hard cap in-process" son defaults. Validar con SRE / Felipe en /plan.
15. **DNS subdomain `demo.boosterchile.com`** (R16): ¿se elimina del DNS junto al hotfix o queda como follow-up al ADR de cierre del modo demo? Default: follow-up.

**Open questions añadidos por el retool H1 (2026-05-14T18:30Z):**

16. ~~TTL inicial para las 3 cuentas demo~~ — **Cerrado 2026-05-14T19:30Z por Felipe**: TTL = **30 días** (`now + 30 días` UTC ISO-8601). Override del default propuesto (90d) para acortar ventana de uso comprometido. Refleja en §3 H1.1, plan.md T3, OPS-1 pre-condition. Aviso 7 días antes del expiry vía nuevo task **T-TTL-WARN** (cron Cloud Scheduler diario, ver plan).
17. ~~Secrets por persona vs compartido~~ — **Cerrado 2026-05-14T19:30Z por Felipe (naming refinado 19:45Z)**: **3 secrets per-persona con prefijo unificado** `demo-account-password-shipper`, `demo-account-password-carrier`, `demo-account-password-stakeholder` **+ 1 para seed** `demo-seed-password` **+ 1 para HMAC pepper** `pin-rate-limit-hmac-pepper` = **5 secrets totales**. Refleja en plan v3 T2 (a renombrar desde plan v2 que usaba `demo-{persona}-password`). IAM por separado por secret.
18. ~~Path del middleware TTL~~ — **Cerrado 2026-05-14T19:30Z por Felipe**: TTL middleware = `apps/api/src/middleware/demo-expires.ts` (T4 del plan). Separado del middleware `is_demo` enforcement = `apps/api/src/middleware/is-demo-enforcement.ts` (T9.0 del plan).
19. **API exacta para self-signup OFF** (H1.2 paso 10): ¿qué campo del Identity Platform Config (`signIn.email.allowNewUsers`? `signIn.email.disableSignUp`? otro?) controla el toggle "Allow new accounts to sign up"? Si el provider Terraform `google_identity_platform_config` soporta el campo, IaC; si no, manual + TODO. Resolver en **PF-2** del plan (pre-`/build`).
20. **¿Existe algún flow legítimo de signup vía SDK cliente que se rompe al apagar self-signup?** (R20). Grep obligatorio antes del toggle. Si existe, migrar a Admin SDK server-side dentro del scope de H1 (no diferir). Resolver en PF-2 también.
21. **¿Quién corre el audit `is_demo` H1.3?** Default: el agente que ejecuta /build, con revisión de Felipe sobre el doc generado. Cerrar en pre-/build.
22. ~~Semántica `is_demo`~~ — **Cerrado 2026-05-14T19:30Z por Felipe**: tres-vías (restricción primaria). `is_demo=true` significa **restricción**; el middleware (T9.0) expone `requireNotDemo()` (rechazo 403) y `requireNotDemoOrSandbox(handler)` (alternativa pragmática). Endpoints sin política explícita = severity HIGH en audit H1.3 (T8). Cualquier endpoint que da privilegios extra a cuentas demo se considera bug.

## 13. Decision log

- 2026-05-14 — Initial draft. Spec consolida los 3 BLOCKING en una sola feature por urgencia operativa; sub-secciones H1/H2/H3 mantienen trazabilidad granular dentro del ciclo agent-rigor.
- 2026-05-14 — Devils-advocate pass aplicado (output en `review.md`). 8 strong objections resueltas en spec; 7 residual risks añadidos a §9 (R11–R17). 2 preguntas marcadas BLOQUEANTE en §12 (Q1 + Q11).
- 2026-05-14 — Felipe cierra Q1 (audit artefacto en `/Volumes/Pendrive128GB/Booster-AI/.specs/audit-2026-05-14/security.md`, SHA256 verificado) y Q11 (retention_period = 189216000s, 6 años calendario desde emisión, Ley 19.799 + Ley 20.727). Spec aprobado para `/agent-rigor:plan`.
- 2026-05-14T18:14Z — Verificación Firebase Auth en `booster-ai-494222`: las 3 cuentas demo confirmadas como fixtures de QA D1 con uso interno legítimo (sin actividad externa sospechosa). No es incidente activo.
- 2026-05-14T18:30Z — **Retool de H1 por Felipe**: el approach cambia de "eliminar + suspender + revocar" a "hardening + governance + audit". Sub-secciones H1.0–H1.5 reemplazan el bloque H1 anterior. Q5 cerrada (cuentas demo se mantienen). Nuevos open questions Q16–Q22 añadidos. Nuevos riesgos R18–R20. H2 y H3 sin cambios. Status del spec vuelve a "Revised draft" mientras se completan los nuevos OQs antes de re-aprobar y avanzar a `/agent-rigor:plan`.
- 2026-05-14T19:30Z — **Plan v2 post-devils-advocate y cierre de OQs por Felipe** (decidido por humano, ver mensaje 2026-05-14T19:XX). Cerradas Q16 (TTL = 30 días, no 90), Q19 (5 secrets: 3 per-persona + seed + pepper), Q20 (paths `demo-expires.ts` T4 + `is-demo-enforcement.ts` T9.0), Q22 (tres-vías con restricción primaria). Añadido R21 (compromise del literal en git history público — 4 días en `main` de `boosterchile/booster-ai`, distribución asumida permanente). Decidida **Opción C** (password-spray retroactivo universal pre-rotation) sobre Opción B (`git filter-repo`). ADR-032 referenciado para registrar la decisión Opción C. Añadido task **OPS-X-PASSWORD-SPRAY-RETROACTIVE** en T12a del plan y **T-TTL-WARN** (cron de aviso 7d antes del expiry). Spec re-aprobado integralmente; H1 + H2 + H3 todos en estado Approved.
- 2026-05-14T19:45Z — **Investigación de seed source + cierre operativo de OQs** (decidido por humano, esta sesión). Investigación grep en `apps/api/src/`, `packages/`, `scripts/`, `infrastructure/`, `.github/workflows/` confirma password literal en **2 lugares de código fuente**: `seed-demo.ts:86` (`const DEMO_PASSWORD = 'BoosterDemo2026!'`) y `seed-demo-startup.ts:142` (literal inline duplicado para conductor demo). El seed corre en cold-start (`apps/api/src/index.ts:11` importa `ensureDemoSeeded`), lo que significa que **cualquier rotación H1.1 se sobrescribe al próximo restart si `DEMO_MODE_ACTIVATED=true`**. Derivado: **orden de despliegue H1 es no-negociable** y debe ser **H1.0 → H1.4 → H1.1 → (H1.2/H1.3/H1.5 paralelos)**, no el orden inverso del plan v2 (que pone T7 = flag flip como última task de Phase A). Plan v2 requiere v3 con re-ordering de deps. Naming de secrets refinado a `demo-account-password-{shipper,carrier,stakeholder}` (unificación de prefijo, blast radius por separado). Cron T-TTL-WARN formalizado como criterio §3 H1.1, no solo referencia en plan. R21 verificado vs evidencia git: `git log --all -S 'BoosterDemo2026' --oneline` retorna 7 commits (primero `8400542` el 2026-05-10T23:01-04 = hace 3 días 15h, último `ec86cfd` el 2026-05-13). Repo `boosterchile/booster-ai` confirmado **PÚBLICO** en GitHub (HTTP 200 anónimo); 0 forks detectados. Antigüedad del literal (3.6d) < threshold heurístico del usuario (7d), pero la repo-pública + commit-en-mainline hace que el compromise sea estructuralmente permanente independiente del threshold → R21 mantiene aplicación con Opción C. **No se avanza a `/build` hasta que el plan v3 con orden corregido esté aprobado.**
- 2026-05-14T21:00Z — **PF-1..PF-5 ejecutados** (entry preliminar; ver corrección 21:45Z abajo).
- 2026-05-14T21:45Z — **Decisiones finales post-PF-1..PF-5 + PF-5.1 + PF-4** (Felipe, supersede de entry 21:00Z):
  - **PF-1** → 56 write endpoints raw, **100% sin enforcement de `is_demo`** (verificado por grep cross-cutting de `is_demo|isDemo|requireNotDemo|claims\.is_demo` en `apps/api/src/routes/`). Magnitud + uniformidad invalida approach per-endpoint. **Decisión Felipe**: approach **MIDDLEWARE HTTP GLOBAL con allowlist explícita**. T9 redefinido en plan v3.1 como **5 tasks T9.0–T9.5**: middleware (T9.0), wire global (T9.1), allowlist (T9.2), audit doc (T9.3), integration tests E2E (T9.4), observabilidad (T9.5). NO Drizzle interceptor (HTTP es la defensa correcta; query interceptor tiene risk de bypass via raw queries).
  - **PF-2** → `terraform plan` con provider `hashicorp/google v6.50.0`: **resource `google_identity_platform_config` NO expone `disable_sign_up`** (ni `allow_new_accounts`, ni `signUp.disabled`). Campos disponibles solo: `autodelete_anonymous_users`, `sign_in.allow_duplicate_emails`, `sign_in.email.{enabled, password_required}`, `mfa`, `sms_region_config`, `client`, `hash_config`. **Decisión Felipe**: T5 **split en T5a (manual + capture)** + **T5b (Cloud Monitoring alert sobre drift del setting)**. **OOB-10 nuevo**: file GitHub issue en `hashicorp/terraform-provider-google` solicitando exposición del campo `signUp.allow_new_accounts` o equivalente. **ADR-033 nuevo**: "decisión manual + monitor por gap del provider Terraform Identity Platform".
  - **PF-3'** → bucket `booster-ai-documents-locktest-2026-05-14` retorna **404 NotFound** (`gcloud storage buckets describe`). T25 lo crea limpio. Sin colisión.
  - **PF-4** → Admin SDK roundtrip con `expires_at` string ISO-8601: ✅ **string preservada** (`customAttributes` raw retorna `'{"expires_at":"2026-12-31T23:59:59Z",...}'`, parse JSON yields `str` type). Number también preservado como `int`. Tamaño ~1KB aceptado. **Decisión**: middleware `demo-expires.ts` usa `Date.parse(claims.expires_at) > Date.now()` con claim string ISO; sin override en middleware.
  - **PF-5** → tenant `booster-ai-494222` tiene **4 UIDs con `is_demo=true`**, no 3. El 4to es `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3` (conductor demo). **STOP-THE-LINE → resuelto por Felipe**: **Opción α** — 4 UIDs en scope de hardening.
  - **PF-5.1** → conductor demo creado por `seed-demo-startup.ts:ensureConductorDemoActivated` con `email='drivers+123456785@boosterchile.invalid'`, `password='BoosterDemo2026!'` (línea 142), `activationPinHash=null` (línea 176 limpia el PIN tras seed). Auth pattern verificado:
    - **PWA `login-conductor.tsx`** (línea 68): POST a `/auth/driver-activate` con RUT+PIN; backend retorna 401 (sin PIN hash). Línea 81: si 410 `already_activated` → fallback a `signInWithEmail(synthetic, pin)` que **es Firebase email/password directo**.
    - **`/demo/login`** (subdomain demo): mintea custom token vía Admin SDK, NO usa password.
    - **Vector explotable**: cualquier cliente que llame `signInWithEmailAndPassword('drivers+123456785@boosterchile.invalid', 'BoosterDemo2026!')` con el SDK Firebase obtiene un ID token de prod válido contra el backend Hono (que solo verifica firma).
    - **CASE A confirmado**: password operacional simétrico con los otros 3 owners. **Decisión Felipe**: T2 con **7 secrets** (4 personas + seed + pepper + sre-webhook), T3 itera 4 UIDs, T10 lista 4 entries, T12a/OPS-X cubre 4 cuentas, OPS-Y closure verifica 7 secrets, T-TTL-WARN itera 4 UIDs.
  - **Plan v3 → v3.1**: rewire de T2 (7 secrets), T3 (4 UIDs), T5 (split), T9 (T9.0–T9.5 estructural, 5 tasks no 56), T10/T12a/OPS-X/OPS-Y/T-TTL-WARN actualizados con 4 UIDs. OOB-10 (issue terraform-provider-google) añadido. ADR-033 draft. Plan v3.1 listo para `/build` post-aprobación final del usuario.

---

## Devils-advocate pass

Ejecutado 2026-05-14 — output completo en `.specs/security-blocking-hotfixes-2026-05-14/review.md`.

**Resumen**:
- 16 objeciones totales.
- 8 "must address before /plan" — **todas resueltas** en este draft: criterios re-escritos (#1, #5, #15), Redis fail-closed (#2), SII norm pendiente de cerrar §12 Q11 (#3), token revoke pre-deploy (#7), audit artefacto pendiente §12 Q1 (#8), HMAC con pepper (#10).
- 7 "residual risks accept + document" — capturados en §9 como R11–R17 con mitigación explícita.
- 2 bloqueantes operativos antes de /plan: §12 Q1 (audit source) y §12 Q11 (SII clock).

## Approval

**Estado 2026-05-14T19:30Z**: **Spec APPROVED integralmente** (H1 + H2 + H3) por Felipe Vicencio.

Trayectoria:
- 2026-05-14 — Aprobación inicial H2/H3 con Q1, Q11 cerrados.
- 2026-05-14T18:30Z — Retool H1, status volvió a Revised draft.
- 2026-05-14T19:30Z — Cierre de Q16, Q19, Q20, Q22 por Felipe + R21 añadido (git history compromise) + ADR-032 referenciado + OPS-X (password-spray) y T-TTL-WARN añadidos al plan. **H1 re-aprobada.**

Caveats permanentes (válidos para los 3 hotfixes):
- ADR-031 (`docs/adr/031-dte-bucket-retention-lock-activated.md`) debe citar Ley N° 19.799 + Ley N° 20.727 + resoluciones SII como fuentes normativas del período `189216000s`.
- ADR-032 (`docs/adr/040-git-history-password-compromise-opcion-c.md`) registra la decisión Opción C sobre el compromise del literal `BoosterDemo2026!` en git history.
- Si durante `/plan` o `/build` aparece evidencia de explotación previa (forensia §3 H1.5 o spray retroactivo OPS-X), el flujo escala a incident response antes de cerrar H1 (ver R17, R21).
- PF-1..PF-5 (en plan.md) deben cerrarse antes de `/agent-rigor:build`.

**Gating BLOQUEANTE adicional 2026-05-14T19:45Z**: el plan v2 actual (mtime 14:35Z) tiene el orden de tasks H1 invertido respecto al orden de despliegue no-negociable definido en §7 (`H1.0 → H1.4 → H1.1 → paralelo`). En plan v2, `T7` (flag flip = H1.0) depende de `T4 + OPS-1 + T5 + T6 + T12a` y termina siendo la ÚLTIMA task de Phase A — exactamente lo opuesto. **Plan v2 debe re-correr `/agent-rigor:plan` para producir v3 con re-deps antes de `/build`**. Spec queda Approved; `/agent-rigor:plan` (re-run) es el próximo paso, no `/agent-rigor:build`.
