# Review: sec-001-cierre spec — rounds 1 + 2

- Reviewer: `agent-rigor:devils-advocate` sub-agent (Sonnet)
- Date: 2026-05-24
- Round 1 target: `.specs/sec-001-cierre/spec.md` v1 (330 LOC, status Draft)
- Round 2 target: `.specs/sec-001-cierre/spec.md` v2 (~700 LOC, status Draft post 4 PO decisions + technical fixes)

## Round 2 summary (2026-05-24, post v2)

**Verdict**: `APPROVE_WITH_RESERVATIONS` — v2 directionally correct y addresses los 6 P0 + 8 P1 + 3 P2 de round 1, pero la expansión de scope introdujo 3 nuevos P0 + 7 P1 + 3 P2.

### Round 2 P0 (load-bearing, gating approval o residual documentado)

- **O2-1: SC-1.2.0 inventory missed `sendPasswordResetEmail` y otros Firebase auth-creation paths**
  - Evidencia: `apps/web/src/hooks/use-auth.ts:149` tiene `sendPasswordResetEmail`. Con self-signup OFF pero password-reset ON, el admin-approval gate es **bypassable en 30 segundos**: attacker pide reset, recibe email, setea password de cuenta nueva.
  - SC-1.2.0 sólo nombró `createUserWithEmailAndPassword|signupNewUser`. La clase de attack es "todos los Firebase auth-creation paths", no un solo método.
  - Resolución: SC-1.2.0 reformulado para inventory exhaustivo de **toda Firebase Admin/Auth call que crea o establece credentials**: `createUserWithEmailAndPassword`, `sendPasswordResetEmail`, `signInWithEmailLink`, `sendSignInLinkToEmail`, `linkWithCredential`, `updatePassword`, `confirmPasswordReset`. Each path migrated to admin-approval gate o explicit OOS con justificación.

- **O2-2: H1.1 recreate breaks seed-demo idempotency**
  - Evidencia: `seed-demo.ts:82-86` declara emails as module-level constants. `seed-demo-startup.ts:141` deriva email del conductor desde RUT (`drivers+12345678@boosterchile.invalid`). Spec v2 SC-1.1.1 propone nuevos formatos (`demo-2026-shipper@...`, `drivers+demo2026@...`) **sin direccionar cómo el seed coexiste con UIDs viejos disabled**.
  - Si cold-start corre seed con flag ON post-recreate, el script intenta crear los old emails de nuevo (que ahora son disabled UIDs), encuentra el conflict, ¿qué hace? Spec no dice. Test T8 sólo cubre "seed mock Secret Manager + 4 cuentas NUEVAS", no el path "old disabled + new active coexistence".
  - Resolución: H1.1 implementation debe refactorizar seed-demo para: (a) usar tabla de configuración (Drizzle) en vez de module constants, (b) check si email existe Y está disabled antes de seed, (c) integration test específico para "second cold-start después de recreate".

- **O2-3: Performance budget ≤8ms p95 (§6.8) es fantasy con Admin SDK getUser**
  - Evidencia: Firebase Admin SDK `getUser` típicamente toma 50-200ms p95 cold. Redis cache 60s ayuda pero el FIRST request post-expiry es uncached (consistent 50ms+).
  - Plus: spec no especifica fail-mode si Firebase Auth incident (50% getUser fail) ni si Redis outage. Middleware fail-open o fail-closed?
  - Resolución: 3 sub-decisiones de architecture:
    - (a) ¿Budget revisado a ≤200ms p95 (uncached) + ≤5ms p95 (cached)? Reduce promesa pero alinea con realidad.
    - (b) ¿Bypass Admin SDK en middleware (trust cached token, accept ≤1h staleness for expires_at) + revoke via `revokeRefreshTokens` cubre los attack paths críticos? Más simple pero menos defense-in-depth.
    - (c) ¿Fail-mode explícito: Firebase getUser fail → fail-closed (401 reject + alert) vs fail-open (allow + log)? Redis fail → fail-closed (rate-limit Pattern) vs fail-open?

### Round 2 P1 (gaps materiales pero defer-able a /plan)

- ADR numbering "ADR-NNN" placeholder — defers to /plan. Si /plan no asigna antes de PR, collision se repite.
- SC-1.6.5 string-matches "sec-h3-dte-retention-lock" PR title. State assertion sobre `is_locked=true` real en prod sería más robusto.
- T6b/c/d están en el local test suite — un PR autor puede deshabilitar los tests + CI pasa. Necesitan ser CI gates explícitos en `.github/workflows/`.
- §14.3 wall-clock 67h es "pure execution" pero asume Felipe trabajando lineal sin context-switch. 4h/día focused = 17 días = 3.5 semanas calendar mínimo. Spec no acomoda esto.
- SC-H4.1 PII regex chileno + internacional — phone regex frágil; spec no dice umbral de false positives/negatives aceptable.
- §14.4 interrupt protocol post-canary "completar full deploy o full rollback antes de cualquier interrupción" — ¿qué si incident SLA es menor que canary remaining time?
- OQ11 (`is_demo` claim cleaning protocol) sigue como OQ; no resolution.

### Round 2 P2

