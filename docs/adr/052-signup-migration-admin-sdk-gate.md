# ADR-052: Signup público migrado a Admin SDK + admin-approval gate + Identity Platform self-signup OFF (email/password leg)

- **Status**: Proposed (2026-05-26; T6 Sprint 2b H1.2 PR2). Transición a `Accepted` agendada en T13 post-canary 30 min success + 2 h watch.
- **Date**: 2026-05-26
- **Deciders**: Felipe Vicencio (PO)
- **Linked**:
  - Spec: `.specs/sec-001-cierre/spec.md` §3 H1.2 (SC-1.2.0..SC-1.2.5), §13 decision log O-1 (admin-approval gate first), amendment A3 v3.4 (Google leg deferred)
  - Plan: `.specs/sec-001-cierre/plan-sprint-2b.md` T6 (este ADR), T7 (DB schema), T8 (route + service + rate-limit), T9a/T9b/T9c (integration tests), T10 (admin UI + email), T11 (Terraform IdP), T13 (canary + Status flip)
  - Inventario: `docs/qa/signup-paths-audit.md` (entregado en T6 junto con este ADR)
  - Origin: spec v3 round 1 objection O-1 ("flip self-signup OFF" → "migrar primero, después flip") + amendment A3 v3.4 (2026-05-25)
  - Followup: `.specs/_followups/sprint-2c-google-blocking-function.md` (Google leg deferred)
  - Precedent: ADR-053 (post-disclosure account replacement) — mismo pattern Status transitions Sprint 2a.
  - References: NIST SP 800-63 §5.2.2 (memorized secret enrollment); OWASP ASVS V2.7 (account registration); OWASP API Security Top 10 2023 API3 (broken object property level authorization).

## Context

Spec `.specs/sec-001-cierre` SEC-001 H1.2 expandió de "Identity Platform self-signup OFF" (spec v1) a "migrar paths productivos de signup a Admin SDK + admin-approval gate, **después** flip self-signup OFF" (spec v3 post-objection O-1). Razón de la expansión: hacer flip antes de migrar genera regresión customer-facing (el web app rompe en `signUpWithEmail` → `createUserWithEmailAndPassword` retorna `auth/operation-not-allowed`, sin alternativa para que un user real pida cuenta).

Estado del repo en main HEAD `c3a6ebb` (2026-05-26):

- `apps/web/src/routes/login.tsx:140` llama `signUpWithEmail({...})` → `apps/web/src/hooks/use-auth.ts:137` ejecuta `createUserWithEmailAndPassword(firebaseAuth, ...)` 100 % client-side. Cualquier visitante anónimo puede crear cuenta en Identity Platform.
- `apps/web/src/hooks/use-auth.ts:85` ejecuta `signInWithPopup(firebaseAuth, googleProvider)` también client-side, con sign-up implícito en primer login Google.
- No existe ruta backend `POST /api/v1/signup-request` ni handler de admin-approval.
- Identity Platform tenant `booster-ai-494222` tiene self-signup ON (verificado en plan Sprint 2b T6 audit: `curl -s "https://identitytoolkit.googleapis.com/admin/v2/projects/booster-ai-494222/config" | jq '.signIn.email.allowDuplicateEmails'` retorna estado actual permissive).

Sin la migración, flip-only deja UX rota; sin el flip, migration es teatro (cualquier cliente con Firebase SDK bypassa el endpoint backend). El plan Sprint 2b H1.2 PR2 secuencia ambos pasos: primero entrega T7-T10 (DB schema + endpoint + admin UI + flag feature off-by-default), después T11 (Terraform flip), después T13 (canary deploy + Status `Accepted`).

Decisión obligada: ¿qué arquitectura de signup deja el patrón estabilizado y compatible con la disciplina Zero-Trust Booster?

## Decision

**Signup público (email/password) migrado a un flow admin-approval gated**:

1. Frontend (`apps/web/src/routes/login.tsx`) deja de llamar `signUpWithEmail`; en su lugar invoca `POST /api/v1/signup-request` (endpoint nuevo, sin auth, IP rate-limited, en plan Sprint 2b T8).
2. Backend (`apps/api/src/routes/signup-request.ts` + `services/signup-request.ts`) persiste un row en tabla `solicitudes_registro` con `estado=pendiente_aprobacion` (Drizzle schema en T7). Response 202 idempotente, identical para email nuevo vs ya-existente — defensa contra email enumeration.
3. Email a `BOOSTER_PLATFORM_ADMIN_EMAILS` notifica de la nueva request (servicio en T10).
4. Admin entra a `/app/platform-admin/signup-requests` (UI en T10, single-file pattern `apps/web/src/routes/platform-admin-signup-requests.tsx`), aprueba o rechaza.
5. Approve → backend ejecuta Firebase Admin SDK `auth.createUser({email, displayName})` desde service account con privilegio `firebase.auth.users.create`. Email al user con login link.
6. Reject → `estado=rechazado`, sin cuenta creada.
7. Identity Platform tenant configurado vía Terraform (`infrastructure/identity-platform.tf` en T11) con `sign_in.email.enabled=true, sign_in.email.password_required=true, sign_in.allow_duplicate_emails=false` y self-signup email/password disabled. Cliente Firebase invocando `createUserWithEmailAndPassword` recibe `auth/operation-not-allowed`.
8. **Google leg (SC-1.2.2 amendment A3) = TRACKED_RESIDUAL**: Identity Platform GA no expone toggle per-provider "Allow new accounts to sign up = OFF" para Google; el equivalente se implementa con Firebase Auth Blocking Function `beforeCreate` en Sprint 2c. Tracked en `.specs/_followups/sprint-2c-google-blocking-function.md`. Riesgo aceptado: Google self-signup queda OPEN entre Sprint 2b ship y Sprint 2c ship, no exploitable end-to-end sin role-assignment manual.

Fundamento normativo:

- **NIST SP 800-63 §5.2.2** Enrollment: "verifier SHALL bind an identity to an authenticator only after [...] identity proofing or attribute verification". El admin-approval gate cumple el rol de attribute verification: el admin verifica que el email solicitante es legítimo (cliente real, no automated abuse).
- **OWASP ASVS V2.7 Authentication & Session Management**: la fase de account creation debe ser protegida con controls equivalentes a los de authentication (rate-limit, enumeration defense, audit log). El flow Sprint 2b cumple con SC-1.2.5 (rate-limit 5/15min/IP + cascade Cloud Armor + structured logs).
- **Cero deuda técnica day 0 (CLAUDE.md Booster)**: la decisión NO es entregar signup mínimo viable y endurecer en sprint siguiente; es structural-first.

## Consequences

### Positivas

- **Self-signup customer-facing fraud surface = 0** post-T11 (para email/password). Atacante anónimo que invoque Firebase SDK directamente recibe `auth/operation-not-allowed`.
- **Audit trail completo**: cada solicitud queda en `solicitudes_registro` con timestamps + approver email. Cumple Ley 19.628 (privacy Chile) art. 5 (responsabilidad del responsable del registro) y SII/DTE retention 6 años en caso de auditoría futura sobre quién creó qué cuenta.
- **Email enumeration defense estructural**: response 202 idempotente para email existente vs nuevo — sin canal lateral sobre presencia de usuarios.
- **Rate-limit aplicado en el path**: SC-1.2.5 garantiza 5/15min/IP + cascade Cloud Armor + fail-closed 503 si Redis down (defense en profundidad).
- **Synthetic monitor en producción**: SC-1.2.3 + plan T13 garantiza canary 30min antes de full deploy + uptime check cada 60s post-deploy — regresiones se detectan con baja blast radius.
- **Pattern reusable**: si Booster agrega nuevos roles (e.g., admin marketplace, support agent), el mismo flow signup-request → admin-approval aplica sin cambios estructurales.

### Negativas

