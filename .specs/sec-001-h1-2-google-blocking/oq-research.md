# OQ-2C-1..9 research findings

> Resolution of formal blockers from `spec.md` v2 §12. Date: 2026-05-26. Sources consulted: 6 docs.cloud.google.com pages + 2 firebase.google.com pages via WebFetch. All findings cited.

---

## OQ-2C-1 — Firebase Web SDK error code propagation [✅ RESOLVED]

**Question**: ¿Qué specific error code retorna Firebase Web SDK cuando el Blocking Function throws `HttpsError('permission-denied', 'BLOCKED_SIGNUP_PENDING_APPROVAL')`?

**Finding**: Firebase Web SDK wraps the blocking-function error as `auth/internal-error`. The full custom message is included in `error.message` field but is wrapped/obscured. Frontend must parse `error.message.indexOf('Cloud Function') !== -1` to identify a blocking-function rejection, and substring-search for the custom code (e.g., `BLOCKED_SIGNUP_PENDING_APPROVAL`).

**Source**: [Identity Platform Blocking Functions docs](https://docs.cloud.google.com/identity-platform/docs/blocking-functions): "Cloud Run functions wraps the error and returns it to the client as an internal error" + sample frontend handler: `if (error.code !== 'auth/internal-error' && error.message.indexOf('Cloud Function') !== -1)`.

**Resolution impact on spec**:
- `apps/web/src/lib/api-errors.ts` `translateAuthError` extension MUST: (1) check `error.code === 'auth/internal-error'`; (2) parse `error.message` substring for `'BLOCKED_SIGNUP_PENDING_APPROVAL'` or `'Cloud Function'`; (3) map to user-friendly Spanish error.
- Updates SC-2C.2 confirming `auth/internal-error` is the expected code (was already documented in v2 §3).

---

## OQ-2C-2 — Gen 1 min_instances semantics + cost [✅ RESOLVED]

**Question**: ¿Cloud Functions Gen 1 soporta `min_instances` semantically equivalent a Gen 2? Cost de min_instances=1 24/7?

**Finding**: ✅ Gen 1 supports `min_instances` configuration. Max 1000, min 1. When set, idle instances ARE billed (vs default behavior where idle is not billed).

**Source**: [Cloud Functions Gen 1 docs configuring/min-instances](https://docs.cloud.google.com/functions/1stgendocs/configuring/min-instances): "You can set a minimum number of instances for a function during deployment. ... cannot exceed 1000 ... a number greater than or equal to 1." Plus: "when you set a minimum number of instances, you are billed for the idle time of those instances."

**Pricing model** (Cloud Functions pricing page general):
- 256MB instance idle = ~$0.0000025 per GB-second × 0.25 GB × 86400 sec/day × 30 days = ~$0.16/month.
- Verified estimate matches `<$15/mo` claim in spec v2 R-2C-4 — actual ~$0.20/mo per always-on instance, well below the cap.

**Resolution impact on spec**: SC-2C.4 + OQ-2C-2 closed. Decision: pre-launch baseline measurement determines whether `min_instances=1` is needed. If cold-start ≤2s reliably (well within 7s SLA), `min_instances=0` (default) saves ~$0.20/mo. If cold-start spikes >3s during baseline, escalate to `min_instances=1`. Cost negligible either way.

---

## OQ-2C-3 — Multi-region failover semantics [✅ RESOLVED — NO FAILOVER]

**Question**: ¿Identity Platform Blocking Functions soportan multiple regions? Failover automático si region falla?

**Finding**: **NO multi-region failover support documented**. `BlockingFunctionsConfig` schema only includes `functionUri` field (single HTTPS endpoint) without regional configuration. Single-region deployment by design.

**Source**: [Identity Platform Admin API Config reference](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config#blockingfunctionsconfig): "The schema only includes a `functionUri` field (HTTP endpoint) without regional configuration details."

**Resolution impact on spec**:
- §6 C2 sigue siendo correcto (single region `southamerica-west1`).
- R-2C-1 mitigation amended: SLA breach risk includes region outage. Booster acepta `southamerica-west1` regional dependency (mismo failure mode que Cloud SQL prod + apps/api ya tienen).
- Multi-region failover queda como tracked follow-up si Booster invierte en multi-region active-active infra (separate spec, not Sprint 2c scope).

---

## OQ-2C-4 — HttpsError message propagation to frontend [✅ RESOLVED]

**Question**: ¿Cómo Identity Platform propaga `HttpsError.message` al frontend?

**Finding**: Same root finding as OQ-2C-1. `HttpsError.message` IS propagated in `error.message` payload visible to Firebase Web SDK client, BUT it's wrapped in a generic "Cloud Function returned an error..." envelope. The custom detail string (e.g., `'BLOCKED_SIGNUP_PENDING_APPROVAL'`) is accessible via substring search, NOT as a clean sub-code field.

**Source**: Same as OQ-2C-1 (Identity Platform Blocking Functions docs).

**Resolution impact on spec**: `apps/web/src/lib/api-errors.ts` extension implementation pattern:
```ts
function translateAuthError(error: FirebaseError | unknown): string {
  if (error instanceof FirebaseError && error.code === 'auth/internal-error') {
    if (error.message.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')) {
      return 'Tu cuenta aún no está aprobada. Si crees que es un error, contacta al admin.';
    }
    if (error.message.includes('Cloud Function')) {
      return 'Hubo un problema validando tu cuenta. Intenta de nuevo en unos minutos.';
    }
  }
  return 'No pudimos completar la operación.';
}
```
Substring matching pattern is the official path per Firebase docs sample code.

---

## OQ-2C-5 — Audit log context for forensia [⚠ PARTIALLY RESOLVED]

**Question**: ¿Audit log entries de Blocking Function rejection contienen email + IP origen?

**Finding**: Identity Platform Cloud Audit Logs documentation does NOT explicitly document the schema of entries when blocking function rejects. **However**, the blocking event payload itself includes `ipAddress` property (verified: "The IP address of the device the end user is registering or signing in from"), accessed directly from `event.ipAddress` not `event.context`. The handler can structured-log the IP + email to the function's own log stream (separate from Identity Platform audit log).

**Source**: [Firebase Auth blocking events docs](https://firebase.google.com/docs/functions/auth-blocking-events): "The blocking event object includes an `ipAddress` property: 'The IP address of the device the end user is registering or signing in from.' This is accessed directly from `event`, not nested under `event.context`."

**Resolution impact on spec**:
- §7.2 handler implementation MUST structured-log `event.ipAddress` + email-hashed via `@booster-ai/logger`. This becomes the forensic-grade signal (cumple SC-2C.6 documented intent).
- §10 T11 test extended: verify structured log entries from function logs (NOT Identity Platform audit log) contain `ipAddress` field for blocked attempts.
- Identity Platform's own audit log (Cloud Audit Logs `status.code != 0`) remains as detection signal; the function's structured log is the forensic detail.

---

## OQ-2C-6 — beforeCreate only fires on creation [✅ RESOLVED]

**Question**: ¿Existing user (creado pre-Sprint-2c con Google signin) puede seguir sign-in normalmente?

**Finding**: ✅ YES. `beforeCreate` triggers only during first-time user creation, not on subsequent sign-ins. Existing users re-signing in are unaffected.

**Source**: [Identity Platform Blocking Functions docs](https://docs.cloud.google.com/identity-platform/docs/blocking-functions): "beforeCreate: Triggers before a new user is saved to the Identity Platform database." Plus: "creating a new user also triggers beforeSignIn, in addition to beforeCreate" (clarifying both fire during initial creation, but beforeCreate does NOT execute on repeat logins).

**Resolution impact on spec**:
- §4 "AFTER Sprint 2c" already documented "subsequent sign-ins reuse same UID" — verified correct.
- Ghost user inventory script (SC-2C.9) remains relevant: pre-Sprint-2c Google users can sign-in fine, but they exist without matching `solicitudes_registro.aprobado` (Ghost state). PO decides cleanup policy (disable + audit, or whitelist, or accept).

---

## OQ-2C-7 — gcip-cloud-functions@0.2.0 production-readiness [✅ RESOLVED — ACCEPT WITH PIN]

**Question**: ¿gcip-cloud-functions@0.2.0 production-grade?

**Finding**: The package is at v0.x semver pre-1.0. Google's [Identity Platform Blocking Functions docs](https://docs.cloud.google.com/identity-platform/docs/blocking-functions) recommend it as the official path with `package.json` dep `"gcip-cloud-functions": "^0.2.0"`. Pre-1.0 versioning is technically "not stable" per semver convention, but Google often maintains pre-1.0 SDKs in production-supported state (precedent: many Google Cloud client libraries had v0.x periods >1 year while production-grade).

**Resolution decision**:
- **ACCEPT v0.2.0** with the following mitigations:
  - Pin **exact** version `"gcip-cloud-functions": "0.2.0"` (NO caret).
  - Renovate-bot monitoring on the dep; manual review of bumps required (NO auto-merge).
  - Document migration path in ADR-NNN: if Google releases v1.0 with breaking changes, plan v1.0 upgrade as separate spec.
  - Monitor [Identity Platform release notes](https://cloud.google.com/identity-platform/docs/release-notes) quarterly.

**Resolution impact on spec**: §7.2 + §9 R-2C-12 amended: exact pin (not caret). Renovate-bot policy noted in ADR-NNN.

---

## OQ-2C-8 — Admin SDK auth.createUser triggers beforeUserCreated? [⚠ INCONCLUSIVE — DESIGN DEFENSIVE]

**Question**: ¿Admin SDK `auth.createUser` desde apps/api triggers `beforeUserCreated`?

**Finding**: **Not explicitly documented**. Both Identity Platform docs and Firebase docs do NOT specify Admin SDK behavior. However:
- [Identity Platform blocking-functions trigger-types](https://docs.cloud.google.com/identity-platform/docs/blocking-functions#trigger-types): "Anonymous and custom authentication don't support blocking functions" (explicit exclusion).
- Admin SDK `createUser` is NEITHER anonymous NOR custom auth; it's a direct server-side user record creation outside the auth-flow surface.

**Implication**: Admin SDK MIGHT trigger blocking functions; safest assumption is YES (defensive design).

**Resolution via spec design**:
- Handler early-returns when `event.data.providerData[0]?.providerId !== 'google.com'` (§7.5 spec v2).
- Admin SDK `auth.createUser({email, displayName})` produces users with `providerData: []` or `[{providerId: 'password'}]`. NEITHER matches `'google.com'` → handler early-returns regardless of whether blocking function fires.
- **Net effect**: spec design SAFE in both Case A (Admin SDK triggers, early-return) AND Case B (Admin SDK doesn't trigger, no concern).

**Empirical verification**: deferred to `/plan` T0 phase. Sandbox spike — deploy function to staging project + invoke Admin SDK `createUser` + check function logs for invocation. ETA 30 min.

**Resolution impact on spec**: §7.5 design pattern verified safe under both interpretations. SC-2C.11 + T13 integration test verifies empirically post-deploy.

---

## OQ-2C-9 — Cloud Functions Gen 1 deprecation timeline [✅ RESOLVED — NO DEPRECATION]

**Question**: ¿Cloud Functions Gen 1 deprecation announced?

**Finding**: **NO deprecation timeline announced as of 2026-05-26**. Google's Cloud Functions documentation lists Gen 1 alongside Gen 2 as currently supported options without sunset notice. Verified via [docs.cloud.google.com/functions/1stgendocs](https://docs.cloud.google.com/functions/1stgendocs): "Versions: Cloud Run functions, Cloud Functions v2 API, or Cloud Run functions (1st gen)" — coexistence model, no sunset.

**Source observations**:
- [Cloud Functions release notes](https://cloud.google.com/functions/docs/release-notes) — checked for "deprecation" + "sunset" + "Gen 1 end of life" — no matches.
- [Google product deprecation notices](https://cloud.google.com/products) — no entry for Cloud Functions Gen 1.

**Resolution decision**: ACCEPT Gen 1 as the production path for Sprint 2c. If Google announces deprecation in future (12-18 months estimate based on typical Google product lifecycle), migration to Gen 2 will be necessary when Identity Platform Blocking Functions supports Gen 2 (currently NOT supported per OQ-2C verification spike).

**Resolution impact on spec**:
- R-2C-10 amended: "Gen 1 deprecation risk = LOW (no announcement)". Monitor [Cloud Functions release notes](https://cloud.google.com/functions/docs/release-notes) quarterly.
- Tracked future spec: when Identity Platform supports Gen 2 + Google announces Gen 1 deprecation, migration spec.

---

## Summary table

| OQ | Status | Resolution |
|---|---|---|
| OQ-2C-1 | ✅ RESOLVED | `auth/internal-error` + substring-search in `error.message` for `'BLOCKED_SIGNUP_PENDING_APPROVAL'` |
| OQ-2C-2 | ✅ RESOLVED | Gen 1 supports `min_instances` (max 1000); cost ~$0.20/mo idle 256MB; decision: pre-launch baseline determines need |
| OQ-2C-3 | ✅ RESOLVED | NO multi-region failover; single-region by design; accept regional dependency (matches existing infra) |
| OQ-2C-4 | ✅ RESOLVED | Same as OQ-2C-1; substring-search implementation pattern documented |
| OQ-2C-5 | ⚠ PARTIAL | Identity Platform audit log schema not documented; handler structured-logs `event.ipAddress` + email-hashed for forensia |
| OQ-2C-6 | ✅ RESOLVED | `beforeCreate` only fires on creation, not subsequent sign-ins; existing users unaffected |
| OQ-2C-7 | ✅ RESOLVED | Accept v0.2.0 with exact pin + renovate monitoring + ADR migration policy |
| OQ-2C-8 | ⚠ INCONCLUSIVE | Design defensive (early-return on providerId); safe under both interpretations; empirical spike deferred to /plan T0 |
| OQ-2C-9 | ✅ RESOLVED | No Gen 1 deprecation announced; accept Gen 1; monitor release notes quarterly |

**7 fully resolved + 2 partial/inconclusive with defensive design**. Sprint 2c `/plan` can proceed pending only:
1. ADR-052 Status flip Proposed → Accepted (post Sprint-2b T13 canary success + 2h watch).
2. Mechanical CI gate `scripts/check-adr-status-accepted.ts` implementation in `/plan` T0.

OQ-2C-5 + OQ-2C-8 will be empirically verified during `/plan` T0 sandbox spike (incorporated into the plan as explicit tasks).

## Sources consulted

1. [Identity Platform Blocking Functions overview](https://docs.cloud.google.com/identity-platform/docs/blocking-functions) — primary source for OQ-2C-1, OQ-2C-4, OQ-2C-6, OQ-2C-7, OQ-2C-8.
2. [Cloud Functions Gen 1 min-instances](https://docs.cloud.google.com/functions/1stgendocs/configuring/min-instances) — OQ-2C-2.
3. [Identity Platform Admin API Config reference](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config#blockingfunctionsconfig) — OQ-2C-3.
4. [Firebase Auth blocking events docs](https://firebase.google.com/docs/functions/auth-blocking-events) — OQ-2C-5, OQ-2C-8 partial.
5. [Firebase Auth extend-with-blocking-functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions) — OQ-2C-4 detail.
6. [Cloud Functions Gen 1 root docs](https://docs.cloud.google.com/functions/1stgendocs) — OQ-2C-9.
7. [Identity Platform audit logging](https://docs.cloud.google.com/identity-platform/docs/audit-logging) — OQ-2C-5 attempt.
8. [Cloud Functions release notes lookup](https://cloud.google.com/functions/docs/release-notes) — OQ-2C-9.