- §7.5 rollback H1.2 path tiene drift vocabulary que el SKILL §4 marca: "ventana de fix (SLA target: 4h)" — la palabra-trigger se cambió pero el concepto sigue siendo "estado bounded" sin SLA real escrito.
- "page on first failure" es brittle (single false positive page el equipo a 3am); add hysteresis.
- POST `/api/v1/signup-request` necesita rate-limit propio (email enumeration attack).

### Strong points round 2 (max 3)

1. §14 Execution plan for solo-dev es genuinely new y bien estructurado. Minimum-viable-merge order + safe pause points + interrupt protocol es ejemplar.
2. O-11 recreate decision aplicada correctamente (per OWASP/SP-800-63).
3. §9 risks table audit-trail con R-DA-* prefix es bueno para tracking origin de cada risk.

### Open questions

- ¿`signup-request` flow tiene attack surface propia que necesita su propio threat model (email enumeration, rate-limit, admin-approval token TOCTOU)?
- ¿Cómo se versiona la tabla `signup_requests` para soportar future flows (OAuth, magic link)?

---

## Round 3 summary (2026-05-24, post v3)

**Verdict**: `APPROVE_WITH_RESERVATIONS` — v3 dropped from 3 P0 (round 2) to 2 P0 (round 3). Reducción consistente. _"If both [P0s] are resolved with edits ≤20 lines, the spec is ready for /plan without a round 4."_

### Round 3 P0 (surgical, ≤20 LOC each — closed in v3.1 via Edits)

- **P0-R3-1**: SC-1.2.0 inventory incompleto — falta Google provider (`signInWithPopup`, `linkWithPopup`), `signInWithEmailAndPassword`, `signInWithCustomToken`, `reauthenticateWithCredential`, `updateProfile`, `unlink`. Y SC-1.2.2 sólo cubre `Sign-in providers → Email/Password → Allow new accounts to sign up = OFF`, NO Google. **End-run completo via `signInWithPopup(googleProvider)`**.
  - **Closed v3.1**: SC-1.2.0 expanded a 3 categorías (creation/mutation/sign-in paths) con 14 métodos. SC-1.2.2 ahora cubre AMBOS providers email/password + Google, con fallback backend check si Identity Platform per-provider no soporta.

- **P0-R3-2**: SC-1.1.8 UUID-derived driver email rompe idempotency. UUID non-determinístico → cold-start N+1 genera nuevo email → unbounded Firebase growth. Rationale "evitar collision con RUTs reales" se logra con deterministic fixed string, NO con UUID.
  - **Closed v3.1**: SC-1.1.8 cambia UUID → deterministic fixed `drivers+demo2026-conductor@boosterchile.invalid`. DB table `demo_accounts` con SELECT/INSERT lookup. Nuevo integration test `seed-demo-third-cold-start.integration.test.ts` verifica count(*) constante across cold-starts.

### Round 3 P1 (4, closed in v3.1)

- **P1-R3-1**: Cloud Armor cascade interaction con Redis rate-limit no documentada → SC-1.2.5 expanded con cascade docs + integration test.
- **P1-R3-2**: §6.8 budget ≤5ms/≤200ms inconsistente con §9 R-DA-CLAIM-LATENCY que decía ≤8ms (stale de v2) → §9 row actualizado a budget v3.
- **P1-R3-3**: Redis SPOF compounding (3 middlewares fail-closed) sin risk row → §9 nuevo R-DA-REDIS-SPOF con Memorystore HA mitigation.
- **P1-R3-4**: SC-H4.1 phone regex `+56[2-9]\d{8}` sin normalization step → real-world false-negative ~60% sobre strings con spaces/dashes → SC-H4.1 ahora especifica normalization ANTES de regex.

### Round 3 P2 (3, residual documentados)

- **P2-R3-1**: Email enumeration timing oracle via admin response latency. Defer a /build con monitoring.
- **P2-R3-2**: UID/email migration en audit logs / support tickets / integrations. Defer; tracked en CURRENT.md post-merge.
- **P2-R3-3**: Status field stale "Draft v3" cuando is decision-loaded. Closed en v3.1 con qualifier (`Draft v3.1 post devils-advocate rounds 1+2+3`).

### Strong points round 3

1. §14.3 calendar disclaimer (3.5-5 semanas calendar solo-dev) — unusually honest.
2. SC-1.6.5 state assertion `gsutil retention get` (no PR-title-match) — correct primitive.
3. SC-1.3.8 (is-demo wins over rate-limit en `/auth/driver-activate`) — explicit interaction call que previene future debate.

---

# Original Round 1 review
- Mode: adversarial review per `agent-rigor:11-spec-driven-development` §Step 4 (mandatory for solo-developer)

**Verdict del reviewer**: _"6 P0 spec-breaking objeciones; do not approve as-is. Spec tiene la forma correcta (bien organizado, concreto en la mayoría de SCs) pero no ha sobrevivido contacto con el codebase real en tres claims load-bearing (self-signup, ADR numbers, claim enforcement mechanics) y tiene al menos dos issues estructurales (drift threshold, scope cohesion of H3)."_

## P0 — Spec-breaking objeciones (deben direccionarse antes de approve)

### O-1: H1.2 (self-signup OFF) ROMPERÁ el sign-up de usuarios reales. R-IPLOCK §9 está equivocado en hechos.

