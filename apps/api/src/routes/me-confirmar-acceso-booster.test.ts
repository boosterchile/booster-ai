import type { Logger } from '@booster-ai/logger';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmacionesAccesoBooster, users } from '../db/schema.js';
import { createImpersonationWriteGuardMiddleware } from '../middleware/impersonation-write-guard.js';
import { hashActivationPin } from '../services/activation-pin.js';
import type { EmailSender } from '../services/notifications/email-sender.js';

/**
 * `.specs/confirmar-acceso-booster` — T4 (SC4–SC7, SC13).
 *
 * `POST /me/confirmar-acceso-booster`: la persona confirma desde su sesión el
 * código que el admin de Booster le entregó en persona. Si coincide, está
 * vigente y le quedan intentos, la cuenta queda marcada como personal. Todo
 * rechazo es la misma 400.
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

/** Cada verificación de un código: con qué hash se comparó. */
const pin = vi.hoisted(() => ({ verificaciones: [] as Array<{ codigo: string; hash: string }> }));
vi.mock('../services/activation-pin.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/activation-pin.js')>();
  return {
    ...real,
    verifyActivationPin: (codigo: string, hash: string) => {
      pin.verificaciones.push({ codigo, hash });
      return real.verifyActivationPin(codigo, hash);
    },
  };
});

const ADMIN_EMAIL = 'dev@boosterchile.com';
const ADMIN_ID = '2b0c1f4e-7d65-4f0e-9a9b-6f1b2d3c4e5f';
const PERSONA_ID = '9c8b7a6d-5e4f-4a3b-9c1d-0e9f8a7b6c5d';
const CONFIRMACION_ID = '3e2d1c0b-9a8f-4e7d-8c6b-5a4f3e2d1c0b';
const CORREO = 'ana.soto@empresa.cl';
const LISTA = [ADMIN_EMAIL, 'ops@boosterchile.com'];
const CODIGO = '482915';
const HASH = hashActivationPin(CODIGO);
const UNA_HORA_MS = 60 * 60 * 1000;

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
  return { sender: { send } as EmailSender, send };
}

/** La cuenta de la sesión, tal como la lee (y bloquea) la confirmación. */
function persona(overrides: Record<string, unknown> = {}) {
  return {
    id: PERSONA_ID,
    email: CORREO,
    fullName: 'Ana Soto',
    isPlatformAdmin: false,
    ...overrides,
  };
}

/** La confirmación pendiente de la persona. */
function confirmacion(overrides: Record<string, unknown> = {}) {
  return {
    id: CONFIRMACION_ID,
    codigoHash: HASH,
    venceEn: new Date(Date.now() + UNA_HORA_MS),
    intentosFallidos: 0,
    emitidoPorUsuarioId: ADMIN_ID,
    ...overrides,
  };
}

interface DbOpts {
  /** Respuestas de `select().from().where()…limit()`, en orden. */
  lookups?: unknown[][];
  /** Filas de `update().set().where().returning()`. Vacío = no encontró la fila. */
  filasActualizadas?: unknown[];
}

function makeDb(opts: DbOpts = {}) {
  const lookups = [...(opts.lookups ?? [])];
  const locks: unknown[] = [];
  const selectWheres: unknown[] = [];
  const updates: Array<{ tabla: unknown; valores: Record<string, unknown>; predicado: unknown }> =
    [];

  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn((predicado: unknown) => {
      selectWheres.push(predicado);
      return chain;
    });
    chain.for = vi.fn((fuerza: unknown) => {
      locks.push(fuerza);
      return chain;
    });
    chain.limit = vi.fn(async () => lookups.shift() ?? []);
    return chain;
  });

  const update = vi.fn((tabla: unknown) => ({
    set: vi.fn((valores: Record<string, unknown>) => ({
      where: vi.fn((predicado: unknown) => {
        updates.push({ tabla, valores, predicado });
        return Object.assign(Promise.resolve(undefined), {
          returning: vi.fn(async () => opts.filasActualizadas ?? [{ id: CONFIRMACION_ID }]),
        });
      }),
    })),
  }));

  const base = { select, update };
  const transaction = vi.fn(async (fn: (tx: typeof base) => Promise<unknown>) => fn(base));
  return {
    db: { ...base, transaction } as never,
    select,
    update,
    transaction,
    locks,
    selectWheres,
    updates,
  };
}

