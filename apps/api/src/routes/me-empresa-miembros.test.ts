import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailSender } from '../services/notifications/email-sender.js';
import { createMeEmpresaMiembrosRoutes } from './me-empresa-miembros.js';

/**
 * equipo-de-la-empresa Fase A — `POST /me/empresa/miembros`.
 *
 * La empresa da de alta a su propia gente. Booster no interviene: la
 * autorización sale de la membresía activa del caller sobre ESA empresa, no de
 * un id que venga del cliente ni de la allowlist de platform-admin.
 *
 * El alta devuelve un código de un solo uso que la empresa entrega por su
 * canal. Ese código NO es la contraseña — la clave la elige después la propia
 * persona al activar (spec §6.1).
 */

const EMPRESA = 'e0000000-0000-4000-8000-000000000001';
const OTRA_EMPRESA = 'e0000000-0000-4000-8000-000000000002';
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

interface DbOpts {
  userByRut?: unknown[];
  membresiaExistente?: unknown[];
  listaEquipo?: unknown[];
  insertUserError?: unknown;
}

function makeDb(opts: DbOpts = {}) {
  const cola = [opts.userByRut ?? [], opts.membresiaExistente ?? []];
  const insertedUsers: Record<string, unknown>[] = [];
  const insertedMemberships: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => cola.shift() ?? []),
        orderBy: vi.fn(() => ({ limit: vi.fn(async () => opts.listaEquipo ?? []) })),
      })),
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => opts.listaEquipo ?? []) })),
        })),
      })),
    })),
  }));

  const insert = vi.fn(() => ({
    values: vi.fn((v: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if ('empresaId' in v) {
          insertedMemberships.push(v);
          return [{ id: 'membership-uuid' }];
        }
        if (opts.insertUserError) {
          throw opts.insertUserError;
        }
        insertedUsers.push(v);
        return [{ id: 'user-uuid' }];
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((v: Record<string, unknown>) => {
      updates.push(v);
      return { where: vi.fn(async () => undefined) };
    }),
  }));

  const tx = { select, insert, update };
  return {
    db: {
      select,
      insert,
      update,
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as never,
    insertedUsers,
    insertedMemberships,
    updates,
  };
}

function buildApp(
  db: ReturnType<typeof makeDb>['db'],
  ctx: { empresaId?: string; rol?: string } = {},
  emailSender?: EmailSender,
) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
      user: { id: 'caller-id', email: 'jefe@empresa.cl' },
      activeMembership: {
        membership: {
          id: 'membership-caller',
          empresaId: ctx.empresaId ?? EMPRESA,
          role: ctx.rol ?? 'dueno',
          status: 'activa',
        },
        empresa: {
          id: ctx.empresaId ?? EMPRESA,
          status: 'activa',
          legalName: 'Transportes Andes SpA',
        },
      },
    });
    await next();
  });
  app.route(
    '/',
    createMeEmpresaMiembrosRoutes({
      db,
      logger: noopLogger,
      ...(emailSender ? { emailSender, webAppUrl: 'https://app.boosterchile.com' } : {}),
    }),
  );
  return app;
}

const BODY = {
  full_name: 'Gabriel Barros',
  rut: '8.601.693-1',
  email: 'gobe00@gmail.com',
  rol: 'admin',
};

