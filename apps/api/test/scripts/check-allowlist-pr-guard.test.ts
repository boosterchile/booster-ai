import { describe, expect, it } from 'vitest';
import { isAllowlistFileInDiff, runPrGuard } from '../../scripts/check-allowlist-pr-guard.js';

/**
 * Tests para T2b T6d (Sprint 2b SC-1.3.6 part 3) — PR-modifies guard.
 *
 * Behavior:
 *   - Si el git diff NO modifica `is-demo-allowlist.ts` → exitCode 0
 *     + skipped=true (CI job pasa sin validar).
 *   - Si SÍ lo modifica → re-usa validator T6c sobre el archivo entero.
 *   - Si validator falla → exitCode 1 con errors.
 *   - Si validator pasa → exitCode 0 con skipped=false.
 */

const TODAY = new Date('2026-05-26T00:00:00Z');
const ALLOWLIST_PATH = 'apps/api/src/middleware/is-demo-allowlist.ts';

const VALID_SOURCE = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint',
    reviewBy: '2026-08-25',
  },
];
`;

const INVALID_SOURCE = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: '',
    reviewBy: '2026-08-25',
  },
];
`;

describe('check-allowlist-pr-guard — isAllowlistFileInDiff', () => {
  it('file en lista de changed files → true', () => {
    const diff = 'apps/api/src/middleware/is-demo-allowlist.ts\napps/api/src/server.ts';
    expect(isAllowlistFileInDiff(diff, ALLOWLIST_PATH)).toBe(true);
  });

  it('file NO en lista → false', () => {
    const diff = 'apps/api/src/server.ts\napps/api/src/middleware/auth.ts';
    expect(isAllowlistFileInDiff(diff, ALLOWLIST_PATH)).toBe(false);
  });

  it('lista vacía → false', () => {
    expect(isAllowlistFileInDiff('', ALLOWLIST_PATH)).toBe(false);
  });

  it('whitespace y líneas blancas no falsos positivos', () => {
    const diff = '\n  \napps/api/src/middleware/is-demo-allowlist.ts  \n';
    expect(isAllowlistFileInDiff(diff, ALLOWLIST_PATH)).toBe(true);
  });

  it('match exacto, no substring', () => {
    // Un path que CONTIENE el nombre pero es otro file.
    const diff = 'apps/api/src/middleware/is-demo-allowlist.test.ts';
    expect(isAllowlistFileInDiff(diff, ALLOWLIST_PATH)).toBe(false);
  });
});

describe('check-allowlist-pr-guard — runPrGuard', () => {
  it('file NOT in diff → exitCode 0 + skipped=true (no validation)', () => {
    const result = runPrGuard({
      diffOutput: 'apps/api/src/server.ts',
      allowlistRelativePath: ALLOWLIST_PATH,
      source: INVALID_SOURCE, // sabotage: source es inválido, pero como
      // diff no lo incluye, no se valida.
      now: TODAY,
    });
    expect(result.exitCode).toBe(0);
    expect(result.skipped).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('file in diff + entries válidas → exitCode 0 + skipped=false', () => {
    const result = runPrGuard({
      diffOutput: ALLOWLIST_PATH,
      allowlistRelativePath: ALLOWLIST_PATH,
      source: VALID_SOURCE,
      now: TODAY,
    });
    expect(result.exitCode).toBe(0);
    expect(result.skipped).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('file in diff + entries inválidas → exitCode 1 + errors populated', () => {
    const result = runPrGuard({
      diffOutput: ALLOWLIST_PATH,
      allowlistRelativePath: ALLOWLIST_PATH,
      source: INVALID_SOURCE,
      now: TODAY,
    });
    expect(result.exitCode).toBe(1);
    expect(result.skipped).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/rationale/i);
  });

  it('empty diff (no changes en PR) → skipped', () => {
    const result = runPrGuard({
      diffOutput: '',
      allowlistRelativePath: ALLOWLIST_PATH,
      source: VALID_SOURCE,
      now: TODAY,
    });
    expect(result.skipped).toBe(true);
    expect(result.exitCode).toBe(0);
  });
});