function sqlDe(valor: unknown) {
  if (!(valor instanceof SQL)) {
    throw new Error('se esperaba SQL');
  }
  return new PgDialect().sqlToQuery(valor);
}

type Sesion = 'normal' | 'impersonada' | null;

async function buildApp(opts: {
  db: ReturnType<typeof makeDb>['db'];
  sender?: EmailSender;
  logger?: ReturnType<typeof makeLogger>;
  sesion?: Sesion;
  /** Empresa activa de prueba (el guard deja escribir sobre ella). */
  empresaDePrueba?: boolean;
}) {
  const mod = await import('./me-confirmar-acceso-booster.js');
  const routes = mod.createMeConfirmarAccesoBoosterRoutes({
    db: opts.db,
    logger: (opts.logger ?? makeLogger()) as never as Logger,
    platformAdminEmails: LISTA,
    emailSender: opts.sender ?? makeSender().sender,
    webAppUrl: 'https://app.boosterchile.com',
  });
  const app = new Hono();
  const sesion = opts.sesion === undefined ? 'normal' : opts.sesion;
  if (sesion !== null) {
    app.use('*', async (c, next) => {
      const activa = opts.empresaDePrueba
        ? { membership: { id: 'm-1' }, empresa: { id: 'e-1', isTestUser: true } }
        : null;
      c.set(
        'userContext' as never,
        {
          user: { id: PERSONA_ID, email: CORREO, fullName: 'Ana Soto', isPlatformAdmin: false },
          memberships: activa ? [activa] : [],
          activeMembership: activa,
          impersonatedBy: sesion === 'impersonada' ? 'admin-uid-1' : null,
        } as never,
      );
      await next();
    });
  }
  app.route('/', routes);
  return app;
}

function confirmar(app: Hono, codigo: unknown = CODIGO) {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ codigo }),
  });
}

const RECHAZO = { error: 'codigo_invalido', code: 'codigo_invalido' };

function textoDeLogs(logger: ReturnType<typeof makeLogger>): string {
  return JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls, logger.error.mock.calls]);
}

beforeEach(() => {
  vi.clearAllMocks();
  observabilidad.contadores.length = 0;
  observabilidad.spans.length = 0;
  pin.verificaciones.length = 0;
});

