import type gcipCloudFunctions from 'gcip-cloud-functions';

/**
 * Sprint 2c-A T4 — handler skeleton with provider check (active) +
 * istanbul-ignored placeholder for T5-T7 logic.
 *
 * **Istanbul-ignore strategy** (per plan v4 H-A2 fix):
 *
 * T4 ships a minimal skeleton where the only active branch is the
 * provider check (return `{}` if signup is not Google federated). The
 * un-implemented T5-T7 logic (email normalize + DB lookup + fail-closed
 * + structured log) is replaced by a single istanbul-ignored throw line.
 *
 * Each subsequent PR removes the istanbul-ignore comment + adds the
 * covering test:
 *
 *   - T5: removes istanbul-ignore + adds email normalize call + R-2C-9 test.
 *   - T6: extends with DB pool reference (still istanbul-ignored at query).
 *   - T7: removes final istanbul-ignore + adds DB lookup + fail-closed +
 *         structured log + 5 new tests (T1+T2+T3+T6+T7 per spec §10).
 *
 * This pattern keeps `Test + Coverage (≥80%)` CI gate **green on every
 * PR** instead of relying on transient waivers (plan v4 H-A2 rejected
 * "reviewer approves with explicit waiver in PR description" as the
 * rebranded honor-system anti-pattern).
 *
 * Plan deviation: original plan v4 §T4 code block envisioned the full
 * skeleton with dynamic imports of `./email-normalize` and `./db` modules
 * that don't yet exist (T5/T6 create them as NEW per plan). Those
 * imports would fail typecheck in T4. The simpler single-throw
 * placeholder satisfies the H-A2 spirit (coverage gate green per PR)
 * without requiring stub files outside T4 scope.
 */
export const beforeCreateCallback: gcipCloudFunctions.BeforeCreateHandlerCallback = async (
  user,
) => {
  const isGoogle = user.providerData?.some((p) => p.providerId === 'google.com') ?? false;
  if (!isGoogle) {
    return {};
  }

  // T5-T7 logic ships in subsequent PRs (email normalize → DB lookup →
  // fail-closed). The throw below is a sentinel: if it ever fires en
  // prod it means T4 was deployed without the rest of the chain. T2b
  // path-gate + T11 handler-completeness smoke catch this at PR time.
  // vitest v8 provider respects `c8 ignore` (not `istanbul ignore`).
  /* c8 ignore next */
  throw new Error('handler T5-T7 logic not yet implemented (Sprint 2c-A T4 ships skeleton only)');
};
