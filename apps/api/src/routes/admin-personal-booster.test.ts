import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImpersonationWriteGuardMiddleware } from '../middleware/impersonation-write-guard.js';
import { hashActivationPin, verifyActivationPin } from '../services/activation-pin.js';
import type { EmailSender } from '../services/notifications/email-sender.js';

/**
 * `.specs/alta-personal-booster/spec.md` — T3 (SC2–SC5), T4 (SC8) y T5 (SC9).
 *
 * El platform-admin da de alta desde el panel a otra persona de Booster. La
 * cuenta nace provisoria con un código de un solo uso; la persona elige su
 * clave en `/activar`. La lista de Terraform sigue decidiendo quién entra:
 * el alta no la exige (el correo queda reservado para esa persona desde el
 * primer paso), pero el correo con el código sale solo si ya está en la lista.
 */

const ADMIN_EMAIL = 'dev@boosterchile.com';
const ADMIN_ID = '2b0c1f4e-7d65-4f0e-9a9b-6f1b2d3c4e5f';
const NUEVO_ID = '7a4e2c1b-3d5f-4a6b-8c9d-0e1f2a3b4c5d';
const PERSONA_ID = '9c8b7a6d-5e4f-4a3b-9c1d-0e9f8a7b6c5d';
const RUT = '12345678-5';
const CORREO = 'ana.soto@boosterchile.com';
const LISTA = [ADMIN_EMAIL, CORREO];
const WEB_APP_URL = 'https://app.boosterchile.com';
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

const noop = (): void => undefined;
function makeLogger() {
  const l = {
    trace: noop,
    debug: noop,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: noop,
    child: () => l,
  };
  return l;
}

function makeSender() {
  const send = vi.fn(async () => ({ enviado: true as const, id: 'm-1' }));
  return { sender: { send } as never as EmailSender, send };
}

interface DbOpts {
  /** Respuestas de `select().from().where().limit()`, en orden. */
  lookups?: unknown[][];
  /** Filas del listado (`select().from().where().orderBy().limit()`). */
  listRows?: unknown[];
  /** Error que lanza el INSERT de `usuarios` (carrera de UNIQUE). */
  insertError?: unknown;
  /**
   * Filas que devuelve `update().set().where().returning()`. Vacío = el
   * UPDATE condicional no encontró la fila en el estado esperado.
   */
  filasActualizadas?: unknown[];
}

function makeDb(opts: DbOpts = {}) {
  const lookups = [...(opts.lookups ?? [])];
  const insertedUsers: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const locks: unknown[] = [];
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    const orderBy = vi.fn(() => chain);
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.orderBy = orderBy;
    chain.for = vi.fn((strength: unknown) => {
      locks.push(strength);
      return chain;
    });
    chain.limit = vi.fn(async () => {
      if (orderBy.mock.calls.length > 0) {
        return opts.listRows ?? [];
      }
      return lookups.shift() ?? [];
    });
    return chain;
  };
  const select = vi.fn(() => selectChain());

  const insert = vi.fn(() => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if (opts.insertError) {
          throw opts.insertError;
        }
        insertedUsers.push(vals);
        return [{ id: NUEVO_ID }];
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      updates.push(vals);
      const filas = opts.filasActualizadas ?? [{ id: PERSONA_ID }];
      // `where` se puede esperar directo o seguir con `returning()`.
      return {
        where: vi.fn(() =>
          Object.assign(Promise.resolve(undefined), { returning: vi.fn(async () => filas) }),
        ),
      };
    }),
  }));

  const base = { select, insert, update };
  return {
    db: {
      ...base,
      transaction: vi.fn(async (fn: (tx: typeof base) => Promise<unknown>) => fn(base)),
    } as never,
    select,
    insert,
    update,
    insertedUsers,
    updates,
    locks,
  };
}

async function loadMod() {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] },
  }));
  return import('./admin-personal-booster.js');
}

interface AppOpts {
  db: ReturnType<typeof makeDb>['db'];
  sender?: EmailSender;
  logger?: ReturnType<typeof makeLogger>;
  lista?: readonly string[];
  /** Email de la sesión. `null` = sin sesión. */
  sesion?: string | null;
}

