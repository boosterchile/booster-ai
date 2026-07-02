# Spec: sec-001-cierre

- Author: Felipe Vicencio (with agent-rigor / Claude Opus 4.7)
- Date: 2026-05-24
- Status: **Approved** (2026-05-24 v3.2 PO final approve post 4 rondas devils-advocate + 8 decisiones PO; v3.3 amendment 2026-05-25 persona naming Spanish; **v3.4 amendment 2026-05-25 pre-Sprint-2b /build**: A1 SC-1.3.2 wire location reality-check, A2 SC-1.2.4 negative-tests scope-reduction, A3 SC-1.2.2 Google leg TRACKED_RESIDUAL Sprint 2c. Deuda definida tracked en §13 + review.md.)
- Linked:
  - **Adversarial review round 1**: `.specs/sec-001-cierre/review.md` (6 P0 + 8 P1 + 3 P2 objections; verdict do-not-approve v1)
  - **Spec hermano split**: `.specs/sec-h3-dte-retention-lock/spec.md` (H3 movido fuera del scope per O-5)
  - Spec vieja (referencia conceptual, NO base): `feat/security-blocking-hotfixes-2026-05-14:.specs/security-blocking-hotfixes-2026-05-14/spec.md`
  - Auditoría origen: `feat/security-blocking-hotfixes-2026-05-14:.specs/audit-2026-05-14/security.md` (SHA256 `ea8f258dca391836142165b9ac46de71d1b4c254d2a7309c84f533f4d371add4`)
  - Plan viejo (referencia): `feat/security-blocking-hotfixes-2026-05-14:.specs/security-blocking-hotfixes-2026-05-14/plan.md`
  - PR #206 (`feat(demo): subdominio demo.boosterchile.com operativo`) que introdujo el vector original
  - Ledger sesión `2026-05-24_6f2f4fcd-da5a-46e9-9ea8-f22edbb59dde.jsonl`
  - CLAUDE.md §Reglas no-negociables del stack Booster

## 1. Objective

Cerrar los **dos** hallazgos BLOCKING H1 + H2 de la auditoría de seguridad del 2026-05-14 (SEC-001) sobre la rama `main` de `boosterchile/booster-ai` y, una vez la postura defensiva está en su lugar, reactivar `demo.boosterchile.com` con paridad funcional al estado pre-2026-05-14 pero con governance, secrets, enforcement, monitoring y PII redaction que no existían entonces. El cierre incluye además reconciliar el drift IaC actual (state remoto de Cloud Run diverge de main porque el `terraform apply` original se ejecutó desde una rama abandonada).

**H3 (DTE retention lock) movido fuera de scope** a spec hermano `.specs/sec-h3-dte-retention-lock/` per decisión PO 2026-05-24 (objeción devils-advocate O-5: scope cohesion + irreversibility risk class). H3 debe mergear ANTES del flip final H1.6 (SC-IAC.5) pero se trackea independiente.

**H4 (PII redaction) agregado in-scope** por decisión PO 2026-05-24 (objeción O-12: compliance Ley 19.628 hace inseparable).

Audiencia interna: Felipe (PO/dev), el equipo Booster, el agente bajo CLAUDE.md. Audiencia externa: shippers/carriers/conductores/stakeholders de demo + auditores GLEC v3.0 / SII / compliance Chile.

## 2. Why now

- `demo.boosterchile.com` apagada desde 2026-05-15 (10 días). Bloqueo de negocio.
- Drift IaC invisible: env var Cloud Run prod `DEMO_MODE_ACTIVATED=false` viene de `terraform apply` ejecutado desde rama abandonada, NO main. `variables.tf` en main sigue `default = true`. Cualquier `terraform apply` futuro desde main revierte silenciosamente.
- 22 commits abandonados en `feat/security-blocking-hotfixes-2026-05-14` sin PR. Trabajo útil (T6+T6.2 Secret Manager, ADRs renombrables, forensia parcial) en riesgo de GC.
- Vectores SEC-001 activos en main HEAD: literal `BoosterDemo2026!` hardcoded en `apps/api/src/services/seed-demo.ts:86` y `seed-demo-startup.ts:142`; sin middleware enforcement; sin TTL; `/auth/driver-activate` sin rate-limit; logger no redacta PII (Ley 19.628 gap).
- Compromise estructural permanente del literal en git history público (repo `boosterchile/booster-ai` HTTP 200 anónimo). No reparable; neutralizable solo via rotation + monitoring + **post-disclosure account replacement** (per O-11 / OWASP / SP-800-63).

## 3. Success criteria

Numerados por hallazgo y sub-fase. Cada SC verificable con comando concreto post-deploy.

### H1.0 — Flag flip y endpoint público

- [ ] **SC-1.0.1**: `infrastructure/variables.tf` declara `variable "demo_mode_activated" { default = false }` durante el período de construcción (cambio explícito de `true` actual). Al cierre, vuelve a `true` (SC-1.6.1).
- [ ] **SC-1.0.2** _(v3.3 amendment 2026-05-25: persona value Spanish per CLAUDE.md naming)_: durante construcción, `curl -s -o /dev/null -w '%{http_code}' -X POST https://api.boosterchile.com/demo/login -H 'content-type: application/json' -d '{"persona":"generador_carga"}'` → **`404`**.
- [ ] **SC-1.0.3**: al cierre, mismo `curl` → **`200`** con body `{custom_token, redirect_to, persona, expires_at}`.

### H1.1 — Recreación de las 4 cuentas demo (post-disclosure account replacement per O-11)

**Per decisión PO 2026-05-24 y objeción devils-advocate O-11**: las 4 UIDs originales (`nQSqGqVCHGUn8yrU21uFtnLvaCK2`, `Uxa37UZPAEPWPYEhjjG772ELOiI2`, `s1qSYAUJZcUtjGu4Pg2wjcjgd2o1`, `Gg9k3gIPa1cJZtgKC0RRkWQ0QHJ3`) y sus emails (`demo-shipper@`, `demo-carrier@`, `demo-stakeholder@boosterchile.com`, `drivers+123456785@boosterchile.invalid`) son **public attack surface** (literal `BoosterDemo2026!` expuesto en git history público desde 2026-05-10). Postura defensible per OWASP / SP-800-63: **retirar + recrear**, no rotation.

- [ ] **SC-1.1.1** _(corregido en v3.2 per round 4 P0-R4-1)_: 4 UIDs nuevos creados via Admin SDK con emails nuevos consistentes (todos contienen substring `demo-2026`): `demo-2026-shipper@boosterchile.com`, `demo-2026-carrier@boosterchile.com`, `demo-2026-stakeholder@boosterchile.com`, `drivers+demo-2026-conductor@boosterchile.invalid`. Verificación: `firebaseAuth.listUsers({ filter: 'email.contains("demo-2026")' })` retorna **exactamente 4 cuentas** (incluyendo conductor — el filter ahora matchea las 4 gracias al pattern unificado `demo-2026`).
- [ ] **SC-1.1.2**: cada cuenta nueva tiene `customClaims.expires_at` ISO-8601 UTC = `now + 30 días` (TTL renovable) + `customClaims.is_demo = true` + `customClaims.persona`. Verificado con `firebaseAuth.getUser(uid).customClaims`.
- [ ] **SC-1.1.2b** _(reformado en v3 per O2-3 decisión PO)_: middleware `apps/api/src/middleware/demo-expires.ts` usa `firebaseAuth.verifyIdToken(token, /*checkRevoked*/ true)` y re-lee `expires_at` desde `firebaseAuth.getUser(uid)` server-side, cached ≤60s en Redis con key `demo-claim:<uid>`. Budget realista: **≤5ms p95 (cached)** + **≤200ms p95 (uncached)** + **≤1s timeout** antes de invocar fail-mode (SC-1.1.2c). Demo cards landing pre-warm: durante render de `/demo`, el frontend dispara `GET /api/v1/demo/cache-warm/<persona>` (idempotente, sin side effects) que invoca `getUser` y siembra Redis cache para los 4 UIDs activos. Resultado esperado: cards click → ~5ms p95 (cached antes del click) en happy path; ~200ms p95 sólo si pre-warm falla o cache expira.
- [ ] **SC-1.1.2c** _(nuevo en v3 per O2-3 decisión PO)_: fail-mode middleware **fail-closed**. Si Firebase Admin SDK `getUser` falla (timeout >1s, 5xx, network) → middleware retorna `503 service_unavailable` con header `Retry-After: 30` + log estructurado `auth.demo.fail_closed.firebase`. Si Redis es unreachable → mismo response con métrica `auth.demo.fail_closed.redis`. Alertas Cloud Monitoring si counter > 5/min (anomaly). Rationale: demo path bloqueado durante dependency outage es preferible a passthrough sin TTL check (defense-in-depth).
- [ ] **SC-1.1.3**: middleware `apps/api/src/middleware/demo-expires.ts` montado pre-router post-firebaseAuth. Si `claims.expires_at` presente y `Date.now() > Date.parse(claims.expires_at)` (con re-read del SC-1.1.2b) → `401 demo_account_expired`. Si claim ausente → passthrough (zero impacto en cuentas no-demo).
- [ ] **SC-1.1.4**: 4 UIDs viejos retirados: `auth.updateUser(uid, { disabled: true })` + entry en audit log Firebase `audit.demo_uid_retired` con timestamp + razón "post-disclosure replacement 2026-05-24". Login con UIDs viejos retorna `auth/user-disabled` immediately.
- [ ] **SC-1.1.5**: 4 secretos nuevos en Secret Manager con random 128-bit passwords: `demo-account-password-shipper-2026`, `demo-account-password-carrier-2026`, `demo-account-password-stakeholder-2026`. **NOTA conductor** (per devils-advocate open question): el conductor demo usa AMBOS paths — custom token primario via `/demo/login` Y `signInWithEmailAndPassword` secundario (path PIN-based per `auth-driver.ts`). El "password" del conductor demo es PIN-based; la "secret" en Secret Manager es el password Firebase para el path secundario solamente. Naming: `demo-account-password-conductor-2026-firebase` para distinguir del PIN.
- [ ] **SC-1.1.6**: cron `infrastructure/scripts/demo-account-ttl-alerter.ts` ejecutado por Cloud Scheduler diario. Lee `customClaims` de las 4 UIDs nuevas, dispara aviso por canal SRE si `days_remaining ≤ 7` (idempotente días -7, -3, -1, 0). Métrica `demo.account.ttl_remaining_days` con alerta si `min < 3`. **Helper requerido** (per devils-advocate open question): `infrastructure/scripts/harden-demo-accounts.ts --renew <uid> --extend-days N` para renovar el claim — listado explícito como T-OPS-1 en /plan.
- [ ] **SC-1.1.7**: `docs/qa/demo-accounts.md` (nuevo) contiene por UID: email actual, persona, propósito, dueño, fecha creación, `expires_at` actual, criterio para suspensión, comando renovar TTL, comando rotar password, puntero al secret. Sin secretos en el archivo; solo punteros.
- [ ] **SC-1.1.8** _(reformado en v3.1 per round 3 P0-R3-2)_: seed-demo refactorizado para soportar coexistence de UIDs viejos (disabled) y nuevos (active) sin race conditions:
  - `apps/api/src/services/seed-demo.ts` lee lista de emails desde tabla DB `demo_accounts` (Drizzle migration nueva: columns `persona`, `email`, `firebase_uid`, `created_at`, `disabled_at`), NO module-level constants (eliminar `DEMO_PASSWORD` literal + `DEMO_SHIPPER_EMAIL` etc. constants).
  - `seed-demo-startup.ts` chequea cada persona contra DB:
    - SELECT email FROM demo_accounts WHERE persona='shipper' AND disabled_at IS NULL → si existe, usa ese email; si no, INSERT new row con email **deterministic fixed string** (no UUID).
    - Email pattern fixed (alineado con SC-1.1.1 v3.2): `demo-2026-shipper@boosterchile.com`, `demo-2026-carrier@boosterchile.com`, `demo-2026-stakeholder@boosterchile.com`, `drivers+demo-2026-conductor@boosterchile.invalid` (no UUID — round 3 P0-R3-2 verified que UUID rompe idempotency; consistencia con dash entre `demo` y `2026` corregida en v3.2 round 4 P0-R4-1).
    - Cold-start N+1: SELECT retorna mismo email → `getUserByEmail` → si active, skip; si disabled, alert (estado inconsistente); si null, create.
  - Rationale UUID-out: deterministic fixed string ya logra "no-collision con RUTs reales" (el suffix `demo2026-conductor` no parece RUT). UUID solo añade no-determinism que rompe idempotency, sin ganancia de seguridad.
  - Integration test `seed-demo-second-cold-start.integration.test.ts`: estado inicial 4 viejas disabled + 4 nuevas active → cold-start → 0 changes (idempotent) + log structured `{seed_demo.skipped_disabled: 4, skipped_active: 4, created: 0}`. **NUEVO test** `seed-demo-third-cold-start.integration.test.ts`: tras N cold-starts, count(*) en `demo_accounts` sigue siendo 4 (no unbounded growth).

