import { type App, deleteApp, initializeApp } from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Sprint 2c-A T10b — Admin SDK no-impact integration test.
 *
 * **Empirically resolves OQ-2C-8** (umbrella spec §12): does
 * `firebase-admin auth.createUser` trigger the `beforeCreate` blocking
 * function, and if so, does the handler's non-Google early-return
 * keep the call uninterrupted?
 *
 * The contract this test enforces: when `apps/api`
 * `approveSignupRequest` calls `auth.createUser` (after marking
 * `solicitudes_registro.estado='aprobado'`), the blocking function
 * either:
 *   (a) does NOT fire (Admin SDK bypasses blocking functions), OR
 *   (b) fires but early-returns `{}` because the synthetic user has no
 *       `google.com` provider.
 *
 * Either outcome is acceptable; both are documented post-run by
 * observing `auth.createUser` succeeds + DB row remains intact + no
 * `signup.blocked.google` log entry is produced for this UID.
 *
 * **NOT run in CI** by default. `describe.skipIf` checks both
 * `TEST_DATABASE_URL` and `FIREBASE_AUTH_EMULATOR_HOST`. Manual run
 * (per 2c-B runbook):
 *
 * ```bash
 * # 1. Start emulators (auth only; functions optional)
 * firebase emulators:start --only auth --project demo-booster-ai
 *
 * # 2. In another terminal:
 * FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099' \
 * TEST_DATABASE_URL='postgresql://localhost/booster_test' \
 * pnpm --filter @booster-ai/auth-blocking-functions test:admin-sdk
 * ```
 *
 * Plan deviation: the test mimics `apps/api/services/signup-request.
 * approveSignupRequest`'s Admin SDK call directly (not via cross-
 * workspace import) to avoid pulling in the full apps/api Drizzle +
 * service deps. The contract under test is the SDK call shape, not
 * the apps/api orchestration.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const skipReason = TEST_DB_URL
  ? EMULATOR_HOST
    ? null
    : 'FIREBASE_AUTH_EMULATOR_HOST unset (start emulator + export)'
  : 'TEST_DATABASE_URL unset';

describe.skipIf(skipReason !== null)('admin-sdk-no-impact (resolves OQ-2C-8)', () => {
  let pool: pg.Pool;
  let auth: Auth;
  let firebaseApp: App;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    // firebase-admin auto-detects FIREBASE_AUTH_EMULATOR_HOST env and
    // bypasses real credentials when set.
    firebaseApp = initializeApp({ projectId: 'demo-booster-ai' }, 'admin-sdk-no-impact-test');
    auth = getAuth(firebaseApp);
  });

  afterAll(async () => {
    await pool.end();
    await deleteApp(firebaseApp);
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM solicitudes_registro WHERE email LIKE '%@adminsdktest.example'");
    // Best-effort cleanup of any prior emulator users from the same test.
    try {
      const existing = await auth.getUserByEmail('admin-sdk@adminsdktest.example');
      await auth.deleteUser(existing.uid);
    } catch {
      // No prior user — expected most of the time.
    }
  });

  it('auth.createUser after estado=aprobado update → succeeds + DB row intact + no rejection', async () => {
    const email = 'admin-sdk@adminsdktest.example';
    await pool.query("INSERT INTO solicitudes_registro (email, estado) VALUES ($1, 'aprobado')", [
      email,
    ]);

    // Mimics apps/api/services/signup-request.approveSignupRequest's
    // Admin SDK invocation (the Drizzle UPDATE + notifier dispatch are
    // orchestration concerns out of scope for this empirical test).
    const created = await auth.createUser({
      email,
      emailVerified: true,
      displayName: 'Admin SDK Test',
    });

    expect(created.uid).toBeTruthy();
    expect(created.email).toBe(email);

    // DB row still present + still aprobado (createUser does NOT mutate it).
    const rows = await pool.query('SELECT estado FROM solicitudes_registro WHERE email = $1', [
      email,
    ]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.estado).toBe('aprobado');

    // Cleanup: delete the user so subsequent runs do not collide.
    await auth.deleteUser(created.uid);
  });
});
