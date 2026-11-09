import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
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
const USER_ID = '11111111-2222-4333-8444-555555555555';

function makeDbStub(opts: {
  userRow?: Record<string, unknown> | null;
  conductorRow?: Record<string, unknown> | null;
  updateOk?: boolean;
  /**
   * Filas que devuelve el UPDATE de la cuenta con `returning()`. Vacío = la
   * cuenta ya no cumplía el predicado cuando llegó la escritura.
   */
  filasActualizadas?: unknown[];
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

  // Predicado de cada `update().set().where(...)`, en orden.
  const updateWheres: unknown[] = [];
  const resultado = <T>(valor: T): Promise<T> =>
    opts.updateOk === false ? Promise.reject(new Error('db error')) : Promise.resolve(valor);
  // `where` se puede esperar directo o seguir con `returning()`. La promesa se
  // crea al consumirla, para no dejar un rechazo sin manejar.
  const updateWhere = vi.fn((predicado: unknown) => {
    updateWheres.push(predicado);
    return {
      then: (ok: (v: undefined) => unknown, falla: (e: unknown) => unknown) =>
        resultado(undefined).then(ok, falla),
      returning: vi.fn(() => resultado(opts.filasActualizadas ?? [{ id: USER_ID }])),
    };
  });
  // Captura los valores del UPDATE para poder afirmar QUÉ columnas se tocan
  // (Fase B: el email real no debe estar entre ellas).
  const capturedUpdates: Record<string, unknown>[] = [];
  const set = vi.fn((vals: Record<string, unknown>) => {
    capturedUpdates.push(vals);
    return { where: updateWhere };
  });
  const update = vi.fn(() => ({ set }));

  return {
    db: { select, update } as unknown as Parameters<
      typeof import('../../src/routes/auth-driver.js').createDriverAuthRoutes
    >[0]['db'],
    capturedUpdates,
    updateWheres,
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
      body: JSON.stringify({ rut: '11.111.111-9', pin: '123456', clave_numerica: '482915' }),
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string; synthetic_email?: string };
    expect(body.code).toBe('already_activated');
    // `.specs/bordes-autenticacion` SC1: sin datos de la cuenta.
    expect(body.synthetic_email).toBeUndefined();
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '000000', clave_numerica: '482915' }),
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
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

  it('activate retry (Firebase user ya existe) → reusa UID sin tocar su credencial', async () => {
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
    expect(res.status).toBe(200);
    expect(firebase.createUser).not.toHaveBeenCalled();
    // Fase B: ya NO se resetea el password con el PIN. La credencial del
    // conductor es su clave numérica, que no conoce quien lo dio de alta.
    expect(firebase.updateUser).not.toHaveBeenCalled();
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
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
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
    expect(res.status).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// equipo-de-la-empresa Fase B — el conductor es dueño de su identidad
// ---------------------------------------------------------------------------
// Dos defectos que este flujo arrastraba desde el inicio:
//   · pisaba el email REAL del conductor con uno sintético → lo dejaba sin
//     canal de comunicación con la plataforma;
//   · usaba el PIN que generó su empresa como contraseña permanente de
//     Firebase → su jefe conocía su credencial.
// Medido en prod el 2026-07-31: ningún conductor había activado, así que
// corregirlo no rompe nada vivo (spec §10).
describe('POST /auth/driver-activate — identidad del conductor (Fase B)', () => {
  const CONDUCTOR_EMAIL = 'conductor.real@gmail.com';

  function stubConEmailReal() {
    return makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: CONDUCTOR_EMAIL,
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
  }

  it('NO pisa el email real del conductor', async () => {
    const stub = stubConEmailReal();
    const firebase = makeFirebaseStub({ existingUserUid: null, createUid: 'fb-nuevo' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });

    // El UPDATE de activación no debe tocar `email`: el sintético es
    // identificador interno de Firebase, no reemplaza el correo de la persona.
    const set = stub.capturedUpdates[0] ?? {};
    expect(set.email).toBeUndefined();
  });

  it('el PIN NO queda como contraseña de la cuenta', async () => {
    const stub = stubConEmailReal();
    const firebase = makeFirebaseStub({ existingUserUid: null, createUid: 'fb-nuevo' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });

    const args = firebase.createUser.mock.calls[0]?.[0] ?? {};
    expect(JSON.stringify(args)).not.toContain('123456');
  });

  it('en el retry tampoco setea el PIN como password', async () => {
    const stub = stubConEmailReal();
    const firebase = makeFirebaseStub({ existingUserUid: 'existing-uid-abc' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });

    const llamadas = JSON.stringify(firebase.updateUser.mock.calls ?? []);
    expect(llamadas).not.toContain('123456');
  });
});

// ---------------------------------------------------------------------------
// UI conductor — la activación deja al conductor con SU clave
// ---------------------------------------------------------------------------
// Auditoría 2026-08-01: tras la Fase B el conductor activaba y quedaba sin
// ninguna credencial usable — Firebase sin password (correcto) pero también
// sin `clave_numerica_hash`. Si cerraba la app antes de crearla, las tres
// puertas quedaban cerradas: /login/conductor (410 sin fallback válido),
// /login (410 needs_rotation, "usa tu método anterior" que no existe) y
// /activar (401, exige una membresía pendiente que el alta de conductor no
// crea). Ahora la clave se define en el mismo acto de activar.
describe('POST /auth/driver-activate — el conductor sale con su clave', () => {
  function stubActivable() {
    return makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'conductor.real@gmail.com',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
  }

  it('persiste la clave numérica que eligió el conductor, hasheada', async () => {
    const stub = stubActivable();
    const app = await buildApp({
      db: stub.db,
      firebaseAuth: makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' }),
    });

    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });

    expect(res.status).toBe(200);
    const set = stub.capturedUpdates[0] ?? {};
    expect(set.claveNumericaHash).toBeDefined();
    expect(JSON.stringify(set)).not.toContain('482915');
    // El PIN se consume: el hash y su vencimiento quedan en NULL.
    expect(set.activationPinHash).toBeNull();
    expect(set).toHaveProperty('activacionVenceEn', null);
  });

  it('exige la clave: sin ella el conductor quedaría sin forma de volver a entrar', async () => {
    const stub = stubActivable();
    const app = await buildApp({
      db: stub.db,
      firebaseAuth: makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' }),
    });

    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // A propósito SIN `clave_numerica`.
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456' }),
    });

    expect(res.status).toBe(400);
  });

  it('rechaza una clave que no sea de 6 dígitos', async () => {
    const stub = stubActivable();
    const app = await buildApp({
      db: stub.db,
      firebaseAuth: makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' }),
    });

    const res = await app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '12' }),
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// alta-personal-booster — la misma regla del código del panel que /auth/activar
// ---------------------------------------------------------------------------
// Una cuenta con `es_admin_plataforma = true` se activa solo con un código del
// panel vigente (`activacion_vence_en` existe y no pasó). Los dos endpoints que
// consumen el código aplican la misma regla (spec §6.6).
describe('POST /auth/driver-activate — cuenta del personal de Booster', () => {
  const EN_UNA_SEMANA = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const AYER = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const RECHAZO = { error: 'invalid_credentials', code: 'invalid_credentials' };

  function stubMarcada(
    activacionVenceEn: Date | null,
    conductorRow: Record<string, unknown> | null = { id: 'c-1', deletedAt: null },
  ) {
    return makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'personal@boosterchile.com',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
        claveNumericaHash: null,
        isPlatformAdmin: true,
        activacionVenceEn,
      },
      conductorRow,
    });
  }

  function activar(app: Hono) {
    return app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
  }

  it.each([
    ['con un código sin vencimiento del panel', null],
    ['con el código del panel vencido', AYER],
  ])('cuenta marcada %s → 401 sin tocar Firebase ni la base', async (_caso, venceEn) => {
    const stub = stubMarcada(venceEn);
    const firebase = makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    const res = await activar(app);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RECHAZO);
    expect(stub.capturedUpdates).toEqual([]);
    expect(firebase.getUserByEmail).not.toHaveBeenCalled();
    expect(firebase.createUser).not.toHaveBeenCalled();
    expect(firebase.createCustomToken).not.toHaveBeenCalled();
  });

  it('cuenta marcada sin código vigente del panel y sin fila de conductor → la misma 401', async () => {
    const stub = stubMarcada(null, null);
    const firebase = makeFirebaseStub({ existingUserUid: null });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    const res = await activar(app);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RECHAZO);
  });

  it('cuenta marcada con el código del panel vigente → activa con la clave elegida', async () => {
    const stub = stubMarcada(EN_UNA_SEMANA);
    const firebase = makeFirebaseStub({ existingUserUid: null, createUid: 'fb-personal' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    const res = await activar(app);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { custom_token: string }).custom_token).toBe('custom-token-xyz');
    const set = stub.capturedUpdates[0] ?? {};
    expect(set.activationPinHash).toBeNull();
    expect(set).toHaveProperty('activacionVenceEn', null);
    expect(set.claveNumericaHash).toBeDefined();
  });

  it('cuenta sin marca y sin vencimiento del panel → activa como siempre', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'conductor.real@gmail.com',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
        claveNumericaHash: null,
        isPlatformAdmin: false,
        activacionVenceEn: null,
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
    const app = await buildApp({
      db: stub.db,
      firebaseAuth: makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' }),
    });

    const res = await activar(app);

    expect(res.status).toBe(200);
  });
});

