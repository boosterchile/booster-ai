import { createHash } from 'node:crypto';
import gcipCloudFunctions from 'gcip-cloud-functions';
import { getDbPool } from './db.js';
import { normalizeEmail } from './email-normalize.js';
import { logger } from './logger.js';

/**
 * Sprint 2c-A T7 — admin-approval gate for Google federated signup
 * (full flow active).
 *
 * Flow:
 *   1. Provider check (T4). Non-Google → return `{}` (passthrough).
 *   2. Email presence check (T5). Missing → throw HttpsError
 *      `invalid-argument`.
 *   3. Email normalize (T5). Canonical form for DB lookup
 *      (lowercase + NFC + IDN punycode decode).
 *   4. DB query (T7). `SELECT 1 FROM solicitudes_registro WHERE
 *      LOWER(email) = $1 AND estado = 'aprobado' LIMIT 1`. Try/catch
 *      isolates DB errors from the gate decision.
 *   5. Decision (T7):
 *      - DB error → log `signup.gate.db_error` (error) + throw
 *        HttpsError `internal` with code `BLOCKED_CODE`. The IdP
 *        propagates this to the client as an internal failure; the
 *        signup is rejected (fail-closed).
 *      - `rowCount === 0` → log `signup.blocked.google` (warn) + throw
 *        HttpsError `permission-denied` with code `BLOCKED_CODE`.
 *        Common cases: no admin approval row + non-aprobado estado
 *        (query filters `estado = 'aprobado'` so rowCount is 0).
 *      - `rowCount >= 1` → log `signup.allowed.google` (info) + return
 *        `{}` (allow signup without modifications).
 *
 * **BLOCKED_CODE** is inlined per F-A4 option (a). Cross-source-of-
 * truth obligation enforced via 2c-B spec §10 T-LITERALS integration
 * test (added in this PR per G-A2 fix). 2c-B `apps/web/src/utils/
 * translate-auth-error.ts` duplicates the literal with a code comment
 * cross-referencing this file.
 *
 * **PII redaction** (Ley 19.628 + booster-stack-conventions): email
 * appears only as `emailHashed` (SHA-256, first 16 hex chars) in logs.
 * Plaintext email never logged. correlationId derives from
 * `event.eventId` for trace correlation; `ipAddress` is from the event
 * context, not PII per Booster IDOR audits scope.
 */

const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;

function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex').slice(0, 16);
}

export const beforeCreateCallback: gcipCloudFunctions.BeforeCreateHandlerCallback = async (
  user,
  context,
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
  const emailHashed = hashEmail(normalized);
  const correlationId = context.eventId;
  const ipAddress = context.ipAddress;

  let rowCount: number;
  try {
    const pool = getDbPool();
    const result = await pool.query(
      "SELECT 1 FROM solicitudes_registro WHERE LOWER(email) = $1 AND estado = 'aprobado' LIMIT 1",
      [normalized],
    );
    rowCount = result.rowCount ?? 0;
  } catch (err) {
    logger.error({
      event: 'signup.gate.db_error',
      correlationId,
      ipAddress,
      emailHashed,
      err: err instanceof Error ? err.message : 'unknown',
    });
    throw new gcipCloudFunctions.https.HttpsError('internal', BLOCKED_CODE);
  }

  if (rowCount === 0) {
    logger.warn({
      event: 'signup.blocked.google',
      correlationId,
      ipAddress,
      emailHashed,
    });
    throw new gcipCloudFunctions.https.HttpsError('permission-denied', BLOCKED_CODE);
  }

  logger.info({
    event: 'signup.allowed.google',
    correlationId,
    ipAddress,
    emailHashed,
  });
  return {};
};
