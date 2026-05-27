import type gcipCloudFunctions from 'gcip-cloud-functions';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * Sprint 2c-A T10a — race-documents-invariant integration test.
 *
 * Documents the MVCC commit-order invariant: the blocking function
 * sees only **committed** state in `solicitudes_registro`. Concurrent
 * approve transactions that have not yet committed are invisible to
 * the handler's `SELECT estado FROM solicitudes_registro WHERE …`
 * — so signups attempted during the gap correctly receive
 * `permission-denied`.
 *
 * **NOT run in CI** by default. `describe.skipIf` checks
 * `TEST_DATABASE_URL`. Manual run (per 2c-B runbook, alongside the
 * Firebase emulator test in `firebase-emulator.test.ts`):
 *
 * ```bash
 * TEST_DATABASE_URL='postgresql://localhost/booster_test' \
 * pnpm --filter @booster-ai/auth-blocking-functions test:race
 * ```
 *
 * The test assumes the `solicitudes_registro` schema exists (run
 * `pnpm --filter @booster-ai/api migrate` against the test DB). Each
 * test cleans its own rows via the `*@racetest.example` email
 * prefix; the rest of the table is left untouched.
 *
 * **Scenarios**:
 *   A) approve commits first → Google signup attempt allowed.
 *   B) Google signup attempt first → permission-denied; subsequent
 *      approve commits → retry signup allowed.
 *   C) (Optional, per plan v4 T10a §3) `pg_sleep` fault injection
 *      during a mid-flight UPDATE. Marked `it.skip` because reliably
 *      reproducing in a shared dev/CI Postgres is hard without
 *      dedicated isolation. Documents the expected behaviour for
 *      future expansion if a flake-tolerant harness lands.
 */

const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const skipReason = TEST_DB_URL
  ? null
  : 'TEST_DATABASE_URL unset (point at local test Postgres + run migrations)';

function buildGoogleUser(email: string): gcipCloudFunctions.UserRecord {
  return {
    uid: `racetest-${email}`,
    email,
    emailVerified: false,
    displayName: '',
    phoneNumber: '',
    photoURL: '',
    disabled: false,
    metadata: { lastSignInTime: '', creationTime: '', toJSON: () => ({}) },
    providerData: [
      {
        providerId: 'google.com',
        uid: 'g-uid',
        displayName: '',
        email,
        phoneNumber: '',
        photoURL: '',
        toJSON: () => ({}),
      },
    ] as gcipCloudFunctions.UserInfo[],
    toJSON: () => ({}),
  } as gcipCloudFunctions.UserRecord;
}

const STUB_CONTEXT = {
  eventId: 'racetest-event',
  timestamp: new Date().toISOString(),
  eventType: 'providers/cloud.auth/eventTypes/user.beforeCreate',
  resource: 'projects/racetest',
  params: {},
  ipAddress: '127.0.0.1',
  userAgent: 'racetest',
} as unknown as gcipCloudFunctions.AuthEventContext;

describe.skipIf(skipReason !== null)('race-documents-invariant', () => {
  let pool: pg.Pool;
  let beforeCreateCallback: typeof import('../../src/handler.js').beforeCreateCallback;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;
    const dbModule = await import('../../src/db.js');
    dbModule.__resetDbPoolForTests();
    const handlerModule = await import('../../src/handler.js');
    beforeCreateCallback = handlerModule.beforeCreateCallback;
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query("DELETE FROM solicitudes_registro WHERE email LIKE '%@racetest.example'");
  });

  it('Scenario A: pre-approved row → Google signup allowed', async () => {
    await pool.query("INSERT INTO solicitudes_registro (email, estado) VALUES ($1, 'aprobado')", [
      'scenario-a@racetest.example',
    ]);
    const result = await beforeCreateCallback(
      buildGoogleUser('scenario-a@racetest.example'),
      STUB_CONTEXT,
    );
    expect(result).toEqual({});
  });

  it('Scenario B: signup before approve → denied; signup after approve → allowed', async () => {
    const email = 'scenario-b@racetest.example';
    await expect(beforeCreateCallback(buildGoogleUser(email), STUB_CONTEXT)).rejects.toMatchObject({
      status: 'PERMISSION_DENIED',
    });
    await pool.query("INSERT INTO solicitudes_registro (email, estado) VALUES ($1, 'aprobado')", [
      email,
    ]);
    const retry = await beforeCreateCallback(buildGoogleUser(email), STUB_CONTEXT);
    expect(retry).toEqual({});
  });

  it.skip('Scenario C (pg_sleep fault-injection): concurrent approve + signup sees pre-commit snapshot', async () => {
    // Plan v4 marks this scenario optional. The intent is: open a
    // transaction that INSERTs the approve row with a pg_sleep(2)
    // delay before COMMIT; concurrently invoke the handler in the
    // sleep window; expect permission-denied (snapshot pre-commit);
    // after COMMIT, retry → expect allowed.
    //
    // Implementation deferred: reliably timing the concurrent
    // invocation in a shared dev Postgres without flakes requires a
    // harness (e.g., advisory-lock + barrier) not yet built. 2c-B
    // runbook tracks the expansion if it becomes load-bearing.
  });
});
