#!/usr/bin/env tsx
/**
 * Sprint 2c-A T2a — Mechanical CI gate script.
 *
 * Spec: `.specs/sec-001-h1-2-google-blocking-a/plan.md` v4 §T2a acceptance.
 *
 * Purpose: enforces that Sprint 2c-B deploy paths cannot merge until
 * ADR-052 (`docs/adr/052-signup-migration-admin-sdk-gate.md`) Status
 * is `Accepted`. Sprint 2c-B mechanical gate wires this script in the
 * workflow `sprint-2c-build-gate.yml` (T2b, next PR) with a path-filter
 * targeting Sprint 2c-B deploy paths only.
 *
 * Sprint 2c-A code paths are deliberately OUTSIDE the gate's
 * path-filter; 2c-A handler implementation lands without this gate
 * firing.
 *
 * **Regex scope — by design ADR-052-specific, NOT corpus-general**.
 * `docs/adr/*.md` corpus contains 6+ Status formats (verified via
 * `grep -hE '^- \\*\\*Sta|^\\*\\*Sta|^- \\*\\*Est|^\\*\\*Est' docs/adr/*.md`):
 *   - `**Status**: Accepted` (no dash, EN)        ~24 ADRs
 *   - `**Estado**: Accepted` (no dash, mixed)     ~8 ADRs
 *   - `- **Estado**: Accepted` (dash, mixed)      6 ADRs
 *   - `**Estado**: Aceptado` (no dash, full ES)   5 ADRs
 *   - `- **Status**: ... (dash, EN parenthetical)` 3 ADRs (ADR-052/053/054)
 *   - `**Estado:** Aceptado` (colon-inside-bold)  1 ADR (ADR-014)
 *
 * This script narrowly matches **only** the ADR-052/053/054 lineage form
 * `^- **Status**: Accepted` because that is the exact form ADR-052
 * post-flip will use per its §"Acceptance criterion" line 116:
 *   "T13 emite separate post-merge commit `docs(adr-052): Accepted
 *    post-canary success cloudbuild run <ID>` que actualiza línea 3
 *    de este file de `Proposed` a `Accepted`"
 *
 * Bidirectional cross-ref: `.specs/_followups/castellanizar-adr-headers.md`
 * §"Exclusiones / coordinación con Sprint 2c" coordinates ADR-052/053/054
 * castellanization deferral to post-Sprint-2c-B CERRADO + regex update.
 *
 * Ejecución:
 *   pnpm exec tsx apps/api/scripts/check-adr-status-accepted.ts
 *
 * Exit codes:
 *   0 — ADR-052 Status line matches `- **Status**: Accepted ...`
 *   1 — file absent, malformed, Status Proposed, or any other form
 */

import { existsSync, readFileSync } from 'node:fs';

const ADR_PATH = new URL(
  '../../../docs/adr/052-signup-migration-admin-sdk-gate.md',
  import.meta.url,
).pathname;
const SEARCH_LINES = 10;

const ACCEPTED_PATTERN = /^- \*\*Status\*\*:\s+Accepted\b/;

/**
 * Returns true when `source` (raw markdown content) has a Status line
 * within the first `searchLines` lines matching the ADR-052 lineage form
 * `- **Status**: Accepted ...`. Deliberately NOT matching any other
 * format in the corpus (see file-level doc-comment).
 */
export function isAdrStatusAccepted(source: string, searchLines = SEARCH_LINES): boolean {
  const head = source.split('\n').slice(0, searchLines);
  return head.some((line) => ACCEPTED_PATTERN.test(line));
}

export function checkAdrFile(path: string): { ok: boolean; reason: string } {
  if (!existsSync(path)) {
    return { ok: false, reason: `ADR file not found: ${path}` };
  }
  const source = readFileSync(path, 'utf-8');
  if (isAdrStatusAccepted(source)) {
    return { ok: true, reason: 'Status: Accepted (matches ADR-052/053/054 lineage form)' };
  }
  return {
    ok: false,
    reason: `Status not Accepted at ${path}; expected '- **Status**: Accepted ...' within first ${SEARCH_LINES} lines`,
  };
}

// Solo ejecuta si es llamado directamente (no en import desde tests).
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const result = checkAdrFile(ADR_PATH);
  if (result.ok) {
    console.log(`[check-adr-status-accepted] OK — ${result.reason}`);
    process.exit(0);
  }
  console.error(`[check-adr-status-accepted] FAIL — ${result.reason}`);
  console.error('');
  console.error('Sprint 2c-B deploy paths require ADR-052 Status flip Proposed → Accepted.');
  console.error(
    'Run AFTER Sprint-2b T13 canary success + 2h watch documented in a separate post-merge commit.',
  );
  console.error('See ADR-052 §"Acceptance criterion para transition Proposed → Accepted".');
  process.exit(1);
}