- **Evidencia**: `apps/web/src/routes/login.tsx:140` llama `signUpWithEmail({...})`, que en `apps/web/src/hooks/use-auth.ts:132-142` llama `createUserWithEmailAndPassword(firebaseAuth, ...)`. La ruta `/login` expone modo `sign-up` a CUALQUIER visitor web — self-signup público es path productivo vivo hoy. Tests `apps/web/src/hooks/use-auth.test.tsx:133-143` y `apps/web/src/routes/login.test.tsx:159-168` lockean este comportamiento.
- **Riesgo si no se direcciona**: deploy de SC-1.2.1 causa 100% failure de `/login` sign-up instantáneo. Shippers/carriers reales no pueden onboard via web. Spec lo enmarca como _"verificar en /plan"_ sin hacer /plan blocking — esto es una regresión customer-facing escondida en un "hardening de seguridad".
- **Resolución sugerida**: SC-1.2.0 nuevo ("inventario de todos los entry points de sign-up y, o (a) migrar a Admin SDK ANTES de OFF, o (b) keep self-signup ON y enforce admin-approval gate post-signup"). Mientras tanto **H1.2 fuera de scope** de este spec, no OQ.

### O-2: ADR-040 y ADR-041 YA están usados en main. Cherry-pick generará COLISIÓN.

- **Evidencia**: spec §Linked references ADRs "ya aprobados en rama" como `040-git-history-compromise-literal-password.md` y `041-identity-platform-self-signup-off.md`. Pero `docs/adr/` en main HEAD contiene `040-wave-3-tls-ca-preload-fmc150.md` y `041-stakeholder-geo-aggregations-bounding-boxes-k-anonymity.md` (numerados + contenido sin relación). ADR-046 en main documenta colisiones históricas — exactamente la patología que se intentaba prevenir.
- **Riesgo**: cherry-pick de `ad970bc` sobrescribe los dos ADRs existentes O crea duplicados; audit trail se rompe; `scripts/check-adr-numbering` falla CI.
- **Resolución**: spec debe especificar **renumbering plan** (ej. nuevos ADR-051 / ADR-052 con contenido de los 040/041 abandonados + header "supersedes none, motivated by SEC-001"). SC-IAC.3 debe leer "ADR-051 + ADR-052 mergeados" no "040, 041".

### O-3: `customClaims.expires_at` NO enforce en sesiones already-signed-in. SC-1.1.1+SC-1.1.2 son insuficientes para el threat model.

- **Evidencia**: Firebase custom claims se hornean en el ID token al issuance y propagan en next token refresh (1h cadence) — no in-flight. Middleware `demo-expires.ts` lee claims del token verificado; sesión demo minted en día 29 con `expires_at = día 30` keeps functioning ~1h after deadline (hasta que SDK refresh), y attacker que tiene refresh token tiene ventanas de 1h con acceso válido **incluso post `auth.revokeRefreshTokens()`** salvo que verifyIdToken se llame con `checkRevoked: true`.
- **Riesgo**: SC-1.1.2 advertise garantía ("si past, 401") que la implementación no entrega sin `verifyIdToken(token, true)` + Admin SDK `getUser` server-side claim re-read at request time. Demo accounts siguen funcionando hasta 60min post-expiry, exactamente lo que un attacker con session exfiltrada explotaría.
- **Resolución**: SC-1.1.2b "`firebaseAuth.verifyIdToken(token, /*checkRevoked*/ true)` habilitado en demo path; middleware re-lee `expires_at` desde último user record (Admin SDK `getUser`) cada request, cached ≤60s en Redis". Ajustar §6.9 (Admin SDK lookup agrega latency).

### O-4: §7.4 threshold drift ">2 diffs no esperados → STOP" es meaningless y peligroso.

- **Evidencia**: §7.4 y §9 R-DRIFT son inconsistentes (1 vs >2 diffs); ninguno define "no esperado" objetivamente.
- **Riesgo**: un diff inesperado en `infrastructure/iam.tf` (ej. service account binding borrado) es catastrófico pero pasa el threshold. Human at apply-time está cansado y racionaliza "this one's fine".
- **Resolución**: rule categórico, no numérico: "CUALQUIER diff inesperado en resources matching `google_iam_*`, `google_secret_manager_*`, `google_storage_bucket*`, `google_cloud_run_v2_service*` → STOP. Diffs sólo en tags/labels/timestamps → log y continúa. Otros resource types → require explicit waiver event en ledger".

### O-5: Scope cohesion — H3 (DTE retention lock) NO pertenece a este spec.

- **Evidencia**: H3 = `infrastructure/storage.tf:143-145` change; 2 líneas terraform, no toca código, no coupling con H1/H2, explícitamente irreversible (clase de riesgo distinta). Bundling fuerza una decisión irreversible single-PR en el mismo gating que un middleware rework de semanas. §5 OOS dice "Cierre de los SEC-XXX restantes" out of scope, pero H3 ES structurally un SEC-XXX-style item.
- **Riesgo**: H3 hold up H1/H2 (¿cuál validation antes del lock? spec no dice) O rush porque resto del spec está listo. "BLOCKING" classification de H3 es de retention compliance, time horizon distinto, stakeholder distinto.
- **Resolución**: split H3 a spec separado `sec-h3-dte-retention-lock` (1 PR, 1 ADR, 1 `gsutil lock` manual). SC-IAC.5 en current spec: "H3 cerrado en su propio PR mergeado before final flip H1.6". O: keep en scope pero force-pair con SC-H3.0 explícito ("48h DTE write/read test en prod before lock").

