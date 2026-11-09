import type { Logger } from '@booster-ai/logger';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmacionesAccesoBooster } from '../db/schema.js';
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

/**
 * SC9: el counter y el span se capturan para comprobar nombres, labels y que
 * nunca llevan el código. El meter y el tracer reales son no-op en tests.
 */
const observabilidad = vi.hoisted(() => ({
  contadores: [] as Array<{ nombre: string; labels: Record<string, unknown> }>,
  spans: [] as Array<{ nombre: string; atributos: Record<string, unknown> }>,
}));
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: (nombre: string) => ({
    add: (_valor: number, labels: Record<string, unknown> = {}) => {
      observabilidad.contadores.push({ nombre, labels });
    },
  }),
}));
vi.mock('../observability/business-span.js', () => ({
  withBusinessSpan: async (
    opciones: { name: string; attributes?: Record<string, unknown> },
    fn: (span: { atributos: Record<string, unknown> }) => Promise<unknown>,
  ) => {
    const span = { nombre: opciones.name, atributos: { ...(opciones.attributes ?? {}) } };
    observabilidad.spans.push(span);
    return await fn(span);
  },
  setResultAttributes: (
    span: { atributos: Record<string, unknown> },
    atributos: Record<string, unknown>,
  ) => {
    Object.assign(span.atributos, atributos);
  },
}));

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
  const send = vi.fn<EmailSender['send']>(async () => ({ enviado: true, id: 'm-1' }));
  const sender: EmailSender = { send };
  return { sender, send };
}

const ASUNTO_ACTIVACION = 'Activa tu acceso al panel de Booster';

/** Correos con el código de activación, en orden. */
function correosDeActivacion(send: ReturnType<typeof makeSender>['send']) {
  return send.mock.calls.map((c) => c[0]).filter((m) => m.subject === ASUNTO_ACTIVACION);
}

/** Avisos a la lista de respaldo (`.specs/acceso-panel-plataforma` SC5), en orden. */
function avisos(send: ReturnType<typeof makeSender>['send']) {
  return send.mock.calls
    .map((c) => c[0])
    .filter((m) => m.subject.startsWith('Booster: acceso al panel'));
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
  /**
   * Filas que devuelve `delete().where().returning()` (confirmaciones
   * pendientes borradas). Vacío = no había una pendiente.
   */
  filasBorradas?: unknown[];
}

const CONFIRMACION_ID = '3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b';

function makeDb(opts: DbOpts = {}) {
  const lookups = [...(opts.lookups ?? [])];
  const insertedUsers: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  /** Predicado de cada `update().set().where(...)`, en orden. */
  const updateWheres: unknown[] = [];

  const locks: unknown[] = [];
  /** Predicado de cada `select().from().where(...)`, en orden. */
  const selectWheres: unknown[] = [];
  /** Cada `leftJoin`/`innerJoin` del select: tabla y condición. */
  const joins: Array<{ tabla: unknown; on: unknown }> = [];
  /** Confirmaciones insertadas, en orden. */
  const insertedConfirmaciones: Record<string, unknown>[] = [];
  /** Cada `delete(tabla).where(predicado)`, en orden. */
  const deletes: Array<{ tabla: unknown; predicado: unknown }> = [];
  /** Orden de las escrituras sobre confirmaciones. */
  const operaciones: string[] = [];
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    const orderBy = vi.fn(() => chain);
    const join = vi.fn((tabla: unknown, on: unknown) => {
      joins.push({ tabla, on });
      return chain;
    });
    chain.from = vi.fn(() => chain);
    chain.leftJoin = join;
    chain.innerJoin = join;
    chain.where = vi.fn((predicado: unknown) => {
      selectWheres.push(predicado);
      return chain;
    });
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

  const insert = vi.fn((tabla: unknown) => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if (tabla === confirmacionesAccesoBooster) {
          operaciones.push('insert');
          insertedConfirmaciones.push(vals);
          return [{ id: CONFIRMACION_ID }];
        }
        if (opts.insertError) {
          throw opts.insertError;
        }
        insertedUsers.push(vals);
        return [{ id: NUEVO_ID }];
      }),
    })),
  }));

  const del = vi.fn((tabla: unknown) => ({
    where: vi.fn((predicado: unknown) => {
      operaciones.push('delete');
      deletes.push({ tabla, predicado });
      return Object.assign(Promise.resolve(undefined), {
        returning: vi.fn(async () => opts.filasBorradas ?? [{ id: CONFIRMACION_ID }]),
      });
    }),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      updates.push(vals);
      const filas = opts.filasActualizadas ?? [{ id: PERSONA_ID }];
      // `where` se puede esperar directo o seguir con `returning()`.
      return {
        where: vi.fn((predicado: unknown) => {
          updateWheres.push(predicado);
          return Object.assign(Promise.resolve(undefined), {
            returning: vi.fn(async () => filas),
          });
        }),
      };
    }),
  }));

  const base = { select, insert, update, delete: del };
  return {
    db: {
      ...base,
      transaction: vi.fn(async (fn: (tx: typeof base) => Promise<unknown>) => fn(base)),
    } as never,
    select,
    insert,
    update,
    delete: del,
    insertedUsers,
    insertedConfirmaciones,
    deletes,
    operaciones,
    updates,
    updateWheres,
    selectWheres,
    joins,
    locks,
  };
}

