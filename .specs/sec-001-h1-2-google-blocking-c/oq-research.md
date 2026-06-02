# OQ research — Sprint 2c-C Gen 1 → Gen 2 migration (DEFINE-phase empirical spike)

- **Date**: 2026-05-29
- **Author**: Felipe Vicencio (with agent-rigor)
- **Purpose**: Resolve the blocking architectural questions BEFORE spec approval, per the project pattern in [`docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md`](../../docs/lessons-learned/2026-05-sprint-2c-gen1-vs-gen2.md) ("WebFetch spike against authoritative docs before approving /plan → /build"). Triggered by devils-advocate P0-1/P0-2 on `spec.md` v1: the spec asserted a Gen-2-wiring resolution it had not earned.

## Method

WebSearch + WebFetch against authoritative sources, decreasing precedence: GCP/Firebase official docs → Terraform provider registry → community examples with dates → GitHub issues. Cross-checked against the repo's own existing `infrastructure/identity-platform.tf`.

## OQ-2C-C-1 — Can the Gen 2 blocking trigger be Terraform-owned via `function_uri`? — **PLAUSIBLE (leans YES), NOT dispositively verified — requires a deploy-and-observe spike**

> **Correction (2026-05-29, post devils-advocate round 2)**: this section originally read "RESOLVED: YES" on the strength of a single community blog + the URL-typed field. That was an over-claim — the mirror of the exact "documented but not verified" error the lessons-learned doc exists to prevent. Downgraded to PLAUSIBLE-UNVERIFIED after re-pulling the primary source (issue #258 comment thread). The dispositive evidence (a real Gen 2 function wired via `function_uri` + an observed `beforeCreate` invocation) does not yet exist.

**What the Terraform field is**: `google_identity_platform_config.blocking_functions.triggers.function_uri` consumes an HTTPS URL string; the repo already wires it as `function_uri = google_cloudfunctions_function.before_create.https_trigger_url` (`infrastructure/identity-platform.tf:73-76`). Nothing in the field's *type* is generation-bound. The Gen 2 accessor is `google_cloudfunctions2_function.…service_config[0].uri`.

**Primary source — [iap-gcip-web-toolkit#258](https://github.com/GoogleCloudPlatform/iap-gcip-web-toolkit/issues/258)** ("Support Gen2 Cloud Functions", opened 2024-05-03, **still OPEN** as of 2026-05-29, 5 comments). The thread is the decisive signal and it is **mixed but leans YES that Gen 2 functions fire**:
- 2024 issue body: wiring a Gen 2 `function_uri` produces an IdP error "function … has been deleted or no longer exists." (This is the pessimistic quote some secondary sources echo.)
- **2025-02-07 (TheMarex)**, replying directly to that quote: *"Curiously I do have this work."*
- **2025-04-24 (kenberland)**: *"Blocking Functions … sees gen2 functions and lets you use them."* / *"We don't even use Firebase."* (i.e., GA Identity Platform, not Firebase console.)
- **2026-03-18 (bertPB)**: *"the functions work just fine, but the google cloud console just doesn't seem to look for gen2 functions… Crazy that this still is not fixed."*

**Honest reading**: the *runtime trigger fires* for Gen 2 (three independent 2025-2026 practitioner confirmations); the still-broken part is the **GCP console's function picker not listing Gen 2** — cosmetic and irrelevant to Booster's Terraform-driven wiring. The 2026-05-27 lessons-learned conclusion ("Gen 1 only") was over-broad **but** the contrary evidence is practitioner-anecdotal on a still-open issue, not official Google docs — so it is not a basis for an "Approved" spec on its own.

**Two unverified hops remain (this is the real load-bearing unknown, per DA P0-R2-2):**
1. **Event specificity**: the cited working examples wire `event_type = "beforeSignIn"`; Booster needs **`beforeCreate`**. Not yet confirmed for the `beforeCreate` event specifically.
2. **Deploy toolchain**: whether the `firebase-functions/v2/identity` `beforeUserCreated` wrapper, deployed as a Gen 2 function via Booster's **Cloud Build `--gen2`** path (not `firebase deploy`, which does extra control-plane registration), is recognised + fires when wired via `function_uri`. Fallback if not — a raw Gen 2 HTTP handler validating the IdP JWT — is itself **unproven** (no cited reference impl).

**Dispositive test (must run before the migration scope is committed)**: deploy a throwaway `google_cloudfunctions2_function` via the real Cloud Build `--gen2` path, wire `function_uri` with `event_type = "beforeCreate"`, then (a) read back the IdP config via Admin API and confirm it is accepted (no "deleted/no longer exists"), and (b) trigger one real signup and confirm the function is invoked in logs. This mutates the **production** IdP config (no staging project exists — `#STAGING-ENV` backlog) → requires explicit PO go-ahead.

## OQ-2C-C-2 — v2 `beforeUserCreated` event field mapping — **RESOLVED**

**Finding** (Firebase v2 auth-blocking-events doc): the `AuthBlockingEvent` exposes:
- `event.data` — the user record: `email`, `displayName`, `emailVerified`, `providerData` (with `providerId`).
- `event.eventId`, `event.ipAddress`, `event.userAgent`, `event.eventType`, `event.locale`, `event.timestamp`.

Mapping from the current Gen 1 handler (`apps/auth-blocking-functions/src/handler.ts`):
| Gen 1 (`gcip-cloud-functions`) | Gen 2 (`firebase-functions/v2/identity`) |
|---|---|
| `user.providerData[].providerId` | `event.data.providerData[].providerId` |
| `user.email` | `event.data.email` |
| `context.eventId` | `event.eventId` |
| `context.ipAddress` | `event.ipAddress` |

Source: <https://firebase.google.com/docs/functions/auth-blocking-events>

## OQ-2C-C-6 — v2 error contract (vs Gen 1 `auth/internal-error` + substring) — **CODE confirmed; MESSAGE-substring survival UNVERIFIED**

**Finding** (Firebase v2 auth-blocking-events doc, verbatim): *"Cloud Functions wraps the error and returns it to the client as an internal error. Clients receive the error as `auth/internal-error` and should check error messages to determine if a blocking function rejected the request."*

**What the web client actually keys on** (verified by reading `apps/web/src/lib/translate-auth-error.ts:43-46`): `code === 'auth/internal-error'` **AND** `message?.includes('BLOCKED_SIGNUP_PENDING_APPROVAL')` — it matches the **custom code substring**, NOT the literal `"Cloud Function"` the lessons-learned doc implied.

- **`code === 'auth/internal-error'`** — confirmed preserved under v2 (doc above).
- **`message` containing `BLOCKED_SIGNUP_PENDING_APPROVAL` verbatim** — **NOT confirmed.** The v2 doc says clients "should check error messages," implying the custom message propagates, but the *exact wrapped format* (whether the custom string survives byte-for-byte in the substring-searchable `message`) differs between the Gen 1 `gcip-cloud-functions` wrapper and the v2 module and is not documented. If the substring does not survive, `translate-auth-error.ts:44` silently falls through to the generic fallback (user sees a wrong/opaque message) — a **silent break**.

**Consequence**: SC-2C.C.6 must pin the exact `message` string emitted by a real v2 rejection **before** wiring prod (not discover it at the negative smoke E2E, the most expensive point). Fold this observation into the same deploy-and-observe spike as OQ-2C-C-1. The DA round-1 P0-3 ("byte-for-byte" vs contract change) is resolved by re-wording SC-2C.C.2 to *decision-logic* invariance; but the *transport* contract is NOT yet proven identical.

Sources: <https://firebase.google.com/docs/functions/auth-blocking-events> ; `apps/web/src/lib/translate-auth-error.ts:43-46`

## OQ-2C-C-3 — Gen 2 region constraint — **PARTIALLY RESOLVED (verify at /plan)**

Gen 1 required `us-east1` for IdP blocking (per existing tf comment). Gen 2 functions are Cloud Run-backed and broadly region-available; the 2026-02 example did not assert a region restriction. **Action for /plan**: confirm the target region against the live `google_cloudfunctions2_function` + IdP blocking docs before writing infra; default to keeping `us-east1` (where the rest of Booster prod lives) unless a constraint forbids it. Low risk (wrong region → trigger doesn't fire → caught by SC-2C.C.5 verification before prod wire).

## Net effect on the spec (post DA round 2 correction)

| Question | Status | What's still needed |
|---|---|---|
| OQ-2C-C-1 — Terraform `function_uri` accepts Gen 2 + trigger fires | **PLAUSIBLE, leans YES, UNVERIFIED** | Deploy-and-observe spike with `event_type=beforeCreate` via Cloud Build `--gen2` |
| OQ-2C-C-1 residual — wrapper-via-CloudBuild vs `firebase deploy` | **UNVERIFIED** (load-bearing, not a /plan detail) | Same spike; fallback (raw HTTP handler) also unproven |
| OQ-2C-C-2 — v2 event field mapping | **RESOLVED** (doc-confirmed) | — |
| OQ-2C-C-6 — error CODE `auth/internal-error` | **RESOLVED** | — |
| OQ-2C-C-6 — error MESSAGE substring survives | **UNVERIFIED** (silent-break risk) | Pin exact v2 message in the same spike |

**Honest bottom line**: the migration is *probably* IaC-preserving and contract-preserving, and the practitioner evidence leans that way — but the architecture is **not dispositively verified**, and the only test that settles it (deploy + wire `beforeCreate` + observe) mutates the **production** IdP config. Approving the full handler+infra+cloudbuild scope before that observation repeats the lessons-learned failure mode. Recommended path: a **gated spike-first spec** (the deploy-and-observe proof is task 1; all migration tasks hard-gated behind it; Alternative D carried as co-primary until it fires) — OR run the prod deploy-spike now with explicit PO authorization.