### O-6: §10 test list miss los negative cases que definen el valor del is-demo enforcement.

- **Evidencia**: T6 testea "demo → 403; no-demo → 200" en endpoints del default-deny path. T9 cubre happy-path persona landing. **Ningún lugar** testea: (a) demo persona POST a allowlisted endpoint (debe succeed sin leak fuera del allowlist), (b) demo POST a brand-new endpoint added post-deploy (debe default-deny sin code change — el whole point del global middleware), (c) request hits demo enforcement antes de business logic, (d) rate-limit (H2) y is-demo (H1.3) middleware interactúan correctly en `/auth/driver-activate`.
- **Riesgo**: middleware ships y pasa sus 5-10 sampled endpoints, después nuevo POST endpoint mergeado 30 días después sin allowlist entry — y el dev "arregla" el 403 agregando al allowlist sin pensar. Defense-in-depth se vuelve default-allow over 6 months.
- **Resolución**: T6b (write endpoint añadido en fixture, expect 403 sin allowlist), T6c (allowlist entry happy-path con comment hash verified in CI), T6d (CI lint rule: cada allowlist entry tiene comment matching `// <rationale>` + `// REVIEW_BY: <date>`).

## P1 — Material gaps

### O-7: §7.1 cherry-pick narrative misrepresenta cuánto "main ha movido" — su premisa es parcialmente falsa.

- spec dice "el estado de main divergió en 10 días (PRs #217, #218, #223, #232, etc.)". `git log` muestra: #217, #218, #223 son ancestros del fork-point de la rama abandonada — pre-incident. Sólo #232 (2026-05-16) es post-incident. **Conflict surface mucho más pequeño** que lo que el spec implica.
- Resolución: §7.1/§8/OQ3 con `git log $(git merge-base feat/security-blocking-hotfixes-2026-05-14 main)..main` real (72 commits, mayoría S0/S1 sprint, **ninguno** tocando `apps/api/src/services/seed-demo*`, `routes/demo-login.ts`, `routes/auth-driver.ts`).

### O-8: Forensia 60d window (SC-1.5.1) — wrong direction en el trade-off.

- Literal primer commit `8400542` 2026-05-10. Hoy 2026-05-24. Public exposure window = **14 días**. 60d back-window cubre 46 días ANTES del literal — wasted compute y false confidence.
- Resolución: SC-1.5.1 scan window = **max(2026-05-10, retention-of-logs) → today**. Si Cloud Logging retention es 30d default en Identity Platform audit logs, window 2026-05-10→2026-05-24 está parcialmente missing — registrar residual.

### O-9: H2 rate-limit semantics under-specified para race conditions e infrastructure failure.

- (a) ¿Qué pasa cuando Redis es unreachable — fail-open (allow) o fail-closed (429 everything)? (b) ¿Qué cuenta como "RUT" — normalization per ADR-026? (c) ¿IP-based limits as defense-in-depth — 5/RUT means attacker rotates RUTs unrestrained?
- Resolución: SC-H2.1b "fail-CLOSED en Redis unreachable: 503, never bypass". SC-H2.1c "normalize RUT via `normalizeRut()` from `@booster-ai/shared-schemas`; integration test 4 input variants → same counter". SC-H2.4 "IP-based global: 30/15min/IP across todos RUTs, 429 con `X-RateLimit-Scope: ip`".

### O-10: H1.5 "monitoring 90d" no tiene exit criterion accionable hoy.

- SC-1.5.2 "criterio cierre triple: 90 días sin matches + ..." → spec no closeable hasta 2026-08-22. Goal del spec dice "Cerrar los tres hallazgos BLOCKING **hoy**". Mismatch.
- Resolución: split en dos estados: "SEC-001 mitigated" (hoy, post H1.6 green) + "SEC-001 monitoring complete" (T+90d). Reflejar ambos en SC-IAC.1 + SC-IAC.5 "Issue tracker tiene open ticket SEC-001-monitoring-window, auto-closes en detector PASS + 90d elapsed".

### O-11: OQ1 (keep vs recreate UIDs) — recreate es la respuesta técnicamente correcta, no "decisión pendiente".

- Post-disclosure de credential, defensible posture per OWASP / SP-800-63 es account replacement, not credential rotation: (a) no podés probar que old session token chain no fue exfiltrated, (b) UIDs son low-entropy / known-targets en public history, (c) custom claims/memberships/seed FKs replicables a new UIDs vía deterministic seed scripts. Único costo: fixtures churn para Van Oosterwyk demo — y Van Oosterwyk está en queue, no in-flight (memoria `project_d1_d6_demo_features`). **No hay continuidad real que preservar**.
- Riesgo: keeping UIDs anchora public attack surface; futuro audit ("cualquier account con public credential exposure debe retirarse") flagea exactamente estas 4 UIDs.
- Resolución: convertir OQ1 a recomendación: "RECREATE — 4 fresh UIDs, new emails (`demo-2026-shipper@...` o hashed), retire old UIDs (disable + audit log entry), seed script genera new UIDs at startup. Decision basis: post-disclosure correctness."

