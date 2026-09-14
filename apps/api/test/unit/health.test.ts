import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
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
        release: (): void => undefined,
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

describe('onError — una HTTPException conserva su status (regresión 2026-09-14)', () => {
  // Prod 2026-09-14 13:04Z: PATCH /assignments/:id/confirmar-recogida con
  // Content-Type json y cuerpo vacío → el validador lanzó HTTPException(400)
  // «Malformed JSON» y onError lo convirtió en 500 opaco. El 4xx debe llegar
  // al cliente con su mensaje; solo lo inesperado es 500.
  it('HTTPException(400) lanzada por un handler → 400 con su mensaje', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool() });
    app.get('/__test/lanza-400', () => {
      throw new HTTPException(400, { message: 'cuerpo inválido' });
    });
    const res = await app.request('/__test/lanza-400');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('cuerpo inválido');
  });

  it('zValidator json con Content-Type json y cuerpo vacío → 400, no 500', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool() });
    app.post('/__test/json', zValidator('json', z.object({ x: z.string().optional() })), (c) =>
      c.json({ ok: true }),
    );
    const res = await app.request('/__test/json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('un Error cualquiera sigue siendo 500 internal_server_error', async () => {
    const { createServer } = await import('../../src/server.js');
    const app = createServer({ db: stubDb, pool: makeStubPool() });
    app.get('/__test/explota', () => {
      throw new Error('boom');
    });
    const res = await app.request('/__test/explota');
    expect(res.status).toBe(500);
    expect((await res.json()) as { error: string }).toEqual({ error: 'internal_server_error' });
  });
});
