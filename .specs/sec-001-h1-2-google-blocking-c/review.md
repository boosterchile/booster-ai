# Review — sec-001-h1-2-google-blocking-c (DEFINE phase)

## Round 1 — devils-advocate on spec v1 (2026-05-29)

**Verdict: DO_NOT_APPROVE** (3 P0, 5 P1, 2 P2).

| ID | Finding | Resolution |
|---|---|---|
| **P0-1** | Central premise (Gen 2 viable only via "Firebase-managed path"; Terraform `function_uri` is "Gen-1-only") is likely false — existing `identity-platform.tf:73-76` proves `function_uri` is just a URL field; a 2026-02 example wires Gen 2 via Terraform. Spec asserted a resolution it hadn't earned. | **Fixed.** Ran DEFINE-phase spike → `oq-research.md` OQ-2C-C-1: `function_uri` accepts `google_cloudfunctions2_function.…service_config[0].uri`. §2/§7/§8 rewritten; IaC preserved; R-2C-C-1 downgraded. |
| **P0-2** | Deferring the decisive question (OQ-2C-C-1) to a post-approval `/build` spike repeats the 2c-A "documented but not verified" failure in mirror image. | **Fixed.** Spike pulled into DEFINE before approval (the lessons-learned pattern). OQ-2C-C-1/2/6 RESOLVED in `oq-research.md`. |
| **P0-3** | SC-2C.C.2 "byte-for-byte preserved" contradicts admitted error-contract change (SC-2C.C.6 / C-2C-C-3). Internally unsatisfiable. | **Fixed.** Spike found the v2 error contract is *identical* to Gen 1 (`auth/internal-error` + substring) → no contract change. SC-2C.C.2 reworded to *decision-logic* invariance; SC-2C.C.6 now "confirm preserved." |
| **P1-1** | "Identity Platform" vs "Firebase Auth" blocking may be different product surfaces; spec cited Firebase evidence for an IdP claim. | **Resolved.** Same Terraform `function_uri` field serves the Booster `google_identity_platform_config` stack with a Gen 2 URI (`oq-research.md`). |
| **P1-2** | Abandoning Terraform ownership for `firebase deploy` deserves a hard stop, not "document in ADR amendment." | **Resolved + hardened.** No abandonment needed (IaC preserved). SC-2C.C.7 makes any forced deviation a hard-stop→PO-escalation, not self-approval. |
| **P1-3** | R-2C-C-7 hand-waves the amendment-escalation clause (3rd cloudbuild touch in 72h). | **Resolved.** Read the actual clause: 2c-C is a new sub-spec with full cycle artifacts = endorsed path (b); the "third amendment blocked" rule governs plan-amendments, not sub-specs. Cited in §9. |
| **P1-4** | Five deliverables bundled; fragile while wiring unresolved; suggest split (handler-only C1 + infra C2). | **Partially adopted.** Spike removed the fragility (architecture resolved). §7 adds handler-first independently-mergeable sequencing for `/plan`; split decision deferred to `/plan`. |
| **P1-5** | SC-2C.C.5 emulator-only verification can't prove the real IdP→Gen2 trigger fires; SC-2C.C.2/C.7 unmeasurable. | **Fixed.** SC-2C.C.5 now requires non-emulator config-read + a real invocation; SC-2C.C.2 reworded; SC-2C.C.7 given an outcome bar. |
| **P2-1** | Missing alternatives: pin Gen 1 to Node 22; non-blocking API-boundary gate. | **Added** as §8 F + G with rejection grounds. |
| **P2-2** | Drift-vocab scan clean; ensure cleanup removes the Gen 1 placeholder. | **Added** to SC-2C.C.10 scope. |

**No objection from DA on**: §11 rollback (sound, honestly scoped, low cost-to-undo).

### Residual risks accepted into the spec (not blockers)
- R-2C-C-1 (wrapper-vs-raw-handler wiring detail) — /plan spike + known fallback.
- OQ-2C-C-3/C-4/C-5 — /plan implementation questions (region, min_instances, build SA, pg pool).

**Next**: PO approval of spec v2 → `/plan`. (A re-run of devils-advocate on v2 can be folded into the `/plan` review per solo-dev cadence, since the P0s are resolved with empirical evidence.)

---

## Round 2 — devils-advocate on spec v2 + oq-research.md (2026-05-29)