### O-12: §5 OOS — T-SEC-032a (PII redaction) deferral es taking a position by not taking one.

- "quizás separar" + "si no añade overhead" = drift vocabulary disguised as decision. PII redaction (logger redacta emails/phones/RUTs from structured logs) está en scope de "auditor SII / compliance Chile" (Ley 19.628 per `agents/security-auditor.md`). Defer + auditor flag = re-open SEC-001 efectivo.
- Resolución: hard-decide AHORA: include OR explicit OOS con justificación ADR-shaped ("PII redaction is separate SEC-032 finding, tracked in `.specs/sec-032-pii-redaction/`"). No "quizás".

### O-13: Solo-developer adaptation — spec implícitamente scoped para team.

- T1–T16 tests (~12 distinct test files); §7 lista 8 sub-fases con cooling-off 30min (§6.11). 8 PRs × (build + cooling-off + review + ship 2h watch) ≈ 8 × 4h serial = **~32h pura ejecución**, plus context-switching solo dev. Spec no da estimate, no PR-grouping, no priority para partial-deploy.
- Riesgo: 3 PRs land, después business priority interrumpe (Teltonika, demo cliente), spec muere a mitad — con prod en peor estado que hoy. **Repite el problema abandoned-branch**.
- Resolución: §14 "Execution plan for solo-dev" con: (a) minimum-viable-merge order, (b) safe pause points donde prod no es peor que hoy, (c) wall-clock budget per sub-phase, (d) explicit "si priority X interrumpe, current sub-phase es safe to leave open if and only if".

### O-14: §7.5 rollback priorities invertidos.

- H1.1 passwords rotados "irreversible by design" — fine. H1.2 self-signup OFF "toggle inverso ~1 min" — pero 4-min window entre deploy y detection de broken signup verá usuarios reales hit "Crear tu cuenta" → silent failure (FirebaseError code masked por `translateAuthError` en `apps/web/src/routes/login.tsx:151-154`).
- Resolución: SC-1.2.3 "pre-deploy synthetic monitor: signup probe runs every 60s, pages on first failure; canary deploy con 1% traffic 30min antes de full deploy". O: OOS para H1.2 hasta O-1 resuelto.

## P2 — Improvements (deferred OK)

### O-15: `agents/security-auditor.md` stale per ADR-049 / `.specs/_followups/migrate-booster-agents-to-plugin-v0.2.0.md`

Audit usa tooling stale. Loggear como residual §9 o hacer /review invoke confirm-tooling-version.

### O-16: Banner persistente MODO DEMO solo testeado after click, no across SPA route navigations.

T9b: "navegar por 5 rutas per persona, banner permanece visible".

### O-17: Durante build period (potentially semanas), demo.boosterchile.com sirve alert "Hubo un problema". Public-facing broken UX.

SC-INT-1: "demo.boosterchile.com sirve explicit maintenance page durante build period". O accept residual y documentar.

## Strong points (límite 3, sin padding)

1. **§3 Success criteria individualmente testables con comandos concretos** (curl, gsutil, git grep, terraform plan). Raro y bueno. SC-1.0.2 / SC-1.0.3 / SC-1.4.4 / SC-H3.2 / SC-IAC.4 ejemplares.
2. **§7.2 order-of-deployment es genuinamente non-negotiable para H1.4 → H1.1 → H1.0(flip)**. Chain "Secret Manager seed BEFORE password rotation BEFORE flag flip" es correcto y no-obvio.
3. **§9 R-LIT-HIST admite "irreparable, only neutralizable"**. No fantasy de force-push history rewrite en repo público. Postura correcta.

## Open questions devils-advocate no pudo resolver del spec solo

- ¿`harden-demo-accounts.ts --renew <uid>` ya está escrito? Spec §4 lo referencia, no se encuentra archivo. Si needs to be written, SC-1.1.5 cron implícitamente lo require pero no lo lista en scope.
- Lista real de endpoints write en main hoy: spec dice "≥50 endpoints (PF-1 contó 56)". Conteo actual: 32 route files / ≈61 write-method handlers. 5-10 sampled = 8-16% coverage. Low.
- ¿Cloud Logging retiene Identity Platform audit logs ≥60d en este project? SC-1.5.1 asume sí.
- ¿Qué pasa en `demo-account-password-conductor` rotation cuando conductor demo logs in por RUT + PIN, no email + password? El "password" del conductor demo ES el PIN per `apps/api/src/routes/auth-driver.ts`. SC-1.1.4 random 128-bit pwd rompe PIN-based login flow.
- ¿Claim `is_demo` se STRIPEA de non-demo sessions en cada refresh? Si un non-demo user alguna vez tuvo `is_demo:true` (testing) y nunca se clear-eo, queda permanentemente en global-deny middleware.

## Resumen para el PO

Si tuvieras que aprobar AHORA, no apruebes. El spec tiene la arquitectura correcta pero al menos 6 P0 reales:

1. **O-1**: hardening de seguridad propuesto rompería signup de usuarios reales hoy. Debe quedar OOS o resolverse con pre-trabajo.
2. **O-2**: ADR-040/041 ya existen en main con OTRO contenido. Renumbering plan obligatorio.
3. **O-3**: TTL claim no enforce in-flight sin `checkRevoked:true`. SC actuales sobre-prometen.
4. **O-4**: drift threshold sin definir → racionalizable.
5. **O-5**: H3 debería ser spec separado.
6. **O-6**: tests no cubren el negative case que define el valor del middleware.

Plus O-11 (recreate vs keep UIDs — recreate es defensiblemente correcto) y O-12 (PII redaction — hard-decide).

Pre-addressable por el agente (técnicas, sin trade-off real): O-2, O-3, O-4, O-6, O-7, O-8, O-9, O-10, O-13, O-14, O-15-17.

Requieren decisión PO: O-1 (alcance H1.2), O-5 (split H3 a spec separado), O-11 (recreate vs keep), O-12 (PII redaction in or out).

---

# Devils-advocate review — sec-001-cierre — round 4 (confirmatory) — 2026-05-24T19:05:00Z

## Scope of round 4

Confirmatory review of v3.1 (512 LOC) post-8-Edits from round 3. Round 3 said: "If both P0s resolved with edits ≤20 lines, spec ready for /plan without round 4." PO requested round 4 anyway. Charter: confirm Edits applied OR find what is still broken. Short by design.

## Edit-by-Edit verification

### Edit 1 — SC-1.2.0 expanded inventory (P0-R3-1)
- Verified `apps/web/src/hooks/use-auth.ts:3-18` actually contains 14 named methods: `createUserWithEmailAndPassword`, `linkWithCredential`, `linkWithPopup`, `onAuthStateChanged`, `reauthenticateWithCredential`, `reauthenticateWithPopup`, `sendPasswordResetEmail`, `signInWithCustomToken`, `signInWithEmailAndPassword`, `signInWithPopup`, `signOut`, `unlink`, `updatePassword`, `updateProfile`, plus `EmailAuthProvider`.
- Spec SC-1.2.0 lists: creation (9 methods incl. Google), mutation (5 methods), sign-in (2 methods). Total 16 enumerated.
- **Cross-verified vs real codebase**: `onAuthStateChanged` is MISSING from spec inventory. While `onAuthStateChanged` is a SUBSCRIBE, not an auth-action, the spec inventory `verifyBeforeUpdateEmail` is NOT in the file. The spec inventory is theoretically derived (Firebase SDK surface) rather than codebase-derived. Mostly aligned — `signOut` also missing but inconsequential.
- **Verdict**: Edit applied with one minor inversion (spec includes `verifyBeforeUpdateEmail` which is unused; misses `onAuthStateChanged`/`signOut` which are non-auth-mutating). Acceptable as a forward-looking inventory.

### Edit 2 — SC-1.2.2 Google provider (P0-R3-1)
- Spec adds fallback: "Si Identity Platform no expone toggle per-provider, alternativa: backend `app.api/v1/auth/google-callback` rechaza primera sign-in si no hay matching `signup_request` aprobada".
- **Issue (P1 below)**: This fallback ships AFTER Firebase has already created the user record via `signInWithPopup`. Cleanup `auth.deleteUser(uid)` is not specified. See P1-R4-1.
- **Verdict**: Edit applied. Cleanup gap is residual.

### Edit 3 — SC-1.1.8 UUID → deterministic (P0-R3-2)
- Verified spec changes UUID to `drivers+demo2026-conductor@boosterchile.invalid` as deterministic fixed string.
- **CONTRADICTION FOUND**: SC-1.1.1 (line 48) states the conductor email is `drivers+demo2026@boosterchile.invalid` (no `-conductor` suffix). SC-1.1.8 (line 61) states `drivers+demo2026-conductor@boosterchile.invalid` (with suffix). These two SCs disagree on the source of truth.
- **Verdict**: Edit applied but spec is now internally inconsistent. See P0-R4-1.

### Edit 4 — SC-1.2.5 Cloud Armor cascade (P1-R3-1)
- Verified `infrastructure/networking.tf:160-180` actually contains `rate_based_ban` priority 1000, count 1000, interval_sec 60, ban_duration_sec 600. Spec is accurate.
- Spec acknowledges the cascade. Layer order documented.
- **Issue**: Spec assumes that when Cloud Armor allows, Redis 503, response is 503 (middleware layer). This is correct. But the spec does NOT specify what happens if Cloud Armor itself returns 429 for the signup-request — is the 429 surfaced to client with the same `202 Accepted` enumeration defense, or does Cloud Armor's plain 429 leak enumeration? Cloud Armor 429 is **emitted at L7 before Hono middleware runs**, so enumeration defense via `202 Accepted` does NOT apply during Cloud Armor ban. Spec does not document this. Minor (P2).
- **Verdict**: Edit applied with shallow P2 residual.

### Edit 5 — §9 R-DA-CLAIM-LATENCY aligned (P1-R3-2)
- Verified §9 line 342 now says "≤5ms p95 cached / ≤200ms p95 uncached", aligned with §6.8 line 239.
- Searched spec for stale ≤8ms references: 0 matches.
- **Verdict**: Edit applied cleanly.

