import { describe, expect, it } from 'vitest';
import { checkCloudFunctionDeployed } from '../../scripts/check-cloud-function-deployed.js';

/**
 * Sprint 2c-B T7 — atomic deploy verification fixture tests.
 *
 * Tests inject a mock `exec` callback (instead of real `child_process.
 * execSync` against `gcloud`) so the harness is hermetic and runs in
 * CI without prod credentials.
 *
 * Fixtures per plan v4 §T7 acceptance:
 *   1. ACTIVE + sourceArchiveUrl present → exit 0.
 *   2. Missing sourceArchiveUrl → exit 1.
 *   3. status=DEPLOY_IN_PROGRESS → exit 1.
 *   4. gcloud failure (e.g., function not found OR gcloud absent) → exit 1.
 *   5. Non-JSON output (gcloud crash, partial stream) → exit 1.
 */

describe('checkCloudFunctionDeployed', () => {
  it('ACTIVE + sourceArchiveUrl present → ok', () => {
    const result = checkCloudFunctionDeployed({
      exec: () =>
        JSON.stringify({
          name: 'projects/booster-ai-494222/locations/us-east1/functions/beforeCreate',
          status: 'ACTIVE',
          sourceArchiveUrl: 'gs://gcf-sources-469283083998-us-east1/beforeCreate-deadbeef.zip',
        }),
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/ACTIVE/);
  });

  it('missing sourceArchiveUrl → fail with clear message', () => {
    const result = checkCloudFunctionDeployed({
      exec: () =>
        JSON.stringify({
          name: 'projects/booster-ai-494222/locations/us-east1/functions/beforeCreate',
          status: 'ACTIVE',
          // sourceArchiveUrl intentionally omitted
        }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sourceArchiveUrl is empty/);
  });

  it('status=DEPLOY_IN_PROGRESS → fail with status in reason', () => {
    const result = checkCloudFunctionDeployed({
      exec: () =>
        JSON.stringify({
          name: 'projects/booster-ai-494222/locations/us-east1/functions/beforeCreate',
          status: 'DEPLOY_IN_PROGRESS',
          sourceArchiveUrl: 'gs://gcf-sources-469283083998-us-east1/beforeCreate-deadbeef.zip',
        }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/DEPLOY_IN_PROGRESS/);
  });

  it('gcloud failure (exec throws) → fail with gcloud-failed message', () => {
    const result = checkCloudFunctionDeployed({
      exec: () => {
        throw new Error('gcloud: command not found');
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/gcloud functions describe failed/);
  });

  it('non-JSON output → fail with parse-error message', () => {
    const result = checkCloudFunctionDeployed({
      exec: () => 'not-json-output',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not valid JSON/);
  });

  it('explicit empty sourceArchiveUrl → fail (not just undefined)', () => {
    const result = checkCloudFunctionDeployed({
      exec: () =>
        JSON.stringify({
          name: 'projects/booster-ai-494222/locations/us-east1/functions/beforeCreate',
          status: 'ACTIVE',
          sourceArchiveUrl: '',
        }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/sourceArchiveUrl is empty/);
  });

  it('explicit OFFLINE status → fail', () => {
    const result = checkCloudFunctionDeployed({
      exec: () =>
        JSON.stringify({
          name: 'projects/booster-ai-494222/locations/us-east1/functions/beforeCreate',
          status: 'OFFLINE',
          sourceArchiveUrl: 'gs://gcf-sources-469283083998-us-east1/beforeCreate-deadbeef.zip',
        }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/OFFLINE/);
  });
});