**Verdict: DO_NOT_APPROVE** (2 P0, 4 P1, 2 P2). The rewrite is well-organized and the cycle discipline (spike-in-DEFINE) is exactly right. But the spike's central finding does not survive an independent re-pull of its own cited sources. The spec is now confidently asserting a resolution that the evidence contradicts, which is more dangerous than v1's honest uncertainty.

### P0 findings (must address before approval)

**P0-R2-1 — The spike's load-bearing claim (OQ-2C-C-1 "RESOLVED: YES") is contradicted by its own cited sources; an independent re-pull returns the OPPOSITE conclusion.**

The spike overturns a same-team empirical finding from 2 days ago (lessons-learned 2026-05-27) on the strength of (a) "the field is a URL string" and (b) one community blog (oneuptime, 2026-02-23). Independent WebSearch on the exact question returns, verbatim:

> "Identity Platform only supports Gen1 Cloud Functions as blocking functions. ... while you can technically reference a Gen2 Cloud Function using its `function_uri` in Terraform, Identity Platform doesn't natively support Gen2 functions ... Terraform can be used to configure Identity Platform and use the function_uri of the Gen2 function directly, but this causes Identity Platform to show an error saying that the function that is identified by that URL has been deleted or no longer exists."

This is not a UI-only / console-list limitation as OQ-2C-C-1 reframes it. It is precisely the Terraform-`function_uri`-with-a-Gen2-URI path the spec adopts, and the failure is silent-at-wire / error-at-runtime. The spike's reinterpretation of issue #258 ("the symptom was UI-list/console-driven, not Terraform service_config[0].uri") is wrong: #258 (opened 2024-05-03, titled "Support Gen2 Cloud Functions") explicitly documents BOTH the console-list symptom AND the Terraform-`function_uri`-errors-as-deleted symptom. The 2-day-old lessons-learned doc cited the same issue and a maintainer confirmation that Gen 2 is not supported and is tracked as an open feature request. The spike did not produce evidence that #258 was closed/resolved — it inferred resolution from a blog post existing after the issue's open date, which is a non-sequitur (a blog showing the HCL syntax compiles is not evidence the trigger fires).

- Remedy: Do not approve on current evidence. The falsifier is cheap and must run BEFORE approval, not at /plan: in a non-prod IdP config, wire `function_uri` to an actual deployed `google_cloudfunctions2_function.service_config[0].uri`, then (1) read back the config via Admin API and confirm it is accepted, and (2) trigger one real `signInWithPopup`/`createUser` and confirm the Gen 2 function is invoked (logs show an invocation). If the config read shows the "function deleted/no longer exists" error or no invocation occurs, OQ-2C-C-1 is FALSE and Alternative D/G is the real path. Until that observation exists, OQ-2C-C-1 is at most "PLAUSIBLE, UNVERIFIED," not "RESOLVED: YES." Note this is the identical class of error the lessons-learned doc was written to prevent ("assuming the newer runtime is supported," "documented but not verified") — the spike committed the mirror version: documented-it-IS-supported-but-not-verified.

**P0-R2-2 — The "residual" (firebase-functions/v2 wrapper deployed via gcloud/Cloud Build vs firebase deploy, and whether it fires when wired via function_uri) is the REAL load-bearing unknown, dressed down to a /plan implementation detail.**

