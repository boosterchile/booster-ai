import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDemoPasswordForPersona } from './seed-demo.js';

// T3 SEC-001 Sprint 2a — replaces T8 SEC-001 single-env-var pattern with
// per-persona Secret Manager env vars. Each persona reads its own env var
// (DEMO_ACCOUNT_PASSWORD_<SUFFIX>_2026). Fail-closed loudly si ausente o
// vacía, con mensaje accionable referenciando T2 + init-demo-secrets-2026.sh.
//
// Aislamiento de env: usamos vi.stubEnv en vez de mutar process.env
// directamente — restore explícito en afterEach. Test setup.ts global no
// pre-seedea las 4 nuevas env vars, así que parten en undefined.

const ALL_ENV_KEYS = [
  'DEMO_ACCOUNT_PASSWORD_SHIPPER_2026',
  'DEMO_ACCOUNT_PASSWORD_CARRIER_2026',
  'DEMO_ACCOUNT_PASSWORD_STAKEHOLDER_2026',
  'DEMO_ACCOUNT_PASSWORD_CONDUCTOR_FIREBASE_2026',
] as const;

beforeEach(() => {
  // Force "ausente" para cada env var antes de cada test.
  for (const key of ALL_ENV_KEYS) {
    vi.stubEnv(key, '');
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDemoPasswordForPersona (T3 SEC-001 Sprint 2a)', () => {
  it('throw con mensaje accionable si env var ausente (generador_carga)', () => {
    expect(() => getDemoPasswordForPersona('generador_carga')).toThrowError(
      /DEMO_ACCOUNT_PASSWORD_SHIPPER_2026/,
    );
    expect(() => getDemoPasswordForPersona('generador_carga')).toThrowError(/T2/);
    expect(() => getDemoPasswordForPersona('generador_carga')).toThrowError(
      /init-demo-secrets-2026\.sh/,
    );
  });

  it('throw si env var es string vacío (transportista)', () => {
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_CARRIER_2026', '');
    expect(() => getDemoPasswordForPersona('transportista')).toThrowError(/ausente o vacía/);
  });

  it('throw si env var es solo whitespace (stakeholder)', () => {
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_STAKEHOLDER_2026', '   \t  ');
    expect(() => getDemoPasswordForPersona('stakeholder')).toThrowError(/ausente o vacía/);
  });

  it('retorna el valor por persona cuando env está seteado (shipper)', () => {
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_SHIPPER_2026', 'random-shipper-secret');
    expect(getDemoPasswordForPersona('generador_carga')).toBe('random-shipper-secret');
  });

  it('mapping enum Spanish → English env suffix correcto para los 4 personas', () => {
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_SHIPPER_2026', 'pw-shipper');
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_CARRIER_2026', 'pw-carrier');
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_STAKEHOLDER_2026', 'pw-stakeholder');
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_CONDUCTOR_FIREBASE_2026', 'pw-conductor');

    expect(getDemoPasswordForPersona('generador_carga')).toBe('pw-shipper');
    expect(getDemoPasswordForPersona('transportista')).toBe('pw-carrier');
    expect(getDemoPasswordForPersona('stakeholder')).toBe('pw-stakeholder');
    expect(getDemoPasswordForPersona('conductor')).toBe('pw-conductor');
  });

  it('NO retorna sentinel placeholder REPLACE_ME_BEFORE_DEPLOY sin error', () => {
    // El sentinel es un valor "no-real" pero técnicamente non-empty.
    // Decisión: dejarlo pasar (el helper solo valida non-empty). El gate
    // semántico (placeholder vs real) vive en el script init + en la
    // verificación operacional post-init.
    vi.stubEnv('DEMO_ACCOUNT_PASSWORD_SHIPPER_2026', 'REPLACE_ME_BEFORE_DEPLOY');
    expect(getDemoPasswordForPersona('generador_carga')).toBe('REPLACE_ME_BEFORE_DEPLOY');
  });
});
