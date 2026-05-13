import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

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

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/routes/feature-flags.js').createFeatureFlagsRoutes
>[0]['logger'];

describe('GET /feature-flags (ADR-035 + ADR-036)', () => {
  it('devuelve los tres flags como booleanos', async () => {
    const { createFeatureFlagsRoutes } = await import('../../src/routes/feature-flags.js');
    const app = new Hono();
    app.route('/feature-flags', createFeatureFlagsRoutes({ logger: noopLogger }));

    const res = await app.request('/feature-flags');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body).toHaveProperty('auth_universal_v1_activated');
    expect(body).toHaveProperty('wake_word_voice_activated');
    expect(body).toHaveProperty('matching_algorithm_v2_activated');
    expect(typeof body.auth_universal_v1_activated).toBe('boolean');
    expect(typeof body.wake_word_voice_activated).toBe('boolean');
    expect(typeof body.matching_algorithm_v2_activated).toBe('boolean');
  });

  it('no requiere auth (público)', async () => {
    const { createFeatureFlagsRoutes } = await import('../../src/routes/feature-flags.js');
    const app = new Hono();
    app.route('/feature-flags', createFeatureFlagsRoutes({ logger: noopLogger }));

    // Sin headers de auth.
    const res = await app.request('/feature-flags');
    expect(res.status).toBe(200);
  });
});
