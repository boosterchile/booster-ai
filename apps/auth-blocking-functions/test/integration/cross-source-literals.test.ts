import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Sprint 2c-B T2 — cross-source-of-truth literal contract.
 *
 * The `BLOCKED_SIGNUP_PENDING_APPROVAL` literal exists in TWO files
 * by design (per ADR-054 F-A4 option (a) decision: handler.ts inlines
 * the literal; apps/web/translateAuthError duplicates it because the
 * Firebase web SDK wraps the handler's HttpsError as `auth/internal-
 * error` with a custom message containing the literal substring).
 *
 * This test enforces the contract: both files MUST contain the
 * literal. Drift triggers test failure → reviewer must reconcile.
 *
 * **Plan v4 G-A2 fix obligation** added by Sprint 2c-A T7 PR. This
 * test lands as part of Sprint 2c-B T2 (extracts + extends the
 * apps/web translator) per plan v4 §"What changed v1 → v2" + spec
 * §10 T-LITERALS bullet.
 *
 * Reads files via `fs.readFileSync` (NOT `import`) to avoid pulling
 * apps/web React deps into apps/auth-blocking-functions test env.
 */

const HANDLER_PATH = new URL('../../src/handler.ts', import.meta.url).pathname;

const TRANSLATE_PATH = new URL('../../../web/src/lib/translate-auth-error.ts', import.meta.url)
  .pathname;

const REQUIRED_LITERAL = 'BLOCKED_SIGNUP_PENDING_APPROVAL';

describe('cross-source literals contract (Sprint 2c-A handler ↔ Sprint 2c-B apps/web translator)', () => {
  it('handler.ts contains BLOCKED_SIGNUP_PENDING_APPROVAL', () => {
    const source = readFileSync(HANDLER_PATH, 'utf-8');
    expect(source).toContain(REQUIRED_LITERAL);
  });

  it('apps/web translate-auth-error.ts contains BLOCKED_SIGNUP_PENDING_APPROVAL', () => {
    const source = readFileSync(TRANSLATE_PATH, 'utf-8');
    expect(source).toContain(REQUIRED_LITERAL);
  });

  it('both files reference each other in code comments (audit traceability)', () => {
    const handlerSource = readFileSync(HANDLER_PATH, 'utf-8');
    const translateSource = readFileSync(TRANSLATE_PATH, 'utf-8');
    expect(handlerSource).toMatch(/2c-B|apps\/web|translate-auth-error|BLOCKED_CODE/);
    expect(translateSource).toMatch(/handler\.ts|apps\/auth-blocking-functions|ADR-054/);
  });
});
