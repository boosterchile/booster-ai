import type { Auth } from 'firebase-admin/auth';
import { Hono, type MiddlewareHandler } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { createDriverAuthRoutes } from '../../src/routes/auth-driver.js';
import { hashActivationPin } from '../../src/services/activation-pin.js';

/**
 * Ramas de `POST /auth/driver-activate` que `auth-driver.test.ts` no cubre:
 * rate-limit montado, fallas de Firebase/BD y el bloque de membresía.
 */

type Deps = Parameters<typeof createDriverAuthRoutes>[0];

const VALID_RUT = '11.111.111-1';
const USER_ID = '11111111-2222-3333-4444-555555555555';
const EMPRESA_ID = 'eeeeeeee-0000-0000-0000-000000000001';

const USUARIO_ACTIVABLE = {
  id: USER_ID,
  firebaseUid: 'pending-rut:11.111.111-1',
  email: 'conductor@boosterchile.invalid',
  rut: VALID_RUT,
  activationPinHash: hashActivationPin('123456'),
  claveNumericaHash: null,
};

function makeLogger() {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };
  return logger;
}

/**
 * Cada `select().from().where().limit()` consume la siguiente entrada de
 * `selects`, en el orden del handler: usuario, conductor, empresa del
 * conductor, membresía. Una entrada `Error` hace fallar ese select.
 */
function makeDb(opts: {
  selects: Array<Record<string, unknown>[] | Error>;
  userUpdateFails?: boolean;
}) {
  const queue = [...opts.selects];
  const limit = vi.fn(() => {
    const next = queue.shift() ?? [];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));

  const sets: Record<string, unknown>[] = [];
  let updates = 0;
  const update = vi.fn(() => ({
    set: (vals: Record<string, unknown>) => {
      sets.push(vals);
      updates += 1;
      const falla = opts.userUpdateFails === true && updates === 1;
      const resultado = <T>(valor: T): Promise<T> =>
        falla ? Promise.reject(new Error('db down')) : Promise.resolve(valor);
      // `where` se espera directo (membresía) o sigue con `returning()` (cuenta).
      // La promesa se crea al consumirla, para no dejar un rechazo sin manejar.
      return {
        where: () => ({
          then: (ok: (v: undefined) => unknown, mal: (e: unknown) => unknown) =>
            resultado(undefined).then(ok, mal),
          returning: () => resultado([{ id: 'u-1' }]),
        }),
      };
    },
  }));

  const inserted: Record<string, unknown>[] = [];
  const insert = vi.fn(() => ({
    values: (vals: Record<string, unknown>) => {
      inserted.push(vals);
      return Promise.resolve(undefined);
    },
  }));

  return { db: { select, update, insert } as unknown as Deps['db'], sets, inserted, update };
}

function makeFirebase(opts: { createUserError?: Error } = {}) {
  const auth: Partial<Auth> = {
    getUserByEmail: vi.fn(() => Promise.reject(new Error('auth/user-not-found'))),
    createUser: vi.fn(() =>
      opts.createUserError
        ? Promise.reject(opts.createUserError)
        : Promise.resolve({ uid: 'fb-uid-1' } as Awaited<ReturnType<Auth['createUser']>>),
    ),
    createCustomToken: vi.fn(() => Promise.resolve('custom-token-xyz')),
  };
  return auth as Auth;
}

function buildApp(deps: {
  db: Deps['db'];
  firebaseAuth: Auth;
  logger?: ReturnType<typeof makeLogger>;
  rateLimitPin?: MiddlewareHandler;
}) {
  const app = new Hono();
  app.route(
    '/auth',
    createDriverAuthRoutes({
      db: deps.db,
      firebaseAuth: deps.firebaseAuth,
      logger: (deps.logger ?? makeLogger()) as unknown as Deps['logger'],
      ...(deps.rateLimitPin ? { rateLimitPin: deps.rateLimitPin } : {}),
    }),
  );
  return app;
}

function activar(app: Hono) {
  return app.request('/auth/driver-activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rut: VALID_RUT, pin: '123456', clave_numerica: '482915' }),
  });
}

const CONDUCTOR_VIGENTE = [{ id: 'c-1', deletedAt: null }];
const EMPRESA_DEL_CONDUCTOR = [{ empresaId: EMPRESA_ID }];