describe('POST /me/confirmar-acceso-booster — confirma (SC4)', () => {
  it('código correcto y vigente: marca la cuenta, consume la confirmación y responde ok', async () => {
    const d = makeDb({
      lookups: [[persona()], [confirmacion()], [{ email: ADMIN_EMAIL }]],
    });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, user_id: PERSONA_ID });
    expect(d.transaction).toHaveBeenCalledTimes(1);

    const consumo = d.updates.find((u) => u.tabla === confirmacionesAccesoBooster);
    expect(consumo?.valores.consumidoEn).toBeInstanceOf(Date);
    const predicadoConsumo = sqlDe(consumo?.predicado);
    expect(predicadoConsumo.sql).toContain('"confirmaciones_acceso_booster"."id" = $1');
    expect(predicadoConsumo.sql).toContain(
      '"confirmaciones_acceso_booster"."consumido_en" is null',
    );

    const marca = d.updates.find((u) => u.tabla === users);
    expect(marca?.valores.isPlatformAdmin).toBe(true);
    expect(sqlDe(marca?.predicado).params).toEqual([PERSONA_ID]);
    // Ni la clave, ni el correo, ni el estado de la cuenta.
    for (const campo of ['claveNumericaHash', 'email', 'status', 'activationPinHash']) {
      expect(marca?.valores).not.toHaveProperty(campo);
    }
  });

  it('bloquea la fila de la cuenta y después la de la confirmación hasta el commit (SC6)', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()], [{ email: ADMIN_EMAIL }]] });
    const app = await buildApp({ db: d.db });

    await confirmar(app);

    expect(d.locks).toEqual(['update', 'update']);
    expect(sqlDe(d.selectWheres[0]).sql).toContain('"usuarios"."id" = $1');
    const pendiente = sqlDe(d.selectWheres[1]);
    expect(pendiente.sql).toContain('"confirmaciones_acceso_booster"."usuario_id" = $1');
    expect(pendiente.sql).toContain('"confirmaciones_acceso_booster"."consumido_en" is null');
    expect(pendiente.params).toEqual([PERSONA_ID]);
  });

  it('avisa a la lista de respaldo con quien entregó el código, sin el código (SC7)', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()], [{ email: ADMIN_EMAIL }]] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender });

    await confirmar(app);

    expect(send.mock.calls.map((c) => c[0].to)).toEqual(LISTA);
    const msg = send.mock.calls[0]?.[0];
    expect(msg?.subject).toBe('Booster: acceso al panel otorgado a Ana Soto');
    expect(msg?.text).toContain(`Ana Soto (${CORREO}) confirmó desde su sesión`);
    expect(msg?.text).toContain(ADMIN_EMAIL);
    expect(JSON.stringify(send.mock.calls)).not.toContain(CODIGO);
  });

  it('auditoría: acceso_otorgado con quien emitió, a quién y via confirmacion, sin el código (SC7)', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()], [{ email: ADMIN_EMAIL }]] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger });

    await confirmar(app);

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.acceso_otorgado',
        actor_user_id: ADMIN_ID,
        user_id: PERSONA_ID,
        via: 'confirmacion',
        avisos_destinatarios: 2,
        avisos_enviados: 2,
      }),
      expect.any(String),
    );
    const logs = textoDeLogs(logger);
    expect(logs).not.toContain(CODIGO);
    expect(logs).not.toContain(HASH);
  });

  it('métrica y span con el resultado, sin el código (SC13)', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()], [{ email: ADMIN_EMAIL }]] });
    const app = await buildApp({ db: d.db });

    await confirmar(app);

    expect(observabilidad.contadores).toEqual([
      { nombre: 'personal_booster_confirmacion_total', labels: { resultado: 'confirmado' } },
    ]);
    expect(observabilidad.spans).toHaveLength(1);
    expect(observabilidad.spans[0]?.nombre).toBe('personal_booster.confirmar_acceso');
    expect(observabilidad.spans[0]?.atributos).toMatchObject({
      'booster.user_id': PERSONA_ID,
      'personal_booster.resultado': 'confirmado',
    });
    expect(JSON.stringify(observabilidad)).not.toContain(CODIGO);
  });

  it('una cuenta que ya estaba marcada consume la confirmación sin avisar de nuevo', async () => {
    const d = makeDb({ lookups: [[persona({ isPlatformAdmin: true })], [confirmacion()]] });
    const { sender, send } = makeSender();
    const app = await buildApp({ db: d.db, sender });

    const res = await confirmar(app);

    expect(res.status).toBe(200);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('POST /me/confirmar-acceso-booster — rechazos con la misma respuesta (SC5, SC6)', () => {
  it('código incorrecto: 400 codigo_invalido y suma un intento fallido, sin marcar', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion({ intentosFallidos: 2 })]] });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app, '111111');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(d.updates).toHaveLength(1);
    expect(d.updates[0]?.tabla).toBe(confirmacionesAccesoBooster);
    const suma = sqlDe(d.updates[0]?.valores.intentosFallidos);
    expect(suma.sql).toBe('"confirmaciones_acceso_booster"."intentos_fallidos" + 1');
    expect(sqlDe(d.updates[0]?.predicado).params).toEqual([CONFIRMACION_ID]);
  });

  it('sin confirmación pendiente: la misma 400, verifica contra un hash de relleno y no escribe', async () => {
    const d = makeDb({ lookups: [[persona()], []] });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(d.updates).toEqual([]);
    expect(pin.verificaciones).toHaveLength(1);
    expect(pin.verificaciones[0]?.codigo).toBe(CODIGO);
    expect(pin.verificaciones[0]?.hash).not.toBe(HASH);
  });

  it('código vencido: la misma 400, sin sumar intento ni marcar', async () => {
    const d = makeDb({
      lookups: [[persona()], [confirmacion({ venceEn: new Date(Date.now() - 60_000) })]],
    });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(d.updates).toEqual([]);
  });

  it('el quinto código incorrecto deja la confirmación con cinco intentos y lo registra', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion({ intentosFallidos: 4 })]] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger });

    const res = await confirmar(app, '000000');

    expect(res.status).toBe(400);
    expect(d.updates).toHaveLength(1);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.confirmacion_rechazada',
        user_id: PERSONA_ID,
        motivo: 'incorrecto',
        intentos_fallidos: 5,
      }),
      expect.any(String),
    );
  });

  it('con cinco intentos fallidos ni el código correcto sirve: la misma 400, sin escrituras', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion({ intentosFallidos: 5 })]] });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(d.updates).toEqual([]);
  });

  it('una confirmación que otra request consumió en el intervalo: la misma 400, sin marcar', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()]], filasActualizadas: [] });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(d.updates.filter((u) => u.tabla === users)).toEqual([]);
  });

  it('una cuenta que ya no está en la base: la misma 400', async () => {
    const d = makeDb({ lookups: [[]] });
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(d.updates).toEqual([]);
  });

  it.each([
    ['sin_codigo', [[persona()], []], CODIGO],
    ['incorrecto', [[persona()], [confirmacion()]], '111111'],
    ['vencido', [[persona()], [confirmacion({ venceEn: new Date(Date.now() - 1000) })]], CODIGO],
    ['agotado', [[persona()], [confirmacion({ intentosFallidos: 5 })]], CODIGO],
  ])('motivo %s: counter y evento de rechazo, sin el código', async (motivo, lookups, codigo) => {
    const d = makeDb({ lookups: lookups as unknown[][] });
    const logger = makeLogger();
    const app = await buildApp({ db: d.db, logger });

    const res = await confirmar(app, codigo);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual(RECHAZO);
    expect(observabilidad.contadores).toEqual([
      { nombre: 'personal_booster_confirmacion_total', labels: { resultado: motivo } },
    ]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'personal_booster.confirmacion_rechazada',
        user_id: PERSONA_ID,
        motivo,
      }),
      expect.any(String),
    );
    expect(textoDeLogs(logger)).not.toContain(codigo);
    expect(JSON.stringify(observabilidad)).not.toContain(codigo);
  });
});