- **UX delay sign-up → activación**: user que envía form recibe 202 + email de "tu solicitud está siendo revisada". Email de activación depende de cuándo el admin aprueba. SLA blando: 24 h hábiles. Mitigation: admin UI (T10) tiene notificación email per nueva solicitud + dashboard prominente; en producción se evaluará workflow para escalation si solicitudes acumulan.
- **Manual admin workload**: cada signup-request requiere un click admin. Para Booster en estadio TRL 10 con volumen moderado (~10-50 requests/mes esperado), workload es aceptable. Si crece, considerar auto-approval bajo reglas (e.g., email domain allowlist) en spec futura.
- **Google leg residual = OPEN entre Sprint 2b y Sprint 2c**: cualquiera con cuenta Google + popup puede crear Firebase User. Risk surface mitigado por downstream role-assignment (sin role, user no consume endpoints útiles); pero log noise en Identity Platform + cuentas huérfanas en tenant. Mitigation: monitor Identity Platform audit log + alerta sobre rate de sign-ups Google sin matching `solicitudes_registro.estado=aprobado`. Sprint 2c cierra el leg con Blocking Function.
- **Email enumeration nominal en admin UI**: el admin ve emails de solicitudes pendientes; un admin malicioso podría exfiltrar la lista. Mitigation: audit log de accesos al admin route + role check estricto (`BOOSTER_PLATFORM_ADMIN_EMAILS` env). Risk aceptado dado el set acotado de admins (Felipe).
- **No-rotation precedent extension**: este ADR establece que para SaaS B2B regulados (logística chilena), self-signup público sin verification adicional NO es aceptable. Para futuras superficies B2C que Booster pueda explorar (e.g., conductor self-onboarding del lado driver app), revisar caso a caso — el patrón puede o no aplicar.

### Riesgo residual

- **R-DA-EMAIL-DELIVERY**: si el email "tu solicitud está siendo revisada" o el email "tu solicitud fue aprobada, accede acá" no llega (spam folder, deliverability provider down), user real cree que app está rota. Mitigation: usar mismo proveedor email que confirma DTE (alta deliverability), structured logs + métrica `signup_email_sent` + alerta on rate-of-failure > 5 %. Documentar en runbook T13.
- **R-DA-GOOGLE-OPEN**: Google sign-in self-signup OPEN entre Sprint 2b y Sprint 2c. Documentado, monitoreado, no exploitable end-to-end sin downstream role assignment. Cierre en Sprint 2c (`.specs/_followups/sprint-2c-google-blocking-function.md`).
- **R-DA-ADMIN-INSIDER**: admin malicioso podría aprobar solicitudes attacker. Mitigation actual: solo Felipe en `BOOSTER_PLATFORM_ADMIN_EMAILS`. Cuando se incorpore segundo admin, este ADR debe revisarse para incluir dual-control approval para emails fuera de domain allowlist.
- **R-DA-FLAG-FLIP-WINDOW**: durante Sprint 2b ship, hay una ventana entre T10 (admin UI + email available) y T11 (Terraform IdP flip) en que coexisten ambos paths. Mitigation: feature flag `SIGNUP_REQUEST_FLOW_ACTIVATED=false` default (spec §7.5) deja UI nueva en "coming soon" mode hasta que admin route esté probado + flag flip ON intencional. Plan T10 acceptance documenta el sequencing.

## Alternatives considered

### Alt-1: OAuth-only (Google / Apple SSO, eliminar email/password del todo)

**Rejected**. Pros: elimina la superficie email/password completa; reduce phishing risk (passwords nunca atraviesan Booster). Cons: (a) clientes B2B logística en Chile no necesariamente tienen cuenta Google corporativa estandarizada (muchas PYMEs usan emails @gmail.com personales mezclados con @empresa.cl outlook/zoho); forzar SSO recorta TAM. (b) Google leg sin Blocking Function tiene el mismo gap de self-signup que email/password — sin un gate adicional, OAuth-only no resuelve el problema. (c) Apple SSO requiere Apple Developer Program enrollment + tariff anual + flujo adicional que Booster no necesita estado TRL 10. Spec v3.2 round 1 PO decision: no. Este ADR confirma la decisión.

### Alt-2: Email-verification-only (Firebase `sendEmailVerification` o link sign-in) sin admin-approval

**Rejected**. Pros: zero admin workload; Firebase ya implementa el primitivo `sendSignInLinkToEmail` + `signInWithEmailLink`. Cons: (a) no satisface O-1 PO ("admin debe controlar acceso a marketplace B2B regulado"); (b) no defensa contra automated abuse — atacante puede crear emails @gmail.com infinitos, verificar cada uno, popular el tenant Identity Platform de cuentas-zombie. (c) email-verification valida que el solicitante posee el email, no que es un cliente legítimo de Booster. La decisión de quién entra al marketplace B2B es un product call, no un technical primitive de Firebase.

### Alt-3: Status quo (Identity Platform self-signup ON + downstream role checks)