### H1.2 — Migración signup público a Admin SDK + Identity Platform self-signup OFF (in-scope per O-1)

**Per decisión PO 2026-05-24 y objeción devils-advocate O-1**: H1.2 expande de "flip self-signup OFF" a "migrar paths productivos de signup a Admin SDK + admin-approval gate, después flip self-signup OFF". Esto previene la regresión customer-facing que el spec v1 (rejected) escondía.

- [ ] **SC-1.2.0** _(reformado en v3.1 per round 3 P0-R3-1)_: inventario **exhaustivo** de TODA la clase Firebase auth-creation + auth-mutation paths en main HEAD. Categorías y métodos identificados (verificado en `apps/web/src/hooks/use-auth.ts:3-18` round 3):
  - **Creation paths** (admin-approval gate aplica): `createUserWithEmailAndPassword`, `sendPasswordResetEmail`, `signInWithEmailLink`, `sendSignInLinkToEmail`, `applyActionCode`, `verifyBeforeUpdateEmail`, `linkWithCredential`, `linkWithPopup` (Google provider), `signInWithPopup` (Google provider — implícito create-on-first-sign).
  - **Mutation paths** (no creation, pero impactan credentials existentes): `updatePassword`, `confirmPasswordReset`, `reauthenticateWithCredential`, `unlink`, `updateProfile`.
  - **Sign-in paths** (no creation, autenticación con credencial existente): `signInWithEmailAndPassword`, `signInWithCustomToken` (server-minted via `/demo/login`).
  Output: `docs/qa/signup-paths-audit.md` con tabla `path → método → categoría → migration plan (Admin SDK / OOS / explicit allowlist con justificación)`. Comando verificación: `grep -rnE 'createUserWithEmailAndPassword|sendPasswordResetEmail|signInWithEmailLink|sendSignInLinkToEmail|applyActionCode|verifyBeforeUpdateEmail|linkWithCredential|linkWithPopup|signInWithPopup|updatePassword|confirmPasswordReset|reauthenticateWithCredential|unlink|updateProfile' apps/web/src apps/api/src` retorna 0 matches no-allowlistados. **Decisión scope creation paths**: TODOS migrados a admin-approval gate o explicit OOS con justificación. **Mutation/sign-in paths**: en allowlist con comentario per SC-1.3.6 pattern (justificación + REVIEW_BY). **Razón de expansión v3.1**: round 3 P0-R3-1 verified que el v3 inventario perdía Google provider (`signInWithPopup`) que es end-run completo al admin-approval gate.
- [ ] **SC-1.2.1** _(reformado per O-1)_: cada signup path identificado en SC-1.2.0 reemplazado por flow via Admin SDK con admin-approval gate:
  - Frontend signup form llama nuevo `POST /api/v1/signup-request` que crea registro en tabla `signup_requests` (status `pending_approval`).
  - Email enviado a admin allowlist (`booster_platform_admin_emails` env var en main).
  - Admin click approve en `/app/platform-admin/signup-requests` → backend hace `auth.createUser` via Admin SDK + crea membership inicial → email al user con login link.
  - User reject → estado `rejected`, sin cuenta creada.
- [x] **SC-1.2.2** _(v3.4 A3 2026-05-25: partial-cierre split; **v4 amendment A4 2026-06-04: Google leg → MET, cerrado por boundary ADR-001 + harness CI default-deny + reaper de higiene — NO por blocking function. ADR-057 supersede ADR-054. Ver `.specs/sec-001-h1-2-google-boundary-closure/`**)_: Identity Platform sign-up disabled split en 2 legs:
  - **Email/password leg (Sprint 2b T11 = MET)**: `Sign-in providers → Email/Password → "Allow new accounts to sign up" = OFF`. Verificación: `curl -s -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" -H "x-goog-user-project: booster-ai-494222" "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.signIn.email'`. Aplicado via Terraform (`infrastructure/identity-platform.tf` con `google_identity_platform_config`); fallback manual + captura en `docs/qa/identity-platform-config.md` si Terraform property no expuesta en GA.
  - **Google leg (boundary-closure Stream A = MET 2026-06-04)**: ~~backend gate require Firebase Auth Blocking Function~~ **abandonado** (Gen 1 deprecado / Gen 2 no verificado — ADR-057 supersede ADR-054). El leg se cierra por: (a) **self-serve onboarding OFF** verificado (`EMPRESA_SELF_ONBOARDING_ENABLED` default-false unset en prod + invariante servicio); (b) **boundary auditado sin GAP** (SC-G1, `route-boundary-audit.md`): toda ruta de negocio/admin es ENFORCED (userContext) o GATED-CLOSED — un usuario Google autenticado-pero-no-provisionado no obtiene datos ni privilegio; (c) **harness CI default-deny** (SC-G1b, `apps/api/scripts/check-route-default-deny.ts`) que falla el build ante una ruta nueva sin clasificar — invariante durable que reemplaza el backstop creation-time; (d) **reaper de higiene** desplegado (SC-G4/G5, Cloud Scheduler diario en dry-run; modo destructivo gateado por `REAPER_DESTRUCTIVE` + sign-off PO) que remueve cuentas IdP inertes. **MET = no queda path self-signup→cuenta-activa abierto** (el botón Google puede crear un Firebase user inerte, pero el boundary lo deja sin acceso y el reaper lo limpia). Followup `.specs/_followups/sprint-2c-google-blocking-function.md` cerrado (superseded). Detalle: `.specs/sec-001-h1-2-google-boundary-closure/{spec,plan,route-boundary-audit,oq-resolution}.md`.
