import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'admin@boosterchile.com';
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
  typeof import('../../src/routes/admin-matching-backtest.js').createAdminMatchingBacktestRoutes
>[0]['logger'];

async function buildApp(opts: {
  userEmail?: string;
  runReturn?: { id: string; resumen: unknown };
  runError?: Error;
  listReturn?: unknown[];
  getReturn?: unknown;
  getError?: Error;
}) {
  vi.resetModules();

  vi.doMock('../../src/services/matching-backtest.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/services/matching-backtest.js')>();
    return {
      ...actual,
      runBacktest: vi.fn(() =>
        opts.runError
          ? Promise.reject(opts.runError)
          : Promise.resolve(opts.runReturn ?? { id: 'run-1', resumen: {} }),
      ),
      listBacktestRuns: vi.fn(() => Promise.resolve(opts.listReturn ?? [])),
      getBacktestRun: vi.fn(() =>
        opts.getError ? Promise.reject(opts.getError) : Promise.resolve(opts.getReturn ?? null),
      ),
    };
  });

  const { createAdminMatchingBacktestRoutes } = await import(
    '../../src/routes/admin-matching-backtest.js'
  );
  const app = new Hono();
  app.use('*', async (c, next) => {
    if (opts.userEmail !== undefined) {
      c.set('userContext', {
        user: { id: 'u', firebaseUid: 'fb', email: opts.userEmail },
        memberships: [],
        activeMembership: null,
      });
    }
    await next();
  });
  app.route(
    '/admin/matching',
    createAdminMatchingBacktestRoutes({
      db: {} as Parameters<typeof createAdminMatchingBacktestRoutes>[0]['db'],
      logger: noopLogger,
    }),
  );
  return app;
}

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

describe('admin-matching-backtest routes', () => {
  describe('POST /admin/matching/backtest', () => {
    it('sin auth → 401', async () => {
      const app = await buildApp({});
      const res = await app.request('/admin/matching/backtest', { method: 'POST' });
      expect(res.status).toBe(401);
    });

    it('email no-admin → 403', async () => {
      const app = await buildApp({ userEmail: 'random@user.com' });
      const res = await app.request('/admin/matching/backtest', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(403);
    });

    it('admin allowlisted + body vacío → 200', async () => {
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        runReturn: {
          id: 'run-123',
          resumen: { tripsProcesados: 10 },
        },
      });
      const res = await app.request('/admin/matching/backtest', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; id: string };
      expect(body.ok).toBe(true);
      expect(body.id).toBe('run-123');
    });

    it('admin con tripsLimit fuera de rango → 400', async () => {
      const app = await buildApp({ userEmail: 'admin@boosterchile.com' });
      const res = await app.request('/admin/matching/backtest', {
        method: 'POST',
        body: JSON.stringify({ tripsLimit: 99999 }),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    it('admin con pesos custom inválidos (suma > 1) NO se valida en schema, pero validateWeights del service rechaza', async () => {
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        runError: new Error('weights must sum to 1.0'),
      });
      const res = await app.request('/admin/matching/backtest', {
        method: 'POST',
        body: JSON.stringify({
          pesos: { capacidad: 0.5, backhaul: 0.5, reputacion: 0.5, tier: 0.5 },
        }),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('backtest_failed');
    });

    it('admin con pesos fuera de [0,1] → 400 (schema rechaza)', async () => {
      const app = await buildApp({ userEmail: 'admin@boosterchile.com' });
      const res = await app.request('/admin/matching/backtest', {
        method: 'POST',
        body: JSON.stringify({
          pesos: { capacidad: 1.5, backhaul: 0, reputacion: 0, tier: 0 },
        }),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(400);
    });

    it('admin pero servicio crashea → 500 con error message', async () => {
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        runError: new Error('DB connection lost'),
      });
      const res = await app.request('/admin/matching/backtest', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      });
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string; detail: string };
      expect(body.error).toBe('backtest_failed');
      expect(body.detail).toContain('DB connection');
    });
  });

  describe('GET /admin/matching/backtest', () => {
    it('sin auth → 401', async () => {
      const app = await buildApp({});
      const res = await app.request('/admin/matching/backtest');
      expect(res.status).toBe(401);
    });

    it('admin → 200 + lista', async () => {
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        listReturn: [
          {
            id: 'run-1',
            createdAt: new Date('2026-05-12'),
            createdByEmail: 'admin@boosterchile.com',
            estado: 'completada',
            tripsProcesados: 100,
            resumenPreview: { topNOverlapPct: 80, scoreDeltaAvg: 0.05 },
          },
        ],
      });
      const res = await app.request('/admin/matching/backtest');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; runs: unknown[] };
      expect(body.ok).toBe(true);
      expect(body.runs).toHaveLength(1);
    });

    it('admin con limit param → respeta', async () => {
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        listReturn: [],
      });
      const res = await app.request('/admin/matching/backtest?limit=10');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /admin/matching/backtest/:id', () => {
    it('sin auth → 401', async () => {
      const app = await buildApp({});
      const res = await app.request(`/admin/matching/backtest/${VALID_UUID}`);
      expect(res.status).toBe(401);
    });

    it('admin + id inválido (no UUID) → 400', async () => {
      const app = await buildApp({ userEmail: 'admin@boosterchile.com' });
      const res = await app.request('/admin/matching/backtest/not-a-uuid');
      expect(res.status).toBe(400);
    });

    it('admin + run no existe → 404', async () => {
      const { BacktestRunNotFoundError } = await import('../../src/services/matching-backtest.js');
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        getError: new BacktestRunNotFoundError(VALID_UUID),
      });
      const res = await app.request(`/admin/matching/backtest/${VALID_UUID}`);
      expect(res.status).toBe(404);
    });

    it('admin + run existe → 200 + run', async () => {
      const app = await buildApp({
        userEmail: 'admin@boosterchile.com',
        getReturn: {
          id: VALID_UUID,
          createdAt: new Date(),
          createdByEmail: 'admin@boosterchile.com',
          estado: 'completada',
          tripsProcesados: 50,
          metricasResumen: null,
        },
      });
      const res = await app.request(`/admin/matching/backtest/${VALID_UUID}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; run: { id: string } };
      expect(body.run.id).toBe(VALID_UUID);
    });
  });
});