### Edit 6 — §9 R-DA-REDIS-SPOF (P1-R3-3)
- New row at line 343 mentions "Memorystore HA tier" as mitigation.
- **Issue**: Memorystore HA tier is NOT specified as an SC anywhere (no SC-H5.x or equivalent). Risk row says "Documentar en runbook incident-response" but the runbook is also not an SC. The mitigation is therefore **observational, not actionable** by /plan. Either it becomes a concrete SC, or risk should mark as "Accepted, no mitigation specified beyond observation". See P1-R4-2.
- **Verdict**: Edit applied as risk row but mitigation is hand-wave.

### Edit 7 — SC-H4.1 phone normalization (P1-R3-4)
- Spec at line 151 references `apps/web/src/lib/two-factor.ts:69`. Actual file line 69 is a docstring comment (`Llamar desde un user-action (click).`), not a regex. The actual phone format regex is at line 79: `/^\+\d{8,15}$/` — and this is E.164 validation of an MFA enrollment input, NOT a log redaction pattern at all.
- The spec's claim that "round 3 P1-R3-4 sobre formatos reales en `apps/web/src/lib/two-factor.ts:69`" is anchored to a misleading reference. The cited code does not match the prose. See P1-R4-3.
- Also: spec specifies a new normalization step (strip whitespace+dashes+parens, prepend +56 if 9-digit, etc.) but does NOT specify WHERE this normalizer lives. `packages/shared-schemas/src/primitives/chile.ts` has `normalizeRut` but no `normalizePhone`. So the spec requires net-new code in `@booster-ai/logger` (or new helper in shared-schemas), but does not assign a file/package.
- **Verdict**: Edit applied conceptually but reference is wrong and location of normalizer unspecified.

### Edit 8 — Status field qualifier (P2-R3-3)
- Line 5 now: "Draft v3.1 (post devils-advocate rounds 1+2+3; 2 P0 round-3 resueltos en surgical Edits)".
- **Verdict**: Cosmetic acceptable.

## P0 — Strong objections (must address before /plan)

### P0-R4-1: SC-1.1.1 and SC-1.1.8 disagree on conductor demo email

- Line 48 (SC-1.1.1): `drivers+demo2026@boosterchile.invalid`
- Line 61 (SC-1.1.8): `drivers+demo2026-conductor@boosterchile.invalid`
- Line 190 (§4 user-visible): "UIDs son los NUEVOS (`demo-2026-shipper@...`)" — does not specify conductor.
- This is exactly the inconsistency I flagged in round 4 charter section B ("are they consistent? is source of truth SC-1.1.1 or SC-1.1.8?"). The Edit to SC-1.1.8 introduced `-conductor` suffix but SC-1.1.1 was not updated to match.
- Impact: implementer reading SC-1.1.1 will create `drivers+demo2026@boosterchile.invalid`; implementer reading SC-1.1.8 will create `drivers+demo2026-conductor@...`. Two different Firebase UIDs created on cold-start. Idempotency test `seed-demo-third-cold-start.integration.test.ts` (line 64) may pass with the SC-1.1.8 string while SC-1.1.1 verification curl (line 48: `email.contains("demo-2026")`) only catches `demo-2026-` prefix not the `drivers+demo2026-conductor` driver.
- **Fix**: 1-line Edit to SC-1.1.1 to match SC-1.1.8 (add `-conductor` suffix) OR an explicit note that SC-1.1.8 is the source of truth for the conductor email and SC-1.1.1 lists only the 3 owner emails plus a "see SC-1.1.8 for driver email" reference.

## P1 — Substantive concerns

### P1-R4-1: Identity Platform Google provider fallback leaves orphan Firebase users

- SC-1.2.2 fallback flow: `signInWithPopup(googleProvider)` → Firebase tenant creates user record → returns to client → client/backend calls `/api/v1/auth/google-callback` → backend checks `signup_requests` → if no approved request, reject with "Tu cuenta requiere aprobación".
- **Problem**: by the time the backend rejects, Firebase Identity Platform has already created the user record (UID + email + provider linkage). The rejection only sends an error to the UI; the Firebase user persists.
- **Consequence**: attacker can spray `signInWithPopup(googleProvider)` against many Google accounts → many Firebase user records created with no `signup_request` link → eventually fills the tenant + potential email-enumeration via Identity Platform admin export.
- **Fix**: SC-1.2.2 fallback flow must include `firebaseAuth.deleteUser(uid)` server-side in the rejection path, with audit log entry `auth.signup_rejected.google_provider_orphan_cleaned`. 1-2 line spec addition.

### P1-R4-2: R-DA-REDIS-SPOF mitigation is observational, not actionable

- §9 row says "Mitigation: Memorystore HA tier" but no SC creates/configures HA tier. /plan cannot generate a task from a risk row alone (per agent-rigor SKILL).
- **Options**:
  - (a) Add SC-H5.1 `infrastructure/redis.tf` declares `tier = "STANDARD_HA"` with verification `gcloud redis instances describe`. ~3-line SC.
  - (b) Explicitly accept residual: "Memorystore HA is a deferred mitigation tracked in `.specs/_followups/`. Spec residual is Redis SPOF compounding accepted as ship-blocking-but-not-spec-blocking." Less satisfying but defensible.
- Current spec is neither (a) nor (b). It is hand-wave.

### P1-R4-3: SC-H4.1 references wrong file location

