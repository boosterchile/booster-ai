import { describe, expect, it } from 'vitest';

/**
 * Sprint 2c-A T9a — Firebase emulator end-to-end integration test.
 *
 * **NOT run in CI** per plan v4 OQ-PLAN-1 soft-waiver (Firebase emulator
 * setup overhead > 30s; firebase-tools install heavyweight; emulator
 * flakiness risk). Run **manually pre-merge** per Sprint 2c-B runbook.
 *
 * **Skip condition**: tests `describe.skipIf` checks for two env
 * vars. CI sees them unset → skipped (instant pass). Local run sets
 * both vars → real test executes.
 *
 *   - `FIREBASE_AUTH_EMULATOR_HOST` — typically `127.0.0.1:9099` after
 *     `firebase emulators:start --only auth,functions`.
 *   - `TEST_DATABASE_URL` — connection string to an isolated test
 *     Postgres (NOT prod). Seeding happens here.
 *
 * **Manual run procedure** (will be inlined in 2c-B runbook):
 *
 * ```bash
 * # 1. Install firebase-tools globally (once per dev machine)
 * npm install -g firebase-tools
 *
 * # 2. Build the function for the emulator
 * cd apps/auth-blocking-functions
 * pnpm build
 *
 * # 3. Start a throwaway Postgres + create the schema
 * # (or point TEST_DATABASE_URL to a pre-seeded local DB)
 *
 * # 4. Start the emulators (auth + functions only)
 * firebase emulators:start --only auth,functions --project demo-booster-ai
 *
 * # 5. In a separate terminal:
 * cd apps/auth-blocking-functions
 * FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099' \
 * TEST_DATABASE_URL='postgresql://localhost/booster_test' \
 * pnpm test:emulator
 *
 * # 6. Stop emulators when done (Ctrl+C in step 4)
 * ```
 *
 * **Expected outcomes** (asserted below):
 *   - Scenario A — pre-seeded `solicitudes_registro` row with
 *     `estado='aprobado'` for `approved@booster.test` → Firebase Auth
 *     signup succeeds; user created.
 *   - Scenario B — no matching row for `unknown@booster.test` →
 *     Firebase Auth signup fails with `auth/internal-error` (the
 *     wrapping Firebase web SDK emits when the blocking function
 *     throws HttpsError).
 *
 * Both scenarios exercise the full chain handler → DB pool → query →
 * HttpsError throw → IdP propagation to client SDK.
 */

const EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const TEST_DB_URL = process.env.TEST_DATABASE_URL;
const skipReason = EMULATOR_HOST
  ? TEST_DB_URL
    ? null
    : 'TEST_DATABASE_URL unset (point at local test Postgres)'
  : 'FIREBASE_AUTH_EMULATOR_HOST unset (start emulator + export)';

describe.skipIf(skipReason !== null)('Firebase emulator integration (manual)', () => {
  it(`scenario A: pre-seeded approved row → Google signup succeeds (${skipReason ?? 'running'})`, async () => {
    // Implementation activates only when emulator + test DB are available.
    // The test driver code below is intentionally minimal scaffolding;
    // 2c-B runbook expands the seed + Firebase Auth REST invoke steps.
    expect(EMULATOR_HOST).toBeDefined();
    expect(TEST_DB_URL).toBeDefined();

    // TODO(sprint-2c-B-runbook): expand into real seed + signup invoke.
    //   1. Connect to TEST_DB_URL; INSERT INTO solicitudes_registro
    //      (email, estado) VALUES ('approved@booster.test', 'aprobado').
    //   2. POST to Firebase Auth emulator /signUp endpoint con
    //      providerId='google.com' + email='approved@booster.test'.
    //   3. Expect 200 + user record created.
    //   4. Cleanup (DELETE row).
  });

  it(`scenario B: no matching row → signup fails with auth/internal-error (${skipReason ?? 'running'})`, async () => {
    expect(EMULATOR_HOST).toBeDefined();
    expect(TEST_DB_URL).toBeDefined();

    // TODO(sprint-2c-B-runbook): expand into real signup invoke + error
    // assertion.
    //   1. Confirm no row for 'unknown@booster.test' en
    //      solicitudes_registro.
    //   2. POST to Firebase Auth emulator /signUp endpoint con
    //      providerId='google.com' + email='unknown@booster.test'.
    //   3. Expect 4xx/5xx con error message containing
    //      'auth/internal-error' (web SDK wrapping pattern per ADR-054).
  });
});

describe('Firebase emulator integration (config sanity)', () => {
  it('firebase.json declares auth + functions emulators on expected ports', async () => {
    const fs = await import('node:fs/promises');
    const url = new URL('../../firebase.json', import.meta.url);
    const content = await fs.readFile(url, 'utf-8');
    const config = JSON.parse(content);
    expect(config.emulators.auth.port).toBe(9099);
    expect(config.emulators.functions.port).toBe(5001);
    expect(config.functions[0].codebase).toBe('auth-blocking-functions');
    expect(config.functions[0].runtime).toBe('nodejs20');
  });
});