describe('POST /auth/driver-activate — estado de la cuenta (acceso-panel-plataforma SC10)', () => {
  const RECHAZO = { error: 'invalid_credentials', code: 'invalid_credentials' };

  function stubConEstado(status: string, filasActualizadas?: unknown[]) {
    return makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'conductor.real@gmail.com',
        rut: VALID_RUT,
        activationPinHash: hashActivationPin('123456'),
        claveNumericaHash: null,
        isPlatformAdmin: false,
        activacionVenceEn: null,
        status,
      },
      conductorRow: { id: 'c-1', deletedAt: null },
      ...(filasActualizadas ? { filasActualizadas } : {}),
    });
  }

  function activar(app: Hono) {
    return app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
  }

  it.each(['suspendido', 'eliminado'])(
    'cuenta %s con el PIN correcto → la misma 401 que un PIN incorrecto, sin tocar Firebase ni la base',
    async (status) => {
      const stub = stubConEstado(status);
      const firebase = makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' });
      const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

      const res = await activar(app);

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual(RECHAZO);
      expect(stub.capturedUpdates).toEqual([]);
      expect(firebase.createUser).not.toHaveBeenCalled();
      expect(firebase.createCustomToken).not.toHaveBeenCalled();
    },
  );

  it('el UPDATE exige que la cuenta no esté suspendida ni eliminada', async () => {
    const stub = stubConEstado('pendiente_verificacion');
    const app = await buildApp({
      db: stub.db,
      firebaseAuth: makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' }),
    });

    const res = await activar(app);

    expect(res.status).toBe(200);
    const predicado = stub.updateWheres[0];
    if (!(predicado instanceof SQL)) {
      throw new Error('driver-activate no pasó un predicado SQL al UPDATE');
    }
    const consulta = new PgDialect().sqlToQuery(predicado);
    expect(consulta.sql).toContain('"usuarios"."estado" not in');
    expect(consulta.params).toEqual(expect.arrayContaining(['suspendido', 'eliminado']));
  });

  it('si la cuenta cambió de estado antes de escribir → la misma 401 y sin sesión', async () => {
    const stub = stubConEstado('pendiente_verificacion', []);
    const firebase = makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' });
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    const res = await activar(app);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RECHAZO);
    expect(firebase.createCustomToken).not.toHaveBeenCalled();
  });
});