**Rejected**. Esto fue la propuesta del spec v1 (rejected en round 1 por devils-advocate O-1). Pros: zero changes; el modelo existente de "Firebase User sin role no consume endpoints" sería defensa suficiente. Cons: (a) SEC-001 H1.2 explícitamente exige cerrar self-signup como capa estructural — depender solo de downstream defense es one-layer protection, viola defense-in-depth principle; (b) tenant Identity Platform crece con cuentas-zombie infinitas (operational cost + audit noise); (c) attacker que descubra una manera de elevar role (futuro RCE en `/api/v1/empresas/join`, IDOR en membership, etc.) tiene attack surface pre-fabricado. SEC-001 spec rechazó esta opción in toto.

### Alt-4: Magic-link only (passwordless) gated por admin-approval

**Rejected** (considerado en /plan Sprint 2b T6 audit). Pros: zero passwords; combina admin-approval de Decision + UX moderno. Cons: (a) UX dual con `signInWithEmail` existente confunde — Booster tendría que migrar también auth-existing-users a magic-link, scope creep masivo; (b) magic-link sin password es vulnerable a session theft si el email del user es comprometido — sin password como segundo factor, attacker con email access tiene access total. Spec actual mantiene password como base + 2FA opcional (otro spec). Migrar a magic-link merece su propio spec/ADR; en Sprint 2b no aplica.

### Alt-5: Diferir migration a Sprint 3 (flip Terraform first, fix UX después)

**Rejected**. Esto fue propuesto en /plan round 2 P0-2: "flip primero, build UI después". Cons: rompe demos pendientes + leads in-flight + customer-facing regression de UX abierta sin SLA. Spec v3 + amendment v3.4 establecen que migration first, flip after — no negociable per CLAUDE.md "Cero deuda day 0".

## Notes for future-self

- Cuando Sprint 2c (Google Blocking Function) cierre, este ADR debe linkearse desde el nuevo ADR de Blocking Function (cross-reference bidireccional para que el reader entienda el residual closing).
- Si se agrega un segundo admin a `BOOSTER_PLATFORM_ADMIN_EMAILS`, considerar dual-control approval para emails fuera de domain allowlist conocido. Tracked como follow-up cuando se incorpore el segundo dev/admin.
- El admin UI (T10) usa pattern `platform-admin-*.tsx` single-file. Cuando crezca a >1500 LOC, considerar split — tracked en review.md Sprint 2b si aplica.
- El email enumeration defense del endpoint depende de timing-equivalence: response 202 con misma latencia para email nuevo vs existente. Si el flow approve agrega side-effect síncrono (e.g., write a tabla externa para email-nuevo solamente), el timing puede leak presence — code review SC-1.2.5 debe re-verificar.
- Considerar Cloud Identity Aware Proxy (IAP) o reCAPTCHA Enterprise frente al endpoint `/api/v1/signup-request` cuando volumen crezca (>500 requests/mes) para reducir bot signup attempts. Out-of-scope SEC-001; tracked en backlog.

## Acceptance criterion para transition Proposed → Accepted

Este ADR transiciona a `Status: Accepted` cuando **todas** estas condiciones se cumplen, en este orden:

1. T7 Drizzle migration `solicitudes_registro` + pgEnum mergeado en main.
2. T8 endpoint `POST /api/v1/signup-request` + service + rate-limit middleware + health endpoint mergeado.
3. T9a + T9b + T9c integration tests todos mergeados y passing en main CI.
4. T10 admin UI + email notifications + feature flag `SIGNUP_REQUEST_FLOW_ACTIVATED` mergeado (flag default `false`).
5. T11 Terraform `google_identity_platform_config` aplicado en prod con email/password self-signup OFF; verificado via curl Admin API.
6. T13 canary deploy ejecutado: 30 min sobre `--no-traffic` tag + `canary-verify` step OK (error_rate < 1 % AND p95_latency < 500 ms) + `update-traffic --to-latest` + 2 h watch post-deploy sin alertas signup-probe.
7. Synthetic monitor `signup-probe` (cada 60 s) muestra success rate > 99 % durante las 2 h watch.
8. T13 emite **separate post-merge commit** `docs(adr-052): Accepted post-canary success cloudbuild run <ID>` que actualiza línea 3 de este file de `Proposed` a `Accepted` (per plan §3 T13 round 2 P1-5 fix).

Si cualquier step 1-7 falla, el flip Status se posterga; rollback path está definido en plan T13 (`gcloud run services update-traffic --to-revisions=PREVIOUS=100`).
