import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDemoPassword } from './seed-demo.js';

// SC-1.4.3 (sec-001-cierre): si DEMO_MODE_ACTIVATED=true y env ausente,
// seed CRASHEA al startup con error claro. Si flag OFF, seed skip sin
// crash. La helper getDemoPassword es el chokepoint del env lookup —
// los call sites (seedDemo, ensureConductorDemoActivated) la invocan
// dentro del path "flag ON".
//
// Aislamiento de env: usamos vi.stubEnv en vez de mutar process.env
// directamente — restore explícito en afterEach. Esto evita leak entre
// tests aunque otro suite haya seteado DEMO_SEED_PASSWORD vía
// test/setup.ts (default 'test-only-not-a-real-secret').

beforeEach(() => {
  // Force "ausente" — anula el default del setup global.
  vi.stubEnv('DEMO_SEED_PASSWORD', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getDemoPassword (T8 SEC-001)', () => {
  it('throw con mensaje accionable si DEMO_SEED_PASSWORD ausente', () => {
    expect(() => getDemoPassword()).toThrowError(/DEMO_SEED_PASSWORD/);
    expect(() => getDemoPassword()).toThrowError(/Secret Manager/);
    expect(() => getDemoPassword()).toThrowError(/init-demo-seed-password\.sh/);
  });

  it('throw si DEMO_SEED_PASSWORD es string vacío', () => {
    vi.stubEnv('DEMO_SEED_PASSWORD', '');
    expect(() => getDemoPassword()).toThrowError(/ausente o vacía/);
  });

  it('throw si DEMO_SEED_PASSWORD es solo whitespace', () => {
    vi.stubEnv('DEMO_SEED_PASSWORD', '   \t  ');
    expect(() => getDemoPassword()).toThrowError(/ausente o vacía/);
  });

  it('retorna el valor cuando DEMO_SEED_PASSWORD está seteado', () => {
    vi.stubEnv('DEMO_SEED_PASSWORD', 'real-random-secret-from-secret-manager');
    expect(getDemoPassword()).toBe('real-random-secret-from-secret-manager');
  });

  it('NO retorna el sentinel placeholder REPLACE_ME_BEFORE_DEPLOY sin error', () => {
    // El sentinel es un valor "no-real" pero técnicamente non-empty.
    // Decisión: dejarlo pasar (el helper solo valida non-empty). El gate
    // semántico (placeholder vs real) vive en el script init + en la
    // verificación operacional post-init, no acá. Documentado en
    // docs/runbooks/secret-init-runbook.md §"Por qué viewer y no
    // secretAccessor".
    vi.stubEnv('DEMO_SEED_PASSWORD', 'REPLACE_ME_BEFORE_DEPLOY');
    expect(getDemoPassword()).toBe('REPLACE_ME_BEFORE_DEPLOY');
  });
});
