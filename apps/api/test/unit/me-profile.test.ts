import { Hono } from 'hono';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as unknown as Parameters<typeof import('../../src/routes/me.js').createMeRoutes>[0]['logger'];

/**
 * Helper: arma un stub del DB que devuelve `userRow` en el primer SELECT y
 * `updatedRow` en el primer UPDATE. La cadena fluent de drizzle se mockea
 * paso a paso porque cada eslabón devuelve el siguiente.
 */
function makeDbStub(opts: {
  userRow: Record<string, unknown> | undefined;
  updatedRow?: Record<string, unknown>;
}) {
  const limitFn = vi.fn().mockResolvedValue(opts.userRow ? [opts.userRow] : []);
  const whereFnSelect = vi.fn(() => ({ limit: limitFn }));
  const fromFn = vi.fn(() => ({ where: whereFnSelect }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const returningFn = vi.fn().mockResolvedValue(opts.updatedRow ? [opts.updatedRow] : []);
  const whereFnUpdate = vi.fn(() => ({ returning: returningFn }));
  const setFn = vi.fn(() => ({ where: whereFnUpdate }));
  const updateFn = vi.fn(() => ({ set: setFn }));

  return {
    db: { select: selectFn, update: updateFn } as unknown as Parameters<
      typeof import('../../src/routes/me.js').createMeRoutes
    >[0]['db'],
    spies: { selectFn, updateFn, setFn, returningFn, limitFn },
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

const validClaimsHeader = JSON.stringify({ uid: 'fb-1', email: 'felipe@boosterchile.com' });

const baseUserRow = {
  id: 'u1',
  firebaseUid: 'fb-1',
  email: 'felipe@boosterchile.com',
  fullName: 'Felipe Vicencio',
  phone: '+56912345678',
  whatsappE164: null,
  rut: null,
  status: 'activo',
  isPlatformAdmin: false,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-01T00:00:00Z'),
  lastLoginAt: null,
};

describe('PATCH /me/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rechaza body vacío con 400 (refine "al menos un campo")', async () => {
    const { db } = makeDbStub({ userRow: baseUserRow });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza whatsapp_e164 con formato no chileno con 400', async () => {
    const { db } = makeDbStub({ userRow: baseUserRow });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({ whatsapp_e164: '+1234' }),
    });
    expect(res.status).toBe(400);
  });

  it('devuelve 404 si el user no existe en la DB', async () => {
    const { db } = makeDbStub({ userRow: undefined });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({ whatsapp_e164: '+56912345678' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('user_not_found');
  });

  it('actualiza whatsapp_e164 y devuelve el user nuevo', async () => {
    const { db, spies } = makeDbStub({
      userRow: baseUserRow,
      updatedRow: { ...baseUserRow, whatsappE164: '+56987654321' },
    });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({ whatsapp_e164: '+56987654321' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { whatsapp_e164: string; phone: string } };
    expect(body.user.whatsapp_e164).toBe('+56987654321');
    expect(body.user.phone).toBe('+56912345678');

    // Verificar que el patch enviado al UPDATE solo incluye los campos
    // tocados (no overwrite de phone/full_name/rut).
    expect(spies.setFn).toHaveBeenCalledOnce();
    const patchArg = spies.setFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patchArg.whatsappE164).toBe('+56987654321');
    expect(patchArg.fullName).toBeUndefined();
    expect(patchArg.phone).toBeUndefined();
    expect(patchArg.rut).toBeUndefined();
    expect(patchArg.updatedAt).toBeInstanceOf(Date);
  });

  it('rechaza cambio de RUT cuando ya está declarado con 409', async () => {
    const userWithRut = { ...baseUserRow, rut: '12.345.678-5' };
    const { db } = makeDbStub({ userRow: userWithRut });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({ rut: '76.123.456-0' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('rut_immutable');
  });

  it('permite setear RUT cuando es null', async () => {
    const { db, spies } = makeDbStub({
      userRow: baseUserRow,
      updatedRow: { ...baseUserRow, rut: '76.123.456-0' },
    });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({ rut: '76.123.456-0' }),
    });
    expect(res.status).toBe(200);
    const patchArg = spies.setFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patchArg.rut).toBe('76.123.456-0');
  });

  // ---------------------------------------------------------------------
  // Account linking — cuando llega un firebase_uid nuevo y el email del
  // claim matchea un user existente Y emailVerified=true, /me debe
  // actualizar el firebase_uid del user existente y devolverlo.
  // ---------------------------------------------------------------------
  it('account linking: matchea por email si emailVerified=true', async () => {
    // Sequence de SELECTS:
    //   1. SELECT users WHERE firebase_uid='fb-google-NEW' .limit(1) → []
    //   2. SELECT users WHERE email='felipe@boosterchile.com' .limit(1) → [existing]
    //   3. SELECT memberships JOIN empresas WHERE user_id=u1 (sin .limit, await directo) → []
    // Plus 1 UPDATE entre (2) y (3).
    //
    // El where mock devuelve un objeto que es thenable Y tiene .limit() para
    // soportar ambos patterns: con limit() y await directo.
    let selectCallCount = 0;
    const whereFnSelect = vi.fn(() => {
      selectCallCount += 1;
      const rows =
        selectCallCount === 1
          ? [] // por uid: no existe
          : selectCallCount === 2
            ? [baseUserRow] // por email: existe
            : []; // memberships: ninguna
      return {
        limit: vi.fn().mockResolvedValue(rows),
        then: <T,>(onFulfilled: (v: typeof rows) => T) =>
          Promise.resolve(rows).then(onFulfilled),
      };
    });
    const innerJoinFn = vi.fn(() => ({ where: whereFnSelect }));
    const fromFn = vi.fn(() => ({ where: whereFnSelect, innerJoin: innerJoinFn }));
    const selectFn = vi.fn(() => ({ from: fromFn }));

    const linkedRow = { ...baseUserRow, firebaseUid: 'fb-google-NEW' };
    const returningFn = vi.fn().mockResolvedValue([linkedRow]);
    const whereFnUpdate = vi.fn(() => ({ returning: returningFn }));
    const setFn = vi.fn(() => ({ where: whereFnUpdate }));
    const updateFn = vi.fn(() => ({ set: setFn }));

    const db = { select: selectFn, update: updateFn } as unknown as Parameters<
      typeof import('../../src/routes/me.js').createMeRoutes
    >[0]['db'];
    const app = await buildApp(db);
    const claims = JSON.stringify({
      uid: 'fb-google-NEW',
      email: 'felipe@boosterchile.com',
      emailVerified: true,
    });
    const res = await app.request('/me', { headers: { 'x-test-claims': claims } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_onboarding: boolean; user: { email: string } };
    expect(body.needs_onboarding).toBe(false);
    expect(body.user.email).toBe('felipe@boosterchile.com');
    // Confirma que se llamó al UPDATE con el nuevo firebase_uid
    expect(setFn).toHaveBeenCalledTimes(1);
    const setArg = setFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.firebaseUid).toBe('fb-google-NEW');
  });

  it('NO linkea si emailVerified=false (devuelve needs_onboarding)', async () => {
    let selectCallCount = 0;
    const limitFn = vi.fn(() => {
      selectCallCount += 1;
      return Promise.resolve([]); // ambos selects vacíos
    });
    const whereFnSelect = vi.fn(() => ({ limit: limitFn }));
    const fromFn = vi.fn(() => ({ where: whereFnSelect }));
    const selectFn = vi.fn(() => ({ from: fromFn }));
    const updateFn = vi.fn();

    const db = { select: selectFn, update: updateFn } as unknown as Parameters<
      typeof import('../../src/routes/me.js').createMeRoutes
    >[0]['db'];
    const app = await buildApp(db);
    const claims = JSON.stringify({
      uid: 'fb-emailpw-NEW',
      email: 'nuevo@test.com',
      emailVerified: false,
    });
    const res = await app.request('/me', { headers: { 'x-test-claims': claims } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_onboarding: boolean };
    expect(body.needs_onboarding).toBe(true);
    // No update porque no se encontró el user
    expect(updateFn).not.toHaveBeenCalled();
    // Solo un SELECT (por uid). El segundo (por email) NO ocurre porque
    // emailVerified=false aborta el linking.
    expect(selectCallCount).toBe(1);
  });

  it('actualiza múltiples campos en un solo PATCH', async () => {
    const { db, spies } = makeDbStub({
      userRow: baseUserRow,
      updatedRow: {
        ...baseUserRow,
        fullName: 'Felipe V.',
        whatsappE164: '+56987654321',
        phone: '+56987654321',
      },
    });
    const app = await buildApp(db);
    const res = await app.request('/me/profile', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-test-claims': validClaimsHeader,
      },
      body: JSON.stringify({
        full_name: 'Felipe V.',
        phone: '+56987654321',
        whatsapp_e164: '+56987654321',
      }),
    });
    expect(res.status).toBe(200);
    const patchArg = spies.setFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(patchArg.fullName).toBe('Felipe V.');
    expect(patchArg.phone).toBe('+56987654321');
    expect(patchArg.whatsappE164).toBe('+56987654321');
  });
});