- [ ] **SC-1.2.3** _(nuevo per O-14)_: synthetic monitor en `infrastructure/monitoring/signup-probe.tf` ejecuta probe cada 60s contra `POST /api/v1/signup-request` con payload inválido, espera 422; con payload válido, espera `202 Accepted`. Page on first failure. **Canary deploy 1% traffic 30min antes de full deploy** para detectar regresiones de signup en producción real con baja blast radius.
- [ ] **SC-1.2.4** _(v3.4 amendment A2 2026-05-25: scope reducido)_: integration tests cubren: signup-request submit → DB row created → admin approve → user created → user login OK. Y: con self-signup OFF, intento directo de `createUserWithEmailAndPassword` desde cliente → `auth/operation-not-allowed`. Y por los **5 métodos creation MÁS exploitables** del inventario SC-1.2.0 (`createUserWithEmailAndPassword`, `sendSignInLinkToEmail`, `signInWithEmailLink`, `sendPasswordResetEmail`, `applyActionCode`) un negative test verifica que NO bypassa el admin-approval gate. **Rationale scope-reduction**: mutation paths (`updatePassword`, `confirmPasswordReset`, `verifyBeforeUpdateEmail`, `linkWithCredential`, etc.) requieren user ya-existente y no son self-signup vectors; sign-in paths (`signInWithEmailAndPassword`, `reauthenticateWithCredential`) tampoco crean cuentas nuevas; los 5 elegidos son los únicos que pueden CREAR un new user sin gate previo.
- [ ] **SC-1.2.5** _(reforzado en v3.1 per round 3 P1-R3-1)_: `POST /api/v1/signup-request` endpoint tiene su propio rate-limit + email enumeration defense + Cloud Armor interaction documentada:
  - Rate-limit: 5 requests / 15min / IP via mismo middleware H2 con scope distinto (`rl:signup-request:<ip>`). Mismo fail-closed semantics que SC-H2.1b.
  - **Cloud Armor cascade** (per `infrastructure/networking.tf:160-180` round 3 verified): Cloud Armor enforces `rate_based_ban` 1000 req/min/IP global con ban_duration 600s. Layer order: Cloud Armor → Redis rate-limit. Cloud Armor authoritative para abuse coarse-grain; Redis layer para endpoint-specific finer 5/15min. Si Cloud Armor ban hit ANTES de Redis, el counter Redis no incrementa — esperado, no bug. Si Redis fail-closed (503) mientras Cloud Armor allows, response es 503 (middleware layer). Documentar en `docs/qa/rate-limit-cascade.md`.
  - Email enumeration defense: response identical (`202 Accepted`) para email que existe vs no existe en el sistema. Admin notification es la única señal real de "esta request es para email nuevo".
  - Logs structured con `correlation_id` para tracing del flow signup-request → admin approve → user created.
  - Integration tests: `signup-request-enumeration.test.ts` verifica response identical; `signup-request-cloud-armor-cascade.test.ts` verifica Cloud Armor + Redis interaction (mock Cloud Armor headers).

### H1.3 — Enforcement estructural del claim `is_demo`

- [ ] **SC-1.3.1**: `apps/api/src/middleware/is-demo-enforcement.ts` con 3 modos (`requireNotDemo` / `requireNotDemoOrSandbox` / `explicitAllow`).
- [ ] **SC-1.3.2** _(v3.4 amendment A1 2026-05-25)_: wire **per-group en `apps/api/src/server.ts` post-`firebaseAuthMiddleware` middleware chain**, con `requireNotDemo` aplicado por default a TODOS `POST/PUT/PATCH/DELETE`. Reality check: `firebaseAuthMiddleware` no es global en main.ts (es applied per-group en `server.ts:226-580`); el wire ocurre antes de cada `app.route(...)` que mountee endpoints auth-required. Mount points canónicos enumerados en T3 acceptance (Sprint 2b plan §3 T3, ~20 grupos). **Audit-completeness CI gate** (`apps/api/scripts/check-is-demo-wire-completeness.ts`) previene incomplete coverage en future PRs.
- [ ] **SC-1.3.3**: `apps/api/src/middleware/is-demo-allowlist.ts` con allowlist explícita. Cada entry tiene comentario inline con formato `// <rationale>` + `// REVIEW_BY: <YYYY-MM-DD>`.
- [ ] **SC-1.3.4**: `docs/qa/is-demo-enforcement-audit.md` con tabla `path → método → cubierto por (middleware global / allowlist) + justificación`. Inventario re-ejecutado contra main 2026-05-24 (no asumido de PF-1 vieja). Comando: `grep -rE "app\\.(post|put|patch|delete)" apps/api/src/routes/ | wc -l` produce conteo actual.
- [ ] **SC-1.3.5**: integration tests E2E sobre **8-10** endpoints muestreados — demo → 403; no-demo → 200.
- [ ] **SC-1.3.6** _(reforzado en v3 per round 2 P1)_: tres CI gates **explícitos** en `.github/workflows/security.yml` (no solo local test suite):
  - **T6b**: fixture añade un nuevo POST endpoint sin allowlist entry → integration test verifica 403 sin code change adicional. Gate: `pnpm --filter @booster-ai/api test:integration --run test/integration/is-demo-default-deny.test.ts`. Workflow on push/PR.
  - **T6c**: script `scripts/check-is-demo-allowlist-comments.ts` valida que cada entry en `is-demo-allowlist.ts` tiene comentario `// <rationale>` + `// REVIEW_BY: <YYYY-MM-DD>`. CI fails si falta. NO permite `[skip ci]` (workflow protected en branch rules).
  - **T6d**: lint custom rule en `eslint-plugin-booster` o pre-commit script: PR que modifica `is-demo-allowlist.ts` DEBE incluir nuevo comentario o cambio matchea pattern existente. CI lint fails si entry sin justificación.
  - **Defense-in-depth**: si PR author deshabilita el test localmente, CI lint y CI integration test son independientes y CI los corre desde workflow.
- [ ] **SC-1.3.7**: observabilidad — métrica `auth.is_demo.blocked` (counter) + structured log por endpoint denegado (correlationId, path, persona; NO body). Alerta Cloud Monitoring 3-sigma anomaly post-deploy.
- [ ] **SC-1.3.8** _(nuevo per O-6)_: integration test `is-demo + rate-limit interaction.test.ts` — request a `/auth/driver-activate` con session demo: ¿is-demo middleware fires first (403) o rate-limit fires first (429)? Decisión explícita: **is-demo first**, porque rate-limit counter no debe consumirse por requests que igual van a fallar por authorization.

### H1.4 — Seed con password fijo: migración a Secret Manager

- [ ] **SC-1.4.1**: `apps/api/src/services/seed-demo.ts:86` y `seed-demo-startup.ts:142` NO contienen literal password. Leen `process.env.DEMO_SEED_PASSWORD`.
- [ ] **SC-1.4.2**: secret `demo-seed-password` en Secret Manager con IAM binding solo al service account del API + PO. Declarado en Terraform.
- [ ] **SC-1.4.3**: si `DEMO_MODE_ACTIVATED=true` y `DEMO_SEED_PASSWORD` no set, seed CRASHEA en startup (no fallback al literal). Si flag OFF, seed no corre.
- [ ] **SC-1.4.4**: `git grep -F 'BoosterDemo2026'` en HEAD de main retorna **0 matches** post-merge (código + docs + handoffs + infra). Git history retiene el literal — asumido residual en §9 R-LIT-HIST.

### H1.5 — Forensia limitada + monitoring sostenido

**Per O-8 devils-advocate**: window forensia ajustado a 14d (desde 2026-05-10 primer commit del literal `8400542`), no 60d. **Per O-10 devils-advocate**: spec ahora distingue "SEC-001 mitigated" (closeable hoy post-H1.6) vs "SEC-001 monitoring complete" (closeable T+90d).

- [ ] **SC-1.5.1** _(corregido per O-8)_: one-shot pre-rotation: scan Cloud Logging / Identity Platform audit logs **desde 2026-05-10 (primer commit literal en git history público) hasta hoy**, buscando logins exitosos con password literal contra cuentas no-demo + password-spray controlado sobre TODO el universo no-demo. Resultado documentado en `.specs/sec-001-cierre/forensia-2026-05-25.md` antes de marcar H1 mitigated. Match → escala incident response. **Caveat**: si Cloud Logging Identity Platform retention < 14d (default 30d), el window puede estar parcialmente missing. Spec acepta este residual y agrega R-DA-LOG-RETENTION en §9.
- [ ] **SC-1.5.2**: Cloud Logging filter + Pub/Sub topic `password-spray-alerts` + Cloud Function `password-spray-incident-trigger` dispara alerta ante intento de `signInWithPassword` con literal en cualquier path (incluyendo emails que no son demo). Owner: Felipe.
- [ ] **SC-1.5.3** _(nuevo per O-10)_: GitHub Issue / tracker open ticket `SEC-001-monitoring-window` con: criterio cierre triple (90 días sin matches + rotación verificada + Secret Manager deployed), auto-cierre via GitHub Action que corre detector + check de 90d elapsed. Esto desacopla "spec mergeado" de "monitoring window terminado".

### H1.6 — Reactivación end-to-end (smoke)

**Per O-5 devils-advocate**: H1.6 SOLO procede después que sec-h3-dte-retention-lock spec mergeado.

- [ ] **SC-1.6.1**: terraform plan en main muestra `DEMO_MODE_ACTIVATED` cambia `false → true`. Aplicando regla categórica de §7.4: 0 diffs inesperados en `google_iam_*`, `google_secret_manager_*`, `google_storage_bucket*`, `google_cloud_run_v2_service*` resources (más allá del flag esperado). Diffs en tags/labels/timestamps OK.
- [ ] **SC-1.6.2**: `terraform apply` desde main reemplaza el `apply` huérfano. Cloud Run reinicia con flag ON + seed lee Secret Manager + crea 4 NUEVAS UIDs (no las viejas, retiradas en SC-1.1.4) con password from Secret + setea `expires_at`.
- [ ] **SC-1.6.3**: smoke E2E Playwright reusable: 4 personas, aterrizan en surface correcto, banner "MODO DEMO" visible, sesión incluye claim `is_demo=true` + `expires_at`.
- [ ] **SC-1.6.4**: `GET /feature-flags` retorna `demo_mode_activated: true`.
- [ ] **SC-1.6.5** _(reforzado en v3 per round 2 P1)_: spec hermano `sec-h3-dte-retention-lock` aplicado a prod. Verificación **state assertion** (no string-match del PR title): `gsutil retention get gs://<bucket-dte>` debe mostrar `Retention Policy: locked=true, retention=189216000s` (estado real del bucket). Razón: la única forma de confirmar que H3 fue aplicado a prod (no solo mergeado en repo) es chequear el state del bucket. PR merge sin `terraform apply` NO satisface SC-1.6.5.

### H2 — Rate-limit en PIN auth (expandido per O-9)