/**
 * `.specs/bordes-autenticacion` SC1 y SC3 — la activación del conductor no
 * devuelve datos de contacto y su código se usa una sola vez.
 */
describe('POST /auth/driver-activate — bordes (bordes-autenticacion)', () => {
  function activar(app: Hono) {
    return app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
  }

  it('SC1: el 410 de una cuenta ya activada no trae datos de la cuenta', async () => {
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'real-firebase-uid',
        email: 'persona.real@empresa.cl',
        rut: VALID_RUT,
        activationPinHash: null,
        claveNumericaHash: 'hash',
        isPlatformAdmin: false,
        activacionVenceEn: null,
        status: 'activo',
      },
    });
    const app = await buildApp({ db: stub.db, firebaseAuth: makeFirebaseStub({}) });

    const res = await activar(app);

    expect(res.status).toBe(410);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ error: 'already_activated', code: 'already_activated' });
    expect(JSON.stringify(body)).not.toContain('persona.real@empresa.cl');
  });

  it('SC3: el UPDATE exige el código verificado y la cuenta sin clave', async () => {
    const hash = hashActivationPin('123456');
    const stub = makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'conductor.real@gmail.com',
        rut: VALID_RUT,
        activationPinHash: hash,
        claveNumericaHash: null,
        isPlatformAdmin: false,
        activacionVenceEn: null,
        status: 'pendiente_verificacion',
      },
      conductorRow: { id: 'c-1', deletedAt: null },
    });
    const app = await buildApp({
      db: stub.db,
      firebaseAuth: makeFirebaseStub({ existingUserUid: null, createUid: 'fb-1' }),
    });

    const res = await activar(app);

    expect(res.status).toBe(200);
    const predicado = stub.updateWheres[0];
    if (!(predicado instanceof SQL)) {
      throw new Error('driver-activate no pasó un predicado SQL al UPDATE');
    }
    const consulta = new PgDialect().sqlToQuery(predicado);
    expect(consulta.sql).toContain('"usuarios"."activacion_pin_hash" = ');
    expect(consulta.sql).toContain('"usuarios"."clave_numerica_hash" is null');
    expect(consulta.params).toContain(hash);
  });
});

/**
 * `.specs/correos-solicitudes-panel` SC2 — primera activación con dos pedidos
 * simultáneos: los dos leen que no hay cuenta del proveedor y los dos la
 * crean. El proveedor acepta una y rechaza la otra con
 * `auth/email-already-exists`. El pedido rechazado vuelve a leer la cuenta y
 * sigue a la escritura con predicado, que decide quién entra.
 */
