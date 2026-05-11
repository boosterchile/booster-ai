import type { Auth } from 'firebase-admin/auth';
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
  typeof import('../../src/routes/admin-seed.js').createAdminSeedRoutes
>[0]['logger'];

async function buildApp(opts: {
  userEmail?: string;
  seedReturn?: unknown;
  seedError?: Error;
  deleteReturn?: { empresas_eliminadas: number };
}) {
  vi.resetModules();

  vi.doMock('../../src/services/seed-demo.js', () => ({
    seedDemo: vi.fn(() =>
      opts.seedError
        ? Promise.reject(opts.seedError)
        : Promise.resolve(opts.seedReturn ?? { ok: true }),
    ),
    deleteDemo: vi.fn(() => Promise.resolve(opts.deleteReturn ?? { empresas_eliminadas: 0 })),
  }));

  const { createAdminSeedRoutes } = await import('../../src/routes/admin-seed.js');
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
    '/admin/seed',
    createAdminSeedRoutes({
      db: {} as Parameters<typeof createAdminSeedRoutes>[0]['db'],
      firebaseAuth: {} as Auth,
      logger: noopLogger,
    }),
  );
  return app;
}

describe('admin-seed routes', () => {
  it('POST /demo sin auth → 401', async () => {
    const app = await buildApp({});
    const res = await app.request('/admin/seed/demo', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('POST /demo con email no-admin → 403', async () => {
    const app = await buildApp({ userEmail: 'random@user.com' });
    const res = await app.request('/admin/seed/demo', { method: 'POST' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden_platform_admin');
  });

  it('POST /demo con admin allowlisted → 200 + credentials', async () => {
    const app = await buildApp({
      userEmail: 'admin@boosterchile.com',
      seedReturn: {
        shipper_owner: { email: 'demo-shipper@boosterchile.com', password: 'X' },
        carrier_owner: { email: 'demo-carrier@boosterchile.com', password: 'X' },
        conductor: { rut: '12.345.678-5', activation_pin: '123456' },
        carrier_empresa_id: 'e1',
        shipper_empresa_id: 'e2',
        vehicle_with_mirror_id: 'v1',
        vehicle_without_device_id: 'v2',
      },
    });
    const res = await app.request('/admin/seed/demo', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credentials: { conductor: { activation_pin: string } } };
    expect(body.credentials.conductor.activation_pin).toBe('123456');
  });

  it('POST /demo con seed que lanza → 500 seed_failed', async () => {
    const app = await buildApp({
      userEmail: 'admin@boosterchile.com',
      seedError: new Error('postgres pum'),
    });
    const res = await app.request('/admin/seed/demo', { method: 'POST' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe('seed_failed');
    expect(body.detail).toBe('postgres pum');
  });

  it('DELETE /demo con admin → 200 + empresas_eliminadas', async () => {
    const app = await buildApp({
      userEmail: 'admin@boosterchile.com',
      deleteReturn: { empresas_eliminadas: 2 },
    });
    const res = await app.request('/admin/seed/demo', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { empresas_eliminadas: number };
    expect(body.empresas_eliminadas).toBe(2);
  });

  it('DELETE /demo no-admin → 403', async () => {
    const app = await buildApp({ userEmail: 'random@user.com' });
    const res = await app.request('/admin/seed/demo', { method: 'DELETE' });
    expect(res.status).toBe(403);
  });
});
