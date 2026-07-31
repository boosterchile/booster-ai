import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashActivationPin } from '../services/activation-pin.js';
import { createAuthActivarRoutes } from './auth-activar.js';

/**
 * equipo-de-la-empresa Fase A — `POST /auth/activar`.
 *
 * La persona que la empresa dio de alta prueba identidad con el código que le
 * entregaron y, en el mismo acto, **elige su clave**. Ese es el punto: el
 * código sirve una vez y no queda como contraseña, a diferencia del flujo de
 * conductores (`auth-driver.ts:151`), donde el PIN del admin termina siendo la
 * credencial permanente de la persona.
 *
 * Respuestas sin oráculo: RUT inexistente, código incorrecto, cuenta ya
 * activada y código vencido colapsan en la MISMA respuesta, para no revelar
 * qué RUTs existen ni en qué estado están.
 */

const RUT = '8601693-1';
const CODIGO = '135790';
const CLAVE = '482915';

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
  /** Fila de `usuarios` que devuelve el lookup por RUT. */
  user?: Record<string, unknown> | null;
  /** Membresía pendiente asociada. */
  membresia?: Record<string, unknown> | null;
}

function makeDb(opts: DbOpts = {}) {
  const user =
    opts.user === undefined
      ? {
          id: 'user-1',
          rut: RUT,
          email: 'gobe00@gmail.com',
          fullName: 'Gabriel Barros',
          firebaseUid: `pending-rut:${RUT}`,
          activationPinHash: hashActivationPin(CODIGO),
          status: 'pendiente_verificacion',
        }
      : opts.user;

  const membresia =
    opts.membresia === undefined
      ? {
          id: 'membresia-1',
          empresaId: 'empresa-1',
          status: 'pendiente_invitacion',
          // invitada hace 2 días: el código vive 7
          invitedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        }
      : opts.membresia;

  const cola: unknown[][] = [user ? [user] : [], membresia ? [membresia] : []];
  const userUpdates: Record<string, unknown>[] = [];
  const membresiaUpdates: Record<string, unknown>[] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({ limit: vi.fn(async () => cola.shift() ?? []) })),
    })),
  }));

  const update = vi.fn((table: unknown) => ({
    set: vi.fn((v: Record<string, unknown>) => {
      // La membresía se distingue por los campos que toca.
      if ('status' in v && ('joinedAt' in v || v.status === 'activa')) {
        membresiaUpdates.push(v);
      } else {
        userUpdates.push(v);
      }
      return { where: vi.fn(async () => undefined) };
    }),
    _t: table,
  }));

  const tx = { select, update };
  return {
    db: {
      select,
      update,
      transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    } as never,
    userUpdates,
    membresiaUpdates,
  };
}

function makeAuth() {
  const createUser = vi.fn(async (_props: Record<string, unknown>) => ({ uid: 'fb-nuevo' }));
  const createCustomToken = vi.fn(async (_uid: string, _claims?: unknown) => 'ct-activacion');
  const getUserByEmail = vi.fn(async () => null);
  return {
    auth: { createUser, createCustomToken, getUserByEmail } as unknown as Auth,
    spies: { createUser, createCustomToken },
  };
}

function buildApp(db: ReturnType<typeof makeDb>['db'], auth: Auth) {
  const app = new Hono();
  app.route('/', createAuthActivarRoutes({ db, logger: noopLogger, firebaseAuth: auth }));
  return app;
}

function activar(app: Hono, body: Record<string, unknown> = {}) {
  return app.request('/activar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rut: RUT, codigo: CODIGO, clave_numerica: CLAVE, ...body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /auth/activar', () => {
  it('activa la cuenta y devuelve sesión', async () => {
    const d = makeDb();
    const a = makeAuth();
    const res = await activar(buildApp(d.db, a.auth));

    expect(res.status).toBe(200);
    const json = (await res.json()) as { custom_token: string };
    expect(json.custom_token).toBe('ct-activacion');
    expect(a.spies.createCustomToken).toHaveBeenCalledWith('fb-nuevo', expect.any(Object));
  });

  it('guarda la clave que eligió la persona, hasheada, y borra el código', async () => {
    const d = makeDb();
    const a = makeAuth();
    await activar(buildApp(d.db, a.auth));

    const u = d.userUpdates[0] as Record<string, unknown>;
    expect(u.claveNumericaHash).toBeDefined();
    expect(u.claveNumericaHash).not.toBe(CLAVE);
    expect(JSON.stringify(u)).not.toContain(CLAVE);
    // El código es de un solo uso: se limpia al consumirlo.
    expect(u.activationPinHash).toBeNull();
    expect(u.status).toBe('activo');
  });

  it('NO toca el email real de la persona', async () => {
    const d = makeDb();
    const a = makeAuth();
    await activar(buildApp(d.db, a.auth));

    // Este es el defecto de `auth-driver.ts:173`, que pisa el email con un
    // sintético y deja a la persona sin canal con la plataforma.
    const u = d.userUpdates[0] as Record<string, unknown>;
    expect(u.email).toBeUndefined();
  });

  it('la membresía pasa a activa', async () => {
    const d = makeDb();
    const a = makeAuth();
    await activar(buildApp(d.db, a.auth));

    const m = d.membresiaUpdates[0] as Record<string, unknown>;
    expect(m.status).toBe('activa');
    expect(m.joinedAt).toBeInstanceOf(Date);
  });

  it('el código NO queda como contraseña de Firebase', async () => {
    const d = makeDb();
    const a = makeAuth();
    await activar(buildApp(d.db, a.auth));

    const args = a.spies.createUser.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(JSON.stringify(args ?? {})).not.toContain(CODIGO);
    expect(JSON.stringify(args ?? {})).not.toContain(CLAVE);
  });

  it('código incorrecto → 401 genérico', async () => {
    const d = makeDb();
    const a = makeAuth();
    const res = await activar(buildApp(d.db, a.auth), { codigo: '999999' });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'invalid_credentials',
      code: 'invalid_credentials',
    });
    expect(a.spies.createUser).not.toHaveBeenCalled();
  });

  it('RUT inexistente → la MISMA respuesta que código incorrecto (sin oráculo)', async () => {
    const d = makeDb({ user: null });
    const a = makeAuth();
    const res = await activar(buildApp(d.db, a.auth));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: 'invalid_credentials',
      code: 'invalid_credentials',
    });
  });

  it('cuenta ya activada (sin código pendiente) → misma respuesta', async () => {
    const d = makeDb({
      user: {
        id: 'user-1',
        rut: RUT,
        email: 'gobe00@gmail.com',
        firebaseUid: 'fb-real',
        activationPinHash: null,
        status: 'activo',
      },
    });
    const a = makeAuth();
    const res = await activar(buildApp(d.db, a.auth));

    expect(res.status).toBe(401);
    expect(a.spies.createUser).not.toHaveBeenCalled();
  });

  it('código vencido (más de 7 días) → misma respuesta', async () => {
    const d = makeDb({
      membresia: {
        id: 'membresia-1',
        empresaId: 'empresa-1',
        status: 'pendiente_invitacion',
        invitedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });
    const a = makeAuth();
    const res = await activar(buildApp(d.db, a.auth));

    expect(res.status).toBe(401);
    expect(a.spies.createUser).not.toHaveBeenCalled();
  });

  it('rechaza una clave que no sea de 6 dígitos', async () => {
    const d = makeDb();
    const a = makeAuth();
    const res = await activar(buildApp(d.db, a.auth), { clave_numerica: '123' });
    expect(res.status).toBe(400);
  });
});