async function buildApp(opts: AppOpts) {
  const mod = await loadMod();
  const routes = mod.createAdminPersonalBoosterRoutes({
    db: opts.db,
    logger: (opts.logger ?? makeLogger()) as never as Logger,
    platformAdminEmails: opts.lista ?? LISTA,
    emailSender: opts.sender ?? makeSender().sender,
    webAppUrl: WEB_APP_URL,
  });
  const app = new Hono();
  const sesion = opts.sesion === undefined ? ADMIN_EMAIL : opts.sesion;
  if (sesion !== null) {
    app.use('*', async (c, next) => {
      c.set('userContext' as never, { user: { id: ADMIN_ID, email: sesion } } as never);
      await next();
    });
  }
  app.route('/', routes);
  return app;
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const BODY = { email: CORREO, full_name: 'Ana Soto', rut: RUT };

/** Persona que ya existe en `usuarios` con el mismo correo y RUT. */
function existente(overrides: Record<string, unknown> = {}) {
  return {
    id: PERSONA_ID,
    email: CORREO,
    fullName: 'Ana Soto',
    rut: RUT,
    firebaseUid: `pending-rut:${RUT}`,
    claveNumericaHash: null,
    activationPinHash: null,
    activacionVenceEn: null,
    isPlatformAdmin: false,
    ...overrides,
  };
}

function cercaDe(iso: string | null, esperadoMs: number) {
  expect(iso).not.toBeNull();
  const delta = Math.abs(new Date(iso ?? '').getTime() - esperadoMs);
  expect(delta).toBeLessThan(60_000);
}

function textoDeLogs(logger: ReturnType<typeof makeLogger>): string {
  return JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /admin/personal-booster (SC1)', () => {
  it('une la lista de Terraform con las cuentas marcadas, ordenada por correo', async () => {
    const vence = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const ultimoLogin = new Date('2026-10-29T13:00:00.000Z');
    const d = makeDb({
      listRows: [
        {
          id: ADMIN_ID,
          email: ADMIN_EMAIL,
          fullName: 'Felipe Vicencio',
          rut: '11111111-1',
          firebaseUid: 'fb-felipe',
          claveNumericaHash: 'hash',
          activationPinHash: null,
          activacionVenceEn: null,
          lastLoginAt: ultimoLogin,
          isPlatformAdmin: true,
        },
        {
          id: PERSONA_ID,
          email: CORREO,
          fullName: 'Ana Soto',
          rut: RUT,
          firebaseUid: `pending-rut:${RUT}`,
          claveNumericaHash: null,
          activationPinHash: hashActivationPin('123456'),
          activacionVenceEn: vence,
          lastLoginAt: null,
          isPlatformAdmin: true,
        },
        {
          id: NUEVO_ID,
          email: 'carlos.rojas@boosterchile.com',
          fullName: 'Carlos Rojas',
          rut: '22222222-2',
          firebaseUid: 'fb-carlos',
          claveNumericaHash: 'hash',
          activationPinHash: null,
          activacionVenceEn: null,
          lastLoginAt: null,
          isPlatformAdmin: true,
        },
      ],
    });
    const app = await buildApp({
      db: d.db,
      lista: [ADMIN_EMAIL, CORREO, 'Bruno.Diaz@BoosterChile.com'],
    });

    const res = await app.request('/');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { personal: Record<string, unknown>[] };
    expect(json.personal.map((p) => p.email)).toEqual([
      CORREO,
      'bruno.diaz@boosterchile.com',
      'carlos.rojas@boosterchile.com',
      ADMIN_EMAIL,
    ]);
    expect(json.personal[0]).toEqual({
      email: CORREO,
      en_lista: true,
      user_id: PERSONA_ID,
      nombre: 'Ana Soto',
      rut: RUT,
      estado: 'pendiente_activacion',
      expira_en: vence.toISOString(),
      ultimo_login_en: null,
    });
    expect(json.personal[1]).toEqual({
      email: 'bruno.diaz@boosterchile.com',
      en_lista: true,
      user_id: null,
      nombre: null,
      rut: null,
      estado: 'sin_cuenta',
      expira_en: null,
      ultimo_login_en: null,
    });
    expect(json.personal[2]).toMatchObject({
      email: 'carlos.rojas@boosterchile.com',
      en_lista: false,
      estado: 'activa',
      expira_en: null,
    });
    expect(json.personal[3]).toMatchObject({
      email: ADMIN_EMAIL,
      en_lista: true,
      estado: 'activa',
      expira_en: null,
      ultimo_login_en: ultimoLogin.toISOString(),
    });
  });

  it('pendiente sin código: estado pendiente_activacion y expira_en null', async () => {
    const d = makeDb({
      listRows: [
        {
          id: PERSONA_ID,
          email: CORREO,
          fullName: 'Ana Soto',
          rut: RUT,
          firebaseUid: `pending-rut:${RUT}`,
          claveNumericaHash: null,
          activationPinHash: null,
          activacionVenceEn: null,
          lastLoginAt: null,
          isPlatformAdmin: true,
        },
      ],
    });
    const app = await buildApp({ db: d.db, lista: [] });

    const res = await app.request('/');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { personal: Record<string, unknown>[] };
    expect(json.personal).toEqual([
      {
        email: CORREO,
        en_lista: false,
        user_id: PERSONA_ID,
        nombre: 'Ana Soto',
        rut: RUT,
        estado: 'pendiente_activacion',
        expira_en: null,
        ultimo_login_en: null,
      },
    ]);
  });

  it('sin sesión → 401', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db, sesion: null });
    const res = await app.request('/');
    expect(res.status).toBe(401);
    expect(d.select).not.toHaveBeenCalled();
  });

  it('un usuario que no es platform-admin → 403', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db, sesion: 'otra@empresa.cl' });
    const res = await app.request('/');
    expect(res.status).toBe(403);
    expect(d.select).not.toHaveBeenCalled();
  });
});

