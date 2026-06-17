import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Spec fix-factoring-exposicion-y-flag §10 T5: FACTORING_V1_ACTIVATED es
 * false por default en TODOS los entornos — incluido NODE_ENV=production
 * sin env var. Un revert accidental a `booleanFlag(NODE_ENV==='production')`
 * debe romper este test (review 2026-06-10, bloqueante de cobertura).
 *
 * config.ts se evalúa al import, así que cada caso resetea el module
 * registry y setea el env ANTES del import dinámico.
 */

const BASE_ENV: Record<string, string> = {
  SERVICE_NAME: 'booster-ai-api',
  SERVICE_VERSION: '0.0.0-test',
  LOG_LEVEL: 'error',
  GOOGLE_CLOUD_PROJECT: 'test',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_HOST: 'localhost',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  FIREBASE_PROJECT_ID: 'test',
  API_AUDIENCE: 'https://api.boosterchile.com',
  ALLOWED_CALLER_SA: 'caller@booster-ai.iam.gserviceaccount.com',
};

async function loadConfigWith(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...env })) {
    if (v === undefined) {
      vi.stubEnv(k, '');
      delete process.env[k];
    } else {
      vi.stubEnv(k, v);
    }
  }
  const { config } = await import('../../src/config.js');
  return config;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe('FACTORING_V1_ACTIVATED — default seguro (ADR-030 §1)', () => {
  it('false en production sin env var (opt-in explícito para mover dinero)', async () => {
    const config = await loadConfigWith({
      NODE_ENV: 'production',
      FACTORING_V1_ACTIVATED: undefined,
    });
    expect(config.FACTORING_V1_ACTIVATED).toBe(false);
  });

  it('false en development sin env var', async () => {
    const config = await loadConfigWith({
      NODE_ENV: 'development',
      FACTORING_V1_ACTIVATED: undefined,
    });
    expect(config.FACTORING_V1_ACTIVATED).toBe(false);
  });

  it('true SOLO con FACTORING_V1_ACTIVATED=true explícito', async () => {
    const config = await loadConfigWith({
      NODE_ENV: 'production',
      FACTORING_V1_ACTIVATED: 'true',
    });
    expect(config.FACTORING_V1_ACTIVATED).toBe(true);
  });

  it('el string "false" es false (anti-footgun z.coerce.boolean)', async () => {
    const config = await loadConfigWith({
      NODE_ENV: 'production',
      FACTORING_V1_ACTIVATED: 'false',
    });
    expect(config.FACTORING_V1_ACTIVATED).toBe(false);
  });
});