function post(app: Hono, body: unknown = BODY) {
  return app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /me/empresa/miembros', () => {
  it('crea la persona y devuelve un código de activación', async () => {
    const d = makeDb();
    const res = await post(buildApp(d.db));

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      user_id: string;
      membership_id: string;
      codigo_activacion: string;
      expira_en: string;
    };
    // El código se muestra UNA vez para que la empresa lo entregue.
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    expect(new Date(json.expira_en).getTime()).toBeGreaterThan(Date.now());
    expect(json.membership_id).toBe('membership-uuid');
  });

  it('guarda el email REAL de la persona, nunca un sintético', async () => {
    const d = makeDb();
    await post(buildApp(d.db));

    const u = d.insertedUsers[0] as Record<string, unknown>;
    expect(u.email).toBe('gobe00@gmail.com');
    expect(String(u.email)).not.toContain('invalid');
  });

  it('el código se persiste HASHEADO, nunca en claro', async () => {
    const d = makeDb();
    const res = await post(buildApp(d.db));
    const { codigo_activacion } = (await res.json()) as { codigo_activacion: string };

    const u = d.insertedUsers[0] as Record<string, unknown>;
    expect(u.activationPinHash).toBeDefined();
    expect(JSON.stringify(u)).not.toContain(codigo_activacion);
    // Y no queda como contraseña: el usuario nace sin clave numérica; la
    // elegirá la persona al activar.
    expect(u.claveNumericaHash).toBeUndefined();
  });

  it('la membresía nace pendiente de invitación, en la empresa del caller', async () => {
    const d = makeDb();
    await post(buildApp(d.db));

    const m = d.insertedMemberships[0] as Record<string, unknown>;
    expect(m.empresaId).toBe(EMPRESA);
    expect(m.role).toBe('admin');
    expect(m.status).toBe('pendiente_invitacion');
    expect(m.invitedByUserId).toBe('caller-id');
  });

  it('un despachador no puede sumar gente (SC6)', async () => {
    const d = makeDb();
    const res = await post(buildApp(d.db, { rol: 'despachador' }));

    expect(res.status).toBe(403);
    expect(d.insertedUsers.length).toBe(0);
  });

  it('un visualizador tampoco', async () => {
    const d = makeDb();
    const res = await post(buildApp(d.db, { rol: 'visualizador' }));
    expect(res.status).toBe(403);
  });

  it('el admin de otra empresa no puede sumar a la nuestra: usa SU empresa activa', async () => {
    const d = makeDb();
    await post(buildApp(d.db, { empresaId: OTRA_EMPRESA }));

    // El empresaId sale del userContext, no del body: no hay forma de apuntar
    // a una empresa ajena desde el cliente.
    const m = d.insertedMemberships[0] as Record<string, unknown>;
    expect(m.empresaId).toBe(OTRA_EMPRESA);
  });

  it('reusa una cuenta ya activa sin pisar su código ni su clave', async () => {
    const d = makeDb({
      userByRut: [
        {
          id: 'user-existente',
          email: 'gobe00@gmail.com',
          firebaseUid: 'fb-real',
          claveNumericaHash: 'hash-clave',
          activationPinHash: null,
        },
      ],
    });
    const res = await post(buildApp(d.db));

    expect(res.status).toBe(201);
    expect(d.insertedUsers.length).toBe(0);
    expect(d.updates).toEqual([]);
    const json = (await res.json()) as {
      user_id: string;
      codigo_activacion: string | null;
      estado: string;
      vinculo: string;
    };
    expect(json.user_id).toBe('user-existente');
    expect(json.codigo_activacion).toBeNull();
    expect(json.estado).toBe('activa');
    expect(json.vinculo).toBe('cuenta_activa');
    const m = d.insertedMemberships[0] as Record<string, unknown>;
    expect(m.status).toBe('activa');
    expect(m.joinedAt).toBeInstanceOf(Date);
  });

  it('no reemplaza el código de una persona que todavía no activa', async () => {
    const d = makeDb({
      userByRut: [
        {
          id: 'user-pendiente',
          email: 'gobe00@gmail.com',
          firebaseUid: 'pending-rut:8601693-1',
          claveNumericaHash: null,
          activationPinHash: 'hash-previo',
        },
      ],
    });
    const res = await post(buildApp(d.db));

    expect(res.status).toBe(201);
    expect(d.updates).toEqual([]);
    const json = (await res.json()) as {
      codigo_activacion: string | null;
      estado: string;
      vinculo: string;
    };
    expect(json.codigo_activacion).toBeNull();
    expect(json.estado).toBe('pendiente_invitacion');
    expect(json.vinculo).toBe('codigo_vigente');
  });

  it('emite código si la persona provisoria no tiene uno', async () => {
    const d = makeDb({
      userByRut: [
        {
          id: 'user-pendiente',
          email: 'gobe00@gmail.com',
          firebaseUid: 'pending-rut:8601693-1',
          claveNumericaHash: null,
          activationPinHash: null,
        },
      ],
    });
    const res = await post(buildApp(d.db));

    expect(res.status).toBe(201);
    const json = (await res.json()) as { codigo_activacion: string; vinculo: string };
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    expect(json.vinculo).toBe('provisoria_sin_codigo');
    expect(d.updates[0]).toEqual(
      expect.objectContaining({ activationPinHash: expect.any(String) }),
    );
    expect(JSON.stringify(d.updates[0])).not.toContain(json.codigo_activacion);
  });

  it('409 si esa persona ya es miembro de la empresa', async () => {
    const d = makeDb({
      userByRut: [{ id: 'user-existente' }],
      membresiaExistente: [{ id: 'membresia-previa' }],
    });
    const res = await post(buildApp(d.db));

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('already_member');
  });

  it('rechaza rol conductor: tiene su propia alta con licencia', async () => {
    const d = makeDb();
    const res = await post(buildApp(d.db), { ...BODY, rol: 'conductor' });
    expect(res.status).toBe(400);
  });

  it('rechaza el alta sin email: dejaría a la persona incontactable', async () => {
    const d = makeDb();
    const res = await post(buildApp(d.db), { ...BODY, email: undefined });
    expect(res.status).toBe(400);
  });

  it('carrera contra el índice único de RUT responde 409', async () => {
    const d = makeDb({
      insertUserError: { code: '23505', constraint: 'uq_usuarios_rut' },
    });
    const res = await post(buildApp(d.db));
    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('rut_already_registered');
  });
});

