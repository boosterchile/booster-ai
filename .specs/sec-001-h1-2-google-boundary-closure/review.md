# Devils-advocate review — sec-001-h1-2-google-boundary-closure

## Round 1 — 2026-05-29T00:00:00Z (devils-advocate)

Stance: assume the spec is wrong until each load-bearing claim survives. The central
premise ("the ADR-001 boundary ALREADY enforces the admission invariant") was tested
against `server.ts`, `user-context.ts`, and the bare-firebaseAuth handlers. It does
not hold as stated. Findings below, P0/P1/P2, each with a concrete remedy, then verdict.

---

### P0-1 — SC-G1 premise is FALSE: `POST /empresas/onboarding` self-provisions an unprovisioned token into an active user with NO approval gate

**Claim under attack (SC-G1, §0, §2, decision log, alt-d-vs-g §2):**
"a verified Firebase token with no `users` row receives 404 `user_not_registered` …
Every business route behind userContext already fail-closes." The spec then frames the
blocking function's "only marginal value" as preventing the inert IdP record from existing.

**Evidence it is false:**
- `apps/api/src/server.ts:322-328` wires `/empresas/*` on `firebaseAuthMiddleware` +
  demo-expires + is-demo-enforcement, but **NOT** `userContextMiddleware` (deliberate —
  comment lines 319-321: "el user todavía no existe en la DB cuando llama acá").
- `apps/api/src/routes/empresas.ts:25-89` `POST /empresas/onboarding` reads only
  `claims.uid` + `claims.email` and calls `onboardEmpresa(...)`.
- `apps/api/src/services/onboarding.ts:67-160` `onboardEmpresa` has **zero** check
  against `solicitudes_registro.estado='aprobado'` (or any allowlist). Its only guards
  are uniqueness (UserAlreadyExists / EmailAlreadyInUse / EmpresaRutDuplicate / Plan).
  On success it INSERTs `users.status='activo'` + `empresas` + `memberships role='dueno'
  status='activa'` (onboarding.ts:114-160 doc lines 64-65).

**Consequence:** an unauthorized Google self-signup (valid token, no users row) is NOT
inert. It can call one public-by-design business route and **promote itself to a fully
active dueño with a company and membership** — exactly the invariant the deny-pure
blocking function (`auth-blocking-functions/src/handler.ts:91-99`, deny if no
`estado='aprobado'` row) existed to enforce at creation time. G does not move that
invariant to the boundary; it **drops it**. SC-G1's "ENFORCED everywhere" cannot be
truthfully checked off, because this route is a real GAP, not an "INTENTIONAL-OPEN
onboarding probe" like `/me`. `/me` is a read; `/empresas/onboarding` is a privilege-
granting write with no gate.

**Why the alt-d-vs-g comparison missed it:** §2 of that doc asserts "every business
route behind userContext already fail-closes" — true, but it never enumerated the routes
deliberately placed OUTSIDE userContext (`/empresas`, `/me/clave-numerica`, `/me/consents`,
`/me`). The comparison generalized from the userContext-wired subset to "the boundary",
which is the overstatement. The whole D-vs-G decision rests on this generalization.

**Remedy (must, before /plan can proceed):**
1. Reframe SC-G1 from "audit confirms enforcement (assumed true)" to "audit will find
   gaps; onboarding self-provisioning is one." Add an explicit success criterion: a
   business route may be on bare firebaseAuth ONLY if it (a) serves no data and grants no
   privilege without an approval/allowlist check, or (b) is read-only onboarding status.
2. Add a hard requirement: `onboardEmpresa` (or the `/empresas/onboarding` handler) MUST
   verify `solicitudes_registro.estado='aprobado'` for the firebase email before INSERT,
   OR the spec must explicitly accept self-service onboarding as the intended product
   behavior and document why the blocking function was ever needed. You cannot have it
   both ways: either onboarding is gated (then G needs this new code, it is not
   "~zero code already shipped"), or onboarding is open (then SEC-001 H1.2 is NOT closed
   by G and the residual cannot transition to MET).