- [ ] **SC-H2.1**: `POST /auth/driver-activate` retorna `429 too_many_attempts` después de **5 intentos** (éxito o fallido) por RUT en ventana de **15 min**, con header `Retry-After` en segundos. Todos los intentos cuentan; éxito limpia lockout para próximo ciclo sin retro-borrar histórico.
- [ ] **SC-H2.1b** _(nuevo per O-9)_: si Redis es unreachable, rate-limit **fail-CLOSED**: retorna `503 service_unavailable` con header `Retry-After: 30`, never bypass. Integration test simula Redis down → 503.
- [ ] **SC-H2.1c** _(nuevo per O-9)_: RUT normalizado via `normalizeRut()` de `@booster-ai/shared-schemas` ANTES de construir Redis key. Key: `rl:pin-activate:<rutNormalizado>`. Integration test: 4 variantes de input del mismo RUT (`76.999.111-1`, `76999111-1`, `76.999.1111`, `769991111`) → mismo counter.
- [ ] **SC-H2.2**: counter por RUT en Redis (`apps/api/src/services/observability/cache.ts:44` confirma `ioredis` configurado).
- [ ] **SC-H2.3**: integration test cubre: 5 intentos OK (200/401 según pin), 6º intento → 429 + Retry-After, mock Redis clock 15min → counter reset.
- [ ] **SC-H2.4** _(nuevo per O-9)_: IP-based global limit como defense-in-depth: 30 intentos / 15 min / IP across TODOS los RUTs. Returns `429` con header `X-RateLimit-Scope: ip` para distinguir de per-RUT. Integration test: attacker rota 20 RUTs distintos a low rate → IP-based limit fires a los 30 intentos.

### H3 — Bucket DTE Retention Lock _(MOVED)_

H3 movido a spec hermano `.specs/sec-h3-dte-retention-lock/spec.md` per decisión PO 2026-05-24 (objeción O-5 devils-advocate: scope cohesion + irreversibility). SC-IAC.5 (H1.6 §SC-1.6.5) garantiza que se mergee antes del flip final.

### H4 — PII redaction en logger (in-scope per O-12)

**Per decisión PO 2026-05-24 y objeción devils-advocate O-12**: T-SEC-032a + T-SEC-032b traídos in-scope. Justificación: Ley 19.628 (privacy Chile) + audit SII hacen separable engañoso.

- [ ] **SC-H4.1** _(reforzado en v3.1 per round 3 P1-R3-4)_: `@booster-ai/logger` redacta automáticamente PII en structured logs:
  - **Phone normalization step ANTES del regex** (per round 3 P1-R3-4 sobre formatos reales en `apps/web/src/lib/two-factor.ts:69`): strip whitespace + dashes + parentheses; si 9-digit y starts with `9`, prepend `+56`; si 11-digit y starts with `56`, prepend `+`; THEN apply regex `+56[2-9]\d{8}` (móvil) OR `+56[2-9]\d{7}` (fijo). Sin normalización, real-world false-negative rate ~60% sobre strings tipo "+56 9 1234 5678" (con spaces).
  - Emails: regex RFC 5322 compliant.
  - RUTs: regex + módulo-11 validación.
  - Tokens JWT: 3 segments base64.
  - Passwords: cualquier campo cuya key matchee `/pass|secret|token|key/i`.
  - **Thresholds medibles**: false positives ≤1% sobre fixture `packages/logger/test/fixtures/legit-1000.json`; false negatives ≤5% sobre fixture `packages/logger/test/fixtures/adversarial-100.json` (typos, formatos exóticos, encoding obfuscation, phones with spaces/dashes/no-prefix).
  - Cherry-pick del commit `0c9888e` (T-SEC-032a) como base; ajustes de threshold en /build con métrica capturada.
- [ ] **SC-H4.2**: coverage tests para `createLogger` + redaction: 100% statements, ≥90% branches per CLAUDE.md threshold. Cherry-pick del commit `3086e62` (T-SEC-032b).
- [ ] **SC-H4.3**: integration test verifica que un log con email + phone + RUT en payload sale con esos valores reemplazados por `[REDACTED:email]`, `[REDACTED:phone]`, `[REDACTED:rut]`.
- [ ] **SC-H4.4**: ADR nuevo (ver §7.1 numbering) documenta política PII redaction + scope + cómo extender (nuevos patterns).

### Cierre IaC

- [ ] **SC-IAC.1**: PR a main mergeado. CURRENT.md actualizado con sección cierre SEC-001 mitigated (no "complete" — eso es T+90d).
- [ ] **SC-IAC.2**: rama `feat/security-blocking-hotfixes-2026-05-14` decidida (cherry-pick + archive vs delete — ver §7.1).
- [ ] **SC-IAC.3** _(corregido per O-2)_: ADRs **nuevos** mergeados como parte del cierre, con números próximos disponibles (ver §7.1 numbering plan). NO usar números 040/041 (ya tomados en main por `wave-3-tls-ca-preload-fmc150.md` y `stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md`).
- [ ] **SC-IAC.4**: `terraform plan` post-merge muestra 0 diffs en main. Drift cerrado.
- [ ] **SC-IAC.5**: spec hermano `sec-h3-dte-retention-lock` mergeado antes de H1.6 final (referenciado en SC-1.6.5).

### Display intermedio

- [ ] **SC-INT-1** _(nuevo per O-17)_: durante el período de construcción (cualquier momento entre merge del primer PR de cierre y H1.6 final), `demo.boosterchile.com` sirve maintenance page explícita: _"Modo demo en mantenimiento. Volvemos pronto. Para producción, app.boosterchile.com."_ con link. NO sirve la alert "Hubo un problema entrando a la demo" que confunde al visitante.

## 4. User-visible behaviour

### Para shipper / carrier / conductor / stakeholder entrando a demo.boosterchile.com

**BEFORE (estado actual 2026-05-24)**:
1. Carga landing `/demo` (cards visibles, banner "Modo demo · datos sintéticos").
2. Click en cualquier card.
3. Alert UI: _"Hubo un problema entrando a la demo. Intenta de nuevo en 5 segundos."_

**DURANTE construcción (H1.0–H1.5 done, pre-H1.6)**:
1. demo.boosterchile.com sirve maintenance page explícita (per SC-INT-1).

**AFTER (post-merge + apply)**:
1. Carga landing `/demo` (idéntica).
2. Click en card (ej. shipper "Andina Demo S.A.").
3. POST `/demo/login {persona:"generador_carga"}` → 200 con `custom_token`. _(v3.3 amendment 2026-05-25: persona value Spanish per CLAUDE.md naming. Equivalencias: `generador_carga` ↔ shipper, `transportista` ↔ carrier, `stakeholder` ↔ stakeholder (anglicismo aceptado), `conductor` ↔ conductor. Emails siguen English como identificadores.)_
4. `signInWithCustomToken` → sesión Firebase con claims `{is_demo: true, persona: "generador_carga", expires_at: "<ISO+30d>"}`. **UIDs son los NUEVOS** (`demo-2026-shipper@...` emails identificadores English), no los viejos retirados.
5. Redirect a `/app` (o `/app/conductor/modo`, `/app/stakeholder/zonas`).
6. Banner persistente "MODO DEMO" en toda la sesión (verificado persiste across SPA navigations per T9b).
7. **Restricción nueva**: cualquier POST/PUT/PATCH/DELETE no-allowlistado → 403 + métrica.
8. **Restricción nueva**: pasados 30 días, login retorna 401 `demo_account_expired`. Renovación: PO ejecuta `harden-demo-accounts.ts --renew <uid>`.
9. **Restricción nueva**: token verificación incluye `checkRevoked:true` + re-read claims server-side ≤60s. Sesiones revocadas (passwords rotated, account disabled) caen a 401 inmediato, no esperan refresh.

### Para shippers/carriers que se registran via web

**BEFORE**: `/login` mode=sign-up → `createUserWithEmailAndPassword` directo → cuenta creada Firebase inmediato → login auto.

**AFTER**: `/login` mode=sign-up → `POST /api/v1/signup-request` → row en `signup_requests` table → email a admin → admin approve → cuenta creada via Admin SDK + email al user con login link → user login. Self-signup público OFF en Identity Platform.

### Para el conductor activando su cuenta vía PIN

**BEFORE**: ilimitado, brute-forceable.

**AFTER**: 5 intentos por RUT en 15min → 429 + Retry-After 900. IP-based defense-in-depth 30/15min/IP. Redis fail-closed (503 si Redis down). RUT normalizado antes de contar.

### Para developers / operadores

**BEFORE**: logs con emails, phones, RUTs visible en plain.

**AFTER**: structured logs auto-redactan PII. Ley 19.628 compliant.

### Para auditores SII / compliance Chile

H3 (DTE retention lock) cubierto en spec hermano (no acá).

## 5. Out of scope

- **Cambios funcionales nuevos en la demo**: no agregamos personas, surfaces ni datos. Reactivación de paridad funcional pre-2026-05-14.
- **H3 retention lock**: split a `.specs/sec-h3-dte-retention-lock/` per O-5. Acá referenciado en SC-1.6.5 como pre-requisito de H1.6 final.
- **Migración del bucket DTE a otro proyecto o región** — H3 cierra solo retention lock.
- **Cierre de otros SEC-XXX restantes** (la auditoría tiene más findings beyond H1/H2/H3). Acá cerramos SEC-001 H1+H2 + H4 (PII redaction = SEC-032a/b por decisión PO).
- **Re-roll del modelo Picovoice / wake-word**: blocker Picovoice approval (CURRENT.md §c).
- **Reescritura del seed-demo a sistema declarativo** — solo cambia el origen del password.
- **Rotación de otros secrets** (Stripe, Maps, SendGrid) — fuera SEC-001.
- **Mostrar Booster en eventos antes del merge**: si surge evento <72h, waiver explícito.

## 6. Constraints

