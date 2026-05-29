import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkAdrFile, isAdrStatusAccepted } from '../../scripts/check-adr-status-accepted.js';

/**
 * Sprint 2c-A T2a — fixtures (a)..(e) per plan v4 acceptance.
 *
 * (a) ADR-052 with `- **Status**: Proposed (...)` → exit 1.
 * (b) ADR-052 with `- **Status**: Accepted (post-canary success cloudbuild run <ID>)` → exit 0.
 *     This is the literal post-flip form per ADR-052 §"Acceptance criterion".
 * (c) ADR-014 `**Estado:** Aceptado` (colon-inside-bold) → exit 1 (out-of-scope by design).
 * (d) ADR file absent / malformed → exit 1.
 * (e) Integration test: open actual `docs/adr/052-signup-migration-admin-sdk-gate.md`
 *     → exit 0 (flipped Proposed → Accepted 2026-05-29 post-canary
 *     success cloudbuild 8f4ec780; T2a sentinel updated in same commit).
 *
 * Plus negative fixtures covering the 6+ Status formats explicitly NOT
 * matched by design (per file-level doc-comment).
 */

// ────────────────────────────────────────────────────────────────────
// Synthetic fixtures
// ────────────────────────────────────────────────────────────────────

const FIXTURE_A_PROPOSED = `# ADR-052: Foo

- **Status**: Proposed (2026-05-26; T6 Sprint 2b H1.2 PR2). Transición a \`Accepted\` agendada en T13.
- **Date**: 2026-05-26
`;

const FIXTURE_B_ACCEPTED_POST_FLIP = `# ADR-052: Foo

- **Status**: Accepted (post-canary success cloudbuild run abc-123-xyz)
- **Date**: 2026-05-26
`;

const FIXTURE_C_COLON_INSIDE_BOLD = `# ADR-014: API Key de Google Maps

**Fecha:** 2026-05-02
**Estado:** Aceptado
`;

const FIXTURE_MALFORMED = `# Some markdown file

There is no Status line here at all.
Just text. And more text.
`;

const FIXTURE_NO_DASH_EN = `# ADR-035: Foo

**Status**: Accepted
**Date**: 2026-05-12
`;

const FIXTURE_ESTADO_NO_DASH = `# ADR-040: Foo

**Estado**: Accepted
**Fecha**: 2026-05-15
`;

const FIXTURE_ESTADO_WITH_DASH = `# ADR-013: Foo

- **Estado**: Accepted
`;

const FIXTURE_ESTADO_ACEPTADO = `# ADR-034: Foo

**Estado**: Aceptado
**Fecha**: 2026-05-08
`;

// ────────────────────────────────────────────────────────────────────
// Fixture (a)..(d) tests
// ────────────────────────────────────────────────────────────────────

describe('check-adr-status-accepted: ADR-052 lineage form matching', () => {
  it('fixture (a): ADR-052 Proposed → not accepted (exit 1)', () => {
    expect(isAdrStatusAccepted(FIXTURE_A_PROPOSED)).toBe(false);
  });

  it('fixture (b): ADR-052 post-flip Accepted with parenthetical → accepted (exit 0)', () => {
    expect(isAdrStatusAccepted(FIXTURE_B_ACCEPTED_POST_FLIP)).toBe(true);
  });

  it('fixture (c): ADR-014 colon-inside-bold Estado → NOT accepted by design (exit 1)', () => {
    expect(isAdrStatusAccepted(FIXTURE_C_COLON_INSIDE_BOLD)).toBe(false);
  });

  it('fixture (d) malformed: no Status line → not accepted', () => {
    expect(isAdrStatusAccepted(FIXTURE_MALFORMED)).toBe(false);
  });
});

describe('check-adr-status-accepted: corpus diversity intentionally out-of-scope', () => {
  it('no-dash EN Status form → NOT matched by design', () => {
    expect(isAdrStatusAccepted(FIXTURE_NO_DASH_EN)).toBe(false);
  });

  it('no-dash Estado mixed-lang form → NOT matched by design', () => {
    expect(isAdrStatusAccepted(FIXTURE_ESTADO_NO_DASH)).toBe(false);
  });

  it('dash Estado mixed-lang form → NOT matched by design', () => {
    expect(isAdrStatusAccepted(FIXTURE_ESTADO_WITH_DASH)).toBe(false);
  });

  it('full-Spanish Estado Aceptado form → NOT matched by design', () => {
    expect(isAdrStatusAccepted(FIXTURE_ESTADO_ACEPTADO)).toBe(false);
  });
});

describe('check-adr-status-accepted: search window scoped to first 10 lines', () => {
  it('Status line beyond search window → not matched', () => {
    const padding = Array(20).fill('# Padding line').join('\n');
    const source = `${padding}\n- **Status**: Accepted (foo)`;
    expect(isAdrStatusAccepted(source)).toBe(false);
  });

  it('Status line at line 3 (typical) → matched', () => {
    const source = '# Title\n\n- **Status**: Accepted (foo)';
    expect(isAdrStatusAccepted(source)).toBe(true);
  });
});

describe('check-adr-status-accepted: minor variations of accepted form', () => {
  it('accepted with leading whitespace after colon (multiple spaces)', () => {
    expect(isAdrStatusAccepted('- **Status**:   Accepted (foo)')).toBe(true);
  });

  it('accepted without parenthetical (bare form)', () => {
    expect(isAdrStatusAccepted('- **Status**: Accepted')).toBe(true);
  });

  it('Accepted lowercase → not matched (literal `Accepted` capitalization required)', () => {
    expect(isAdrStatusAccepted('- **Status**: accepted (foo)')).toBe(false);
  });

  it('Accepted as substring of longer word → not matched (word boundary)', () => {
    expect(isAdrStatusAccepted('- **Status**: AcceptedExtra (foo)')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Fixture (e) — integration test against the real ADR-052 file
// ────────────────────────────────────────────────────────────────────

describe('check-adr-status-accepted: integration against real ADR-052 file', () => {
  const realPath = new URL(
    '../../../../docs/adr/052-signup-migration-admin-sdk-gate.md',
    import.meta.url,
  ).pathname;

  it('fixture (e): real ADR-052 exists', () => {
    expect(existsSync(realPath)).toBe(true);
  });

  it('fixture (e): real ADR-052 IS Accepted (flipped 2026-05-29 post-canary cloudbuild 8f4ec780)', () => {
    const result = checkAdrFile(realPath);
    expect(result.ok).toBe(true);
    expect(result.reason).toMatch(/matches ADR-052\/053\/054 lineage form/);
  });

  it('fixture (e): real ADR-052 line 3 starts with the lineage form', () => {
    const source = readFileSync(realPath, 'utf-8');
    const line3 = source.split('\n')[2];
    expect(line3).toMatch(/^- \*\*Status\*\*: /);
  });
});

// ────────────────────────────────────────────────────────────────────
// checkAdrFile wrapper behavior
// ────────────────────────────────────────────────────────────────────

describe('checkAdrFile', () => {
  it('returns ok=false con clear reason si file no existe', () => {
    const result = checkAdrFile('/tmp/nonexistent-adr-file-xyz.md');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not found/);
  });
});
