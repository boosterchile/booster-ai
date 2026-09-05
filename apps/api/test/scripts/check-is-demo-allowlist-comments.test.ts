import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARN_DAYS,
  findExpiringEntries,
  formatGitHubWarning,
  parseAllowlistEntries,
  parseWarnDays,
  validateEntries,
} from '../../scripts/check-is-demo-allowlist-comments.js';

/**
 * Tests para T2b T6c (Sprint 2b SC-1.3.6 parts 2+3).
 *
 * Parser regex + validator stand-alone. Tests cubren shape parsing y
 * reglas de validación: rationale non-empty + reviewBy ISO date en
 * futuro.
 */

const TODAY = new Date('2026-05-26T00:00:00Z');

const EMPTY_ALLOWLIST = `
import type { IsDemoAllowlistEntry } from './is-demo-enforcement.js';
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [];
`;

const SINGLE_VALID = `
import type { IsDemoAllowlistEntry } from './is-demo-enforcement.js';
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint mintea token por diseño',
    reviewBy: '2026-08-25',
  },
];
`;

const TWO_VALID = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint mintea token por diseño',
    reviewBy: '2026-08-25',
  },
  {
    path: '/feature-flags',
    methods: ['GET'],
    rationale: 'flags fetch boot path safe en cualquier sesión',
    reviewBy: '2026-09-10',
  },
];
`;

const EMPTY_RATIONALE = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: '',
    reviewBy: '2026-08-25',
  },
];
`;

const MISSING_RATIONALE = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    reviewBy: '2026-08-25',
  },
];
`;

const PAST_REVIEW = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint',
    reviewBy: '2024-01-01',
  },
];
`;

const MALFORMED_REVIEW = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint',
    reviewBy: 'soon',
  },
];
`;

const MISSING_REVIEW = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint',
  },
];
`;

const MIXED_VALID_INVALID = `
export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
  {
    path: '/demo/login',
    methods: ['POST'],
    rationale: 'demo login endpoint',
    reviewBy: '2026-08-25',
  },
  {
    path: '/api/v1/demo/cache-warm/:persona',
    methods: ['POST'],
    rationale: '',
    reviewBy: '2026-08-25',
  },
];
`;

describe('check-is-demo-allowlist-comments — parseAllowlistEntries', () => {
  it('empty allowlist → 0 entries', () => {
    expect(parseAllowlistEntries(EMPTY_ALLOWLIST)).toEqual([]);
  });

  it('single valid entry → 1 entry parsed con shape correcto', () => {
    const entries = parseAllowlistEntries(SINGLE_VALID);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: '/demo/login',
      rationale: 'demo login endpoint mintea token por diseño',
      reviewBy: '2026-08-25',
    });
  });

  it('múltiples entries parseadas en orden', () => {
    const entries = parseAllowlistEntries(TWO_VALID);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.path).toBe('/demo/login');
    expect(entries[1]?.path).toBe('/feature-flags');
  });
});

describe('check-is-demo-allowlist-comments — validateEntries', () => {
  it('empty allowlist → 0 errors', () => {
    expect(validateEntries(parseAllowlistEntries(EMPTY_ALLOWLIST), TODAY)).toEqual([]);
  });

  it('single valid entry → 0 errors', () => {
    expect(validateEntries(parseAllowlistEntries(SINGLE_VALID), TODAY)).toEqual([]);
  });

  it('empty rationale → error con path en mensaje', () => {
    const errors = validateEntries(parseAllowlistEntries(EMPTY_RATIONALE), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/\/demo\/login/);
    expect(errors[0]).toMatch(/rationale/i);
  });

  it('missing rationale field → error', () => {
    const errors = validateEntries(parseAllowlistEntries(MISSING_RATIONALE), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/rationale/i);
  });

  it('reviewBy in past → error', () => {
    const errors = validateEntries(parseAllowlistEntries(PAST_REVIEW), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/reviewBy/i);
    expect(errors[0]).toMatch(/2024-01-01/);
  });

  it('reviewBy malformed (not YYYY-MM-DD) → error', () => {
    const errors = validateEntries(parseAllowlistEntries(MALFORMED_REVIEW), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/reviewBy/i);
  });

  it('missing reviewBy field → error', () => {
    const errors = validateEntries(parseAllowlistEntries(MISSING_REVIEW), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/reviewBy/i);
  });

  it('mixed valid + invalid → solo errores en invalid', () => {
    const errors = validateEntries(parseAllowlistEntries(MIXED_VALID_INVALID), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cache-warm/);
    expect(errors[0]).toMatch(/rationale/i);
  });

  it('reviewBy exactamente hoy → error (no en futuro)', () => {
    const sourceWithToday = `
      export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
        {
          path: '/x',
          methods: ['POST'],
          rationale: 'r',
          reviewBy: '2026-05-26',
        },
      ];
    `;
    const errors = validateEntries(parseAllowlistEntries(sourceWithToday), TODAY);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/future|reviewBy/i);
  });
});

/**
 * Aviso previo al vencimiento (follow-up de PR #668): T6c sigue fallando
 * con reviewBy vencido, pero además AVISA (sin fallar) cuando una entry
 * vence dentro de `warnDays`. Ventana: now < reviewBy ≤ now + warnDays.
 */