/** SQL y parámetros de un predicado Drizzle, para mirar qué filtra. */
function sqlDe(predicado: unknown) {
  if (!(predicado instanceof SQL)) {
    throw new Error('se esperaba un predicado SQL');
  }
  return new PgDialect().sqlToQuery(predicado);
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
  observabilidad.contadores.length = 0;
  observabilidad.spans.length = 0;
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

  // `.specs/acceso-panel-plataforma` SC3: el panel otorga el acceso.
  it('cuenta activa con el correo fuera de la lista: la marca igual y queda con acceso', async () => {
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
    expect(d.updates).toHaveLength(1);
    expect((d.updates[0] as Record<string, unknown>).isPlatformAdmin).toBe(true);
    expect(d.insertedUsers).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.alta',
        vinculo: 'cuenta_activa',
        marcada: true,
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

  it.each([
    ['sin vencimiento (no lo emitió el panel)', null],
    ['con el vencimiento del panel ya pasado', new Date(Date.now() - 60 * 1000)],
  ])(
    'provisoria con un código %s: emite uno nuevo con su plazo y responde provisoria_sin_codigo',
    async (_caso, venceEn) => {
      const hashAnterior = hashActivationPin('246810');
      const d = makeDb({
        lookups: [[existente({ activationPinHash: hashAnterior, activacionVenceEn: venceEn })]],
      });
      const { sender, send } = makeSender();
      const app = await buildApp({ db: d.db, sender });

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
      expect(d.updates).toHaveLength(1);
      const cambios = d.updates[0] as Record<string, unknown>;
      expect(cambios.isPlatformAdmin).toBe(true);
      expect(cambios.activationPinHash).not.toBe(hashAnterior);
      expect(verifyActivationPin(json.codigo_activacion, String(cambios.activationPinHash))).toBe(
        true,
      );
      expect(cambios.activacionVenceEn).toBeInstanceOf(Date);
      cercaDe((cambios.activacionVenceEn as Date).toISOString(), Date.now() + SIETE_DIAS_MS);
      expect(d.insertedUsers).toEqual([]);
      // El código nuevo sale también por correo a la persona.
      expect(correosDeActivacion(send).map((m) => m.to)).toEqual([CORREO]);
    },
  );

  it('provisoria con un código del panel vigente: no emite uno nuevo, la marca y responde codigo_vigente', async () => {
    const vence = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const d = makeDb({
      lookups: [
        [
          existente({
            isPlatformAdmin: true,
            activationPinHash: hashActivationPin('246810'),
            activacionVenceEn: vence,
          }),
        ],
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

  it('carrera contra el UNIQUE del correo → 409 email_already_registered', async () => {
    const d = makeDb({
      lookups: [[], []],
      insertError: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'usuarios_email_key',
      }),
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', code: 'email_already_registered' });
    expect(d.insertedUsers).toEqual([]);
    expect(observabilidad.contadores).toEqual([
      {
        nombre: 'personal_booster_alta_total',
        labels: { resultado: 'email_already_registered', en_lista: 'true' },
      },
    ]);
  });

  it('un error que no es de Postgres no se traduce: sale tal cual y responde 500', async () => {
    const falla = new Error('conexión perdida');
    const d = makeDb({ lookups: [[], []], insertError: falla });
    const app = await buildApp({ db: d.db });
    const capturados: unknown[] = [];
    app.onError((err, c) => {
      capturados.push(err);
      return c.json({ error: 'internal_server_error' }, 500);
    });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(500);
    expect(capturados).toEqual([falla]);
    expect(d.insertedUsers).toEqual([]);
    expect(observabilidad.contadores).toEqual([]);
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

  it('el UPDATE de la re-emisión exige que la cuenta siga sin clave y con el uid provisorio', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(200);
    const predicado = d.updateWheres[0];
    if (!(predicado instanceof SQL)) {
      throw new Error('la re-emisión no pasó un predicado SQL al UPDATE');
    }
    const consulta = new PgDialect().sqlToQuery(predicado);
    expect(consulta.sql).toContain('"usuarios"."id" = $1');
    expect(consulta.sql).toContain('"usuarios"."clave_numerica_hash" is null');
    expect(consulta.sql).toContain('"usuarios"."firebase_uid" like $2');
    expect(consulta.params).toEqual([PERSONA_ID, 'pending-rut:%']);
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

describe('admin-personal-booster — contrato de los 400 (TRK-003)', () => {
  it('POST / con correo inválido y nombre corto → 400 con el body común', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db });

    const res = await app.request(
      '/',
      postJson({ ...BODY, email: 'no-es-correo', full_name: 'A' }),
    );

    expect({ status: res.status, body: await res.json() }).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "issues": [
              {
                "code": "invalid_format",
                "format": "email",
                "message": "Ingresa un correo válido",
                "origin": "string",
                "path": [
                  "email",
                ],
              },
              {
                "code": "too_small",
                "inclusive": true,
                "message": "Escribe al menos 2 caracteres",
                "minimum": 2,
                "origin": "string",
                "path": [
                  "full_name",
                ],
              },
            ],
            "name": "ZodError",
          },
          "success": false,
        },
        "status": 400,
      }
    `);
    expect(d.select).not.toHaveBeenCalled();
  });

  it('POST /:userId/codigo con un userId que no es UUID → 400 con el body común', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db });

    const res = await app.request('/no-es-uuid/codigo', { method: 'POST' });

    expect({ status: res.status, body: await res.json() }).toMatchInlineSnapshot(`
      {
        "body": {
          "error": {
            "issues": [
              {
                "code": "invalid_format",
                "format": "uuid",
                "message": "Invalid UUID",
                "origin": "string",
                "path": [
                  "userId",
                ],
              },
            ],
            "name": "ZodError",
          },
          "success": false,
        },
        "status": 400,
      }
    `);
    expect(d.select).not.toHaveBeenCalled();
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

  it('quitar acceso en una sesión de impersonación → 403 y nada escrito (acceso-panel-plataforma SC4)', async () => {
    const d = makeDb({ listRows: [existente({ isPlatformAdmin: true, status: 'activo' })] });
    const app = await appImpersonada(d);

    const res = await app.request(`/${PERSONA_ID}/quitar-acceso`, { method: 'POST' });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('forbidden_impersonation_write');
    expect(d.update).not.toHaveBeenCalled();
  });

  it('la re-emisión en una sesión de impersonación → 403 y nada escrito', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const app = await appImpersonada(d);

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('forbidden_impersonation_write');
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

    const activacion = correosDeActivacion(send);
    expect(activacion).toHaveLength(1);
    const msg = activacion[0] as { to: string; text: string };
    expect(msg.to).toBe(CORREO);
    expect(msg.text).toContain(`${WEB_APP_URL}/activar`);
    expect(msg.text).toContain(codigo_activacion);
    expect(msg.text).toContain(RUT);
  });

  it('alta con el correo fuera de la lista: el código sale igual por correo a la persona (SC3)', async () => {
    const d = makeDb({ lookups: [[], []] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender, lista: [ADMIN_EMAIL] });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(201);
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };
    const activacion = correosDeActivacion(send);
    expect(activacion.map((m) => m.to)).toEqual([CORREO]);
    expect(activacion[0]?.text).toContain(codigo_activacion);
  });

  it('sin código emitido (cuenta activa o código del panel vigente) no se envía correo', async () => {
    const { sender, send } = makeSender();
    const activa = makeDb({
      lookups: [[existente({ firebaseUid: 'fb-real', claveNumericaHash: 'h' })]],
    });
    const resActiva = await (await buildApp({ db: activa.db, sender })).request(
      '/',
      postJson(BODY),
    );
    expect(resActiva.status).toBe(200);
    expect(((await resActiva.json()) as { vinculo: string }).vinculo).toBe('cuenta_activa');
    const vigente = makeDb({
      lookups: [
        [
          existente({
            isPlatformAdmin: true,
            activationPinHash: hashActivationPin('111111'),
            activacionVenceEn: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          }),
        ],
      ],
    });
    const resVigente = await (await buildApp({ db: vigente.db, sender })).request(
      '/',
      postJson(BODY),
    );
    expect(resVigente.status).toBe(200);
    expect(((await resVigente.json()) as { vinculo: string }).vinculo).toBe('codigo_vigente');

    expect(correosDeActivacion(send)).toEqual([]);
  });

  it('re-emisión: el código nuevo sale por correo, esté o no el correo en la lista (SC3)', async () => {
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
    const json2 = (await res2.json()) as { en_lista: boolean; codigo_activacion: string };
    expect(json2.en_lista).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(((send.mock.calls[0] as unknown[])[0] as { text: string }).text).toContain(
      json2.codigo_activacion,
    );
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

describe('admin-personal-booster — métrica de negocio y span (SC9)', () => {
  const EN_DOS_DIAS = () => new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  /** Todo lo que salió a la métrica y al span, para buscar el código. */
  function telemetria(): string {
    return JSON.stringify([observabilidad.contadores, observabilidad.spans]);
  }

  it.each([
    ['nueva', [[], []], 201],
    ['cuenta_activa', [[existente({ firebaseUid: 'fb-real', claveNumericaHash: 'h' })]], 200],
    [
      'codigo_vigente',
      [
        [
          existente({
            isPlatformAdmin: true,
            activationPinHash: hashActivationPin('111111'),
            activacionVenceEn: EN_DOS_DIAS(),
          }),
        ],
      ],
      200,
    ],
    ['provisoria_sin_codigo', [[existente()]], 200],
  ] as const)(
    'alta con vínculo %s: counter con resultado, vínculo y en_lista; span sin el código',
    async (vinculo, lookups, status) => {
      const d = makeDb({ lookups: lookups.map((filas) => [...filas]) });
      const app = await buildApp({ db: d.db });

      const res = await app.request('/', postJson(BODY));

      expect(res.status).toBe(status);
      const json = (await res.json()) as { vinculo: string; codigo_activacion: string | null };
      expect(json.vinculo).toBe(vinculo);
      expect(observabilidad.contadores).toEqual([
        {
          nombre: 'personal_booster_alta_total',
          labels: { resultado: 'registrada', en_lista: 'true', vinculo },
        },
      ]);
      expect(observabilidad.spans).toEqual([
        {
          nombre: 'personal_booster.alta',
          atributos: {
            'personal_booster.en_lista': true,
            'personal_booster.resultado': 'registrada',
            'personal_booster.vinculo': vinculo,
          },
        },
      ]);
      if (json.codigo_activacion !== null) {
        expect(telemetria()).not.toContain(json.codigo_activacion);
      }
    },
  );

  it('alta con el correo fuera de la lista: en_lista "false" en el counter y false en el span', async () => {
    const d = makeDb({ lookups: [[], []] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(201);
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };
    expect(observabilidad.contadores).toEqual([
      {
        nombre: 'personal_booster_alta_total',
        labels: { resultado: 'registrada', en_lista: 'false', vinculo: 'nueva' },
      },
    ]);
    expect(observabilidad.spans[0]?.atributos['personal_booster.en_lista']).toBe(false);
    expect(telemetria()).not.toContain(codigo_activacion);
  });

  it.each([
    ['rut_mismatch', [[existente({ rut: '22222222-2' })]]],
    ['rut_already_registered', [[], [{ id: 'otra-persona' }]]],
  ] as const)('alta rechazada con 409 %s: counter sin vínculo', async (resultado, lookups) => {
    const d = makeDb({ lookups: lookups.map((filas) => [...filas]) });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(observabilidad.contadores).toEqual([
      { nombre: 'personal_booster_alta_total', labels: { resultado, en_lista: 'true' } },
    ]);
    expect(observabilidad.spans[0]?.atributos).toEqual({
      'personal_booster.en_lista': true,
      'personal_booster.resultado': resultado,
    });
  });

  it('re-emisión: counter emitido; el span lleva el user_id y no el código', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(200);
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };
    expect(observabilidad.contadores).toEqual([
      { nombre: 'personal_booster_reemision_codigo_total', labels: { resultado: 'emitido' } },
    ]);
    expect(observabilidad.spans).toEqual([
      {
        nombre: 'personal_booster.reemitir_codigo',
        atributos: { 'booster.user_id': PERSONA_ID, 'personal_booster.resultado': 'emitido' },
      },
    ]);
    expect(telemetria()).not.toContain(codigo_activacion);
  });

  it.each([
    [
      'already_activated',
      409,
      [[existente({ isPlatformAdmin: true, firebaseUid: 'fb-real', claveNumericaHash: 'h' })]],
    ],
    ['personal_not_found', 404, [[existente({ isPlatformAdmin: false })]]],
    ['personal_not_found', 404, [[]]],
  ] as const)(
    're-emisión rechazada (%s, %i): counter con ese resultado',
    async (resultado, status, lookups) => {
      const d = makeDb({ lookups: lookups.map((filas) => [...filas]) });
      const app = await buildApp({ db: d.db });

      const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

      expect(res.status).toBe(status);
      expect(observabilidad.contadores).toEqual([
        { nombre: 'personal_booster_reemision_codigo_total', labels: { resultado } },
      ]);
      expect(observabilidad.spans[0]?.atributos['personal_booster.resultado']).toBe(resultado);
    },
  );

  it('listado: counter ok y span con los conteos', async () => {
    const d = makeDb({
      listRows: [
        {
          id: PERSONA_ID,
          email: CORREO,
          fullName: 'Ana Soto',
          rut: RUT,
          firebaseUid: `pending-rut:${RUT}`,
          claveNumericaHash: null,
          activationPinHash: hashActivationPin('123456'),
          activacionVenceEn: EN_DOS_DIAS(),
          lastLoginAt: null,
          isPlatformAdmin: true,
        },
      ],
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/');

    expect(res.status).toBe(200);
    expect(observabilidad.contadores).toEqual([
      { nombre: 'personal_booster_listado_total', labels: { resultado: 'ok' } },
    ]);
    expect(observabilidad.spans).toEqual([
      {
        nombre: 'personal_booster.listar',
        atributos: {
          'personal_booster.total': 2,
          'personal_booster.sin_cuenta': 1,
          'personal_booster.pendientes': 1,
        },
      },
    ]);
  });
});

/**
 * `.specs/acceso-panel-plataforma` SC5 — el alta que otorga el acceso deja un
 * evento de auditoría y avisa a cada correo de la lista de respaldo.
 */
/**
 * `.specs/acceso-panel-plataforma` SC3: una provisoria que todavía no era del
 * personal recibe siempre un código nuevo del panel al darla de alta. Un
 * código que ya tenía, aunque tenga vencimiento, lo pudo conocer otra persona.
 */
describe('POST /admin/personal-booster — provisoria que no estaba marcada (SC3)', () => {
  it('con un vencimiento vigente que no dejó el panel del personal: emite uno nuevo', async () => {
    const hashAnterior = hashActivationPin('246810');
    const d = makeDb({
      lookups: [
        [
          existente({
            isPlatformAdmin: false,
            activationPinHash: hashAnterior,
            activacionVenceEn: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          }),
        ],
      ],
    });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { vinculo: string; codigo_activacion: string | null };
    expect(json.vinculo).toBe('provisoria_sin_codigo');
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    const cambios = d.updates[0] as Record<string, unknown>;
    expect(cambios.isPlatformAdmin).toBe(true);
    expect(cambios.activationPinHash).not.toBe(hashAnterior);
    expect(cambios.activacionVenceEn).toBeInstanceOf(Date);
  });
});

describe('POST /admin/personal-booster — aviso y auditoría del acceso otorgado (SC5)', () => {
  it('persona nueva: avisa a cada correo de la lista, sin el código', async () => {
    const d = makeDb({ lookups: [[], []] });
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, sender, logger });

    const res = await app.request('/', postJson(BODY));
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };

    const enviados = avisos(send);
    expect(enviados.map((m) => m.to)).toEqual(LISTA);
    for (const m of enviados) {
      expect(m.subject).toBe('Booster: acceso al panel otorgado a Ana Soto');
      expect(m.text).toContain(ADMIN_EMAIL);
      expect(m.text).toContain(`Ana Soto (${CORREO})`);
      expect(m.text).not.toContain(codigo_activacion);
    }
    expect(logger.info).toHaveBeenCalledWith(
      {
        event_type: 'personal_booster.acceso_otorgado',
        actor_user_id: ADMIN_ID,
        user_id: NUEVO_ID,
        avisos_destinatarios: 2,
        avisos_enviados: 2,
      },
      expect.any(String),
    );
  });

  it('cuenta activa sin marca: el alta la marca y avisa', async () => {
    const d = makeDb({
      lookups: [
        [existente({ firebaseUid: 'fb-real', claveNumericaHash: 'h', isPlatformAdmin: false })],
      ],
    });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender, lista: [ADMIN_EMAIL] });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(avisos(send).map((m) => m.to)).toEqual([ADMIN_EMAIL]);
  });

  it('cuenta que ya estaba marcada: el alta no avisa ni deja evento de acceso otorgado', async () => {
    const d = makeDb({
      lookups: [
        [
          existente({
            isPlatformAdmin: true,
            activationPinHash: hashActivationPin('111111'),
            activacionVenceEn: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
          }),
        ],
      ],
    });
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, sender, logger });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(avisos(send)).toEqual([]);
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(
      'personal_booster.acceso_otorgado',
    );
  });

  it('un rechazo del alta no avisa', async () => {
    const d = makeDb({ lookups: [[existente({ rut: '22222222-2' })]] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });
});

/**
 * `.specs/acceso-panel-plataforma` SC4 — «Quitar acceso» desde el panel. La
 * consulta bloquea las cuentas marcadas hasta el commit; la persona tiene que
 * estar entre ellas.
 */
describe('POST /admin/personal-booster/:userId/quitar-acceso (SC4)', () => {
  const OTRO_ID = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

  /** Cuenta marcada, tal como la lee la baja. */
  function marcada(overrides: Record<string, unknown> = {}) {
    return {
      id: PERSONA_ID,
      email: 'carlos.rojas@boosterchile.com',
      fullName: 'Carlos Rojas',
      firebaseUid: 'fb-carlos',
      claveNumericaHash: 'hash',
      activationPinHash: null,
      activacionVenceEn: null,
      status: 'activo',
      ...overrides,
    };
  }

  const ADMIN_MARCADO = marcada({ id: ADMIN_ID, email: ADMIN_EMAIL, fullName: 'Felipe Vicencio' });

  function quitar(app: Hono, userId = PERSONA_ID) {
    return app.request(`/${userId}/quitar-acceso`, { method: 'POST' });
  }

  it('desmarca la cuenta y responde ok', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO, marcada()] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: PERSONA_ID });
    expect(d.updates).toHaveLength(1);
    const cambios = d.updates[0] as Record<string, unknown>;
    expect(cambios.isPlatformAdmin).toBe(false);
    // Una cuenta activa conserva su clave: solo pierde el acceso al panel.
    for (const campo of ['activationPinHash', 'activacionVenceEn', 'claveNumericaHash', 'status']) {
      expect(cambios).not.toHaveProperty(campo);
    }
  });

  it('la lectura bloquea las cuentas marcadas hasta el commit', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO, marcada()] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    await quitar(app);

    expect(d.locks).toEqual(['update']);
  });

  it('el UPDATE exige que la cuenta siga marcada', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO, marcada()] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    await quitar(app);

    const predicado = d.updateWheres[0];
    if (!(predicado instanceof SQL)) {
      throw new Error('la baja no pasó un predicado SQL al UPDATE');
    }
    const consulta = new PgDialect().sqlToQuery(predicado);
    expect(consulta.sql).toContain('"usuarios"."id" = $1');
    expect(consulta.sql).toContain('"usuarios"."es_admin_plataforma" = $2');
    expect(consulta.params).toEqual([PERSONA_ID, true]);
  });

  it('provisoria con un código del panel: el código deja de servir', async () => {
    const d = makeDb({
      listRows: [
        ADMIN_MARCADO,
        marcada({
          firebaseUid: `pending-rut:${RUT}`,
          claveNumericaHash: null,
          activationPinHash: hashActivationPin('123456'),
          activacionVenceEn: new Date(Date.now() + SIETE_DIAS_MS),
          status: 'pendiente_verificacion',
        }),
      ],
    });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(200);
    expect(d.updates[0]).toMatchObject({
      isPlatformAdmin: false,
      activationPinHash: null,
      activacionVenceEn: null,
    });
  });

  it('provisoria con un código que no emitió el panel: ese código no se toca', async () => {
    const d = makeDb({
      listRows: [
        ADMIN_MARCADO,
        marcada({
          firebaseUid: `pending-rut:${RUT}`,
          claveNumericaHash: null,
          activationPinHash: hashActivationPin('123456'),
          activacionVenceEn: null,
          status: 'pendiente_verificacion',
        }),
      ],
    });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    await quitar(app);

    expect(d.updates[0]).not.toHaveProperty('activationPinHash');
  });

  it('cuenta que no está marcada → 404 personal_not_found, sin escrituras', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found', code: 'personal_not_found' });
    expect(d.update).not.toHaveBeenCalled();
  });

  it('correo de la lista de respaldo → 409 en_lista_respaldo, sin escrituras', async () => {
    const d = makeDb({
      listRows: [ADMIN_MARCADO, marcada({ email: 'Carlos.Rojas@BoosterChile.com' })],
    });
    const app = await buildApp({
      db: d.db,
      lista: [ADMIN_EMAIL, 'carlos.rojas@boosterchile.com'],
    });

    const res = await quitar(app);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', code: 'en_lista_respaldo' });
    expect(d.update).not.toHaveBeenCalled();
  });

  it('quitárselo a uno mismo siendo el último con acceso → 409 ultimo_acceso', async () => {
    const d = makeDb({
      listRows: [ADMIN_MARCADO, marcada({ id: OTRO_ID, status: 'suspendido' })],
    });
    const app = await buildApp({ db: d.db, lista: [] });

    const res = await quitar(app, ADMIN_ID);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'conflict', code: 'ultimo_acceso' });
    expect(d.update).not.toHaveBeenCalled();
  });

  it('quitárselo a uno mismo cuando otra cuenta activa conserva el acceso → 200', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO, marcada({ id: OTRO_ID })] });
    const app = await buildApp({ db: d.db, lista: [] });

    const res = await quitar(app, ADMIN_ID);

    expect(res.status).toBe(200);
    expect((d.updates[0] as Record<string, unknown>).isPlatformAdmin).toBe(false);
  });

  it('el UPDATE que no encuentra la cuenta marcada → 404, sin aviso', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO, marcada()], filasActualizadas: [] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it('avisa a la lista de respaldo y deja el evento de auditoría (SC5)', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO, marcada()] });
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, sender, logger, lista: [ADMIN_EMAIL] });

    await quitar(app);

    const enviados = avisos(send);
    expect(enviados.map((m) => m.to)).toEqual([ADMIN_EMAIL]);
    expect(enviados[0]?.subject).toBe('Booster: acceso al panel quitado a Carlos Rojas');
    expect(logger.info).toHaveBeenCalledWith(
      {
        event_type: 'personal_booster.acceso_quitado',
        actor_user_id: ADMIN_ID,
        user_id: PERSONA_ID,
        codigo_invalidado: false,
        avisos_destinatarios: 1,
        avisos_enviados: 1,
      },
      expect.any(String),
    );
  });

  it('counter y span con el resultado', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    await quitar(app);

    expect(observabilidad.contadores).toEqual([
      {
        nombre: 'personal_booster_quitar_acceso_total',
        labels: { resultado: 'personal_not_found' },
      },
    ]);
    expect(observabilidad.spans).toEqual([
      {
        nombre: 'personal_booster.quitar_acceso',
        atributos: {
          'booster.user_id': PERSONA_ID,
          'personal_booster.resultado': 'personal_not_found',
        },
      },
    ]);
  });

  it('userId que no es UUID → 400', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db });

    const res = await app.request('/no-es-uuid/quitar-acceso', { method: 'POST' });

    expect(res.status).toBe(400);
    expect(d.update).not.toHaveBeenCalled();
  });

  it('sin sesión → 401 y un usuario que no es platform-admin → 403', async () => {
    const sinSesion = await buildApp({ db: makeDb().db, sesion: null });
    expect((await quitar(sinSesion)).status).toBe(401);
    const otro = await buildApp({ db: makeDb().db, sesion: 'otra.persona@empresa.cl' });
    expect((await quitar(otro)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// `.specs/confirmar-acceso-booster` — T2 (SC1–SC3, SC7, SC13) y T3 (SC8–SC10).
// ---------------------------------------------------------------------------

const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
const ASUNTO_AVISO_OTORGADO = 'Booster: acceso al panel otorgado';

/** Cuenta que ya eligió su clave. */
function activa(overrides: Record<string, unknown> = {}) {
  return existente({ firebaseUid: 'fb-ana', claveNumericaHash: 'hash-clave', ...overrides });
}

/** Lo que devuelve la consulta de vínculos cuando la cuenta tiene uno. */
const CON_VINCULO = [{ id: PERSONA_ID }];

describe('POST /admin/personal-booster — cuenta activa con vínculos con una empresa (SC1)', () => {
  it('no la marca: emite un código de confirmación de 24 horas, guardado solo como hash, y lo devuelve una vez', async () => {
    const d = makeDb({ lookups: [[activa()], CON_VINCULO] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      user_id: string;
      vinculo: string;
      codigo_activacion: string | null;
      expira_en: string | null;
      en_lista: boolean;
    };
    expect(json).toMatchObject({
      ok: true,
      user_id: PERSONA_ID,
      vinculo: 'cuenta_activa_por_confirmar',
      en_lista: true,
    });
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    cercaDe(json.expira_en, Date.now() + VEINTICUATRO_HORAS_MS);

    // La cuenta no se toca: ni la marca ni el código de activación.
    expect(d.updates).toEqual([]);
    expect(d.insertedUsers).toEqual([]);

    expect(d.insertedConfirmaciones).toHaveLength(1);
    const fila = d.insertedConfirmaciones[0] as Record<string, unknown>;
    expect(fila.usuarioId).toBe(PERSONA_ID);
    expect(fila.emitidoPorUsuarioId).toBe(ADMIN_ID);
    expect(fila.codigoHash).not.toBe(json.codigo_activacion);
    expect(verifyActivationPin(json.codigo_activacion ?? '', String(fila.codigoHash))).toBe(true);
    expect(fila.venceEn).toBeInstanceOf(Date);
    expect((fila.venceEn as Date).toISOString()).toBe(json.expira_en);
    expect(fila.intentosFallidos ?? 0).toBe(0);
  });

  it('emitir borra antes la confirmación pendiente de esa persona (una sola por persona, SC3)', async () => {
    const d = makeDb({ lookups: [[activa()], CON_VINCULO] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(d.operaciones).toEqual(['delete', 'insert']);
    expect(d.deletes).toHaveLength(1);
    expect(d.deletes[0]?.tabla).toBe(confirmacionesAccesoBooster);
    const borrado = sqlDe(d.deletes[0]?.predicado);
    expect(borrado.sql).toContain('"confirmaciones_acceso_booster"."usuario_id" = $1');
    expect(borrado.sql).toContain('"confirmaciones_acceso_booster"."consumido_en" is null');
    expect(borrado.params).toEqual([PERSONA_ID]);
    // La fila de la cuenta queda bloqueada hasta el commit.
    expect(d.locks).toEqual(['update']);
  });

  it('la consulta de vínculos mira membresías con empresa en cualquier estado y filas de conductores', async () => {
    const d = makeDb({ lookups: [[activa()], CON_VINCULO] });
    const app = await buildApp({ db: d.db });

    await app.request('/', postJson(BODY));

    const consulta = sqlDe(d.selectWheres[1]);
    expect(consulta.sql).toContain('"membresias"');
    expect(consulta.sql).toContain('"membresias"."empresa_id" is not null');
    expect(consulta.sql).toContain('"conductores"');
    expect(consulta.sql).not.toContain('"membresias"."estado"');
    expect(consulta.sql).not.toContain('"conductores"."eliminado_en"');
    expect(consulta.params).toContain(PERSONA_ID);
  });

  it('el código de confirmación no sale por correo ni avisa a la lista: todavía no hay acceso', async () => {
    const d = makeDb({ lookups: [[activa()], CON_VINCULO] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });

  it('auditoría, métrica y span con el vínculo, sin el código ni su hash', async () => {
    const d = makeDb({ lookups: [[activa()], CON_VINCULO] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger });

    const res = await app.request('/', postJson(BODY));
    const json = (await res.json()) as { codigo_activacion: string };

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.alta',
        actor_user_id: ADMIN_ID,
        user_id: PERSONA_ID,
        vinculo: 'cuenta_activa_por_confirmar',
        marcada: false,
        codigo_emitido: true,
      }),
      expect.any(String),
    );
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'personal_booster.acceso_otorgado' }),
      expect.any(String),
    );
    const fila = d.insertedConfirmaciones[0] as Record<string, unknown>;
    const logs = textoDeLogs(logger);
    expect(logs).not.toContain(json.codigo_activacion);
    expect(logs).not.toContain(String(fila.codigoHash));

    expect(observabilidad.contadores).toContainEqual({
      nombre: 'personal_booster_alta_total',
      labels: { resultado: 'registrada', en_lista: 'true', vinculo: 'cuenta_activa_por_confirmar' },
    });
    const span = observabilidad.spans.find((s) => s.nombre === 'personal_booster.alta');
    expect(span?.atributos['personal_booster.vinculo']).toBe('cuenta_activa_por_confirmar');
    expect(JSON.stringify(observabilidad)).not.toContain(json.codigo_activacion);
  });
});

describe('POST /admin/personal-booster — las demás cuentas siguen como en #893 (SC2)', () => {
  it('cuenta activa sin vínculos: el alta la marca y no emite confirmación', async () => {
    const d = makeDb({ lookups: [[activa()], []] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { vinculo: string }).vinculo).toBe('cuenta_activa');
    expect(d.updates).toHaveLength(1);
    expect((d.updates[0] as Record<string, unknown>).isPlatformAdmin).toBe(true);
    expect(d.insertedConfirmaciones).toEqual([]);
    expect(d.deletes).toEqual([]);
  });

  it('cuenta activa ya marcada: cuenta_activa, sin consultar vínculos ni emitir confirmación', async () => {
    const d = makeDb({ lookups: [[activa({ isPlatformAdmin: true })], CON_VINCULO] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { vinculo: string }).vinculo).toBe('cuenta_activa');
    expect(d.selectWheres).toHaveLength(1);
    expect(d.insertedConfirmaciones).toEqual([]);
    expect(d.deletes).toEqual([]);
  });

  it('provisoria (sin clave): no consulta vínculos y recibe el código de activación de siempre', async () => {
    const d = makeDb({ lookups: [[existente()], CON_VINCULO] });
    const app = await buildApp({ db: d.db });

    const res = await app.request('/', postJson(BODY));

    expect(res.status).toBe(200);
    expect(((await res.json()) as { vinculo: string }).vinculo).toBe('provisoria_sin_codigo');
    expect(d.selectWheres).toHaveLength(1);
    expect(d.insertedConfirmaciones).toEqual([]);
    expect((d.updates[0] as Record<string, unknown>).isPlatformAdmin).toBe(true);
  });
});

describe('POST /admin/personal-booster/:userId/codigo — persona por confirmar (SC8)', () => {
  const PENDIENTE = [{ id: CONFIRMACION_ID }];

  it('emite un código de confirmación nuevo, sin correo, y responde como el alta', async () => {
    const d = makeDb({ lookups: [[activa()], PENDIENTE] });
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, sender, logger });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      user_id: string;
      vinculo: string;
      codigo_activacion: string;
      expira_en: string;
      en_lista: boolean;
    };
    expect(json).toMatchObject({
      ok: true,
      user_id: PERSONA_ID,
      vinculo: 'cuenta_activa_por_confirmar',
      en_lista: true,
    });
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    cercaDe(json.expira_en, Date.now() + VEINTICUATRO_HORAS_MS);

    expect(d.operaciones).toEqual(['delete', 'insert']);
    const fila = d.insertedConfirmaciones[0] as Record<string, unknown>;
    expect(fila.usuarioId).toBe(PERSONA_ID);
    expect(fila.emitidoPorUsuarioId).toBe(ADMIN_ID);
    expect(verifyActivationPin(json.codigo_activacion, String(fila.codigoHash))).toBe(true);
    // Ni la marca ni el código de activación de la cuenta.
    expect(d.updates).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    // La lectura de la cuenta bloquea su fila hasta el commit.
    expect(d.locks[0]).toBe('update');

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.reemision_codigo',
        actor_user_id: ADMIN_ID,
        user_id: PERSONA_ID,
        vinculo: 'cuenta_activa_por_confirmar',
      }),
      expect.any(String),
    );
    expect(textoDeLogs(logger)).not.toContain(json.codigo_activacion);
    expect(observabilidad.contadores).toContainEqual({
      nombre: 'personal_booster_reemision_codigo_total',
      labels: { resultado: 'emitido', vinculo: 'cuenta_activa_por_confirmar' },
    });
  });

  it('la búsqueda de la confirmación pendiente mira la persona y consumido_en NULL', async () => {
    const d = makeDb({ lookups: [[activa()], PENDIENTE] });
    const app = await buildApp({ db: d.db });

    await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    const consulta = sqlDe(d.selectWheres[1]);
    expect(consulta.sql).toContain('"confirmaciones_acceso_booster"."usuario_id" = $1');
    expect(consulta.sql).toContain('"confirmaciones_acceso_booster"."consumido_en" is null');
    expect(consulta.params).toEqual([PERSONA_ID]);
  });

  it('sin marca y sin confirmación pendiente → 404 personal_not_found, sin escrituras', async () => {
    const d = makeDb({ lookups: [[activa()], []] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('personal_not_found');
    expect(d.deletes).toEqual([]);
    expect(d.insertedConfirmaciones).toEqual([]);
    expect(d.updates).toEqual([]);
  });

  it('el código de activación de siempre responde vinculo provisoria_sin_codigo', async () => {
    const d = makeDb({ lookups: [[existente({ isPlatformAdmin: true })]] });
    const app = await buildApp({ db: d.db });

    const res = await app.request(`/${PERSONA_ID}/codigo`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { vinculo: string }).vinculo).toBe('provisoria_sin_codigo');
    expect(d.insertedConfirmaciones).toEqual([]);
  });
});

describe('GET /admin/personal-booster — persona por confirmar (SC9)', () => {
  function filaPorConfirmar(overrides: Record<string, unknown> = {}) {
    return {
      id: PERSONA_ID,
      email: CORREO,
      fullName: 'Ana Soto',
      rut: RUT,
      firebaseUid: 'fb-ana',
      claveNumericaHash: 'hash',
      activationPinHash: null,
      activacionVenceEn: null,
      lastLoginAt: new Date('2026-11-01T12:00:00.000Z'),
      isPlatformAdmin: false,
      confirmacionVenceEn: new Date(Date.now() + 3 * 60 * 60 * 1000),
      confirmacionIntentos: 0,
      ...overrides,
    };
  }

  it('aparece como pendiente_confirmacion con el vencimiento de su código', async () => {
    const fila = filaPorConfirmar();
    const d = makeDb({ listRows: [fila] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await app.request('/');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { personal: Record<string, unknown>[] };
    expect(json.personal).toContainEqual({
      email: CORREO,
      en_lista: false,
      user_id: PERSONA_ID,
      nombre: 'Ana Soto',
      rut: RUT,
      estado: 'pendiente_confirmacion',
      expira_en: fila.confirmacionVenceEn.toISOString(),
      ultimo_login_en: null,
    });
  });

  it('sin intentos disponibles: expira_en null (hay que generar un código nuevo)', async () => {
    const d = makeDb({ listRows: [filaPorConfirmar({ confirmacionIntentos: 5 })] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await app.request('/');

    const json = (await res.json()) as { personal: Record<string, unknown>[] };
    expect(json.personal.find((p) => p.email === CORREO)).toMatchObject({
      estado: 'pendiente_confirmacion',
      expira_en: null,
    });
  });

  it('una cuenta marcada sigue con su estado aunque la consulta traiga una confirmación', async () => {
    const d = makeDb({ listRows: [filaPorConfirmar({ isPlatformAdmin: true })] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await app.request('/');

    const json = (await res.json()) as { personal: Record<string, unknown>[] };
    expect(json.personal.find((p) => p.email === CORREO)).toMatchObject({
      estado: 'activa',
      expira_en: null,
    });
  });

  it('la consulta suma a quien tiene una confirmación pendiente (join por consumido_en NULL)', async () => {
    const d = makeDb({ listRows: [] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    await app.request('/');

    expect(d.joins).toHaveLength(1);
    expect(d.joins[0]?.tabla).toBe(confirmacionesAccesoBooster);
    const on = sqlDe(d.joins[0]?.on);
    expect(on.sql).toContain('"confirmaciones_acceso_booster"."usuario_id" = "usuarios"."id"');
    expect(on.sql).toContain('"confirmaciones_acceso_booster"."consumido_en" is null');
    const where = sqlDe(d.selectWheres[0]);
    expect(where.sql).toContain('"confirmaciones_acceso_booster"."id" is not null');
  });
});

describe('POST /admin/personal-booster/:userId/quitar-acceso — persona por confirmar (SC10)', () => {
  const ADMIN_MARCADO = {
    id: ADMIN_ID,
    email: ADMIN_EMAIL,
    fullName: 'Felipe Vicencio',
    firebaseUid: 'fb-felipe',
    claveNumericaHash: 'hash',
    activationPinHash: null,
    activacionVenceEn: null,
    status: 'activo',
  };
  const POR_CONFIRMAR = [{ id: PERSONA_ID, email: 'carlos.rojas@boosterchile.com' }];

  function quitar(app: Hono) {
    return app.request(`/${PERSONA_ID}/quitar-acceso`, { method: 'POST' });
  }

  it('borra su confirmación pendiente y responde ok, sin aviso ni cambios en la cuenta', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO], lookups: [POR_CONFIRMAR] });
    const { sender, send } = makeSender();
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, sender, logger, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: PERSONA_ID });
    expect(d.deletes).toHaveLength(1);
    expect(d.deletes[0]?.tabla).toBe(confirmacionesAccesoBooster);
    const borrado = sqlDe(d.deletes[0]?.predicado);
    expect(borrado.sql).toContain('"confirmaciones_acceso_booster"."usuario_id" = $1');
    expect(borrado.sql).toContain('"confirmaciones_acceso_booster"."consumido_en" is null');
    expect(d.updates).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.confirmacion_invalidada',
        actor_user_id: ADMIN_ID,
        user_id: PERSONA_ID,
      }),
      expect.any(String),
    );
    expect(observabilidad.contadores).toContainEqual({
      nombre: 'personal_booster_quitar_acceso_total',
      labels: { resultado: 'confirmacion_invalidada' },
    });
  });

  it('con el correo en la lista de respaldo → 409 en_lista_respaldo, sin escrituras', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO], lookups: [POR_CONFIRMAR] });
    const app = await buildApp({
      db: d.db,
      lista: [ADMIN_EMAIL, 'Carlos.Rojas@boosterchile.com'],
    });

    const res = await quitar(app);

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('en_lista_respaldo');
    expect(d.deletes).toEqual([]);
    expect(d.updates).toEqual([]);
  });

  it('sin marca y sin confirmación pendiente → 404 personal_not_found, sin escrituras', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO], lookups: [[]] });
    const app = await buildApp({ db: d.db, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('personal_not_found');
    expect(d.deletes).toEqual([]);
    expect(d.updates).toEqual([]);
  });

  it('si la confirmación se consumió entre la lectura y el borrado → 404', async () => {
    const d = makeDb({ listRows: [ADMIN_MARCADO], lookups: [POR_CONFIRMAR], filasBorradas: [] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger, lista: [ADMIN_EMAIL] });

    const res = await quitar(app);

    expect(res.status).toBe(404);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'personal_booster.confirmacion_invalidada' }),
      expect.any(String),
    );
  });
});

describe('POST /admin/personal-booster — una cuenta por confirmar no avisa a la lista (SC7)', () => {
  it('el aviso de acceso otorgado no sale en el alta por confirmar', async () => {
    const d = makeDb({ lookups: [[activa()], CON_VINCULO] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender });

    await app.request('/', postJson(BODY));

    expect(send.mock.calls.filter((c) => c[0].subject.startsWith(ASUNTO_AVISO_OTORGADO))).toEqual(
      [],
    );
  });
});