describe('POST /admin/personal-booster — alta (SC2)', () => {
  it('persona nueva: crea la cuenta provisoria marcada como personal y devuelve el código una vez', async () => {
    const d = makeDb({ lookups: [[], []] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      ok: boolean;
      user_id: string;
      vinculo: string;
      codigo_activacion: string;
      expira_en: string;
      en_lista: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.user_id).toBe(NUEVO_ID);
    expect(json.vinculo).toBe('nueva');
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    expect(json.en_lista).toBe(true);
    cercaDe(json.expira_en, Date.now() + SIETE_DIAS_MS);

    expect(d.insertedUsers).toHaveLength(1);
    const u = d.insertedUsers[0] as Record<string, unknown>;
    expect(u.firebaseUid).toBe(`pending-rut:${RUT}`);
    expect(u.email).toBe(CORREO);
    expect(u.fullName).toBe('Ana Soto');
    expect(u.rut).toBe(RUT);
    expect(u.isPlatformAdmin).toBe(true);
    expect(u.status).toBe('pendiente_verificacion');
    expect(u.claveNumericaHash).toBeUndefined();
    // Solo el hash: el código en claro no se guarda.
    expect(u.activationPinHash).not.toBe(json.codigo_activacion);
    expect(verifyActivationPin(json.codigo_activacion, String(u.activationPinHash))).toBe(true);
    expect(u.activacionVenceEn).toBeInstanceOf(Date);
    cercaDe((u.activacionVenceEn as Date).toISOString(), Date.now() + SIETE_DIAS_MS);
    // La escritura corre en una transacción.
    expect(
      (d.db as never as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).toHaveBeenCalledTimes(1);
  });

  it('normaliza el correo a minúsculas y el RUT a su forma canónica', async () => {
    const d = makeDb({ lookups: [[], []] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(
      '/',
      postJson({ email: 'Ana.Soto@BoosterChile.com', full_name: 'Ana Soto', rut: '12.345.678-5' }),
    );

    expect(res.status).toBe(201);
    const u = d.insertedUsers[0] as Record<string, unknown>;
    expect(u.email).toBe(CORREO);
    expect(u.rut).toBe(RUT);
  });

  it('el correo fuera de la lista no impide el alta: en_lista false', async () => {
    const d = makeDb({ lookups: [[], []] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(201);
    const json = (await res.json()) as { en_lista: boolean; codigo_activacion: string };
    expect(json.en_lista).toBe(false);
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
  });
});

describe('POST /admin/personal-booster — persona que ya existe (SC3)', () => {
  it('cuenta activa: no emite código, la marca como personal y no toca nada más', async () => {
    const d = makeDb({
      lookups: [[existente({ firebaseUid: 'fb-real', claveNumericaHash: 'hash-clave' })]],
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson({ ...BODY, full_name: 'Otro Nombre' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user_id: PERSONA_ID,
      vinculo: 'cuenta_activa',
      codigo_activacion: null,
      expira_en: null,
      en_lista: true,
    });
    expect(d.insertedUsers).toEqual([]);
    expect(d.updates).toHaveLength(1);
    const cambios = d.updates[0] as Record<string, unknown>;
    expect(cambios.isPlatformAdmin).toBe(true);
    for (const campo of [
      'activationPinHash',
      'activacionVenceEn',
      'claveNumericaHash',
      'fullName',
      'email',
      'rut',
      'firebaseUid',
      'status',
    ]) {
      expect(cambios).not.toHaveProperty(campo);
    }
  });

  it('cuenta activa con el correo fuera de la lista: no la marca y responde cuenta_activa', async () => {
    const d = makeDb({
      lookups: [[existente({ firebaseUid: 'fb-real', claveNumericaHash: 'hash-clave' })]],
    });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger, lista: [ADMIN_EMAIL] });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user_id: PERSONA_ID,
      vinculo: 'cuenta_activa',
      codigo_activacion: null,
      expira_en: null,
      en_lista: false,
    });
    // Sin la lista, la marca no se escribe: la cuenta sigue como estaba.
    expect(d.updates).toEqual([]);
    expect(d.insertedUsers).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.alta',
        vinculo: 'cuenta_activa',
        marcada: false,
      }),
      expect.any(String),
    );
  });

  it('la lectura de la cuenta existente bloquea la fila hasta el commit', async () => {
    const d = makeDb({ lookups: [[existente()]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(d.locks).toEqual(['update']);
  });

  it('provisoria con código: no emite uno nuevo, la marca y responde codigo_vigente', async () => {
    const vence = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const d = makeDb({
      lookups: [
        [existente({ activationPinHash: hashActivationPin('246810'), activacionVenceEn: vence })],
      ],
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      user_id: PERSONA_ID,
      vinculo: 'codigo_vigente',
      codigo_activacion: null,
      expira_en: vence.toISOString(),
      en_lista: true,
    });
    const cambios = d.updates[0] as Record<string, unknown>;
    expect(cambios.isPlatformAdmin).toBe(true);
    expect(cambios).not.toHaveProperty('activationPinHash');
    expect(cambios).not.toHaveProperty('activacionVenceEn');
  });

  it('provisoria sin código: emite el primero con su plazo de 7 días', async () => {
    const d = makeDb({ lookups: [[existente()]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      vinculo: string;
      codigo_activacion: string;
      expira_en: string;
      user_id: string;
    };
    expect(json.vinculo).toBe('provisoria_sin_codigo');
    expect(json.user_id).toBe(PERSONA_ID);
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    cercaDe(json.expira_en, Date.now() + SIETE_DIAS_MS);
    const cambios = d.updates[0] as Record<string, unknown>;
    expect(cambios.isPlatformAdmin).toBe(true);
    expect(verifyActivationPin(json.codigo_activacion, String(cambios.activationPinHash))).toBe(
      true,
    );
    expect(cambios.activacionVenceEn).toBeInstanceOf(Date);
    expect(d.insertedUsers).toEqual([]);
  });
});

describe('POST /admin/personal-booster — rechazos sin escrituras (SC4)', () => {
  it('correo de una cuenta con otro RUT → 409 rut_mismatch', async () => {
    const d = makeDb({ lookups: [[existente({ rut: '22222222-2' })]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('rut_mismatch');
    expect(d.updates).toEqual([]);
    expect(d.insertedUsers).toEqual([]);
  });

  it('correo de una cuenta sin RUT → 409 rut_mismatch (el RUT de una cuenta no se cambia)', async () => {
    const d = makeDb({ lookups: [[existente({ rut: null })]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('rut_mismatch');
    expect(d.updates).toEqual([]);
  });

  it('RUT de otra persona → 409 rut_already_registered', async () => {
    const d = makeDb({ lookups: [[], [{ id: 'otra-persona' }]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('rut_already_registered');
    expect(d.updates).toEqual([]);
    expect(d.insertedUsers).toEqual([]);
  });

  it('carrera contra el UNIQUE del RUT → 409 rut_already_registered', async () => {
    const d = makeDb({
      lookups: [[], []],
      insertError: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'uq_usuarios_rut',
      }),
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('rut_already_registered');
  });

  it('carrera contra el UNIQUE de firebase_uid (el placeholder sale del RUT) → 409 rut_already_registered', async () => {
    const d = makeDb({
      lookups: [[], []],
      insertError: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'usuarios_firebase_uid_key',
      }),
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('rut_already_registered');
  });

  it.each([
    ['RUT con dígito verificador inválido', { ...BODY, rut: '12345678-9' }],
    ['correo inválido', { ...BODY, email: 'no-es-correo' }],
    ['nombre demasiado corto', { ...BODY, full_name: 'A' }],
    ['falta el RUT', { email: CORREO, full_name: 'Ana Soto' }],
  ])('%s → 400 sin tocar la base', async (_caso, body) => {
    const d = makeDb();
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(body));

    expect(res.status).toBe(400);
    expect(d.select).not.toHaveBeenCalled();
    expect(d.insertedUsers).toEqual([]);
  });

  it('sin sesión → 401 y un usuario que no es platform-admin → 403', async () => {
    const d = makeDb({ lookups: [[], []] });
    const sinSesion = await buildApp({ db: d.db, sesion: null });
    expect((await sinSesion.request('/', postJson(BODY))).status).toBe(401);
    const otro = await buildApp({ db: d.db, sesion: 'otra@empresa.cl' });
    expect((await otro.request('/', postJson(BODY))).status).toBe(403);
    expect(d.insertedUsers).toEqual([]);
  });
});

describe('POST /admin/personal-booster/:userId/codigo — re-emisión (SC5)', () => {
  it('persona del personal que no activó: código nuevo, el anterior deja de servir, plazo desde ahora', async () => {
    const anterior = '135790';
    const d = makeDb({
      lookups: [
        [
          existente({
            isPlatformAdmin: true,
            activationPinHash: hashActivationPin(anterior),
            activacionVenceEn: new Date(Date.now() - 60 * 1000),
          }),
        ],
      ],
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      user_id: string;
      codigo_activacion: string;
      expira_en: string;
      en_lista: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.user_id).toBe(PERSONA_ID);
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    expect(json.en_lista).toBe(true);
    cercaDe(json.expira_en, Date.now() + SIETE_DIAS_MS);

    const cambios = d.updates[0] as Record<string, unknown>;
    expect(verifyActivationPin(json.codigo_activacion, String(cambios.activationPinHash))).toBe(
      true,
    );
    if (json.codigo_activacion !== anterior) {
      expect(verifyActivationPin(anterior, String(cambios.activationPinHash))).toBe(false);
    }
    expect(cambios.activacionVenceEn).toBeInstanceOf(Date);
    expect(cambios).not.toHaveProperty('claveNumericaHash');
    expect(
      (d.db as never as { transaction: ReturnType<typeof vi.fn> }).transaction,
    ).toHaveBeenCalledTimes(1);
  });

  it('cuenta ya activa → 409 already_activated, sin escrituras', async () => {
    const d = makeDb({
      lookups: [
        [existente({ isPlatformAdmin: true, firebaseUid: 'fb-real', claveNumericaHash: 'h' })],
      ],
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('already_activated');
    expect(d.updates).toEqual([]);
  });

  it('si la cuenta se activó entre la lectura y la escritura → 409 already_activated, sin correo', async () => {
    const d = makeDb({
      lookups: [[existente({ isPlatformAdmin: true })]],
      filasActualizadas: [],
    });
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, sender, logger });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('already_activated');
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'personal_booster.reemision_codigo' }),
      expect.any(String),
    );
  });

  it('persona que no es del personal → 404 personal_not_found, sin escrituras', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: false })]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('personal_not_found');
    expect(d.updates).toEqual([]);
  });

  it('usuario inexistente → 404 personal_not_found', async () => {
    const d = makeDb({ lookups: [[]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('personal_not_found');
  });

  it('userId que no es UUID → 400', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db });

    const res = await app.request('/no-es-uuid/codigo', { method: 'POST' });

    expect(res.status).toBe(400);
    expect(d.select).not.toHaveBeenCalled();
  });

  it('sin sesión → 401 y un usuario que no es platform-admin → 403', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const sinSesion = await buildApp({ db: d.db, sesion: null });
    expect((await sinSesion.request(`/${PERSONA_ID}/codigo`, { method: 'POST' })).status).toBe(401);
    const otro = await buildApp({ db: d.db, sesion: 'otra@empresa.cl' });
    expect((await otro.request(`/${PERSONA_ID}/codigo`, { method: 'POST' })).status).toBe(403);
    expect(d.updates).toEqual([]);
  });
});

describe('admin-personal-booster — impersonación (SC8)', () => {
  async function appImpersonada(d: ReturnType<typeof makeDb>) {
    const mod = await loadMod();
    const logger = makeLogger() as never as Logger;
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('userContext' as never, { user: { id: ADMIN_ID, email: ADMIN_EMAIL } } as never);
      c.set(
        'firebaseClaims' as never,
        {
          uid: 'target-firebase-uid',
          email: undefined,
          emailVerified: false,
          name: undefined,
          picture: undefined,
          custom: { impersonated_by: 'admin-uuid-1' },
        } as never,
      );
      await next();
    });
    app.use('*', createImpersonationWriteGuardMiddleware({ logger }));
    app.route(
      '/',
      mod.createAdminPersonalBoosterRoutes({
        db: d.db,
        logger,
        platformAdminEmails: LISTA,
        emailSender: makeSender().sender,
        webAppUrl: WEB_APP_URL,
      }),
    );
    return app;
  }

  it('el alta en una sesión de impersonación → 403 y nada escrito', async () => {
    const d = makeDb({ lookups: [[], []] });
    const app = await appImpersonada(d);

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('forbidden_impersonation_write');
    expect(d.insert).not.toHaveBeenCalled();
  });

  it('la re-emisión en una sesión de impersonación → 403 y nada escrito', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const app = await appImpersonada(d);

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(403);
    expect(d.update).not.toHaveBeenCalled();
  });
});

describe('admin-personal-booster — correo, logs y auditoría (SC9)', () => {
  it('alta con el correo en la lista: el código sale por correo a esa dirección con la URL de /activar', async () => {
    const d = makeDb({ lookups: [[], []] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender });

    const res = await app.request('/', postJson(BODY));
    expect(res.status).toBe(201);
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };

    expect(send).toHaveBeenCalledTimes(1);
    const msg = (send.mock.calls[0] as unknown[])[0] as { to: string; text: string };
    expect(msg.to).toBe(CORREO);
    expect(msg.text).toContain(`${WEB_APP_URL}/activar`);
    expect(msg.text).toContain(codigo_activacion);
    expect(msg.text).toContain(RUT);
  });

  it('alta con el correo fuera de la lista: no se envía correo', async () => {
    const d = makeDb({ lookups: [[], []] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender, lista: [ADMIN_EMAIL] });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
  });

  it('sin código emitido (cuenta activa o código vigente) no se envía correo', async () => {
    const { sender, send } = makeSender();
    const activa = makeDb({
      lookups: [[existente({ firebaseUid: 'fb-real', claveNumericaHash: 'h' })]],
    });
    await (await buildApp({ db: activa.db, sender })).request('/', postJson(BODY));
    const vigente = makeDb({
      lookups: [[existente({ activationPinHash: hashActivationPin('111111') })]],
    });
    await (await buildApp({ db: vigente.db, sender })).request('/', postJson(BODY));

    expect(send).not.toHaveBeenCalled();
  });

  it('re-emisión con el correo en la lista envía el código nuevo; fuera de la lista, no', async () => {
    const { sender, send } = makeSender();
    const enLista = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const res = await (await buildApp({ db: enLista.db, sender })).request(
      `/${PERSONA_ID}/codigo`,
      { method: 'POST' },
    );
    expect(res.status).toBe(200);
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };
    expect(send).toHaveBeenCalledTimes(1);
    expect(((send.mock.calls[0] as unknown[])[0] as { text: string }).text).toContain(
      codigo_activacion,
    );

    send.mockClear();
    const fuera = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const res2 = await (await buildApp({ db: fuera.db, sender, lista: [ADMIN_EMAIL] })).request(
      `/${PERSONA_ID}/codigo`,
      { method: 'POST' },
    );
    expect(res2.status).toBe(200);
    expect(((await res2.json()) as { en_lista: boolean }).en_lista).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('el alta deja un evento de auditoría con el admin, la persona y el vínculo, sin el código', async () => {
    const d = makeDb({ lookups: [[], []] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger });

    const res = await app.request('/', postJson(BODY));
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.alta',
        actor_user_id: ADMIN_ID,
        user_id: NUEVO_ID,
        vinculo: 'nueva',
      }),
      expect.any(String),
    );
    expect(textoDeLogs(logger)).not.toContain(codigo_activacion);
  });

  it('la re-emisión deja un evento de auditoría sin el código', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.reemision_codigo',
        actor_user_id: ADMIN_ID,
        user_id: PERSONA_ID,
      }),
      expect.any(String),
    );
    expect(textoDeLogs(logger)).not.toContain(codigo_activacion);
  });
});
