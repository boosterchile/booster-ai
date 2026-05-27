import gcipCloudFunctions from 'gcip-cloud-functions';
import { normalizeEmail } from './email-normalize.js';

/**
 * Sprint 2c-A T4-T5 — handler with provider check + email normalize
 * (active) + c8-ignored placeholder for T6-T7 DB lookup + fail-closed.
 *
 * **C8-ignore strategy** (per plan v4 H-A2 fix):
 *
 * Each PR T4..T7 keeps the `Test + Coverage (≥80%)` CI gate green by
 * marking un-implemented branches with `/* c8 ignore next *​/`. Each
 * subsequent PR removes the ignore comment + adds covering tests:
 *
 *   - T4 (shipped): provider check (return `{}` if non-Google).
 *   - T5 (this PR): email check + normalize → covered by tests T5+T6;
 *     remaining DB lookup + fail-closed marked c8-ignored.
 *   - T6: DB pool initialization (still c8-ignored at query).
 *   - T7: removes final c8-ignore + adds DB lookup + fail-closed +
 *     structured log + 4 new tests (T1+T2+T3+T7 per spec §10).
 *
 * Plan deviation: original plan v4 §T4 code block envisioned dynamic
 * imports of `./email-normalize` and `./db`. Static imports adopted as
 * each module ships (T5 here adds the email-normalize static import).
 */
export const beforeCreateCallback: gcipCloudFunctions.BeforeCreateHandlerCallback = async (
  user,
) => {
  const isGoogle = user.providerData?.some((p) => p.providerId === 'google.com') ?? false;
  if (!isGoogle) {
    return {};
  }

  if (!user.email) {
    throw new gcipCloudFunctions.https.HttpsError(
      'invalid-argument',
      'email required for Google federated signup',
    );
  }

  const normalized = normalizeEmail(user.email);

  // T6-T7 logic ships in subsequent PRs (DB pool → query →
  // fail-closed → structured log). The throw below is a sentinel:
  // if it ever fires en prod it means handler was deployed without the
  // rest of the chain. T2b path-gate + T11 handler-completeness smoke
  // catch this at PR time.
  /* c8 ignore next */
  throw new Error(`handler T6-T7 logic not yet implemented (email=${normalized.length} chars)`);
};
