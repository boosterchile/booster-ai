import gcipCloudFunctions from 'gcip-cloud-functions';
import { getDbPool } from './db.js';
import { normalizeEmail } from './email-normalize.js';

/**
 * Sprint 2c-A T4-T6 — handler with provider check + email normalize +
 * DB pool init (active) + c8-ignored placeholder for T7 query +
 * fail-closed + structured log.
 *
 * **C8-ignore strategy** (per plan v4 H-A2 fix): each PR T4..T7 keeps
 * the `Test + Coverage (≥80%)` CI gate green by marking un-implemented
 * branches with `/* c8 ignore next *​/`. Each subsequent PR removes the
 * ignore comment + adds covering tests:
 *
 *   - T4 (shipped): provider check (return `{}` if non-Google).
 *   - T5 (shipped): email check + normalize.
 *   - T6 (this PR): `getDbPool()` reachable line added; query +
 *     rowCount check + fail-closed + structured log still c8-ignored.
 *   - T7: removes final c8-ignore + adds DB lookup + fail-closed +
 *     structured log + 4 new tests (T1+T2+T3+T7 per spec §10).
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
  const pool = getDbPool();

  // T7 logic ships in the next PR (query solicitudes_registro WHERE
  // estado='aprobado' + permission-denied throw + structured log).
  // The throw below is a sentinel: if it ever fires en prod it means
  // handler was deployed without the rest of the chain. T2b path-gate
  // + T11 handler-completeness smoke catch this at PR time.
  /* c8 ignore next */
  throw new Error(
    `handler T7 logic not yet implemented (email=${normalized.length} chars, pool=${typeof pool})`,
  );
};