describe('GET /me/empresa/miembros', () => {
  it('lista el equipo de la empresa activa', async () => {
    const d = makeDb({
      listaEquipo: [
        {
          membershipId: 'm1',
          userId: 'u1',
          fullName: 'Gabriel Barros',
          email: 'gobe00@gmail.com',
          rut: '8601693-1',
          rol: 'admin',
          estado: 'activa',
          invitadoEn: new Date('2026-07-31T10:00:00Z'),
        },
      ],
    });

    const res = await buildApp(d.db).request('/', { method: 'GET' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { miembros: Array<{ email: string; rol: string }> };
    expect(json.miembros[0]?.email).toBe('gobe00@gmail.com');
    expect(json.miembros[0]?.rol).toBe('admin');
  });

  it('un despachador puede ver el equipo pero no modificarlo', async () => {
    const d = makeDb({ listaEquipo: [] });
    const res = await buildApp(d.db, { rol: 'despachador' }).request('/', { method: 'GET' });
    expect(res.status).toBe(200);
  });
});

/**
 * T10-04 (ADR-082) — el código de activación le llega a la persona por correo.
 * Antes solo lo veía quien la invitaba, que tenía que dictárselo.
 */
describe('correo de activación del equipo de la empresa', () => {
  function makeSender() {
    const send = vi.fn().mockResolvedValue({ enviado: true, id: 'm-1' });
    return { sender: { send } as unknown as EmailSender, send };
  }

  function mensaje(send: ReturnType<typeof vi.fn>) {
    const call = send.mock.calls[0];
    if (!call) {
      throw new Error('no se envió correo');
    }
    return call[0] as { to: string; subject: string; text: string };
  }

  it('invitar a una persona nueva le envía el código a su correo', async () => {
    const d = makeDb();
    const { sender, send } = makeSender();
    const res = await post(buildApp(d.db, {}, sender));

    expect(res.status).toBe(201);
    const json = (await res.json()) as { codigo_activacion: string };
    expect(send).toHaveBeenCalledTimes(1);
    const msg = mensaje(send);
    expect(msg.to).toBe('gobe00@gmail.com');
    expect(msg.text).toContain(json.codigo_activacion);
    expect(msg.text).toContain('Transportes Andes SpA');
    expect(msg.text).toContain('https://app.boosterchile.com/activar');
  });

  it('una cuenta ya activa no recibe correo: no hay código', async () => {
    const d = makeDb({
      userByRut: [
        {
          id: 'user-existente',
          email: 'gobe00@gmail.com',
          fullName: 'Gabriel Barros',
          firebaseUid: 'fb-real',
          claveNumericaHash: 'hash-clave',
          activationPinHash: null,
        },
      ],
    });
    const { sender, send } = makeSender();
    const res = await post(buildApp(d.db, {}, sender));

    expect(res.status).toBe(201);
    expect(send).not.toHaveBeenCalled();
  });

  it('una persona provisoria sin código recibe el código en su correo registrado', async () => {
    const d = makeDb({
      userByRut: [
        {
          id: 'user-provisoria',
          email: 'registrado@andes.cl',
          fullName: 'Gabriel Barros B.',
          firebaseUid: 'pending-rut:8601693-1',
          claveNumericaHash: null,
          activationPinHash: null,
        },
      ],
    });
    const { sender, send } = makeSender();
    const res = await post(buildApp(d.db, {}, sender));

    expect(res.status).toBe(201);
    const json = (await res.json()) as { codigo_activacion: string };
    const msg = mensaje(send);
    expect(msg.to).toBe('registrado@andes.cl');
    expect(msg.text).toContain(json.codigo_activacion);
  });

  it('el código no aparece en ningún log', async () => {
    const d = makeDb();
    const { sender } = makeSender();
    const res = await post(buildApp(d.db, {}, sender));
    const json = (await res.json()) as { codigo_activacion: string };
    const logs = JSON.stringify([
      (noopLogger.info as ReturnType<typeof vi.fn>).mock.calls,
      (noopLogger.warn as ReturnType<typeof vi.fn>).mock.calls,
      (noopLogger.error as ReturnType<typeof vi.fn>).mock.calls,
    ]);
    expect(logs).not.toContain(json.codigo_activacion);
  });
});