function sourceWithReviewBy(reviewBy: string, path = '/x'): string {
  return `
    export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
      {
        path: '${path}',
        methods: ['POST'],
        rationale: 'r',
        reviewBy: '${reviewBy}',
      },
    ];
  `;
}

describe('check-is-demo-allowlist-comments — findExpiringEntries (aviso previo)', () => {
  it('default de umbral es 14 días', () => {
    expect(DEFAULT_WARN_DAYS).toBe(14);
  });

  it('reviewBy lejano (91 días) → sin aviso', () => {
    const entries = parseAllowlistEntries(sourceWithReviewBy('2026-08-25'));
    expect(findExpiringEntries(entries, TODAY, 14)).toEqual([]);
  });

  it('reviewBy dentro de la ventana (10 días) → aviso con daysLeft', () => {
    const entries = parseAllowlistEntries(sourceWithReviewBy('2026-06-05', '/feature-flags'));
    const warnings = findExpiringEntries(entries, TODAY, 14);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      path: '/feature-flags',
      reviewBy: '2026-06-05',
      daysLeft: 10,
    });
    expect(warnings[0]?.lineNumber).toBeGreaterThan(0);
  });

  it('borde: reviewBy = now + warnDays → avisa; now + warnDays + 1 → no', () => {
    const exact = parseAllowlistEntries(sourceWithReviewBy('2026-06-09'));
    expect(findExpiringEntries(exact, TODAY, 14)).toHaveLength(1);
    expect(findExpiringEntries(exact, TODAY, 14)[0]?.daysLeft).toBe(14);
    const oneAfter = parseAllowlistEntries(sourceWithReviewBy('2026-06-10'));
    expect(findExpiringEntries(oneAfter, TODAY, 14)).toEqual([]);
  });

  it('reviewBy vencido → NO es aviso (es error de validateEntries)', () => {
    const entries = parseAllowlistEntries(PAST_REVIEW);
    expect(findExpiringEntries(entries, TODAY, 14)).toEqual([]);
    expect(validateEntries(entries, TODAY)).toHaveLength(1);
  });

  it('reviewBy hoy → NO es aviso (es error)', () => {
    const entries = parseAllowlistEntries(sourceWithReviewBy('2026-05-26'));
    expect(findExpiringEntries(entries, TODAY, 14)).toEqual([]);
  });

  it('warnDays = 0 → nunca avisa, ni con vencimiento mañana', () => {
    const entries = parseAllowlistEntries(sourceWithReviewBy('2026-05-27'));
    expect(findExpiringEntries(entries, TODAY, 0)).toEqual([]);
  });

  it('reviewBy malformado o ausente → NO es aviso (es error)', () => {
    expect(findExpiringEntries(parseAllowlistEntries(MALFORMED_REVIEW), TODAY, 14)).toEqual([]);
    expect(findExpiringEntries(parseAllowlistEntries(MISSING_REVIEW), TODAY, 14)).toEqual([]);
  });

  it('varias entries → solo las que caen en la ventana, en orden', () => {
    const source = `
      export const ALLOWLISTED_PATHS: IsDemoAllowlistEntry[] = [
        { path: '/a', methods: ['GET'], rationale: 'r', reviewBy: '2026-09-01' },
        { path: '/b', methods: ['GET'], rationale: 'r', reviewBy: '2026-06-01' },
        { path: '/c', methods: ['GET'], rationale: 'r', reviewBy: '2026-06-08' },
      ];
    `;
    const warnings = findExpiringEntries(parseAllowlistEntries(source), TODAY, 14);
    expect(warnings.map((w) => w.path)).toEqual(['/b', '/c']);
    expect(warnings.map((w) => w.daysLeft)).toEqual([6, 13]);
  });
});

describe('check-is-demo-allowlist-comments — formatGitHubWarning', () => {
  it('emite anotación ::warning con file, line, title y mensaje con path, fecha y días', () => {
    const line = formatGitHubWarning(
      { path: '/feature-flags', reviewBy: '2026-06-05', lineNumber: 45, daysLeft: 10 },
      'apps/api/src/middleware/is-demo-allowlist.ts',
    );
    expect(
      line.startsWith('::warning file=apps/api/src/middleware/is-demo-allowlist.ts,line=45,title='),
    ).toBe(true);
    expect(line).toMatch(/::.*\/feature-flags/);
    expect(line).toMatch(/2026-06-05/);
    expect(line).toMatch(/10/);
    expect(line.split('\n')).toHaveLength(1);
  });
});

describe('check-is-demo-allowlist-comments — parseWarnDays (CLI)', () => {
  it('sin flag → default', () => {
    expect(parseWarnDays([])).toBe(DEFAULT_WARN_DAYS);
  });

  it('--warn-days=30 → 30; --warn-days=0 → 0', () => {
    expect(parseWarnDays(['--warn-days=30'])).toBe(30);
    expect(parseWarnDays(['--warn-days=0'])).toBe(0);
  });

  it('valor no entero o negativo → null (uso inválido)', () => {
    expect(parseWarnDays(['--warn-days=abc'])).toBeNull();
    expect(parseWarnDays(['--warn-days=-1'])).toBeNull();
    expect(parseWarnDays(['--warn-days=1.5'])).toBeNull();
    expect(parseWarnDays(['--warn-days='])).toBeNull();
  });

  it('argumentos ajenos se ignoran', () => {
    expect(parseWarnDays(['--otro', 'x', '--warn-days=7'])).toBe(7);
  });
});
