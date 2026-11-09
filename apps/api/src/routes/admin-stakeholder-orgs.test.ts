import type { Logger } from '@booster-ai/logger';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSender } from '../services/notifications/email-sender.js';

/**
 * POST /admin/stakeholder-orgs/:id/invitar — el vínculo de persona
 * (`.specs/aislamiento-vinculo-persona/spec.md`) aplicado a organizaciones
 * stakeholder: una cuenta viva o un placeholder con código no reciben un
 * código nuevo; solo la persona nueva o la provisoria sin código.
 */

const ADMIN_EMAIL = 'dev@boosterchile.com';
const ORG_ID = '55555555-5555-4555-8555-555555555555';
const RUT = '12345678-5';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never as Logger;

function org() {
  return { id: ORG_ID, deletedAt: null, nombreLegal: 'Municipalidad de Coquimbo' };
}

function usuario(over: Record<string, unknown>) {
  return {
    id: 'u-existente',
    email: 'persona@acme.cl',
    firebaseUid: 'fb-real',
    claveNumericaHash: null,
    activationPinHash: null,
    ...over,
  };
}

function makeDb(
  selects: unknown[][],
  returning: unknown[][],
  opts: { insertUserError?: unknown } = {},
) {
  const selectQueue = [...selects];
  const returningQueue = [...returning];
  const inserted: Array<Record<string, unknown>> = [];
  const sets: Array<Record<string, unknown>> = [];
  /** Predicados de cada `select().from().where(...)`, en orden. */
  const wheres: unknown[] = [];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn((predicado: unknown) => {
      wheres.push(predicado);
      return chain;
    });
    chain.limit = vi.fn(async () => selectQueue.shift() ?? []);
    return chain;
  });
  const insert = vi.fn(() => ({
    values: vi.fn((vals: Record<string, unknown>) => {
      // La cuenta trae `rut`; la membresía no.
      if ('rut' in vals && opts.insertUserError) {
        return { returning: vi.fn(async () => Promise.reject(opts.insertUserError)) };
      }
      inserted.push(vals);
      return { returning: vi.fn(async () => returningQueue.shift() ?? []) };
    }),
  }));
  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      sets.push(vals);
      return { where: vi.fn(async () => undefined) };
    }),
  }));
  return { db: { select, insert, update } as never, inserted, sets, update, wheres };
}

function buildApp(
  mod: typeof import('./admin-stakeholder-orgs.js'),
  db: ReturnType<typeof makeDb>['db'],
  email = ADMIN_EMAIL,
  emailSender?: EmailSender,
) {
  const routes = mod.createAdminStakeholderOrgsRoutes({
    db,
    logger: noopLogger,
    ...(emailSender ? { emailSender, webAppUrl: 'https://app.boosterchile.com' } : {}),
  });
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
      user: { id: 'admin-id', email },
    });
    await next();
  });
  app.route('/', routes);
  return app;
}

async function loadMod() {
  vi.resetModules();
  vi.doMock('../config.js', () => ({
    config: { BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] },
  }));
  return import('./admin-stakeholder-orgs.js');
}

