# Sprint 2c-B build-gate escape-hatch invocations

Per plan v4 §Pre-conditions contingency clause:

> Contingency clause: If Sprint-2b T13 is deferred >14 calendar days past plan v3 approval, escalate to PO for explicit decision: (a) wait, OR (b) ship 2c-B via gate escape-hatch (`gh workflow run sprint-2c-build-gate.yml -f force=true`), with each use justified in PR description and tracked in `.specs/_followups/sprint-2c-b-gate-bypasses.md`.

Each invocation of the escape-hatch is logged here.

## Log

| Date | PR | Branch | Justification | Run ID |
|---|---|---|---|---|
| 2026-05-28 | [#392](https://github.com/boosterchile/booster-ai/pull/392) | `fix/2cb-t3-cloudbuild-gen2-gate` | Regression-hotfix bootstrap. T3 (PR #384) shipped two defects (`--gen2=false` syntax bug + missing substitution gate) that broke every Cloud Build for 28h, blocking all api/web/whatsapp/telemetry deploys. The same 28h window prevented the api Cloud Build deploy that would run the 5-step canary + 2h watch that flips ADR-052 → Accepted. The build-gate (which requires ADR-052 Accepted) therefore cannot pass until this PR merges, because this PR IS the unblock. Strict circular dependency. **Used the documented escape-hatch path (b) per plan v4 §Pre-conditions.** | [26601188853](https://github.com/boosterchile/booster-ai/actions/runs/26601188853) |
| 2026-05-28 | [#393](https://github.com/boosterchile/booster-ai/pull/393) | `fix/2b-t13-canary-tag-length` | Sprint 2b T13-fix: tag-length 46-char limit. Same circular dependency as PR #392 — the build-gate requires ADR-052 Accepted, ADR-052 requires canary success, canary requires this fix. Path (b) per plan v4 §Pre-conditions. | [26605290697](https://github.com/boosterchile/booster-ai/actions/runs/26605290697) |

## Cumulative count

- Total bypasses: 1 (as of 2026-05-28).
- Threshold per plan: each individual use must be justified above + tracked here. Plan does not cap total uses; cumulative count is informational. Audit at Sprint 2c-B CERRADO.
