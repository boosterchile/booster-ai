import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hashClaveNumerica } from '../../src/services/clave-numerica.js';

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
  typeof import('../../src/routes/auth-universal.js').createAuthUniversalRoutes
>[0]['logger'];

const VALID_RUT = '11.111.111-1';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const CORRECT_CLAVE = '123456';
const WRONG_CLAVE = '654321';

function makeDbStub(opts: {
  userRow?: Record<string, unknown> | null;
  updateOk?: boolean;
}) {
  const queue: Array<Record<string, unknown>[]> = [
    opts.userRow === null ? [] : [opts.userRow ?? {}],
  ];

  const limit = vi.fn(() => Promise.resolve(queue.shift() ?? []));
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));

  const updateWhere = vi.fn(() =>
    opts.updateOk === false ? Promise.reject(new Error('db error')) : Promise.resolve(undefined),
  );
  const set = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update } as unknown as Parameters<
      typeof import('../../src/routes/auth-universal.js').createAuthUniversalRoutes
    >[0]['db'],
  };
}

function makeFirebaseStub() {
  const createCustomToken = vi.fn().mockResolvedValue('custom-token-abc');
  const getUserByEmail = vi.fn().mockRejectedValue(new Error('not found'));
  const createUser = vi
    .fn()
    .mockResolvedValue({ uid: 'fb-uid-new' } as Awaited<ReturnType<Auth['createUser']>>);
  const updateUser = vi
    .fn()
    .mockResolvedValue({ uid: 'fb-uid-new' } as Awaited<ReturnType<Auth['updateUser']>>);

  return {
    auth: {
      createCustomToken,
      getUserByEmail,
      createUser,
      updateUser,
    } as unknown as Auth,
    spies: { createCustomToken, getUserByEmail, createUser, updateUser },
  };
}

async function buildApp(
  db: Parameters<
    typeof import('../../src/routes/auth-universal.js').createAuthUniversalRoutes
  >[0]['db'],
  firebaseAuth: Auth,
) {
  const { createAuthUniversalRoutes } = await import('../../src/routes/auth-universal.js');
  const app = new Hono();
  app.route('/auth', createAuthUniversalRoutes({ db, firebaseAuth, logger: noopLogger }));
  return app;
}

describe('POST /auth/login-rut (ADR-035)', () => {
  it('RUT no existe → 401 invalid_credentials', async () => {
    const { db } = makeDbStub({ userRow: null });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: CORRECT_CLAVE }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_credentials');
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('user existe pero clave_numerica_hash NULL → 410 needs_rotation', async () => {
    const { db } = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'fb-real',
        email: 'user@example.com',
        rut: '11111111-1',
        claveNumericaHash: null,
        status: 'activo',
      },
    });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: CORRECT_CLAVE }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('needs_rotation');
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('clave incorrecta → 401 invalid_credentials (no revela existencia)', async () => {
    const { db } = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'fb-real',
        email: 'user@example.com',
        rut: '11111111-1',
        claveNumericaHash: hashClaveNumerica(CORRECT_CLAVE),
        status: 'activo',
      },
    });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: WRONG_CLAVE }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_credentials');
    expect(fb.spies.createCustomToken).not.toHaveBeenCalled();
  });

  it('user suspendido → 401 (no revela estado)', async () => {
    const { db } = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'fb-real',
        email: 'user@example.com',
        rut: '11111111-1',
        claveNumericaHash: hashClaveNumerica(CORRECT_CLAVE),
        status: 'suspendido',
      },
    });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: CORRECT_CLAVE }),
    });
    expect(res.status).toBe(401);
  });

  it('happy path: user con firebase real + clave correcta → custom_token', async () => {
    const { db } = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'fb-real-12345',
        email: 'user@example.com',
        rut: '11111111-1',
        claveNumericaHash: hashClaveNumerica(CORRECT_CLAVE),
        status: 'activo',
      },
    });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: CORRECT_CLAVE, tipo: 'transporte' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      custom_token: string;
      synthetic_email: string;
      auth_method: string;
    };
    expect(body.custom_token).toBe('custom-token-abc');
    expect(body.synthetic_email).toBe('users+111111111@boosterchile.invalid');
    expect(body.auth_method).toBe('rut_clave');
    // El custom token mint con el firebase_uid real existente, no crea uno nuevo.
    expect(fb.spies.createCustomToken).toHaveBeenCalledWith('fb-real-12345', {
      auth_method: 'rut_clave',
      booster_login_hint: 'transporte',
    });
    expect(fb.spies.createUser).not.toHaveBeenCalled();
  });

  it('placeholder pending-rut: → promueve a firebase real antes del token', async () => {
    const { db } = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:111111111',
        email: null,
        rut: '11111111-1',
        claveNumericaHash: hashClaveNumerica(CORRECT_CLAVE),
        status: 'activo',
      },
    });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: CORRECT_CLAVE }),
    });
    expect(res.status).toBe(200);
    expect(fb.spies.getUserByEmail).toHaveBeenCalledWith('users+111111111@boosterchile.invalid');
    expect(fb.spies.createUser).toHaveBeenCalled();
    expect(fb.spies.createCustomToken).toHaveBeenCalledWith('fb-uid-new', expect.anything());
  });

  it('RUT mal formado → 400 validation', async () => {
    const { db } = makeDbStub({ userRow: null });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: 'no-es-rut', clave: CORRECT_CLAVE }),
    });
    expect(res.status).toBe(400);
  });

  it('clave de 5 dígitos → 400 validation', async () => {
    const { db } = makeDbStub({ userRow: null });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: '12345' }),
    });
    expect(res.status).toBe(400);
  });

  it('clave con letras → 400 validation', async () => {
    const { db } = makeDbStub({ userRow: null });
    const fb = makeFirebaseStub();
    const app = await buildApp(db, fb.auth);
    const res = await app.request('/auth/login-rut', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, clave: 'abc123' }),
    });
    expect(res.status).toBe(400);
  });
});