3. SC-G8 (TRACKED_RESIDUAL → MET) is blocked until #2 is resolved. As written, MET would
   be asserted while the self-signup→active-account path is still open via onboarding.

This finding alone is sufficient for DO_NOT_APPROVE of the spec as drafted, because the
objective (§1) and SC-G8 are built on a premise the code contradicts.

---

### P0-2 — Reaper firebase_uid↔email cross-key split can delete a freshly-onboarded legitimate account (race) — and a malicious actor can weaponize email mismatch

**Claim under attack (SC-G3, T2, T4, R-G1):** the predicate is safe because (1) no
`users` row by `firebase_uid`, (2) no `solicitudes` row `estado IN (pendiente,aprobado)`
by email, (3) aged. "users-row hard-guard" makes it fail-safe.

**Evidence of the gap:**
- `users.firebaseUid` is `NOT NULL UNIQUE` (`db/schema.ts:550`). So the "no users row by
  firebase_uid" guard works ONLY when the IdP uid equals the stored uid.
- `apps/api/src/routes/me.ts:60-90` GET `/me` performs **account-linking**: if no row by
  uid but a row exists by verified email, it **rewrites** `users.firebaseUid` to the new
  uid. Between an unauthorized Google login and the first `/me` call, the IdP uid does NOT
  match any users row even for a legitimate linked user — the match is by email, which the
  reaper only checks against `solicitudes`, not `users`.
- `solicitudes_registro` has **no `firebase_uid` column** (verified: signup-request.ts
  schema is id/email/nombre/estado/requestedAt/approvedBy/approvedAt). So the reaper's two
  predicates key on two different identifiers (uid for users, email for solicitudes). If
  the IdP account email differs from the solicitudes email (Gmail dot/plus normalization,
  capitalization, an alias, a corporate vs personal address used at approval), predicate
  (2) returns "no pending/approved" → the account looks reapable even though it was approved.
- T4 ("estado=aprobado but users row not yet created → not reaped") is covered ONLY by
  predicate (2) catching `aprobado`. But the schema note says firebase_uid can be null
  transiently and `approveSignupRequest → auth.createUser` is async: the window where the
  IdP account EXISTS, estado has already moved past `aprobado` (or the email differs), and
  the users row is not yet written, is not covered by any of the three conditions.
- `demo-account-ttl-alerter.ts` (the cited reference) does NOT delete — it only logs. It
  is not a safe template for a destructive operation; it has no pagination, no idempotency
  for deletes, and lists from DB (`cuentas_demo`) not from the IdP. The reaper must list
  from the IdP (Admin SDK `listUsers`, paginated to 1000/page), which the reference does
  not demonstrate. Missing a page = orphan; double-listing across a page boundary during
  creation = nothing dangerous, but missing the users-row read for a uid that linked
  mid-scan = false-positive delete.

**Weaponization:** because creation is allowed (the whole point of G) and the match is by
email, an attacker who knows a pending applicant's email can self-create a Google account,
let it age past grace, and — if normalization ever disagrees between the reaper's email
canonicalization and the one used at approval — cause deletion or get the legit applicant's
inert account reaped, a griefing vector. Low likelihood, but it is an attack the blocking
function structurally prevented.

**Remedy:**
1. Single source of truth for the "is this account legitimate" decision must be
   `users` BY EMAIL **and** BY uid, not uid alone. Add a hard-guard: refuse to reap if a
   `users` row exists with `email = idpAccount.email` (normalized) regardless of uid
   mismatch. This closes the account-linking race.
2. The solicitudes email match MUST use the exact same `normalizeEmail` used by
   `approveSignupRequest` and by `auth-blocking-functions/src/email-normalize.ts`. Pin it
   in the spec and test cross-normalization (Foo@x.cl vs foo@x.cl, plus-tags, IDN) — add
   to SC-G3 test list explicitly (current T-list has no normalization test).
