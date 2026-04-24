import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.js';

// Set minimal env before importing modules that parse env.
// Esto debe correr en el momento del parse top-level de config.ts, que pasa en
// el primer `import` que transitivamente use config. Vitest hoistea beforeAll
// pero no antes de los imports — usamos dynamic imports dentro de cada test
// para garantizar que el env se vea.
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
  process.env.ALLOWED_CALLER_SA = 'test-sa@test.iam.gserviceaccount.com';
});

// Stub del Db — los tests de health no tocan la DB.
const stubDb = {} as Db;

describe('health endpoints', () => {
  it('GET /health returns 200 with status ok', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('booster-ai-api');
  });

  it('GET /ready returns 200', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb });
    const res = await app.request('/ready');
    expect(res.status).toBe(200);
  });

  it('GET /unknown returns 404 with not_found error', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb });
    const res = await app.request('/does-not-exist');
    expect(res.status).toBe(404);
  });
});