describe('POST /auth/driver-activate — rate limit', () => {
  it('el middleware de rate limit corta antes de tocar la BD', async () => {
    const { db } = makeDb({ selects: [] });
    const rateLimitPin: MiddlewareHandler = (c) =>
      Promise.resolve(c.json({ error: 'rate_limited' }, 429));
    const app = buildApp({ db, firebaseAuth: makeFirebase(), rateLimitPin });

    const res = await activar(app);

    expect(res.status).toBe(429);
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('POST /auth/driver-activate — credenciales', () => {
  it('cuenta con clave elegida (sin firebase_uid real) → 410, el PIN no la reescribe', async () => {
    const { db, update } = makeDb({
      selects: [[{ ...USUARIO_ACTIVABLE, claveNumericaHash: 'scrypt$hash-previo' }]],
    });
    const app = buildApp({ db, firebaseAuth: makeFirebase() });

    const res = await activar(app);

    expect(res.status).toBe(410);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('POST /auth/driver-activate — fallas de Firebase y BD', () => {
  it('createUser falla → 502 firebase_error, no toca la BD', async () => {
    const { db, update } = makeDb({ selects: [[USUARIO_ACTIVABLE], CONDUCTOR_VIGENTE] });
    const logger = makeLogger();
    const app = buildApp({
      db,
      firebaseAuth: makeFirebase({ createUserError: new Error('auth/internal-error') }),
      logger,
    });

    const res = await activar(app);

    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('firebase_error');
    expect(update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('el UPDATE de usuarios falla → 502 db_error y no emite token', async () => {
    const { db } = makeDb({
      selects: [[USUARIO_ACTIVABLE], CONDUCTOR_VIGENTE],
      userUpdateFails: true,
    });
    const firebase = makeFirebase();
    const logger = makeLogger();
    const app = buildApp({ db, firebaseAuth: firebase, logger });

    const res = await activar(app);

    expect(res.status).toBe(502);
    expect(((await res.json()) as { code: string }).code).toBe('db_error');
    expect(firebase.createCustomToken).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});

describe('POST /auth/driver-activate — membresía rol=conductor', () => {
  it('membresía pendiente → la promueve a activa', async () => {
    const { db, sets, inserted } = makeDb({
      selects: [
        [USUARIO_ACTIVABLE],
        CONDUCTOR_VIGENTE,
        EMPRESA_DEL_CONDUCTOR,
        [{ id: 'm-1', status: 'pendiente_invitacion' }],
      ],
    });
    const app = buildApp({ db, firebaseAuth: makeFirebase() });

    const res = await activar(app);

    expect(res.status).toBe(200);
    expect(sets).toHaveLength(2);
    expect(sets[1]?.status).toBe('activa');
    expect(inserted).toHaveLength(0);
  });

  it('membresía ya activa → no la vuelve a escribir', async () => {
    const { db, sets, inserted } = makeDb({
      selects: [
        [USUARIO_ACTIVABLE],
        CONDUCTOR_VIGENTE,
        EMPRESA_DEL_CONDUCTOR,
        [{ id: 'm-1', status: 'activa' }],
      ],
    });
    const app = buildApp({ db, firebaseAuth: makeFirebase() });

    const res = await activar(app);

    expect(res.status).toBe(200);
    expect(sets).toHaveLength(1);
    expect(inserted).toHaveLength(0);
  });

  it('sin membresía → la crea con rol conductor en la empresa del conductor', async () => {
    const { db, inserted } = makeDb({
      selects: [[USUARIO_ACTIVABLE], CONDUCTOR_VIGENTE, EMPRESA_DEL_CONDUCTOR, []],
    });
    const app = buildApp({ db, firebaseAuth: makeFirebase() });

    const res = await activar(app);

    expect(res.status).toBe(200);
    expect(inserted).toEqual([
      expect.objectContaining({
        userId: USER_ID,
        empresaId: EMPRESA_ID,
        role: 'conductor',
        status: 'activa',
      }),
    ]);
  });

  it('falla la consulta de membresía → warn y la activación sigue (200 con token)', async () => {
    const { db } = makeDb({
      selects: [
        [USUARIO_ACTIVABLE],
        CONDUCTOR_VIGENTE,
        EMPRESA_DEL_CONDUCTOR,
        new Error('memberships timeout'),
      ],
    });
    const logger = makeLogger();
    const app = buildApp({ db, firebaseAuth: makeFirebase(), logger });

    const res = await activar(app);

    expect(res.status).toBe(200);
    expect(((await res.json()) as { custom_token: string }).custom_token).toBe('custom-token-xyz');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
