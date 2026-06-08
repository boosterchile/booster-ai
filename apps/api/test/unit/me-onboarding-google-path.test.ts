import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T1.8 (onboarding-flow-redesign) — artefacto del gate de Cierre (T6): el camino
 * Google de `/me` NO auto-provisiona un dueño sin token.
 *
 * Tras T1.3 (approve admin-provisioned NO precrea `users`), un prospecto aprobado
 * que entra por Google (uid distinto, email verificado) NO tiene fila `users` ni
 * por uid ni por email. `/me` debe devolver `needs_onboarding=true` SIN crear
 * nada — el alta como dueño exige el token one-shot vía `/empresas/onboarding-admin`
 * (T1.5b). El account-linking de `/me` solo RE-VINCULA una fila existente; nunca
 * la crea. Esto cierra el vector que el devils-advocate de DEFINE marcó (P1-1).
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

function makeDbStub(opts: {
  userByFirebaseUid?: Record<string, unknown> | null;
  userByEmail?: Record<string, unknown> | null;
  memberships?: Record<string, unknown>[];
  updateReturning?: Record<string, unknown>[];
}) {
  const selectResults: Array<Record<string, unknown>[]> = [];
  selectResults.push(opts.userByFirebaseUid ? [opts.userByFirebaseUid] : []); // by firebase_uid
  selectResults.push(opts.userByEmail ? [opts.userByEmail] : []); // by email (linking)
  selectResults.push(opts.memberships ?? []); // empresas innerJoin
  selectResults.push([]); // stakeholder orgs innerJoin

  const limit = vi.fn(() => Promise.resolve(selectResults.shift() ?? []));
  const innerJoin = vi.fn(() => ({
    where: vi.fn(() => Promise.resolve(selectResults.shift() ?? [])),
  }));
  const where = vi.fn(() => ({ limit, innerJoin }));
  const from = vi.fn(() => ({ where, innerJoin }));
  const select = vi.fn(() => ({ from }));

  const insertCalls: Array<Record<string, unknown>> = [];
  const insert = vi.fn(() => ({
    values: vi.fn((vals: Record<string, unknown>) => {
      insertCalls.push(vals);
      return { returning: vi.fn(() => Promise.resolve([])) };
    }),
  }));

  const updateCalls: Array<Record<string, unknown>> = [];
  const updateReturning = vi.fn(() => Promise.resolve(opts.updateReturning ?? []));
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const set = vi.fn((vals: Record<string, unknown>) => {
    updateCalls.push(vals);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, insert, update } as unknown as Parameters<
      typeof import('../../src/routes/me.js').createMeRoutes
    >[0]['db'],
    insertCalls,
    updateCalls,
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

describe('GET /me — camino Google del onboarding (T1.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('aprobado-Google sin fila users → needs_onboarding, sin crear nada (no auto-provisiona dueño)', async () => {
    const { db, insertCalls, updateCalls } = makeDbStub({
      userByFirebaseUid: null, // sin fila por uid (Google uid distinto)
      userByEmail: null, // sin fila por email (T1.3 no precrea)
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'google-uid-x',
          email: 'dueno@empresa.cl',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_onboarding: boolean };
    expect(body.needs_onboarding).toBe(true);
    // El alta debe ir por el token route (T1.5b); /me NO crea ni re-vincula.
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it('emailVerified=false → no linkea aunque exista fila por email (anti-hijack)', async () => {
    const { db, insertCalls, updateCalls } = makeDbStub({
      userByFirebaseUid: null,
      userByEmail: { id: 'u-existing', email: 'dueno@empresa.cl', firebaseUid: 'old-uid' },
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'unverified-uid',
          email: 'dueno@empresa.cl',
          emailVerified: false,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_onboarding: boolean };
    expect(body.needs_onboarding).toBe(true);
    expect(updateCalls).toHaveLength(0); // linking gateado por emailVerified
    expect(insertCalls).toHaveLength(0);
  });

  it('fila existente por email + Google verificado → re-vincula (needs_onboarding=false), NO crea', async () => {
    const existing = {
      id: 'u-existing',
      firebaseUid: 'old-uid',
      email: 'dueno@empresa.cl',
      fullName: 'Dueño Real',
      phone: null,
      whatsappE164: null,
      rut: null,
      status: 'activo',
      isPlatformAdmin: false,
    };
    const { db, insertCalls, updateCalls } = makeDbStub({
      userByFirebaseUid: null,
      userByEmail: existing,
      memberships: [],
      updateReturning: [{ ...existing, firebaseUid: 'google-uid-x' }],
    });
    const app = await buildApp(db);
    const res = await app.request('/me', {
      headers: {
        'x-test-claims': JSON.stringify({
          uid: 'google-uid-x',
          email: 'dueno@empresa.cl',
          emailVerified: true,
        }),
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_onboarding: boolean };
    expect(body.needs_onboarding).toBe(false);
    expect(updateCalls).toHaveLength(1); // re-vinculó la fila existente (su propia fila)
    expect(insertCalls).toHaveLength(0); // linking != provisioning
  });
});