describe('POST /me/confirmar-acceso-booster — sesión e impersonación (SC4, SC12)', () => {
  it('en una sesión de impersonación → 403 forbidden_impersonation_write, sin leer la base', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()]] });
    // Aunque la empresa activa sea de prueba, la confirmación no se hace impersonando.
    const app = await buildApp({ db: d.db, sesion: 'impersonada', empresaDePrueba: true });

    const res = await confirmar(app);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'forbidden_impersonation_write',
      code: 'forbidden_impersonation_write',
    });
    expect(d.select).not.toHaveBeenCalled();
    expect(d.updates).toEqual([]);
  });

  it('con el guard del server delante: la escritura impersonada se bloquea antes del handler', async () => {
    const d = makeDb({ lookups: [[persona()], [confirmacion()]] });
    const mod = await import('./me-confirmar-acceso-booster.js');
    const logger = makeLogger() as never as Logger;
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set(
        'firebaseClaims' as never,
        {
          uid: 'fb-ana',
          email: undefined,
          emailVerified: false,
          name: undefined,
          picture: undefined,
          custom: { impersonated_by: 'admin-uid-1' },
        } as never,
      );
      await next();
    });
    app.use('*', createImpersonationWriteGuardMiddleware({ logger }));
    app.route(
      '/',
      mod.createMeConfirmarAccesoBoosterRoutes({
        db: d.db,
        logger,
        platformAdminEmails: LISTA,
        emailSender: makeSender().sender,
        webAppUrl: 'https://app.boosterchile.com',
      }),
    );

    const res = await confirmar(app);

    expect(res.status).toBe(403);
    expect(d.select).not.toHaveBeenCalled();
  });

  it('sin sesión → 401, sin leer la base', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db, sesion: null });

    const res = await confirmar(app);

    expect(res.status).toBe(401);
    expect(d.select).not.toHaveBeenCalled();
  });

  it('un código que no tiene 6 dígitos → 400 con el body común, sin leer la base', async () => {
    const d = makeDb();
    const app = await buildApp({ db: d.db });

    const res = await confirmar(app, '12345');

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: { issues: unknown[] } };
    expect(body.success).toBe(false);
    expect(JSON.stringify(body)).toContain('El código tiene 6 números');
    expect(d.select).not.toHaveBeenCalled();
  });
});
