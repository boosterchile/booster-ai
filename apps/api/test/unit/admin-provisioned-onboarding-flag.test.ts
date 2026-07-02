import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T1.4 (onboarding-flow-redesign) — kill-switch `ADMIN_PROVISIONED_ONBOARDING_ENABLED`.
 *
 * `config.ts` se importa con efecto lateral (parseEnv al cargar el módulo), así
 * que usamos `vi.resetModules()` + `vi.stubEnv()` + reimport para leer el flag
 * con distintos valores sin shared state. `vi.unstubAllEnvs()` restaura entre
 * tests (evitamos el operador `delete`, prohibido por Biome noDelete).
 *
 * Invariante de seguridad: el flag es independiente de
 * `EMPRESA_SELF_ONBOARDING_ENABLED` (que gatea el path viejo self-service, que
 * debe quedar OFF para siempre — SEC-001). Mezclarlos reabriría ese agujero.
 */

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadConfig() {
  const mod = await import('../../src/config.js');
  return mod.config;
}

describe('ADMIN_PROVISIONED_ONBOARDING_ENABLED (T1.4 kill-switch)', () => {
  it('default OFF (false) cuando no hay env override', async () => {
    // Sin stub => la var está ausente => booleanFlag(false) aplica el default.
    const config = await loadConfig();
    expect(config.ADMIN_PROVISIONED_ONBOARDING_ENABLED).toBe(false);
  });

  it('=true cuando el env es "true"', async () => {
    vi.stubEnv('ADMIN_PROVISIONED_ONBOARDING_ENABLED', 'true');
    const config = await loadConfig();
    expect(config.ADMIN_PROVISIONED_ONBOARDING_ENABLED).toBe(true);
  });

  it('=false explícito cuando el env es "false"', async () => {
    vi.stubEnv('ADMIN_PROVISIONED_ONBOARDING_ENABLED', 'false');
    const config = await loadConfig();
    expect(config.ADMIN_PROVISIONED_ONBOARDING_ENABLED).toBe(false);
  });

  it('es independiente de EMPRESA_SELF_ONBOARDING_ENABLED', async () => {
    // Encender el path admin-provisioned NO debe encender el self-service viejo.
    vi.stubEnv('ADMIN_PROVISIONED_ONBOARDING_ENABLED', 'true');
    const config = await loadConfig();
    expect(config.ADMIN_PROVISIONED_ONBOARDING_ENABLED).toBe(true);
    expect(config.EMPRESA_SELF_ONBOARDING_ENABLED).toBe(false);
  });
});
