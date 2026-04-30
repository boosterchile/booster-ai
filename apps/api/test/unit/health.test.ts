import type pg from 'pg';
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

// Stub del Db — los tests de health no tocan la DB drizzle directamente.
const stubDb = {} as Db;

// Stub del pg.Pool — /ready hace pool.connect() + client.query('SELECT 1').
// Permite simular tanto OK (200) como fallo (503) sin pegarle a Postgres real.
function makeStubPool(opts: { fail?: boolean } = {}): pg.Pool {
  return {
    connect: async () => {
      if (opts.fail) {
        throw new Error('connection refused');
      }
      return {
        query: async () => ({ rows: [{ '?column?': 1 }] }),
        release: () => {},
      };
    },
  } as unknown as pg.Pool;
}

describe('health endpoints', () => {
  it('GET /health returns 200 with status ok', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool() });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('booster-ai-api');
  });

  it('GET /ready returns 200 when DB is reachable', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool() });
    const res = await app.request('/ready');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; checks: { database: string } };
    expect(body.status).toBe('ready');
    expect(body.checks.database).toBe('ok');
  });

  it('GET /ready returns 503 when DB connect fails', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool({ fail: true }) });
    const res = await app.request('/ready');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; checks: { database: string } };
    expect(body.status).toBe('not_ready');
    expect(body.checks.database).toBe('fail');
  });

  it('GET /unknown returns 404 with not_found error', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool() });
    const res = await app.request('/does-not-exist');
    expect(res.status).toBe(404);
  });
});