oq-research.md §OQ-2C-C-1 Residual concedes the actual operational question — does `beforeUserCreated` deployed as a raw `--gen2` function (not via `firebase deploy`) register and fire when wired through `function_uri`? — and then defers it to /plan with a "known fallback." But this is not separable from P0-R2-1: the whole IaC-preserved conclusion rests on the wrapper firing through that wire. The `firebase deploy` toolchain does extra registration work (it sets the function's IAM + registers the blocking config through the Firebase control plane); deploying the same wrapper via `gcloud functions deploy --gen2` produces a bare Cloud Run service that may not be recognized by IdP as a blocking target even if the URL resolves. The "fallback = raw Gen 2 HTTP handler validating the IdP JWT" is itself unproven (re-implementing what `gcip-cloud-functions` did internally is non-trivial and has no cited reference impl). So the spec has TWO unverified hops stacked (config accepts Gen2 URI; AND wrapper-deployed-via-Cloud-Build fires) and labels the stack "RESOLVED."

- Remedy: Fold this into the same pre-approval falsifier as P0-R2-1 (the smoke must use the actual deploy toolchain Booster will use: Cloud Build `--gen2`, not `firebase deploy`). If the team is unwilling to spike the deploy path in DEFINE, then the honest status is "architecture UNRESOLVED" and the spec should either (a) explicitly carry Alternative D (remove Google provider) as co-primary until the spike lands, or (b) be approved only as a spike-spec whose first deliverable is the wiring proof, with all infra/cloudbuild tasks hard-gated behind it. The current §7 sequencing ("handler-first, then infra") puts the cheap-but-non-decisive work first and the decisive work last — backwards for risk-burndown.

### P1 findings

**P1-R2-1 — event_type mismatch between the spec's wire and the spike's working example; the spec never reconciles it.**

`infrastructure/identity-platform.tf:75` wires `event_type = "beforeCreate"`. The handler is `beforeCreate` (Gen 1 `gcip-cloud-functions`). The Gen 2 SDK symbol is `beforeUserCreated`. The spike's "working example" (oq-research.md:19-25) wires `event_type = "beforeSignIn"` — a DIFFERENT event. So the one piece of Gen2 HCL the spike cites does not even demonstrate the `beforeCreate` event the spec depends on; it demonstrates `beforeSignIn`. The spec keeps `event_type = "beforeCreate"` (correct for the API) but never notes that its sole cited example uses a different event, nor confirms that the IdP API's `beforeCreate` event_type accepts a Gen2 URI (the spike only "showed" `beforeSignIn`). Evidence verdict: ABSENT for the specific event the spec ships.
- Remedy: SC must assert the verification uses `event_type = "beforeCreate"` specifically; do not generalize from a `beforeSignIn` example.

**P1-R2-2 — SC-2C.C.6 / error-contract: the message SUBSTRING surviving is asserted but not the actual point of failure; "confirm in negative smoke E2E" is too late and the spec admits the silent-break path without de-risking it.**

OQ-2C-C-6 quotes the Firebase v2 doc: clients receive `auth/internal-error` and "should check error messages." That establishes the CODE survives. It does NOT establish that the message string the client sees still CONTAINS `BLOCKED_SIGNUP_PENDING_APPROVAL`. Gen 1 `gcip-cloud-functions` wraps the `HttpsError` message into the `error.message` the Web SDK exposes (the lessons-learned doc notes the substring match was `error.message.indexOf('Cloud Function') !== -1` — i.e., the historical match key was literally the string "Cloud Function", not the custom code). The v2 wrapping format is not guaranteed byte-identical; if v2 emits e.g. `"BLOCKED_SIGNUP_PENDING_APPROVAL"` vs Gen1's `"... Cloud Function ... BLOCKED_SIGNUP_PENDING_APPROVAL ..."`, then whichever substring `translate-auth-error.ts` actually keys on may or may not survive. The spec defers discovery to the negative smoke E2E (SC-2C.C.6) — i.e., after handler+infra+deploy are all built. That is the most expensive possible place to discover a 1-line translation break.
- Remedy: Before approval (or as the very first /plan task), read `apps/web/.../translate-auth-error.ts` and record the EXACT substring it matches on. State it in the spec. Then the smoke E2E confirms that exact substring, and the failure is cheap to anticipate. As written, SC-2C.C.6 is testing a claim the spec hasn't pinned down.

**P1-R2-3 — SC-2C.C.2 "decision-logic invariance" is better than "byte-for-byte" but still claims invariance for a thing that DOES change: the HttpsError code namespace.**

SC-2C.C.2 lists the gate decision as invariant and calls "the v1→v2 input remap the only handler change." But the handler also throws `gcipCloudFunctions.https.HttpsError('permission-denied' | 'internal' | 'invalid-argument', ...)`. The v2 module's `HttpsError` is a different class with its own accepted code set and its own wire serialization. Whether `'permission-denied'`/`'internal'`/`'invalid-argument'` map to the identical client-observable outcome under v2's blocking-error wrapping is unverified. So "the input remap is the only change" is false: the error-throwing call site changes class too, and that is on the load-bearing fail-closed path (T5 DB-error → `internal`). If v2 treats an unknown/disallowed code differently (e.g., swallows it or returns a generic block), the fail-closed semantics could degrade silently.
- Remedy: Add the HttpsError class swap explicitly to the "changes" list in SC-2C.C.2, and add a test/observation that each of the three thrown codes still produces a client-side block (not just `permission-denied`).

**P1-R2-4 — Scope/sequencing (deferring the split to /plan) is defensible ONLY IF the architecture is actually resolved; since P0-R2-1/2 show it is not, keeping a unified spec that bundles handler+infra+cloudbuild+state-cleanup is premature.**

The author's argument ("spike resolved the architecture → fragility gone → split-decision can wait for /plan") is logically sound but rests on the false premise that the architecture is resolved. With the wiring still unproven, the unified spec risks building the handler, the Gen2 infra, the cloudbuild `--gen2` lane, AND doing tainted-state cleanup, only to discover at SC-2C.C.5 that the trigger never fires — at which point the tainted-state cleanup (SC-2C.C.10, irreversible-ish `terraform state rm` + gcloud delete of the Gen1 function) has potentially already removed the fallback. Sequencing-wise the spec deletes the Gen 1 artifact in the same spec that first proves Gen 2 works.
- Remedy: Gate SC-2C.C.10 (Gen 1 teardown) explicitly behind SC-2C.C.5 (Gen 2 demonstrably fires in non-emulator). Do not `state rm` the Gen 1 function until a real Gen 2 invocation is observed. State this ordering as a hard constraint, not a /plan nicety.

### P2 findings

**P2-R2-1 — oneuptime is cited as authoritative for the YES finding but the same publisher's other 2026-02 article describes the Gen2 limitation.** The WebSearch surfaces oneuptime 2026-02-17 ("How to Configure Identity Platform...") alongside the 2026-02-23 piece the spike cites. Relying on one blog post from a vendor that elsewhere documents the opposite is weak evidence selection. Remedy: down-rank community blogs below the official `docs.cloud.google.com/identity-platform/docs/blocking-functions` page and issue #258, both of which currently say Gen 1 only.

**P2-R2-2 — Internal inconsistency: spec §2 and §12 state OQ-2C-C-1 "RESOLVED" / contract "identical," while §9 R-2C-C-1 still rates the wrapper-firing residual L–M likelihood with a fallback, and SC-2C.C.7 makes a Terraform-wiring failure a "hard stop → escalate PO."** A genuinely RESOLVED architecture would not need a hard-stop escalation clause for the case where the resolution is wrong. The presence of SC-2C.C.7 and R-2C-C-1 is the spec implicitly admitting the question is not closed. Remedy: relabel OQ-2C-C-1 status to "PLAUSIBLE — pending pre-approval wiring proof" so the document stops contradicting itself.

### Evidence quality summary (Round 2)

| Claim | Evidence offered | Independent verdict |
|---|---|---|
| `function_uri` accepts Gen2 URI & trigger works | 1 community blog + "it's a URL field" | ABSENT/CONTRADICTED — official docs + #258 + independent search say Gen 1 only; Terraform-Gen2 path errors "function deleted" |
| v2 error CODE = `auth/internal-error` | Firebase doc quote | SUFFICIENT for the code |
| v2 error MESSAGE substring preserved | none (inferred) | WEAK — substring not pinned; historical key was literally "Cloud Function" |
| v2 event field mapping | Firebase doc | SUFFICIENT |
| Decision-logic invariant under v2 | unit tests (adapted) | WEAK — HttpsError class swap unaccounted |

### Round 2 verdict

**DO_NOT_APPROVE.** The single most load-bearing claim (Gen2 wires + fires via `function_uri`) is not merely unproven — it is contradicted by the authoritative sources the spike itself names, and the spike overturned a fresher same-team empirical finding without earning it. This is recoverable cheaply: run the actual wiring proof (deploy a `--gen2` function via the Booster Cloud Build path, wire it through `function_uri` with `event_type=beforeCreate`, confirm config-read + one real invocation) IN DEFINE, before approval. If it fires, most of v2 stands and re-approval should be quick. If it does not, Alternative D/G is the real path and the entire infra/handler scope is moot. Either way, the falsifier is hours of work and prevents 1–2 sprints of building toward a trigger that never fires — exactly the failure the lessons-learned doc exists to stop.

Residual risks to carry regardless of the above: P1-R2-2 (pin the translate-auth-error substring before building), P1-R2-3 (HttpsError class swap on the fail-closed path), P1-R2-4 (Gen1 teardown must follow, never precede, the first real Gen2 invocation).

Sources (Round 2 independent re-pull):
- https://docs.cloud.google.com/identity-platform/docs/blocking-functions
- https://github.com/GoogleCloudPlatform/iap-gcip-web-toolkit/issues/258
- https://firebase.google.com/docs/functions/auth-blocking-events
- https://firebase.google.com/docs/functions/2nd-gen-upgrade