- Spec line 151 cites `apps/web/src/lib/two-factor.ts:69` as evidence for "real-world phone format false-negatives".
- File at that line is a docstring comment, not a regex or PII redaction code. The relevant regex at line 79 (`/^\+\d{8,15}$/`) is **E.164 validation of MFA enrollment input** — a code path that requires the user to type a strict format. It is not a sample of "real-world strings" found in logs.
- The actual real-world phone-formats-in-logs problem is real (e.g., contact forms, structured logs from inbound API, error messages) but the spec anchors it to the wrong codebase evidence.
- Also: the spec does not say where the normalizer code lives. `normalizePhone` does not exist in `packages/shared-schemas/src/primitives/chile.ts` (only `normalizeRut`). Spec requires net-new code in `@booster-ai/logger` or a new shared-schemas helper, but does not assign the location.
- **Fix**: 2-line correction. (a) Drop the `:69` reference or change it to a generic "phone formats observed in inbound payloads (contact forms, driver registration, customer support tickets) per `packages/shared-schemas/src/primitives/`" without false anchor. (b) Specify normalizer location: `packages/logger/src/normalizers/phone.ts` or `packages/shared-schemas/src/primitives/chile.ts` (add).

### P1-R4-4: `signup_requests` table migration ordering not specified

- SC-1.1.8 introduces a new DB table `demo_accounts` (via Drizzle migration). SC-1.2.1 introduces another new DB table `signup_requests`. Cold-start migration order matters: Drizzle migrate must run BEFORE `seed-demo-startup` reads `demo_accounts`. Currently `seed-demo-startup.ts` runs in `apps/api/src/server.ts` startup hook — order vs `pnpm db:migrate` is implicit, not declared.
- /plan needs to specify migration ordering as an SC or risk that on first cold-start the `SELECT FROM demo_accounts` errors out (table doesn't exist).
- **Fix**: 1-line note in SC-1.1.8 that "Drizzle migration must complete before `seed-demo-startup` runs; ordering enforced by `startup-sequence.ts` or equivalent".

## P2 — Improvements (deferred OK)

### P2-R4-1: Drift signal "TODO IaC" in line 83 (SC-1.2.2)

Spec text: "change manual + captura en `docs/qa/identity-platform-config.md` + TODO IaC". No issue/ticket linked. CLAUDE.md drift vocabulary catalog flags TODO without issue. Either link to `.specs/_followups/identity-platform-iac.md` or remove the TODO.

### P2-R4-2: SC-1.2.5 mentions "via mismo middleware H2 con scope distinto" but middleware parameterization is not specified

Spec assumes the H2 rate-limit middleware is parameterized to support different Redis key scopes (`rl:pin-activate:` vs `rl:signup-request:`). If it isn't, /plan will end up writing two near-identical middlewares (copy-paste). If it is, the parameterization signature should be declared. Acceptable as /plan-time decision.

### P2-R4-3: Cloud Armor 429 leaks enumeration during ban window

When Cloud Armor returns 429 at L7 (count exceeded, ban active), the Hono `202 Accepted` enumeration defense is bypassed. Same IP getting 429 from Cloud Armor on a signup attempt vs 202 from middleware on a non-signup attempt is itself a signal. Defense-in-depth still wins (Cloud Armor ban is coarse-grain) so this is P2 residual.

## Strong points

1. **The 8 Edits did not regress earlier SCs.** I scanned and found no broken cross-references (other than P0-R4-1 conductor email). The Edits are tight, surgical, and minimally invasive.
2. **Round 3 evidence chain preserved**: every Edit links back to a round 3 P0/P1 with explicit traceability in decision log (line 443). Future readers can audit the chain.
3. **Drift vocabulary mostly clean**: only one unjustified "TODO IaC" found (P2-R4-1). Other "TODO" / future-tense are in code-quoted blocks or test fixture naming, acceptable.

## Verdict

**APPROVE_WITH_RESERVATIONS_FINAL**

The spec is structurally sound. The 8 Edits substantively resolved the round 3 P0s. Round 4 found:

- **1 P0** (P0-R4-1: conductor email inconsistency between SC-1.1.1 and SC-1.1.8) — this is a 1-line Edit to fix.
- **4 P1** (Google provider orphan cleanup, Redis HA mitigation actionability, SC-H4.1 file anchor, migration ordering) — addressable in /plan with focused tasks, do not block spec.
- **3 P2** residual — accept and document.

Per round 4 charter ("if 1 P0, verdict = APPROVE_WITH_RESERVATIONS_FINAL — list the residual that PO accepts as deuda definida"), the 1 P0 is small enough that fixing it now (1-line Edit) and proceeding to /plan is correct. Alternatively, PO can defer to /plan if they prefer to keep round 4 to confirmation-only and move forward.

**Recommended action**: PO applies the 1-line Edit to SC-1.1.1 to match SC-1.1.8 conductor email format (`drivers+demo2026-conductor@boosterchile.invalid`), then proceeds to `/agent-rigor:plan`. The 4 P1s and 3 P2s are tracked in /plan as explicit tasks or accepted residuals.

**Do NOT request round 5.** This spec has been adversarially attacked four times. Further rounds will produce diminishing returns and the marginal P1/P2 items found are better addressed during /build with real code in hand than in spec prose.

