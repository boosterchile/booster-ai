#!/usr/bin/env tsx
/**
 * Sprint 2c-A T11 — handler-completeness smoke check (NOT a semantic gate).
 *
 * Spec: `.specs/sec-001-h1-2-google-blocking-a/plan.md` v4 §T11
 * acceptance (per G-A1 honest framing).
 *
 * **THIS IS A SMOKE CHECK, NOT A SEMANTIC GATE.** It catches the
 * specific regression of shipping a T4-state handler skeleton (no DB
 * lookup wired) to Sprint 2c-B deploy paths. It does NOT verify
 * call-site correctness:
 *
 *   Acceptable defeat scenarios (NOT caught here):
 *     - refactor-to-constant: `const TABLE='solicitudes_registro'` but
 *       no active query referencing it.
 *     - commented-out query block.
 *     - dead-code path where the query is never called.
 *
 * Semantic correctness is verified by:
 *   - T7 unit tests (`apps/auth-blocking-functions/src/handler.test.ts`).
 *   - T10a integration test (race-documents-invariant).
 *   - T10b integration test (admin-sdk-no-impact).
 *   - Code review (humans catch refactor-to-constant theater).
 *
 * What this script DOES catch: the handler skeleton accidentally
 * shipping to a Sprint 2c-B deploy PR without the DB lookup wired.
 * That regression would silently break the admin-approval gate in
 * prod and is non-trivial to detect post-deploy.
 *
 * Ejecución:
 *   pnpm exec tsx apps/api/scripts/check-handler-completeness.ts
 *
 * Exit codes:
 *   0 — handler.ts contains BOTH literals.
 *   1 — handler.ts missing one or both literals, or file absent.
 *
 * Escape-hatch: `gh workflow run sprint-2c-handler-completeness.yml
 * -f force=true` bypasses the gate (workflow YAML).
 */

import { existsSync, readFileSync } from 'node:fs';

const HANDLER_PATH = new URL(
  '../../../apps/auth-blocking-functions/src/handler.ts',
  import.meta.url,
).pathname;

const REQUIRED_LITERALS = ['solicitudes_registro', 'BLOCKED_SIGNUP_PENDING_APPROVAL'] as const;

export function findMissingLiterals(source: string): string[] {
  return REQUIRED_LITERALS.filter((literal) => !source.includes(literal));
}

export function checkHandlerFile(path: string): { ok: boolean; reason: string } {
  if (!existsSync(path)) {
    return { ok: false, reason: `handler.ts not found at ${path}` };
  }
  const source = readFileSync(path, 'utf-8');
  const missing = findMissingLiterals(source);
  if (missing.length === 0) {
    return {
      ok: true,
      reason: `handler.ts contains all required literals (${REQUIRED_LITERALS.join(', ')})`,
    };
  }
  return {
    ok: false,
    reason: `handler.ts missing required literal(s): ${missing.join(', ')}`,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = checkHandlerFile(HANDLER_PATH);
  if (result.ok) {
    console.log(`[check-handler-completeness] OK — ${result.reason}`);
    process.exit(0);
  }
  console.error(`[check-handler-completeness] FAIL — ${result.reason}`);
  console.error('');
  console.error('Sprint 2c-B deploy paths require handler.ts contain both:');
  console.error("  - 'solicitudes_registro' (DB table reference)");
  console.error("  - 'BLOCKED_SIGNUP_PENDING_APPROVAL' (gate error code)");
  console.error('');
  console.error('This smoke check prevents shipping T4-state skeleton handler to prod.');
  console.error('See `.specs/sec-001-h1-2-google-blocking-a/plan.md` §T11.');
  process.exit(1);
}