3. Add a fourth predicate condition: refuse if the IdP account's `lastSignInTime` (not
   just creationTime) is within grace — an account actively being used but not yet linked
   is almost certainly mid-onboarding.
4. SC-G4 must require listing from the IdP with explicit pagination handling and a test
   that a >1000-account tenant is fully scanned; do not inherit the alerter's DB-driven
   single-query pattern.
5. Disable-before-delete (OQ-G2) must be the DECISION, not an open question, given P0-1:
   while onboarding is open, "inert" is a fuzzier category and a reversible disable with a
   second grace window is the only defensible first action.

---

### P1-1 — Consolidating to a single boundary layer IS a defense-in-depth regression, and the spec does not install the backstop it removes

**Axis: alternatives / reversibility / second-order.** The blocking function was a
creation-time backstop independent of route wiring. G removes it and makes correctness
depend on every current AND future route being wired correctly. P0-1 proves the current
wiring already has a hole — so the "regression if a future route ships without
userContext" risk (R-G2 names it but rates it M/H and mitigates only with a per-group
representative test) is not hypothetical; it is the present state.

A per-group representative 404 test (T8) does NOT catch P0-1, because `/empresas` is
INTENTIONALLY not userContext-wired and would be marked INTENTIONAL-OPEN — the test
asserts 404 on userContext routes and skips the open ones, exactly where the hole is.

**Remedy:** the spec must add a structural default-deny harness, not a sampling test:
- A CI check (pattern exists: `check-is-demo-wire-completeness.ts`, server.ts:284)
  enumerating every `app.route` mount and asserting each is either userContext-wired OR on
  an explicit, reviewed `ONBOARDING_OR_PUBLIC_ALLOWLIST` with a per-entry rationale —
  failing the build when a new mount appears unclassified. This is the only thing that
  makes "the boundary enforces it" durable without the creation-time backstop. Without it,
  G trades a robust invariant for a fragile convention. Add as a new SC.

---

### P1-2 — C-G3 (grace ≥ approval SLA) depends on an SLA the spec admits it does not have (OQ-G1), and there is no approval-SLA source

**Axis: evidence quality.** C-G3 and R-G3 both hinge on `REAPER_GRACE_DAYS > max
approval SLA`. OQ-G1 says the SLA is unknown and proposes 30 days as a guess. The
signup-request flow has no documented turnaround SLA (admin-approval is manual,
human-gated). A guessed grace period is not evidence; it is a vibe with a number.
Worse: a genuinely pending applicant whose `solicitudes` estado is still
`pendiente_aprobacion` IS protected by predicate (2) — but one whose request was
**rejected** (`estado='rechazado'`) then re-applies, or who never filed a solicitud at all
(pure self-signup, the actual H1.2 vector) has NO solicitudes row, so only the grace timer
protects them. 30 days is arbitrary for that population.

**Remedy:** make REAPER_GRACE_DAYS a documented decision tied to a real, written
approval-turnaround commitment (or, if none exists, state explicitly that grace protects
only "self-signup with no solicitud" and justify 30d against observed onboarding latency,
not an imagined SLA). Resolve OQ-G1 before /build, as the rollout gate already implies.

---

### P1-3 — SC-G7 decommission: deleting Gen1 tainted state + IAM is destructive infra and the "clean terraform plan" gate is necessary but not sufficient

**Axis: failure modes / reversibility.** SC-G7 removes
`infrastructure/auth-blocking-functions.tf` (incl. Gen1 tainted state, placeholder bucket,
IAM grants), the cloudbuild deploy lane + `_AUTH_BLOCKING_DEPLOY` gate, and the
`identity-platform.tf` blocking_functions wire. Risks:
- The `identity-platform.tf` blocking_functions wire was "never applied" — removing
  unapplied config is safe, but if it WAS partially applied in any environment, `terraform
  plan` in the OTHER environments will look clean while prod/staging drift. The gate is
  per-environment; the spec says "a clean terraform plan" (singular).
