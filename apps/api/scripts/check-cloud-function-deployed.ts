#!/usr/bin/env tsx
/**
 * Sprint 2c-B T7 — atomic deploy verification script.
 *
 * Spec: `.specs/sec-001-h1-2-google-blocking-b/plan.md` v4 §T7
 * acceptance. Wired into Cloud Build via `cloudbuild.production.yaml`
 * `verify-auth-blocking-deployed` step (T3) and into the
 * `sprint-2c-b-deploy-gate.yml` workflow (T7b — next PR).
 *
 * **Mechanical scope** (F-B3 honest framing):
 *
 *   Post-deploy verification of the Cloud Function ARTIFACT only.
 *   Asserts: `sourceArchiveUrl` non-empty + `status === 'ACTIVE'`.
 *
 *   This is NOT an inter-apply ordering gate. The atomic deploy
 *   contract (T4 resource → Cloud Build deploy → THIS verify → T5
 *   wire) is enforced by:
 *     1. PO discipline following T6 runbook §Deploy procedure.
 *     2. T7b CI workflow path-filter on `infrastructure/identity-
 *        platform.tf` modifications that touch `blocking_functions`
 *        (forces this script to run against prod state before T5
 *        wire PR can merge).
 *
 * Defeat scenarios this script does NOT catch:
 *   - Stale `sourceArchiveUrl` pointing at a previous good deploy
 *     (the new deploy uploaded successfully but the API state
 *     reflects an earlier ACTIVE revision).
 *   - Function in `ACTIVE` status but executing wrong code (e.g.,
 *     deployment swap raced with a different branch's artifact).
 *
 * Defenses for the above live in T9 smoke E2E + T10 production
 * perf measurement + T12b 7-day watch.
 *
 * Ejecución:
 *   pnpm --filter @booster-ai/api exec tsx \
 *     scripts/check-cloud-function-deployed.ts
 *
 * Exit codes:
 *   0 — function exists, `sourceArchiveUrl` non-empty, `status` ACTIVE.
 *   1 — file absent, gcloud failed, missing sourceArchiveUrl, or
 *       status not ACTIVE.
 */

import { execSync } from 'node:child_process';

const FUNCTION_NAME = 'beforeCreate';
const REGION = 'us-east1';
const PROJECT = 'booster-ai-494222';

export interface CheckResult {
  ok: boolean;
  reason: string;
}

export interface CheckOptions {
  /** Override the shell invocation (test injection). */
  exec?: (cmd: string) => string;
}

export function checkCloudFunctionDeployed(options: CheckOptions = {}): CheckResult {
  const run =
    options.exec ??
    ((cmd: string) => execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }));
  let raw: string;
  try {
    raw = run(
      `gcloud functions describe ${FUNCTION_NAME} --region=${REGION} --project=${PROJECT} --format=json`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return {
      ok: false,
      reason: `gcloud functions describe failed (function may not exist or gcloud unavailable): ${message}`,
    };
  }
  let parsed: { sourceArchiveUrl?: string; status?: string };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      reason: `gcloud output is not valid JSON: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
  const src = parsed.sourceArchiveUrl ?? '';
  const status = parsed.status ?? '';
  if (!src) {
    return {
      ok: false,
      reason:
        'sourceArchiveUrl is empty (function never deployed or Cloud Build deploy step skipped)',
    };
  }
  if (status !== 'ACTIVE') {
    return {
      ok: false,
      reason: `status is "${status}" (expected ACTIVE; deploy may be in progress or failed)`,
    };
  }
  return {
    ok: true,
    reason: `function ${FUNCTION_NAME} ACTIVE with sourceArchiveUrl=${src}`,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = checkCloudFunctionDeployed();
  if (result.ok) {
    console.log(`[check-cloud-function-deployed] OK — ${result.reason}`);
    process.exit(0);
  }
  console.error(`[check-cloud-function-deployed] FAIL — ${result.reason}`);
  console.error('');
  console.error('Sprint 2c-B atomic deploy contract requires the Cloud Function to be');
  console.error('ACTIVE with non-empty sourceArchiveUrl BEFORE wiring `blocking_functions`');
  console.error('in Identity Platform config (T5 terraform apply).');
  console.error('See docs/qa/google-blocking-function-runbook.md §2 Deploy procedure.');
  process.exit(1);
}