describe('POST /auth/driver-activate — primera activación simultánea (correos-solicitudes-panel SC2)', () => {
  const HASH_DEL_PIN = hashActivationPin('123456');
  const SINTETICO = 'drivers+111111111@boosterchile.invalid';

  function stubPendiente(filasActualizadas?: unknown[]) {
    return makeDbStub({
      userRow: {
        id: USER_ID,
        firebaseUid: 'pending-rut:11.111.111-1',
        email: 'conductor.real@gmail.com',
        rut: VALID_RUT,
        activationPinHash: HASH_DEL_PIN,
        claveNumericaHash: null,
        isPlatformAdmin: false,
        activacionVenceEn: null,
        status: 'pendiente_verificacion',
      },
      conductorRow: { id: 'c-1', deletedAt: null },
      ...(filasActualizadas ? { filasActualizadas } : {}),
    });
  }

  /** La cuenta del proveedor la creó el otro pedido entre la lectura y la creación. */
  function proveedorConCuentaDelOtroPedido(uidDelOtro: string) {
    const getUserByEmail = vi
      .fn<Auth['getUserByEmail']>()
      .mockRejectedValueOnce(Object.assign(new Error('no user'), { code: 'auth/user-not-found' }))
      .mockResolvedValue({ uid: uidDelOtro } as Awaited<ReturnType<Auth['getUserByEmail']>>);
    const createUser = vi
      .fn<Auth['createUser']>()
      .mockRejectedValue(
        Object.assign(new Error('email exists'), { code: 'auth/email-already-exists' }),
      );
    const createCustomToken = vi.fn<Auth['createCustomToken']>(
      async (uid: string) => `custom-token-${uid}`,
    );
    const auth: Partial<Auth> = { getUserByEmail, createUser, createCustomToken };
    return { auth: auth as Auth, getUserByEmail, createUser, createCustomToken };
  }

  function activar(app: Hono) {
    return app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
    });
  }

  it('si la escritura del otro pedido entró primero → la misma 401, sin sesión ni membresías', async () => {
    const stub = stubPendiente([]);
    const proveedor = proveedorConCuentaDelOtroPedido('fb-del-otro');
    const app = await buildApp({ db: stub.db, firebaseAuth: proveedor.auth });

    const res = await activar(app);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'invalid_credentials',
      code: 'invalid_credentials',
    });
    expect(proveedor.getUserByEmail).toHaveBeenCalledTimes(2);
    expect(proveedor.getUserByEmail).toHaveBeenLastCalledWith(SINTETICO);
    expect(proveedor.createCustomToken).not.toHaveBeenCalled();
    // Solo el UPDATE de la cuenta, que no tomó filas.
    expect(stub.capturedUpdates).toHaveLength(1);
  });

  it('si su escritura entra primero → activa con la cuenta del proveedor que ya existe', async () => {
    const stub = stubPendiente();
    const proveedor = proveedorConCuentaDelOtroPedido('fb-del-otro');
    const app = await buildApp({ db: stub.db, firebaseAuth: proveedor.auth });

    const res = await activar(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      custom_token: 'custom-token-fb-del-otro',
      synthetic_email: SINTETICO,
    });
    expect(stub.capturedUpdates[0]?.firebaseUid).toBe('fb-del-otro');
  });

  it('otro error del proveedor al crear la cuenta → 502 firebase_error, sin escribir', async () => {
    const stub = stubPendiente();
    const firebase = makeFirebaseStub({ existingUserUid: null });
    vi.mocked(firebase.createUser).mockRejectedValueOnce(
      Object.assign(new Error('quota'), { code: 'auth/internal-error' }),
    );
    const app = await buildApp({ db: stub.db, firebaseAuth: firebase });

    const res = await activar(app);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'firebase_error', code: 'firebase_error' });
    expect(firebase.getUserByEmail).toHaveBeenCalledTimes(1);
    expect(stub.capturedUpdates).toHaveLength(0);
  });

  it('si la cuenta del proveedor no se puede volver a leer → 502 firebase_error, sin escribir', async () => {
    const stub = stubPendiente();
    const proveedor = proveedorConCuentaDelOtroPedido('fb-del-otro');
    proveedor.getUserByEmail.mockReset();
    proveedor.getUserByEmail.mockRejectedValue(
      Object.assign(new Error('no user'), { code: 'auth/user-not-found' }),
    );
    const app = await buildApp({ db: stub.db, firebaseAuth: proveedor.auth });

    const res = await activar(app);

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'firebase_error', code: 'firebase_error' });
    expect(stub.capturedUpdates).toHaveLength(0);
  });
});
