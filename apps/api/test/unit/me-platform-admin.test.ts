import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

afterEach(() => {
  vi.resetModules();
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
} as unknown as Parameters<typeof import('../../src/routes/me.js').createMeRoutes>[0]['logger'];

/**
 * Mock de DB con queue de selects + capacidad de capturar inserts.
 * Para /me necesitamos hasta 3 selects:
 *   1. users by firebase_uid
 *   2. users by email (account linking) — solo si emailVerified
 *   3. memberships (cuando user existe)
 * Y posiblemente 1 insert (auto-provision admin).
 */
function makeDbStub(opts: {
  userByFirebaseUid?: Record<string, unknown> | null;
  userByEmail?: Record<string, unknown> | null;
  memberships?: Record<string, unknown>[];
  insertReturning?: Record<string, unknown>[];
}) {
  const selectResults: Array<Record<string, unknown>[]> = [];
  selectResults.push(opts.userByFirebaseUid ? [opts.userByFirebaseUid] : []);
  // Para el account linking solo se invoca si !user && emailVerified. En el
  // test setup decidimos qué devolver: si no se llama, queda en queue.
  selectResults.push(opts.userByEmail ? [opts.userByEmail] : []);
  // Memberships join.
  selectResults.push(opts.memberships ?? []);

  const limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  const innerJoin = vi.fn(() => ({
    where: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
  }));
  const where = vi.fn(() => ({
    limit,
    then: (resolve: (v: unknown[]) => void) => resolve(selectResults.shift() ?? []),
  }));
  const from = vi.fn(() => ({ where, innerJoin }));
  const select = vi.fn(() => ({ from }));

  const insertCalls: Array<Record<string, unknown>> = [];
  const insertReturning = vi.fn(() => Promise.resolve(opts.insertReturning ?? []));
  const insertValues = vi.fn((vals: Record<string, unknown>) => {
    insertCalls.push(vals);
    return { returning: insertReturning };
  });
  const insert = vi.fn(() => ({ values: insertValues }));

  const updateReturning = vi.fn(() => Promise.resolve([]));
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, insert, update } as unknown as Parameters<
      typeof import('../../src/routes/me.js').createMeRoutes
    >[0]['db'],
    insertCalls,
  };
}

async function buildApp(
  db: Parameters<typeof import('../../src/routes/me.js').createMeRoutes>[0]['db'],
) {
  const { createMeRoutes } = await import('../../src/routes/me.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    const claimsHeader = c.req.header('x-test-claims');
    if (claimsHeader) {
      const parsed = JSON.parse(claimsHeader) as {
        uid: string;
        email?: string;
        emailVerified?: boolean;
      };
      c.set('firebaseClaims', {
        uid: parsed.uid,
        email: parsed.email,
        emailVerified: parsed.emailVerified ?? false,
        name: undefined,
        picture: undefined,
        custom: {},
      });
    }
    await next();
  });
  app.route('/me', createMeRoutes({ db, logger: noopLogger }));
  return app;
}

describe('GET /me — platform admin auto-provisioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('email NO en allowlist + user no existe → needs_onboarding=true (sin auto-provision)', async () => {
    const { db, insertCalls } = makeDbStub({
      userByFirebaseUid: null,
      userByEmail: null,
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'fb-rando',
          email: 'random@example.com',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_onboarding: boolean };
    expect(body.needs_onboarding).toBe(true);
    expect(insertCalls).toHaveLength(0);
  });

  it('email en allowlist + user no existe → auto-provisiona admin', async () => {
    const provisionedUser = {
      id: 'u-admin',
      firebaseUid: 'fb-admin',
      email: 'admin@boosterchile.com',
      fullName: 'Admin',
      phone: null,
      whatsappE164: null,
      rut: null,
      status: 'activo',
      isPlatformAdmin: true,
    };
    const { db, insertCalls } = makeDbStub({
      userByFirebaseUid: null,
      userByEmail: null,
      memberships: [],
      insertReturning: [provisionedUser],
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'fb-admin',
          email: 'admin@boosterchile.com',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      needs_onboarding: boolean;
      user: { is_platform_admin: boolean; email: string };
      active_membership: unknown;
    };
    expect(body.needs_onboarding).toBe(false);
    expect(body.user.is_platform_admin).toBe(true);
    expect(body.user.email).toBe('admin@boosterchile.com');
    expect(body.active_membership).toBeNull();
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]?.firebaseUid).toBe('fb-admin');
    expect(insertCalls[0]?.isPlatformAdmin).toBe(true);
    expect(insertCalls[0]?.status).toBe('activo');
  });

  it('email en allowlist case-insensitive (mayúsculas) → auto-provisiona', async () => {
    const provisionedUser = {
      id: 'u-admin',
      firebaseUid: 'fb-admin',
      email: 'ADMIN@boosterchile.com',
      fullName: 'admin',
      phone: null,
      whatsappE164: null,
      rut: null,
      status: 'activo',
      isPlatformAdmin: true,
    };
    const { db, insertCalls } = makeDbStub({
      userByFirebaseUid: null,
      userByEmail: null,
      memberships: [],
      insertReturning: [provisionedUser],
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'fb-admin',
          email: 'ADMIN@boosterchile.com',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { is_platform_admin: boolean } };
    expect(body.user.is_platform_admin).toBe(true);
    expect(insertCalls).toHaveLength(1);
  });

  it('user existe con is_platform_admin=false pero email en allowlist → fuerza true en respuesta', async () => {
    const existingUser = {
      id: 'u-1',
      firebaseUid: 'fb-admin',
      email: 'admin@boosterchile.com',
      fullName: 'Admin',
      phone: null,
      whatsappE164: null,
      rut: null,
      status: 'activo',
      isPlatformAdmin: false, // stale en BD
    };
    const { db, insertCalls } = makeDbStub({
      userByFirebaseUid: existingUser,
      memberships: [],
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'fb-admin',
          email: 'admin@boosterchile.com',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { is_platform_admin: boolean };
      needs_onboarding: boolean;
    };
    expect(body.needs_onboarding).toBe(false);
    expect(body.user.is_platform_admin).toBe(true); // allowlist override
    expect(insertCalls).toHaveLength(0); // no re-insert
  });

  it('user existe is_platform_admin=true → respuesta true sin tocar BD', async () => {
    const existingUser = {
      id: 'u-1',
      firebaseUid: 'fb-admin',
      email: 'felipe@boosterchile.com', // NO en allowlist
      fullName: 'Felipe',
      phone: null,
      whatsappE164: null,
      rut: null,
      status: 'activo',
      isPlatformAdmin: true,
    };
    const { db, insertCalls } = makeDbStub({
      userByFirebaseUid: existingUser,
      memberships: [],
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'fb-admin',
          email: 'felipe@boosterchile.com',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { is_platform_admin: boolean } };
    expect(body.user.is_platform_admin).toBe(true);
    expect(insertCalls).toHaveLength(0);
  });

  it('email allowlist sin nombre Firebase → usa email local-part como fullName', async () => {
    const insertedRow = {
      id: 'u-admin',
      firebaseUid: 'fb-admin',
      email: 'admin@boosterchile.com',
      fullName: 'admin', // local part de admin@boosterchile.com
      phone: null,
      whatsappE164: null,
      rut: null,
      status: 'activo',
      isPlatformAdmin: true,
    };
    const { db, insertCalls } = makeDbStub({
      userByFirebaseUid: null,
      userByEmail: null,
      memberships: [],
      insertReturning: [insertedRow],
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'fb-admin',
          email: 'admin@boosterchile.com',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    expect(insertCalls[0]?.fullName).toBe('admin');
  });
});