- Removing IAM grants that the Gen1 SA still holds can leave an orphaned SA or break an
  unrelated binding if the grant was reused. Grep-for-references (R-G4) finds code refs,
  not IAM-binding reuse.
- Tainted Gen1 state removal: `terraform state rm` vs `destroy` matters — destroy may try
  to delete a function that GCP already deprecated out from under TF, producing a
  provider error that blocks the whole apply.

**Remedy:** SC-G7 must require a `terraform plan` in EACH of dev/staging/prod (C-G4 says
100% IaC; honor it per-env), enumerate the exact resources to `state rm` vs `destroy`, and
verify no IAM binding removed is referenced by a non-blocking-function resource. Archive
(OQ-G5) the `apps/auth-blocking-functions` source rather than delete — it is verified
deny-pure reference code and the only artifact proving what the invariant was; cheap to keep
under a tag/`docs/archive/`.

---

### P2-1 — Unmeasurable / under-specified success criteria

- SC-G1 verdict vocabulary (ENFORCED / INTENTIONAL-OPEN / GAP-FIXED) has no definition of
  what disqualifies "INTENTIONAL-OPEN." Given P0-1, define it: INTENTIONAL-OPEN requires
  "serves no data and grants no privilege absent an in-handler approval/allowlist check."
- SC-G2 "PO records a decision per INERT account" — no criterion for what makes the
  decision auditable later (timestamp, rationale, reversible?). Tie to the audit-log
  requirement.
- "related monitoring infra that only served the blocking function" (SC-G7) is vague —
  enumerate it; "only served" is a judgment call that can silently delete shared dashboards.

### P2-2 — Missing risks / alternatives

- **Not considered:** gating onboarding itself (the actual fix for P0-1) as an alternative
  to / complement of the reaper. The reaper is hygiene; it does not stop the self-provision.
  Even with a reaper, an attacker has `REAPER_GRACE_DAYS` of full dueño access. The spec
  treats unauthorized accounts as "inert" — P0-1 shows they are not. This alternative
  (gate onboarding) was never surfaced in §8.
- **Missing risk:** the reaper deletes an IdP account that still has an active Firebase
  session / refresh token; deletion revokes it mid-use for a user who linked but whose row
  the reaper failed to see (P0-2). Cost: a legitimate user is logged out and cannot
  re-auth. Not in the risk table.
- **Missing risk:** OQ-G3 (provider-agnostic vs Google-only) is rated as cleanup, but
  provider-agnostic + the email-cross-key (P0-2) means a SAML/phone account with no email
  could match predicate (2) trivially (no email → no solicitudes match) and be reaped.
  Phone-provider accounts have no email at all. Confirm before going provider-agnostic.

---

## Verdict

**DO_NOT_APPROVE** (as drafted).

The spec's load-bearing premise — "the ADR-001 boundary already enforces the admission
invariant; G is consolidation onto already-shipped code with ~zero new auth code" — is
contradicted by `POST /empresas/onboarding` → `onboardEmpresa`, which lets any
authenticated-but-unprovisioned token self-promote to an active dueño with NO approval
gate (P0-1). This is the exact invariant the deny-pure blocking function enforced.
Therefore G does not move the invariant to the boundary; it drops it, and SC-G8
(residual → MET) would assert closure of a still-open vector.

To reach APPROVE_WITH_RESERVATIONS, the spec must:
1. Resolve P0-1: either add an approval/allowlist gate to onboarding (and admit G is NOT
   "~zero new code"), or explicitly decide self-service onboarding is intended and re-scope
   what "closed" means for H1.2.
2. Resolve P0-2: email+uid dual hard-guard, shared normalization, lastSignInTime guard,
   IdP-side paginated listing, disable-before-delete as a decision.
