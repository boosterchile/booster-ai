# Lesson learned: Identity Platform Blocking Functions support Cloud Function Gen 1 only — empirical verification pattern

- **Date**: 2026-05-27
- **Context**: Sprint 2c-A (`.specs/sec-001-h1-2-google-blocking-a/`)
- **Linked ADR**: [ADR-054](../adr/054-google-blocking-function-signup-gate.md)
- **Author**: Felipe Vicencio (with agent-rigor + booster-skills)

## What we almost shipped

Sprint 2c umbrella **spec v1** mandated:

- `google_cloudfunctions2_function` Terraform resource (Gen 2).
- `firebase-functions/v2/identity` SDK import (`import { beforeUserCreated } from 'firebase-functions/v2/identity'`).

A devils-advocate pass on spec v1 surfaced the architectural choice without ground-truth evidence. The author (Claude) had assumed Gen 2 because it is the "newer / preferred" Cloud Functions generation in 2026 (Gen 1 deprecated for general use).

## Ground truth

Identity Platform Blocking Functions **do NOT support Cloud Function Gen 2** as of 2026-05.

Verified empirically via WebFetch:

1. **`docs.cloud.google.com/identity-platform/docs/blocking-functions`** (official Google docs): code samples use Gen 1 + `import * as gcipCloudFunctions from 'gcip-cloud-functions';`. No mention of Gen 2 / `firebase-functions/v2/identity`.
2. **`package.json` example en docs**: dep entry `"gcip-cloud-functions": "^0.2.0"`. This package is a **Gen 1-only** wrapper.
3. **GitHub `iap-gcip-web-toolkit#258`**: maintainer confirms Gen 2 trigger NOT supported by IdP Blocking Functions; tracked as open feature request.
4. **Firebase Web SDK error pattern**: blocking function `HttpsError` wrapped as `auth/internal-error` + custom message accessible via substring search `error.message.indexOf('Cloud Function') !== -1`. This wrapping is **Gen 1-specific** behavior; Gen 2 trigger model would have a different error contract.

If spec v1 had shipped to `/build` without DA verification, Sprint 2c would have produced:
- Terraform `google_cloudfunctions2_function` resource that IdP cannot trigger.
- SDK import (`firebase-functions/v2/identity`) that has no runtime path for IdP `beforeCreate` events.
- Cloud Build step that deploys a function that never fires.

Caught architectural rework cost: **~1-2 sprints**.

## The pattern: empirical spike before `/build`

When a spec touches a GCP service-specific runtime constraint (e.g., "Identity Platform Blocking Function", "Cloud Run with Cloud SQL Auth Proxy unix socket", "Pub/Sub push to Cloud Run with VPC connector"), do a **WebFetch spike against authoritative docs** before approving `/plan` → `/build` transition.

Authoritative sources, in decreasing precedence:

1. `docs.cloud.google.com/<service>/docs/<feature>` — Google's docs for that specific feature.
2. `docs.cloud.google.com/<service>/docs/release-notes` — to catch recent additions / removals.
3. GitHub repos of the official SDK (e.g., `googleapis/googleapis`, `firebase/firebase-admin-node`).
4. GitHub issues in `iap-gcip-web-toolkit`, `google-cloud-node`, `firebase` repos — for community signal on undocumented constraints.
5. npm package README + recent release notes.

**Anti-pattern**: assuming the "newer" runtime is supported because it's the documented best practice for the parent service category (e.g., Gen 2 for Cloud Functions generally). Service-specific triggers / integrations frequently lag the parent service's runtime evolution.

## Concrete actions taken in this feature

| Step | Outcome |
|---|---|
| DA pass on spec v1 (Sprint 2c umbrella) | Spec marked INVALIDATED for Gen 2 architectural mistake |
| WebFetch spike: 8 authoritative sources cited | `oq-research.md` produced (7 of 9 OQs fully resolved) |
| Spec v2 redrafted | Mandates Gen 1 + `gcip-cloud-functions` 0.2.0 exact pin |
| ADR-054 documents architecture | This PR (Sprint 2c-A T1) |
| Plan v4 T3 acceptance | `package.json` deps include exact pin `gcip-cloud-functions: "0.2.0"` |
| Plan v4 T4 acceptance | `index.ts` imports `gcipCloudFunctions.AuthFunction.beforeCreateHandler` (not v2 trigger) |

## Triggers for future application

Run the empirical spike before `/build` whenever:

- Spec mentions a Google service-specific trigger / integration (Identity Platform, Pub/Sub-to-Run with VPC, Cloud Tasks targets, Cloud Run triggers).
- Spec proposes a runtime (Node 20 vs 22, Python 3.11 vs 3.12) — confirm the target service supports it.
- Spec uses a SDK package name that has Gen 1 / Gen 2 / v1 / v2 namespacing (`firebase-functions/v2/`, `@google-cloud/functions-framework`, etc.).
- DA review flags the architecture as "documented but not verified" — convert the prose claim into a WebFetch citation in the OQ research file.

## When NOT to spike

- Pure application code without GCP integration (e.g., adding a Hono route handler).
- Refactor / rename / typing improvements in existing code paths.
- Documentation-only changes.
- Tasks that explicitly inherit a previously-spiked architecture (e.g., Sprint 2c-A T4-T11 inherit Gen 1 architecture from spec v2; no re-spike needed).

## Cross-references

- **ADR-054 §Alternatives §Alt-III** documents the Gen 2 rejection with empirical citation.
- **`.specs/sec-001-h1-2-google-blocking/oq-research.md`** captures the 8 authoritative sources consulted.
- **`.specs/sec-001-h1-2-google-blocking/spec-v1.md`** retained as INVALIDATED audit trail for posterity.

## Optional sync to Claude auto-memory

If Felipe wants this lesson available cross-session in Claude memory, manually sync to:

- `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/feedback_sprint_2c_pattern.md` (mirror of this file's content).
- `/Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/MEMORY.md` index entry: `- [Gen 1 vs Gen 2 verification pattern](feedback_sprint_2c_pattern.md) — Spike empirically antes de /build cuando spec toca constraints de GCP service-specific runtime.`

Not a deliverable of Sprint 2c-A T1; optional out-of-band per plan v4 §"Out-of-band tasks".
