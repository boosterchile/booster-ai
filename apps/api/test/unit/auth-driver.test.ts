import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { hashActivationPin } from '../../src/services/activation-pin.js';

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
  typeof import('../../src/routes/auth-driver.js').createDriverAuthRoutes
>[0]['logger'];

const VALID_RUT = '11.111.111-1';
const USER_ID = '11111111-2222-3333-4444-555555555555';

function makeDbStub(opts: {
  userRow?: Record<string, unknown> | null;
  conductorRow?: Record<string, unknown> | null;
  updateOk?: boolean;
}) {
  const userQueueRows = opts.userRow === null ? [] : [opts.userRow ?? {}];
  const conductorQueueRows = opts.conductorRow === null ? [] : [opts.conductorRow ?? {}];

  // Cada select() debe ir consumiendo de la cola — los dos selects del
  // handler son: 1) buscar user, 2) buscar conductor. Encolamos en orden.
  const queue: Array<Record<string, unknown>[]> = [userQueueRows, conductorQueueRows];

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
      typeof import('../../src/routes/auth-driver.js').createDriverAuthRoutes
    >[0]['db'],
  };
}

function makeFirebaseStub(opts: {
  existingUserUid?: string | null;
  createUid?: string;
  createCustomTokenError?: Error;
}) {
  const auth: Partial<Auth> = {
    getUserByEmail: vi.fn(() =>
      opts.existingUserUid
        ? Promise.resolve({ uid: opts.existingUserUid } as Awaited<
            ReturnType<Auth['getUserByEmail']>
          >)
        : Promise.reject(new Error('user-not-found')),
    ),
    createUser: vi.fn(() =>
      Promise.resolve({ uid: opts.createUid ?? 'firebase-uid-new' } as Awaited<
        ReturnType<Auth['createUser']>
      >),
    ),
    updateUser: vi.fn(() => Promise.resolve({} as Awaited<ReturnType<Auth['updateUser']>>)),
    createCustomToken: vi.fn(() =>
      opts.createCustomTokenError
        ? Promise.reject(opts.createCustomTokenError)
        : Promise.resolve('custom-token-xyz'),
    ),
  };
  return auth as Auth;
}

async function buildApp(deps: {
  db: Parameters<typeof import('../../src/routes/auth-driver.js').createDriverAuthRoutes>[0]['db'];
  firebaseAuth: Auth;
}) {
  const { createDriverAuthRoutes } = await import('../../src/routes/auth-driver.js');
  const app = new Hono();
  app.route(
    '/auth',
    createDriverAuthRoutes({ db: deps.db, firebaseAuth: deps.firebaseAuth, logger: noopLogger }),
  );
  return app;
}

describe('POST /auth/driver-activate', () => {
  it('rechaza body sin PIN', async () => {
    const stub = makeDbStub({});
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT }),
    });
    expect(res.status).toBe(400);
  });

  it('rechaza PIN no-numérico', async () => {
    const stub = makeDbStub({});
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: 'abcdef' }),
    });
    expect(res.status).toBe(400);
  });

  it('RUT inválido → invalid_credentials (no revela existencia)', async () => {
    const stub = makeDbStub({});
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: '11.111.111-9', pin: '123456' }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('invalid_credentials');
  });

  it('user no existe → invalid_credentials', async () => {
    const stub = makeDbStub({ userRow: null });
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(401);
  });

  it('user ya activado (firebase_uid real) → 410 already_activated', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'real-firebase-uid',
        email: 'drivers+xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: null,
      },
    });
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string; synthetic_email: string };
    expect(body.code).toBe('already_activated');
    expect(body.synthetic_email).toContain('@boosterchile.invalid');
  });

  it('PIN incorrecto → invalid_credentials (no distingue de RUT inexistente)', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
    });
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '000000' }),
    });
    expect(res.status).toBe(401);
  });

  it('user placeholder sin PIN hash → invalid_credentials', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: null,
      },
    });
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(401);
  });

  it('PIN correcto pero no es conductor → 503 not_a_driver', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: null, // no hay fila conductores
    });
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(503);
  });

  it('activate exitoso → 200 con custom_token + synthetic_email', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
    const firebase = makeFirebaseStub({
      existingUserUid: null, // no existe en Firebase → createUser
      createUid: 'firebase-uid-new-123',
    });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { custom_token: string; synthetic_email: string };
    expect(body.custom_token).toBe('custom-token-xyz');
    expect(body.synthetic_email).toContain('@boosterchile.invalid');
    expect(firebase.createUser).toHaveBeenCalledTimes(1);
    expect(firebase.createCustomToken).toHaveBeenCalledWith(
      'firebase-uid-new-123',
      expect.objectContaining({ booster_role_hint: 'conductor' }),
    );
  });

  it('activate retry (Firebase user ya existe) → reusa UID + actualiza password', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
    const firebase = makeFirebaseStub({ existingUserUid: 'existing-uid-abc' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(200);
    expect(firebase.createUser).not.toHaveBeenCalled();
    expect(firebase.updateUser).toHaveBeenCalledWith(
      'existing-uid-abc',
      expect.objectContaining({ password: '123456' }),
    );
  });

  it('createCustomToken error → 502 firebase_error', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
    const firebase = makeFirebaseStub({
      existingUserUid: null,
      createUid: 'fb-1',
      createCustomTokenError: new Error('firebase down'),
    });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(502);
  });

  it('conductor soft-deleted → 503 not_a_driver', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'pending-rut-xyz@boosterchile.invalid',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: { id: 'c-1', deletedAt: new Date('2026-05-09T00:00:00Z') },
    });
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });
    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });
    expect(res.status).toBe(503);
  });
});