3. Add the structural default-deny CI harness (P1-1) so the dropped creation-time backstop
   is replaced by a durable wiring invariant, not a sampling test.

Residual risks to accept-and-document even after the above: per-environment Terraform drift
on the never-applied blocking_functions wire (P1-3); grace-period arbitrariness for the
no-solicitud self-signup population (P1-2); reaper revoking an in-flight session of a
mis-matched-but-legitimate account (P2-2).

Out of scope for this review: the correctness of the Gen1/Gen2 deprecation analysis
(accepted as given); the web-side `use-auth.ts` Google surface (D-only concern); the
email/password leg (closed Sprint 2b).

---

## Round 2 — 2026-06-04 (devils-advocate, sobre spec v2 re-centrado)

**Veredicto: APPROVE_WITH_RESERVATIONS** (vs DO_NOT_APPROVE en R1). Verificado empíricamente contra código vivo + prod (`booster-ai-api`, sa-west1).

### Por-finding (R1 → R2)
- **P0-1 (onboarding auto-promueve) → RESUELTO.** Hotfix verificado: `config.ts:502` default-false; env var UNSET en prod; doble defensa (`empresas.ts:50-64` 403 + `onboarding.ts:108-110` `SelfOnboardingDisabledError`); **único caller de `onboardEmpresa` es `empresas.ts:69` hardcoded `self_service`** — NO existe path `admin_provisioned` (rama muerta). Rutas hermanas (`/me`, `/me/consents`, `/me/clave-numerica`) fail-closed por `firebase_uid` lookup (404). SC-G8→MET defendible.
- **P0-2 → PARCIAL → objeción fuerte.** El "normalizeEmail único pinned" NO existe: `me.ts:66`/`onboarding.ts:127` crudo, `signup-request.ts:52` lowercase+trim, `email-normalize.ts:42` NFC+IDN sin dots/plus. `users.email` nunca canónico → buscar canónico = false-positive reap. T11 contradice la función que pinea. + coupling con package archivado. → **OQ-G6** + SC-G3 reframe + T11 corregido.
- **P1-1 → PARCIAL → objeción fuerte.** El harness citado (`check-is-demo-wire-completeness.ts:43-80`) solo escanea `app.use`; NO ve `<router>.route()` sub-mounts (`server.ts:304,309` = `/me/consents`, `/me/clave-numerica`). → SC-G1b extendido a `app.route()` + sub-mounts.
- **P1-2 → RESUELTO** (texto): grace atado a latencia observada; OQ-G1 con datos (gate /build).
- **P1-3 → RESUELTO** (texto): per-env plan, state-rm vs destroy, IAM-reuse, archive.
- **P2-1/P2-2 → RESUELTO** (texto): INTENTIONAL-OPEN definido; R-G7/R-G8; gate-onboarding en §8.