function invitar(app: Hono, email = 'persona@acme.cl', rut = RUT) {
  return app.request(`/${ORG_ID}/invitar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rut, email, full_name: 'Persona Stakeholder' }),
  });
}

interface Respuesta {
  membership_id: string;
  user_id: string;
  status: string;
  codigo_activacion: string | null;
  expira_en: string | null;
  vinculo: string;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /admin/stakeholder-orgs/:id/invitar', () => {
  it('quien no es platform-admin recibe 403 y no se escribe nada', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()]], []);
    const res = await invitar(buildApp(mod, d.db, 'otro@empresa.cl'));
    expect(res.status).toBe(403);
    expect(d.inserted).toHaveLength(0);
  });

  it('RUT con DV inválido → 400 invalid_rut con error.format() (contrato TRK-003)', async () => {
    const mod = await loadMod();
    const d = makeDb([], []);
    const res = await invitar(buildApp(mod, d.db), undefined, '12345678-9');
    expect({ status: res.status, body: await res.json() }).toMatchInlineSnapshot(`
      {
        "body": {
          "details": {
            "errors": [
              "El RUT no es válido. Revisa el dígito después del guion",
            ],
          },
          "error": "invalid_rut",
        },
        "status": 400,
      }
    `);
    expect(d.inserted).toHaveLength(0);
  });

  it('organización inexistente o eliminada → 404', async () => {
    const mod = await loadMod();
    const d = makeDb([[]], []);
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(404);
    expect(d.inserted).toHaveLength(0);
  });

  // `.specs/bordes-autenticacion` SC5.
  it('persona nueva con un correo de la lista de respaldo → 409 email_already_registered, sin escribir', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], []], [[{ id: 'u-nuevo' }], [{ id: 'm-1' }]]);
    const res = await invitar(buildApp(mod, d.db), 'Dev@BoosterChile.com');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('email_already_registered');
    expect(d.inserted).toHaveLength(0);
  });

  it('persona nueva: crea el usuario con el código hasheado y membresía pendiente; devuelve el código', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], []], [[{ id: 'u-nuevo' }], [{ id: 'm-1' }]]);
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('nueva');
    expect(body.status).toBe('pendiente_invitacion');
    expect(body.codigo_activacion).toMatch(/^\d{6}$/);
    expect(body.expira_en).toBeTruthy();
    expect(d.inserted[0]).toMatchObject({ rut: RUT, firebaseUid: `pending-rut:${RUT}` });
    expect(d.inserted[0]?.activationPinHash).toBeTruthy();
    expect(d.inserted[0]?.activationPinHash).not.toBe(body.codigo_activacion);
    expect(d.inserted[1]).toMatchObject({
      userId: 'u-nuevo',
      empresaId: null,
      organizacionStakeholderId: ORG_ID,
      role: 'stakeholder_sostenibilidad',
      status: 'pendiente_invitacion',
      invitedByUserId: 'admin-id',
    });
  });

  it('cuenta viva: membresía pendiente, sin código, y no toca al usuario', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[org()], [usuario({ claveNumericaHash: 'hash-clave' })], []],
      [[{ id: 'm-1' }]],
    );
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('codigo_vigente');
    expect(body.status).toBe('pendiente_invitacion');
    expect(body.codigo_activacion).toBeNull();
    expect(body.expira_en).toBeNull();
    expect(d.update).not.toHaveBeenCalled();
    expect(d.inserted).toHaveLength(1);
    expect(d.inserted[0]).toMatchObject({ userId: 'u-existente', status: 'pendiente_invitacion' });
  });

  it('provisoria con código vigente: no emite otro ni reescribe el hash', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [
        [org()],
        [usuario({ firebaseUid: `pending-rut:${RUT}`, activationPinHash: 'hash-pin' })],
        [],
      ],
      [[{ id: 'm-1' }]],
    );
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('codigo_vigente');
    expect(body.codigo_activacion).toBeNull();
    expect(body.status).toBe('pendiente_invitacion');
    expect(d.update).not.toHaveBeenCalled();
  });

  it('alta de RUT registrado sin activar: respuesta uniforme', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[org()], [usuario({ firebaseUid: `pending-rut:${RUT}` })], []],
      [[{ id: 'm-1' }]],
    );
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(body.vinculo).toBe('codigo_vigente');
    expect(body.codigo_activacion).toBeNull();
    expect(d.update).not.toHaveBeenCalled();
  });

  it('ya miembro de la organización → 409 y no se escribe', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [usuario({ claveNumericaHash: 'hash' })], [{ id: 'm-0' }]], []);
    const res = await invitar(buildApp(mod, d.db));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'already_member', membership_id: 'm-0' });
    expect(d.inserted).toHaveLength(0);
  });
});

/**
 * `.specs/correos-solicitudes-panel` SC3 — el correo de la persona nueva se
 * compara con las cuentas existentes sin distinguir mayúsculas, y una alta
 * simultánea con el mismo correo responde el mismo 409.
 */
describe('POST /admin/stakeholder-orgs/:id/invitar — correo sin distinguir mayúsculas (correos-solicitudes-panel SC3)', () => {
  const YA_REGISTRADO = { error: 'conflict', code: 'email_already_registered' };

  it('persona nueva: la búsqueda de una cuenta con ese correo compara en minúsculas', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], [], []], [[{ id: 'u-nuevo' }], [{ id: 'm-1' }]]);

    const res = await invitar(buildApp(mod, d.db), 'Persona@Acme.cl');

    expect(res.status).toBe(201);
    // 0 = organización, 1 = persona por RUT, 2 = cuenta por correo.
    const predicado = d.wheres[2];
    if (!(predicado instanceof SQL)) {
      throw new Error('la búsqueda por correo no recibió un predicado SQL');
    }
    const consulta = new PgDialect().sqlToQuery(predicado);
    expect(consulta.sql).toBe('lower("usuarios"."email") = lower($1)');
    expect(consulta.params).toEqual(['persona@acme.cl']);
  });

  it('el correo es de otra cuenta guardada con otras mayúsculas → 409 sin crear cuenta ni membresía', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], [{ id: 'u-mayus' }]], [[{ id: 'u-nuevo' }], [{ id: 'm-1' }]]);

    const res = await invitar(buildApp(mod, d.db), 'persona@acme.cl');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(YA_REGISTRADO);
    expect(d.inserted).toHaveLength(0);
  });

  it('el UNIQUE del correo en el INSERT (alta simultánea) → el mismo 409, sin membresía', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], [], []], [[{ id: 'm-1' }]], {
      insertUserError: Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'usuarios_email_key',
      }),
    });

    const res = await invitar(buildApp(mod, d.db), 'persona@acme.cl');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual(YA_REGISTRADO);
    expect(d.inserted).toHaveLength(0);
  });
});

/**
 * T10-04 (ADR-082) — el código de activación le llega a la persona por correo,
 * no solo al admin que tiene que dictárselo.
 */
describe('correo de activación de la invitación stakeholder', () => {
  function makeSender() {
    const send = vi.fn().mockResolvedValue({ enviado: true, id: 'm-1' });
    return { sender: { send } as unknown as EmailSender, send };
  }

  function mensaje(send: ReturnType<typeof vi.fn>) {
    const call = send.mock.calls[0];
    if (!call) {
      throw new Error('no se envió correo');
    }
    return call[0] as { to: string; text: string };
  }

  it('persona nueva: le envía el código con la organización y el enlace', async () => {
    const mod = await loadMod();
    const d = makeDb([[org()], [], []], [[{ id: 'u-nuevo' }], [{ id: 'm-1' }]]);
    const { sender, send } = makeSender();
    const res = await invitar(buildApp(mod, d.db, ADMIN_EMAIL, sender));
    expect(res.status).toBe(201);
    const body = (await res.json()) as Respuesta;
    expect(send).toHaveBeenCalledTimes(1);
    const msg = mensaje(send);
    expect(msg.to).toBe('persona@acme.cl');
    expect(msg.text).toContain(body.codigo_activacion ?? 'sin-codigo');
    expect(msg.text).toContain('Municipalidad de Coquimbo');
    expect(msg.text).toContain('https://app.boosterchile.com/activar');
  });

  it('alta de RUT registrado sin activar no envía correo', async () => {
    const mod = await loadMod();
    const d = makeDb(
      [[org()], [usuario({ firebaseUid: `pending-rut:${RUT}`, email: 'registrado@acme.cl' })], []],
      [[{ id: 'm-1' }]],
    );
    const { sender, send } = makeSender();
    const res = await invitar(buildApp(mod, d.db, ADMIN_EMAIL, sender), 'otro@acme.cl');
    expect(res.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
  });

  it('cuenta viva o código vigente: no se envía correo', async () => {
    const mod = await loadMod();
    for (const over of [
      { claveNumericaHash: 'hash-clave' },
      { firebaseUid: `pending-rut:${RUT}`, activationPinHash: 'hash-pin' },
    ]) {
      const d = makeDb([[org()], [usuario(over)], []], [[{ id: 'm-1' }]]);
      const { sender, send } = makeSender();
      const res = await invitar(buildApp(mod, d.db, ADMIN_EMAIL, sender));
      expect(res.status).toBe(201);
      expect(send).not.toHaveBeenCalled();
    }
  });
});
