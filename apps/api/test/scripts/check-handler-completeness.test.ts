import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkHandlerFile, findMissingLiterals } from '../../scripts/check-handler-completeness.js';

/**
 * Sprint 2c-A T11 — fixture tests for the handler-completeness smoke
 * check. Plan v4 §T11 acceptance:
 *
 *   - Script returns exit 0 only if BOTH greps succeed.
 *   - Fixture coverage: complete + skeleton-only + missing-file +
 *     missing each literal individually.
 *
 * The script is a **smoke check, NOT a semantic gate** (per G-A1
 * honest framing). These tests assert the literal-presence contract,
 * NOT semantic correctness of the handler — that is covered by
 * `apps/auth-blocking-functions/src/handler.test.ts` (T7) + the
 * integration tests T10a/T10b.
 */

const COMPLETE_HANDLER = `
import gcipCloudFunctions from 'gcip-cloud-functions';

const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;

export const beforeCreateCallback = async () => {
  await pool.query("SELECT 1 FROM solicitudes_registro WHERE …");
};
`;

const SKELETON_T4_STATE = `
export const beforeCreateCallback = async (user) => {
  if (!isGoogle) return {};
  throw new Error('handler T5-T7 logic not yet implemented');
};
`;

const MISSING_TABLE_LITERAL = `
const BLOCKED_CODE = 'BLOCKED_SIGNUP_PENDING_APPROVAL' as const;
// query against a different table by mistake
await pool.query("SELECT 1 FROM users WHERE estado='aprobado'");
`;

const MISSING_CODE_LITERAL = `
await pool.query("SELECT 1 FROM solicitudes_registro WHERE …");
throw new gcipCloudFunctions.https.HttpsError('permission-denied', 'DENIED');
`;

describe('findMissingLiterals', () => {
  it('returns empty array when both required literals are present', () => {
    expect(findMissingLiterals(COMPLETE_HANDLER)).toEqual([]);
  });

  it('reports both literals missing for T4-skeleton handler', () => {
    expect(findMissingLiterals(SKELETON_T4_STATE)).toEqual([
      'solicitudes_registro',
      'BLOCKED_SIGNUP_PENDING_APPROVAL',
    ]);
  });

  it('reports only solicitudes_registro missing when table literal absent', () => {
    expect(findMissingLiterals(MISSING_TABLE_LITERAL)).toEqual(['solicitudes_registro']);
  });

  it('reports only BLOCKED_SIGNUP_PENDING_APPROVAL missing when code literal absent', () => {
    expect(findMissingLiterals(MISSING_CODE_LITERAL)).toEqual(['BLOCKED_SIGNUP_PENDING_APPROVAL']);
  });
});

describe('checkHandlerFile', () => {
  it('returns ok=false with file-not-found reason when path absent', () => {
    const result = checkHandlerFile('/tmp/nonexistent-handler-xyz.ts');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });

  it('integration: runs against actual handler.ts in main', () => {
    // After T7 merge, handler.ts contains both literals. This test
    // serves as a smoke check that the script + the live file agree.
    const realPath = new URL('../../../auth-blocking-functions/src/handler.ts', import.meta.url)
      .pathname;
    expect(existsSync(realPath)).toBe(true);
    const result = checkHandlerFile(realPath);
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/contains all required literals/);
  });
});