### Findings nuevos
- **N1 (Med)**: botón "Continuar con Google" (`login.tsx:289-293`) vivo en prod → repuebla cuentas inertes de continuo durante Stream A. No es escalada (boundary 404 + reaper), pero R-G6 ya no es "Low". → R-G6 re-rateado.
- **N2 (Low)**: `ghost-users-dry-run.csv` está en dir superseded → SC-G2 regenera contra IdP actual en /plan.
- **Wording**: `/me` NO es read-only (account-link + auto-provision admin por allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS` default-vacío) → GATED-CLOSED. SC-G1 corregido.

### Residuales a aceptar/documentar
Drift TF per-entorno (probable solo en /plan); arbitrariedad del grace para población sin-solicitud (OQ-G1 con datos).

**Para /build**: resolver OQ-G6 (normalizador) + OQ-G1 (grace) + OQ-G3 (scope provider). Todos incorporados al spec v2.

---

# REVIEW phase (code review) — 2026-06-05

- Reviewer: Felipe Vicencio (PO) con agent-rigor
- Cooling-off respetado: **Sí** (282 min desde el último write de fuente ≥ 30 min)
- Diff revisado: **acotado a la feature** (`git diff 2689214..HEAD`, 69 archivos, net negativo por el decomiso). La rama arrastra ~25 commits previos NO relacionados (inventario ADR, ADR-055/056, App Check, migración CI) + main avanzó a App Check #401 — ver Residual R-SHIP.
- Sub-agents: `code-reviewer`, `devils-advocate` (R3), `security-auditor`. UX N/A (sin UI); `test-engineer` ya corrió en VERIFY.

## Five-axis (resumen propio)
- **Correctness**: cada SC-G* tiene comportamiento + test verde (ver verify.md). El decomiso no deja refs colgantes (`terraform validate` Success). 1 bug de observabilidad encontrado (finding C) → fijado.
- **Clarity**: naming bilingüe OK; funciones cortas, early-return. `reason` free-form (MINOR, aceptado).
- **Complexity**: sin hallazgos; predicado/decideAction/harness puros y cortos; runner ~80 líneas loop lineal.
- **Consistency**: Zod en boundaries, `@booster-ai/logger`, patrón `/admin/jobs/*`. Triple normalización de email documentada (OQ-G6 → Stream B). `console.*` solo en scripts CLI (consistente con el de referencia).
- **Coverage**: ≥80% gated (verify.md); +20 tests agregados en REVIEW para los findings.

## Sub-agent findings + disposición

Veredicto unánime: **0 CRITICAL / 0 BLOCKING; APPROVE_WITH_RESERVATIONS**. El DA R3 confirmó que las reservas R2 (OQ-G6 normalizador, SC-G1b sub-mounts, grace sin SLA, decomiso per-entorno) están **genuinamente cerradas en código**, no en prosa.

### Fijados en REVIEW (código + tests)

| ID | Hallazgo (agente) | Fix |
|---|---|---|
| **A** | Harness era check de *naming convention*, no default-deny estructural: handlers no `create*`/`*Router` y rutas inline `app.<method>()` eran invisibles (falsa cobertura) — code-reviewer Coverage MAJOR, DA F1 STRONG, security #4 | `enumerateRouteMounts` ahora captura **cualquier** identificador 2º-arg → no-clasificado falla; nuevo `findInlineMethodRoutes` falla el build ante rutas inline. +5 tests. `check-route-default-deny.ts` |
| **C** | El metric/alerta contaba would-be-deletes del **dry-run** → la alerta de volumen podía dispararse en el primer dry-run — code-reviewer MAJOR | filtro del log-based metric agrega `jsonPayload.destructive=true`; +test del log dry-run. `monitoring.tf`, runner |
| **D** | `neverReapable` del script de clasificación (PO decision) ⊊ runtime → un platform-admin podía aparecer INERT en el reporte que el reaper nunca tocaría — code-reviewer MAJOR, security #1 | classify usa `BOOSTER_PLATFORM_ADMIN_EMAILS` + `dev@` (igual que runtime). `classify-google-idp-accounts.ts` |
| **E** | El reporte de clasificación escribía email+displayName crudos a un archivo en el repo (PII a git) — security #3 HIGH | output a `*.generated.md` **gitignored** + warning NO-COMMITEAR en header + doc. `.gitignore`, script, template |
| **G** | `main()` standalone del runner tenía allowlist más débil (sin platform-admins) — security #2 | `parseNeverReapable` incluye `BOOSTER_PLATFORM_ADMIN_EMAILS` + `dev@`. runner |
| **B-limbo** | Si el proceso muere entre `updateUser(disabled)` y `setCustomUserClaims`, la cuenta queda disabled-sin-marker → wait para siempre — code-reviewer MINOR | stamp del claim **antes** de disable + test de orden. runner |
| **J** | Sin cap de borrados/run → blast radius de un false-positive masivo + consumo de quota IdP (inflación R-G6) — security #7 | `maxDeletesPerRun` (default 50); excedentes → `wait` (diferidos); +test. runner, config |

### Aceptados como residual (rationale + review-by = antes de habilitar `REAPER_DESTRUCTIVE=true`)

| ID | Riesgo | Rationale de aceptación |
|---|---|---|
| **F2** (DA STRONG) | delete confía en `reaperDisabledAt` que podría quedar stale tras re-enable manual + re-disable externo → bypass del 2º grace | Cadena de baja probabilidad (requiere ops manual sobre una cuenta inerte + un re-disable no-reaper). Mitigado por: stamp-before-disable (fijado), enabled→disable re-estampa, dry-run default, **gate de sign-off PO + review manual 24h + alerta de volumen**. Endurecer con generation-counter en Stream B. **review-by: antes del 1er run destructivo.** |
| **F-uid** (security HIGH) | `uid` crudo + `emailHashed` en misma línea de log → correlacionable con acceso IdP-admin | `uid` es el handle operacional necesario para el runbook de restore; la correlación requiere privilegio IdP-admin (ya alto). Documentar retención de logs. **review-by: 1er run destructivo.** |
| **I-auth** (security HIGH) | El harness no verifica el wire de auth de `/admin/jobs`; Cloud Run `public=true` (preexistente) → única barrera es cronAuth | Wire correcto hoy (`server.ts:399`, fail-closed si falta `INTERNAL_CRON_CALLER_SA`); cronAuth criptográficamente sólido. Recomendado: binding `run.invoker` restrictivo + test integración "no-token→401". **review-by: 1er run destructivo.** |
| **H-grace** (security LOW) | grace no tuneable por env en el path endpoint (solo `main()` muerto) | Cambiar grace = decisión deliberada que ya requiere redeploy; valor es constante auditable (30/30). Revisar cuando se active signup-request (OQ-G1). |
| **DoS-pool** (security MEDIUM) | reaper comparte el `pg.Pool` del api; 2N queries seriales | Escala esperada baja; acotado por `maxDeletesPerRun`. Considerar pool dedicado / job aislado en Stream B. |
| **least-priv** (security MEDIUM) | reaper corre con SA del api (`firebase.admin`) → RCE en api hereda borrado masivo | Trade-off del patrón B (elegido por PO); mitigado por dry-run default + grace doble + cap. Registrar en ADR-057; evaluar job aislado en Stream B. |
| **R-SHIP** (review) | la rama arrastra commits no relacionados + main avanzó (#401) | El `/ship` debe rebasar sobre main y abrir PR acotado; o confirmar que esos commits ya pasaron su propio ciclo. **Acción de /ship.** |
| triple-normalize, reason free-form, INTERNAL/MIXED vocab | drift menor | Aceptados (OQ-G6 difiere a Stream B / cosmético). |

### Deferidos a gate operacional (ya gateados)
- `terraform plan` per-entorno (dev/staging/prod) — confirmar cero destroys colaterales.
- Rate-limit/Cloud Armor sobre el signup Google (R-G6, flujo web) — Stream B.

## Final read-through
Diff releído end-to-end como cambio coherente. El decomiso (net −) + el reaper (net +) + el harness forman una historia consistente: el boundary cierra el vector, el harness lo hace durable (ahora estructural, no por naming), el reaper es higiene gateada. Tests: suite completa 1407 passed | 2 skipped (ajenos). terraform validate Success.

## Verdict

**Approved for /ship (en dry-run).** 0 BLOCKING. Los 7 findings de mayor valor (A, C, D, E, G, B-limbo, J) fijados con tests. Los residuales (F2, F-uid, I-auth, DoS, least-priv) se aceptan con rationale y **se incorporan al checklist del gate de primer run destructivo** (dry-run revisado + sign-off PO), donde tienen su review-by. R-SHIP (rama divergida) es acción de `/ship`.