1. **Type safety**: zero `any`, Zod en boundaries. Middleware enforcement valida `customClaims` con Zod.
2. **Coverage**: ≥80/80/80/80 en código nuevo. Vitest gate (#232).
3. **Logger structured + PII redaction (H4)**: zero `console.*`; redaction obligatoria post-H4.
4. **Conventional Commits con scope**: `feat(security):`, `fix(auth):`, `refactor(seed):`, `feat(signup):`. Squash merge.
5. **Sección Evidencia en PR**: obligatoria.
6. **IaC 100%**: Cloud Run, Secret Manager, IAM, Identity Platform via Terraform.
7. **Secret Manager**: passwords en secrets, IAM mínima.
8. **Performance** _(reformado en v3 per O2-3)_: middleware `is-demo-enforcement` ≤2ms p95; `demo-expires` middleware **≤5ms p95 cached / ≤200ms p95 uncached** (incluye Admin SDK `getUser` con Redis cache 60s); rate-limit Redis ≤3ms p95; PII redaction ≤1ms p95 per log entry. **Fail-mode obligatorio** per SC-1.1.2c y SC-H2.1b: cualquier dependency failure → `503 service_unavailable` (fail-closed). **Landing pre-warm**: `GET /api/v1/demo/cache-warm/<persona>` siembra cache antes del click (idempotente, ≤200ms p95).
9. **Backward compat**: cuentas no-demo no afectadas. `demo-expires.ts` passthrough si no hay claim.
10. **Solo-developer cooling-off**: 30min entre BUILD y REVIEW per CLAUDE.md §6.1.
11. **devils-advocate**: en /review (round 2 sobre v2 spec) + /ship.
12. **security-auditor**: en /review (cambio toca auth, secrets, network, persistence).
13. **Compliance Ley 19.628 Chile**: H4 PII redaction obligatorio per audit.

## 7. Approach

### 7.1. Estrategia de rama + ADR numbering

Nueva branch off main: `feat/sec-001-cierre-2026-05-24` (sub-branches por H1.X opcionales para PRs <300 LOC).

**Conflict surface real** (per O-7 verificado): 71 commits a main desde 2026-05-14 fork-point, **0 commits** tocando archivos críticos (`apps/api/src/services/seed-demo*.ts`, `routes/demo-login.ts`, `routes/auth-driver.ts`, `services/activation-pin.ts`, `infrastructure/variables.tf`, `compute.tf`, `storage.tf`). Cherry-pick es safer de lo que el spec v1 implicaba.

**ADR numbering plan** (per O-2 devils-advocate):

ADR-040 y 041 ya tomados en main por `wave-3-tls-ca-preload-fmc150.md` y `stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md`. Verificar ADRs vigentes al momento del PR (próximo libre probablemente 051+ post-ADR-050 path-remapping); plan tentativo:

- **ADR-NNN**: Git history compromise — literal password disclosure handling (deriva del 040 abandonado)
- **ADR-NNN+1**: Identity Platform self-signup OFF + signup migration to Admin SDK (deriva del 041 abandonado + expansión H1.2)
- **ADR-NNN+2**: PII redaction en logger (motivado por SEC-032 / Ley 19.628)
- **ADR-NNN+3**: post-disclosure account replacement strategy (motivado por O-11 + OWASP / SP-800-63)

Numbering definitivo se asigna durante /plan checking `docs/adr/` y `scripts/check-adr-numbering`. Si script ya está en CI (cierre S0 T3 confirmó esto vía PR #281), CI bloquea colisiones automáticamente.

**Commits a cherry-pick** (refined per O-7):

- Audit + ADRs (renumerados): traer el contenido conceptual de los ADRs originales 040/041 + audit findings de `.specs/audit-2026-05-14/`.
- `8d71213` (T6) + `e9f7686` (T6.2) — seed → Secret Manager. **Cherry-pick clean** (target files no tocados en main desde fork).
- `a496db8` (T11) — sanitize literal en docs.
- `a962f47` + `f5105e8` (T12a/OPS-X) — forensia spray.
- **NUEVO per O-12**: `0c9888e` (T-SEC-032a) + `3086e62` (T-SEC-032b) — PII redaction.

**Commits NO traer**:
- Bloque observability dashboard (`5d371de`, `4f53db2`, `da6623c`, etc.) — ya en main vía PR #223.
- `3fc85ad` (T7 flip viejo) — se reimplementa en H1.6 desde main.

### 7.2. Orden de despliegue no-negociable

Ajustado por decisiones O-1 (signup migration) + O-11 (recreate) + H4 (PII redaction):

1. **H1.4 PRIMERO**: refactor seed → Secret Manager. Sin esto, recreate de cuentas (H1.1) se overwritea en próximo cold-start si flag está ON.
2. **H4 paralelo a H1.4**: PII redaction es base infrastructure de logging, no depende de otros.
3. **H1.2 SC-1.2.0 → SC-1.2.1**: inventory + migration de signup a Admin SDK. Esto PRECEDE el flag flip self-signup OFF (SC-1.2.2). Sin esto, regresión customer-facing (O-1).
4. **H1.0 sigue en FALSE durante construcción**.
5. **H1.1**: después de H1.4 + H4. Crear 4 UIDs nuevos + retirar 4 viejas + 4 secrets nuevos.
6. **H1.3 / H1.5 / H2 en paralelo** después de H1.1.
7. **H1.2 SC-1.2.2** (flip self-signup OFF): solo después de SC-1.2.1 verificada en prod via synthetic monitor.
8. **H3** (spec hermano): mergeado independiente, antes de H1.6.
9. **H1.6 al final**: smoke + flip `default = true` + apply + verificación 4 personas.

### 7.3. Sub-agents y waivers

- `/review` obligatoriamente invoca `security-auditor` + `devils-advocate` + `code-reviewer` (cambio toca auth, secrets, persistencia, network, payments via signup gate).
- `/ship` invoca `devils-advocate` + checklist 12 puntos + 4 pasos Booster específicos (`booster-deploy-cloud-run`).
- Cooling-off 30min entre BUILD y REVIEW. Sin waiver.
- **NUEVO**: devils-advocate round 2 sobre spec v2 antes de marcar Approved (round 1 ya hecha 2026-05-24, output en review.md).

### 7.4. Drift IaC — regla categórica (per O-4 devils-advocate)

Reemplaza threshold numérico ">2 diffs" por regla categórica:

- **STOP categoría P0**: cualquier diff inesperado en `google_iam_*`, `google_secret_manager_*`, `google_storage_bucket*`, `google_cloud_run_v2_service*`. Investigar antes de proceder.
- **OK categoría P2**: diffs solo en tags, labels, annotations, timestamps, descriptions. Log + continúa.
- **Waiver explícito categoría P1**: otros resource types con diff inesperado. Requiere entry `waiver_granted` en ledger antes de apply.

Reconciliación se ejecuta cuando H1.4+H1.1+H1.0(false→true) están done. `terraform plan` en main HEAD vs state remoto debe mostrar exactamente: `DEMO_MODE_ACTIVATED: false → true` + 0 P0 + 0 P1.

### 7.5. Rollback — priorities corregidos (per O-14)

- **H1.0 (flag final)**: revertir merge → flag vuelve a `default: false`. Endpoint vuelve a 404. ~5 min.
- **H1.1 (recreate cuentas)**: irreversible by design (los UIDs viejos quedan disabled forever, los nuevos persisten). Si QA necesita acceso → leer password nuevo de Secret Manager. No hay path para "rehabilitar" UIDs viejos.
- **H1.2 (signup migration + self-signup OFF) — PRIORITY ROLLBACK**:
  - Pre-deploy: synthetic monitor signup-probe (SC-1.2.3) ejecuta cada 60s, page on first failure.
  - Canary 1% traffic por 30min antes de full deploy.
  - Si synthetic monitor falla post-deploy: toggle Identity Platform self-signup ON via Admin API (~1min) + revert PR. Total time-to-recover < 5min.
  - Si SC-1.2.1 (signup-request flow) falla pero SC-1.2.2 (self-signup OFF) ya aplicado: emergency feature flag `SIGNUP_REQUEST_FLOW_ACTIVATED=false` deshabilita el flow nuevo; self-signup sigue OFF; signup queda deshabilitado durante la ventana de fix (SLA target: 4h). El flag es feature gate convencional per CLAUDE.md booster-stack-conventions; su uso aquí está acotado por SLA de fix con runbook propio, no es defer abierto.
- **H1.3 (middleware enforcement)**: revertir merge si falsos positivos. Pre-deploy: 8-10 endpoints tests; post-deploy: 2h watch + alerta 3-sigma.
- **H1.4 (seed refactor)**: si `DEMO_SEED_PASSWORD` no set tras revert parcial, seed crashea (behavior deseado). Operador: setea secret o vuelve flag a false.
- **H1.5 (forensia + monitoring)**: forensia es one-shot, sin rollback. Monitoring sostenido se deshabilita disable de la Cloud Function.
- **H2 (rate-limit)**: si causa DoS legítimo, increase limits via env vars (`PIN_RATE_LIMIT_ATTEMPTS=10`, `PIN_RATE_LIMIT_WINDOW_SECONDS=900`). Sin revert necesario.
- **H4 (PII redaction)**: revertir merge revive logs con PII. No customer-facing issue, solo compliance regression. ~5 min.
- **H3 (spec hermano)**: irreversible (lock). Sin rollback. Spec hermano dedica §7.2 a esto.

## 8. Alternatives considered

- **A. Reusar la spec vieja sin cambios + mergear branch tal cual**. _Rejected_: PO 2026-05-24 + estado de main divergió + observability mezclado.
- **B. Cherry-pick mínimo H1.4 + reactivar flag, diferir H1.3/H1.5/H2/H3**. _Rejected_: PO 2026-05-24 "cerrar primero" + vector activo si parcial.
- **C. Override gcloud sin tocar main**. _Rejected_: viola IaC 100% CLAUDE.md.
- **D. Mantener UIDs + rotation (spec vieja decision)**. _Rejected_: O-11 devils-advocate + OWASP / SP-800-63 post-disclosure account replacement. PO decision 2026-05-24: recrear.
- **E. H3 in scope con validation gate**. _Rejected_: O-5 + PO decision 2026-05-24: split.
- **F. PII redaction OOS (spec separado)**. _Rejected_: O-12 + PO decision 2026-05-24: in-scope como H4.
- **G. H1.2 OOS hasta migration separate spec**. _Rejected_: O-1 + PO decision 2026-05-24: in-scope migration first.
- **H. Spec v1 sin devils-advocate round** (saltar /review §Step 4). _Rejected_: viola agent-rigor SKILL §"Solo-Developer Adaptation" (devils-advocate mandatory).

## 9. Risks and mitigations

| Risk | L | I | Mitigation |
|---|---|---|---|
| R-LIT-HIST: literal en git history público (irreparable) | H | H | OOS por irreversibility de force-push en repo público. Rotation + recreate (H1.1) neutraliza vector ACTUAL. Monitoring 90d (H1.5). |
| R-CHERRY: cherry-pick regresiones | L | H | Conflict surface real verificado en O-7: 0 commits collision en archivos críticos. Tests CI + devils-advocate /review. |
| R-MIDD: middleware enforcement rompe endpoint legítimo | M | H | Allowlist explícita + CI lint comment+REVIEW_BY (SC-1.3.6) + integration tests + alerta Cloud Monitoring 3-sigma. |
| R-DA-CLAIM-LATENCY: `getUser` lookup en demo path agrega latency | M | M | Redis cache ≤60s (SC-1.1.2b). Performance constraint §6.8 mide ≤5ms p95 cached / ≤200ms p95 uncached (revisado en v3.1 per round 2 O2-3 + round 3 P1-R3-2). Landing pre-warm reduce uncached hits a casi 0. Si excede → optimizar cache o aceptar trade-off. |
| R-DA-REDIS-SPOF _(nueva en v3.1 per round 3 P1-R3-3)_: Redis es SPOF compartido por demo-expires + rate-limit-PIN + signup-request | M | H | Tres consumers fail-closed compounding ante Redis outage → demo / onboarding / signup todos en 503 simultáneamente. Acepción: defense-in-depth posture (fail-open alternativa es peor para demo-expires). Mitigation: Memorystore HA tier (Cloud Memorystore HA) para reducir P(Redis down) significativamente. Documentar en runbook incident-response con priorización Redis. |
| R-DA-SIGNUP: H1.2 migración rompe signup en producción real | M | H | _Resolved_: synthetic monitor (SC-1.2.3) + canary 1% deploy. R-IPLOCK (v1) era el riesgo unresolved; ahora addressed. |
| R-DA-LOG-RETENTION: Cloud Logging retention < 14d en IP audit logs | M | M | Documentar como caveat en SC-1.5.1. Si retention 30d default holds, OK. Si < 14d, registrar gap residual. |
| R-COMP: 4 UIDs viejos comprometidos antes del fix | L | H | Recreate (H1.1) retira UIDs viejos. Forensia 14d + monitoring 90d (H1.5) detecta uso retroactivo. |
| R-DRIFT: drift IaC mayor que esperado | M | M | Regla categórica §7.4. P0 categories → STOP. |
| R-SEED: seed refactor rompe cold-start | M | M | Tests unit + integration con Secret Manager mock. Crash behavior es deseado (no fallback a literal). |
| R-TTL: TTL 30d expira en demo en vivo | M | M | Cron TTL alerter -7/-3/-1/0 (SC-1.1.6). Métrica + alerta < 3 días. |
| R-RATE: rate-limit /auth/driver-activate DoS legítimo | L | M | 5 intentos en 15min generoso. SC-H2.1c normalize RUT evita multiplicación de attempts. Test escenario "conductor olvida 3 veces, acierta 4ª". |
| R-FORENSIC: 14d window no detecta compromise pre-disclosure | M | H | Monitoring 90d sostenido. Aceptar residual: post-public-disclosure, rotation + recreate es la única defensa real. |
| R-DA-PII (nuevo per O-12): H4 redaction missing edge case (formato exótico de RUT/phone) | M | M | T-H4.3 integration test cubre 5-10 variantes. CI lint detecta nuevos patterns inferidos por code review. |
| R-DA-SECURITY-AUDITOR-STALE (nuevo per O-15): `agents/security-auditor.md` stale por ADR-049 | L | L | Aceptar residual. Tracked en `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`. |
| R-DA-MAINT-PAGE (nuevo per O-17): demo.boosterchile.com durante build period muestra alert | L | L | SC-INT-1 maintenance page durante construcción. |
| R-DA-IS-DEMO-STALE-CLAIM (nuevo per devils-advocate OQ): non-demo user con stale `is_demo:true` queda en global-deny | L | M | SC-1.1.4 retire UIDs viejos limpia state. Integration test verifica que claim ausente → passthrough; presente y true → 403. |
| R-DA-PIN-PASSWORD-INTERACTION (nuevo per devils-advocate OQ): conductor demo password rotation rompe PIN-based login | M | M | SC-1.1.5 nota explícita: conductor demo usa AMBOS paths. Secret cubre Firebase email+pwd path; PIN-based path inmodificado. Integration test verifica ambos paths funcionan post-recreate. |
| R-SCOPE: spec ~700 LOC + 4 sub-fases + 16+ tests para solo-dev | M | M | §14 execution plan con minimum-viable-merge + safe pause points + wall-clock budgets. |

## 10. Test list

### Tests unitarios

- **T1** (`apps/api/src/middleware/is-demo-enforcement.test.ts`): 3 modos + claim ausente/`is_demo:true`/path-allowlisted/path-no-allowlisted/`is_demo:false`.
- **T2** (`apps/api/src/middleware/demo-expires.test.ts`): claim future → passthrough; past → 401; ausente → passthrough; inválido → 401 + log error. Incluye `checkRevoked:true` + Admin SDK `getUser` cached path.
- **T3** (`apps/api/src/middleware/rate-limit-pin.test.ts`): contador Redis incrementa; 5 OK; 6º → 429 + Retry-After; 900s → reset; Redis unreachable → 503; RUT 4 variantes → mismo counter; IP-based 30/15min.
- **T4** (`apps/api/src/services/seed-demo.test.ts`): lee `DEMO_SEED_PASSWORD`; ausente + flag ON → throw; ausente + flag OFF → skip.
- **T-H4** (`packages/logger/src/redaction.test.ts`): payload con email/phone/RUT/token → output con `[REDACTED:*]`. Coverage ≥90% branches.

### Tests integration

- **T5** (`apps/api/test/integration/demo-login.integration.test.ts`): POST /demo/login persona=shipper → 200 + token. Persona inválida → 400. Flag OFF → 404. Token issued tiene `is_demo:true` + `persona` + `expires_at`.
- **T6** (`apps/api/test/integration/is-demo-enforcement-sample.integration.test.ts`): 8-10 endpoints muestreados. Demo → 403; no-demo → 200.
- **T6b** _(nuevo per O-6)_: fixture añade nuevo POST endpoint sin allowlist → 403 sin code change (default-deny estructural).
- **T6c** _(nuevo per O-6)_: CI lint `scripts/check-is-demo-allowlist-comments.ts` falla si entry sin comentario o REVIEW_BY date.
- **T7** (`apps/api/test/integration/driver-activate-rate-limit.integration.test.ts`): cover SC-H2.1, .1b, .1c, .2, .3, .4.
- **T7b** _(nuevo per O-6 / SC-1.3.8)_: `/auth/driver-activate` con session demo → 403 (is-demo wins over rate-limit), rate-limit counter NO incrementa.
- **T8** (`apps/api/test/integration/seed-secret-manager.integration.test.ts`): mock Secret Manager; seed crea 4 cuentas con UIDs NUEVOS.
- **T9** (`apps/web/e2e/demo-smoke.spec.ts`): Playwright. 4 personas. Banner visible, surfaces correctos.
- **T9b** _(nuevo per O-16)_: navegar por 5 rutas per persona, banner permanece visible.
- **T-SIGNUP-1** (`apps/api/test/integration/signup-request.integration.test.ts`): POST `/api/v1/signup-request` valid → 202 + row in DB. Admin approve → user created. Self-signup OFF Identity Platform → `createUserWithEmailAndPassword` directo → `auth/operation-not-allowed`.

### Tests infra / scripts

- **T10** (`infrastructure/scripts/demo-account-ttl-alerter.test.ts`): 4 UIDs con `expires_at` variado; days_remaining cálculo; ≤7 alerta; idempotencia.
- **T11** (`infrastructure/scripts/forensia-spray-scan.test.ts`): mock Cloud Logging; window 2026-05-10→today; output count + samples; sin matches → exit 0.
- **T12** (`infrastructure/scripts/harden-demo-accounts.test.ts`): `--renew --extend-days 30` → claim updated; `--retire <uid>` → user.disabled=true + audit log.

### Tests manuales (smoke post-deploy)

- **T13**: `gsutil retention get gs://<bucket-dte>` → `locked=true` (cross-ref H3 spec hermano).
- **T14**: `curl GET /feature-flags` → `demo_mode_activated: true`.
- **T15** _(v3.3 amendment 2026-05-25)_: `curl POST /demo/login -d '{"persona":"generador_carga"}'` → 200 + token.
- **T16**: Identity Platform Admin API → self-signup OFF verificado.
- **T17**: 2h monitoreo post-deploy: error rate, latency P95, logs limpios sin PII (verificación H4), métrica `auth.is_demo.blocked` baseline 0.

## 11. Rollout

- **Feature-flagged**: SÍ. `DEMO_MODE_ACTIVATED` durante construcción en false; flip a true al final. PLUS feature flag `SIGNUP_REQUEST_FLOW_ACTIVATED` para fallback de H1.2 (ver §7.5).
- **Migración DB**: tabla nueva `signup_requests` (id, email, full_name, status, requested_at, approved_by, approved_at). Migration Drizzle.
- **Migración Secret Manager**: 5 secrets nuevos (`demo-seed-password`, 4× `demo-account-password-*-2026`).
- **Migración Identity Platform**: self-signup OFF via Terraform (si provider) o manual + captura.
- **Cron**: Cloud Scheduler diario `demo-account-ttl-alerter`. Permission `roles/cloudfunctions.invoker` al SA.
- **Synthetic monitor**: `signup-probe` cada 60s page on failure.
- **Canary deploy**: H1.2 con 1% traffic 30min.
- **Rollback plan**: §7.5 por H1.X.
- **Monitoring post-deploy**: 2h watch + 90d sostenido (H1.5).

## 12. Open questions

Resolver antes de `/agent-rigor:plan`:

- **OQ1** _(cerrada 2026-05-24 per O-11)_: RECREATE — 4 nuevos UIDs + new emails; 4 viejos disabled. Decision basis: post-disclosure SP-800-63.
- **OQ2** _(cerrada 2026-05-24 per O-2/O-7)_: H1.3 middleware HTTP global confirmado en /plan tras re-ejecutar inventory (PF-1 reproducido contra main 2026-05-24). 71 commits a main since 2026-05-14 fork, 0 touch archivos críticos.
- **OQ3** _(cerrada 2026-05-24 per O-7)_: 71 commits to main since 2026-05-14; ninguno toca archivos críticos de SEC-001. Conflict surface bajo.
- **OQ4** _(parcialmente cerrada)_: rama `feat/security-blocking-hotfixes-2026-05-14` post-cierre = cherry-pick lo útil + archive sin merge (Opción 1 del v1). Decisión definitiva en /plan.
- **OQ5**: Identity Platform tenant state actual (self-signup OFF / ON?) — verificar en /plan con Admin API. Si ya OFF, SC-1.2.2 es no-op; si ON, integration test necesario.
- **OQ6** _(cerrada 2026-05-24 per O-12)_: H4 PII redaction in-scope.
- **OQ7**: gcloud ADC headless reauth — protocol via `--access-token-file` per memoria `reference_prod_db_headless_query.md`. Verificar en /plan.
- **OQ8** _(cosmética)_: feature slug `sec-001-cierre` confirmado.
- **OQ9** _(cerrada 2026-05-24)_: settings.json reescrito + audit preserved.
- **OQ10** _(nueva)_: ¿Cloud Logging retention default 30d para Identity Platform audit logs es suficiente para window 14d de SC-1.5.1? Verificar en /plan con `gcloud logging settings describe`.
- **OQ11** _(cerrada en v3 per round 2 P1)_: claim `is_demo` se setea explicit con `customClaims = {...prev, is_demo: <bool>}` SOLO al issue de custom token vía `/demo/login`. En tokens emitidos por otros paths (signup-request flow → admin approve → Admin SDK createUser), customClaims tiene `is_demo` ausente o `false`. Test T1 verifica passthrough cuando `is_demo` ausente o false. **No es necesario 'cleaning' protocol** porque cada token es issued fresh; el claim no propaga across sessions independientes. Si por error PO hace `setCustomUserClaims(uid, {is_demo: true})` a un user real, requiere `revokeRefreshTokens(uid)` + `setCustomUserClaims(uid, {is_demo: false})` para limpiar. Runbook en `docs/qa/demo-accounts.md` SC-1.1.7.

## 13. Decision log

- 2026-05-24 — Initial draft v1. Spec re-formulado from scratch tras decisión PO (camino A SEC-001 cierre + sin deadline).
- 2026-05-24 — Audit estado actual main HEAD vs rama abandonada. 22 commits abandonados, literal en main, sin middleware, sin docs/qa, H2/H3 sin cerrar. Drift IaC.
- 2026-05-24 — PO: re-spec from scratch; sin presión deadline.
- 2026-05-24 — Bloqueo `.claude/settings.json` audit-session. OQ9 cerrada renombrando a settings.audit.json.
- 2026-05-24 — Devils-advocate round 1 ejecutado sobre v1. 6 P0 + 8 P1 + 3 P2 + 5 OQ. Output preservado en `.specs/sec-001-cierre/review.md`.
- 2026-05-24 — PO decisiones post-devils-advocate:
  - O-1: H1.2 in-scope con migration signup → Admin SDK first (SC-1.2.0).
  - O-5: H3 split a `.specs/sec-h3-dte-retention-lock/` (spec hermano creado).
  - O-11: Recreate UIDs (new emails) per SP-800-63 post-disclosure.
  - O-12: H4 PII redaction in-scope.
- 2026-05-24 — Spec v2 producido con: O-2 ADR renumbering plan, O-3 checkRevoked + getUser cache, O-4 categorical drift rule, O-6 T6b/c/d + T7b + T9b, O-7 conflict surface real verificado, O-8 forensia window 14d, O-9 fail-closed + normalize RUT + IP-based, O-10 mitigated vs monitoring split, O-13 §14 solo-dev exec plan, O-14 H1.2 rollback synthetic monitor + canary. P2: O-15 residual, O-16 T9b, O-17 SC-INT-1.
- 2026-05-24 — Devils-advocate round 2 ejecutado sobre v2. Verdict APPROVE_WITH_RESERVATIONS. 3 nuevos P0 + 7 P1 + 3 P2. Output append a `.specs/sec-001-cierre/review.md`.
- 2026-05-24 — PO decisiones post-round-2:
  - O2-3 sub-1: perf budget realista (a) — ≤200ms p95 uncached / ≤5ms cached con Admin SDK en hot path + landing pre-warm.
  - O2-3 sub-2: fail-closed — `503 service_unavailable` con `Retry-After: 30` ante Firebase/Redis dependency failure.
- 2026-05-24 — Spec v3 producido con: O2-1 SC-1.2.0 exhaustive Firebase auth-creation paths inventory; O2-2 H1.1 SC-1.1.8 seed-demo refactor + idempotency test + UUID-derived driver email; O2-3 §6.8 + SC-1.1.2b realistic budget + SC-1.1.2c fail-closed. P1: SC-1.3.6 CI gate explicit en `.github/workflows/`; SC-1.6.5 state assertion `gsutil retention get`; SC-H4.1 thresholds 1%/5% false pos/neg; §14.3 calendar disclaimer; §14.4 incident-canary sub-excepción; OQ11 closed. P2: SC-1.2.5 signup-request endpoint rate-limit + email enumeration defense.
- 2026-05-24 — Devils-advocate round 3 sobre v3. Verdict APPROVE_WITH_RESERVATIONS. 2 P0 + 4 P1 + 3 P2. Output append `.specs/sec-001-cierre/review.md`.
- 2026-05-24 — Spec v3.1 producido via 7 surgical Edits (~80 LOC totales): **P0-R3-1**: SC-1.2.0 inventory ampliado a auth-creation + auth-mutation + sign-in paths (incluye Google provider, `signInWithEmailAndPassword`, `reauthenticateWithCredential`, etc.); SC-1.2.2 Identity Platform ahora aplica a AMBOS email/password Y Google providers (fallback backend check si Identity Platform per-provider no soporta). **P0-R3-2**: SC-1.1.8 UUID → deterministic fixed string + DB table `demo_accounts` con SELECT/INSERT lookup; nuevo integration test `seed-demo-third-cold-start.integration.test.ts` verifica no unbounded growth. **P1-R3-1**: SC-1.2.5 Cloud Armor cascade documentation + new integration test. **P1-R3-2**: §9 R-DA-CLAIM-LATENCY budget aligned con §6.8 (≤5ms cached / ≤200ms uncached). **P1-R3-3**: §9 nueva R-DA-REDIS-SPOF row con Memorystore HA mitigation. **P1-R3-4**: SC-H4.1 phone normalization step ANTES del regex. P2 residuales: P2-R3-1 email enumeration timing oracle (admin response latency), P2-R3-2 UID/email migration en audit logs / support tickets, P2-R3-3 Status field naming (cambiado a v3.1 con calificadores).
- 2026-05-24 — Devils-advocate round 4 confirmatorio sobre v3.1. Verdict APPROVE_WITH_RESERVATIONS_FINAL. 1 P0 + 4 P1 + 3 P2. **P0-R4-1**: SC-1.1.1 conductor email decía `drivers+demo2026@...` mientras SC-1.1.8 decía `drivers+demo2026-conductor@...` — inconsistencia entre Edits; además filter `email.contains("demo-2026")` (con dash) no matcheaba ninguna versión del conductor email.
- 2026-05-24 — Spec v3.2 producido via 3 surgical Edits (~5 LOC): SC-1.1.1 + SC-1.1.8 unificados a `drivers+demo-2026-conductor@boosterchile.invalid` (dashes consistentes, filter matchea las 4). P1-R4-1..R4-4 + P2-R4-1..R4-3 quedan como deuda definida con tracking en /plan (devils-advocate explícito: "4 P1s become explicit /plan tasks"). NO round 5 per devils-advocate recommendation.
- 2026-05-25 — Spec v3.3 amendment: SC-1.0.2 + §4 lines 189-190 + T15 (4 occurrences) — persona enum values renamed English → Spanish per CLAUDE.md §Reglas naming bilingüe (`shipper` → `generador_carga`, `carrier` → `transportista`, `stakeholder` y `conductor` invariantes). Triggered durante /plan plan-sprint-2a round 4 devils-advocate P0-R4-1 (contract conflict CLAUDE.md ↔ spec v3.2). PO approve inline 2026-05-25 via AskUserQuestion ("Spanish completo + amend spec"). Emails identificadores siguen English. Status sigue Approved. Spec hermano (`sec-h3-dte-retention-lock`) sin impacto.
- 2026-05-25 — **Spec v3.4 amendment** pre-Sprint-2b /build (3 changes alineados con `plan-sprint-2b.md` §11 + §8 pre-build checklist line 360). Triggered durante /build T1 gate detection — plan-sprint-2b §11 marcó "Aprobación PO requerida ANTES de T1 build vía edit directo a `spec.md`". PO approve inline 2026-05-25 via AskUserQuestion ("Aplicar v3.4 ahora"):
  - **A1**: SC-1.3.2 wire location "global en `main.ts`" → "per-group en `server.ts` post-firebase-auth chain". Razón: reality-check del codebase 2026-05-25 — `firebaseAuthMiddleware` no es global en main.ts, se aplica per-group en `server.ts:226-580`. T3 acceptance enumera ~20 mount points canónicos + agrega audit-completeness CI gate.
  - **A2**: SC-1.2.4 scope reducción "por cada método inventariado SC-1.2.0 (~12 métodos)" → "5 métodos creation MÁS exploitables (`createUserWithEmailAndPassword`, `sendSignInLinkToEmail`, `signInWithEmailLink`, `sendPasswordResetEmail`, `applyActionCode`)". Razón: mutation paths requieren user ya-existente; sign-in paths no son self-signup vectors; los 5 elegidos son los únicos que crean new user sin gate previo. Devils-advocate Sprint 2b plan round 1 P0-7.
  - **A3**: SC-1.2.2 "ambos providers email/password Y Google" → "email/password leg = MET via Sprint 2b T11; Google leg = TRACKED_RESIDUAL deferred Sprint 2c con Firebase Auth Blocking Function". Razón: realidad arquitectónica — Google sign-in 100% client-side (`apps/web/src/hooks/use-auth.ts:85` usa `signInWithPopup`); backend gate require Cloud Function diferente diseño + spec dedicada. Tracked en `.specs/_followups/sprint-2c-google-blocking-function.md`. Devils-advocate Sprint 2b plan round 1 P0-2.
  - Status sigue **Approved**. Plan `.specs/sec-001-cierre/plan-sprint-2b.md` v4 ya consistente con esta amendment (T3/T9c/T11 acceptance referencia los nuevos textos). Spec hermano (`sec-h3-dte-retention-lock`) sin impacto.
- 2026-05-24 — **PO final approve** (sesión `2026-05-24_6f2f4fcd-da5a-46e9-9ea8-f22edbb59dde`). Status → Approved. Spec listo para `/agent-rigor:plan`. Trayectoria total: 4 rondas devils-advocate (6→3→2→1→0 P0); 8 decisiones PO; 514 LOC final. Next-session: `/agent-rigor:plan` con foco en P1-R4-1..R4-4 como primeras tasks del plan.

## 14. Execution plan for solo-dev (nuevo per O-13)

Spec v2 tiene ~13 SC blocks distribuidos en 6 sub-fases (H1.0, H1.1, H1.2, H1.3, H1.4, H1.5, H1.6, H2, H4) + cross-cutting (H3 spec hermano, SC-IAC). Para Felipe como solo-dev sin presión deadline, propongo execution plan con minimum-viable-merge order, safe pause points, y interrupt protocol.

### 14.1. Minimum-viable-merge order

Cada paso es un PR mergeable. Después de cada merge, prod está en estado más seguro que antes (nunca peor que hoy).

| # | PR | Contiene | Estado prod post-merge |
|---|---|---|---|
| 1 | `feat/sec-001-h4-pii-redaction` | H4 SC-H4.1 + H4.2 + H4.3 + H4.4 ADR | Logs auto-redactan PII. Compliance Ley 19.628 cerrada. Demo sigue OFF. |
| 2 | `feat/sec-001-h1-4-secret-manager-seed` | H1.4 SC-1.4.1+.2+.3+.4 + cherry-pick T6/T6.2 | Literal eliminado de main. Seed lee Secret Manager. Demo sigue OFF. |
| 3 | `feat/sec-001-h2-rate-limit-pin` | H2 SC-H2.1+.1b+.1c+.2+.3+.4 + T3 + T7 | PIN brute-force mitigado. IP-based defense. Fail-closed Redis. |
| 4 | `feat/sec-001-h1-1-recreate-demo-accounts` | H1.1 SC-1.1.1+.2+.2b+.3+.4+.5+.6+.7 + middleware demo-expires.ts + cron TTL alerter | 4 UIDs nuevos creados + 4 viejos disabled. Middleware TTL deployed. Demo sigue OFF. |
| 5 | `feat/sec-001-h1-3-is-demo-enforcement` | H1.3 SC-1.3.1..8 + T6/T6b/T6c/T6d + T7b interaction | Middleware enforcement global activo. Allowlist con CI lint. Demo sigue OFF. |
| 6 | `feat/sec-001-h1-2-signup-migration` (split posible) | H1.2 SC-1.2.0 (inventory) → SC-1.2.1 (Admin SDK flow) → SC-1.2.3 (synthetic monitor) → SC-1.2.2 (Identity Platform OFF + canary) + T-SIGNUP-1 | Self-signup OFF. Admin approves nuevas cuentas. **MAYOR riesgo de regresión — pre-deploy synthetic monitor + canary 1% obligatorios.** |
| 7 | `feat/sec-001-h1-5-forensia-monitoring` | H1.5 SC-1.5.1 (one-shot scan) + SC-1.5.2 (Cloud Function monitor 90d) + SC-1.5.3 (GitHub Issue tracker) | Forensia 14d ejecutada. Monitoring 90d activo. SEC-001 mitigated milestone. |
| 8 | `sec-h3-dte-retention-lock` (spec hermano, PR independiente) | H3 completo per spec hermano | Bucket DTE locked. Compliance SII Chile. |
| 9 | `feat/sec-001-h1-6-reactivate-demo` | H1.6 SC-1.6.1+.2+.3+.4+.5 (verifies #8 done) + T9 + T9b + T15 + CURRENT.md update | **Demo reactivada**. 4 personas funcionando. drift IaC cerrado. SEC-001 mitigated. |

T+90d: H1.5 monitoring window closes vía GitHub Action auto-trigger. SEC-001 marked "monitoring complete".

### 14.2. Safe pause points

Después de cada PR mergeado, el estado de prod es safe pause point:

- **Post PR #1 (H4)**: PII redaction live. Si Felipe se interrumpe acá, prod está net-mejor. Demo sigue OFF (estado pre-spec).
- **Post PR #2 (H1.4)**: literal en código eliminado. Reabrir seed (poner flag ON) requeriría poner Secret en Secret Manager — bloqueo natural.
- **Post PR #3 (H2)**: PIN endpoint endurecido. Independent improvement.
- **Post PR #4 (H1.1)**: UIDs viejos retirados + nuevos creados. Endpoint sigue OFF, así que nuevas cuentas no se pueden usar todavía — pero rotation hecha.
- **Post PR #5 (H1.3)**: middleware enforcement activo. Cero impacto en flow no-demo. Defense-in-depth for future.
- **Post PR #6 (H1.2)**: signup migrado a Admin SDK. Customer-facing flow cambió — **NO es pause point para abandono largo**. Pre-deploy synthetic + canary OBLIGATORIOS.
- **Post PR #7 (H1.5)**: monitoring activo. SEC-001 mitigated reached.
- **Post PR #8 (H3 hermano)**: bucket lock. Irreversible — separate spec maneja.
- **Post PR #9 (H1.6)**: demo viva. Cierre.

### 14.3. Wall-clock budget per PR (estimado conservador solo-dev)

| PR | Build | Cooling-off | Review | Ship | Total |
|---|---|---|---|---|---|
| #1 H4 PII | 3h | 30min | 1.5h | 1h | ~6h |
| #2 H1.4 Secret Manager | 2h | 30min | 1h | 1h | ~5h |
| #3 H2 Rate-limit | 4h | 30min | 1.5h | 1h | ~7h |
| #4 H1.1 Recreate | 5h | 30min | 2h | 1h | ~9h |
| #5 H1.3 Middleware | 6h | 30min | 2h | 1h | ~10h |
| #6 H1.2 Signup migration | 12h | 30min | 3h | 2h | ~18h (más grande, requires Admin UI cambios + tests + canary) |
| #7 H1.5 Forensia | 3h | 30min | 1h | 1h | ~6h |
| #8 H3 hermano | 2h pre + 48h validation + 2h apply | 30min | 1h | 1h | ~50h calendario (gran parte espera) |
| #9 H1.6 Reactivación | 2h | 30min | 1h | 2h (deploy + 2h watch) | ~6h |

Total construcción (sin contar #8 validation 48h calendario): ~67h pura ejecución, ~75-90h con context-switching. **Disclaimer calendar** _(nuevo en v3 per round 2 P1)_: para solo-dev con 4h/día focused work, esto traduce a **17-23 días working = 3.5-5 semanas calendar mínimo**. Spec asume Felipe puede dedicar al menos 4h/día sostenido. Si <4h/día disponible, multiplicar calendar por factor inverso (2h/día = 7-10 semanas). En cualquier sprint, /build de PR-X completa siempre dentro de safe pause points (§14.2) antes de pausar.

### 14.4. Interrupt protocol

Si surge business priority X durante construcción:

1. **Cierra el PR actual** o márkalo como Draft con WIP commit + comment "Pausado por priority X 2026-MM-DD".
2. **Si PR actual está mergeado al momento de la interrupción**: prod en safe pause point (§14.2). Felipe puede atender priority X sin urgencia.
3. **Si PR actual está mid-flight**:
   - Pre-build: cancel branch, no impact.
   - Post-build pre-review: dejar branch + commit con tests; review se hace cuando vuelves.
   - Post-review pre-ship: PR ready to merge; merge cuando vuelves (cooling-off es desde build, no review).
   - Post-ship 2h watch: completar watch antes de cualquier nuevo PR (CLAUDE.md booster-deploy-cloud-run).
4. **Si la interrupción supera 1 semana**: re-validar estado con `terraform plan` + `git log main` antes de retomar. Documentar deltas en spec §13 decision log.

Excepción crítica: **PR #6 H1.2 NO es interrumpible mid-flight post-canary**. Una vez canary 1% iniciado, completar full deploy o full rollback antes de cualquier interrupción. Razón: estado intermedio (1% traffic con self-signup OFF, 99% traffic con self-signup ON) es customer-affecting inconsistency.

**Sub-excepción** _(nueva en v3 per round 2 P1)_: si durante la ventana canary 30min surge un incident SLA-bound (página de prod down, security incident grave) que requiere atención inmediata, el protocolo es: (1) full rollback del canary a 0% traffic (1-comando, ~2min); (2) atender incident; (3) re-iniciar canary 30min counter cuando incident resuelto. NO 'pause' del canary; NO partial state. Esto evita el dilema "estado canary inconsistente vs incident SLA breach".
