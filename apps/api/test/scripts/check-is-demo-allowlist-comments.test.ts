import { describe, expect, it } from 'vitest';
import {
  parseAllowlistEntries,
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
