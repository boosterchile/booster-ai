import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Fase 3.5 (onboarding-flow-redesign) — `POST /admin/empresas/:id/miembros`.
 *
 * Cierra el hueco que dejaba el onboarding: solo sabe crear empresa + dueño de
 * cero, y con el RUT ya registrado devuelve 409 `rut_already_registered`. Para
 * la segunda persona de un cliente (caso real: el gestor de Transportes Van
 * Oosterwyk, empresa creada en mayo con 8 vehículos y 6 conductores) no había
 * camino de producto — se resolvía con INSERT a mano en prod.
 *
 * Reusa el link de acceso de T2.0: la cuenta que crea el Admin SDK no tiene
 * contraseña ni email verificado, así que sin ese link el invitado no entra.
 */

const ADMIN_EMAIL = 'dev@boosterchile.com';
const EMPRESA_ID = '60c344e0-b925-43a6-a7b3-aa6b07fac721';
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

function makeAuthStub() {
  const createUser = vi.fn(async () => ({ uid: 'fb-invited-uid' }));
  const generatePasswordResetLink = vi.fn(
    async () => 'https://app.boosterchile.com/__/auth/action?mode=resetPassword&oobCode=inv',
  );
  return {
    auth: { createUser, generatePasswordResetLink } as unknown as Auth,
    spies: { createUser, generatePasswordResetLink },
  };
}

interface DbOpts {
  empresaRows?: unknown[];
  userByEmailRows?: unknown[];
  existingMembershipRows?: unknown[];
}

function makeDb(opts: DbOpts = {}) {
  const selectQueue = [
    opts.empresaRows ?? [{ id: EMPRESA_ID, razonSocial: 'Transportes Van Oosterwyk' }],
    opts.userByEmailRows ?? [],
    opts.existingMembershipRows ?? [],
  ];
  const insertedUsers: Record<string, unknown>[] = [];
  const insertedMemberships: Record<string, unknown>[] = [];

  // Dos formas de query conviven: el listado (`from().orderBy().limit()`) y
  // los lookups puntuales (`from().where().limit()`), que consumen la cola.
  const listRows = opts.empresaRows ?? [];
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => selectQueue.shift() ?? []),
      })),
      orderBy: vi.fn(() => ({
        limit: vi.fn(async () => listRows),
      })),
    })),
  }));

  const insert = vi.fn((table: { _: { name?: string } } | unknown) => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        // Distingue por forma del payload: la membresía trae `empresaId`.
        if ('empresaId' in vals) {
          insertedMemberships.push(vals);
          return [{ id: 'membership-uuid' }];
        }
        insertedUsers.push(vals);
        return [{ id: 'user-uuid' }];
      }),
    })),
    _table: table,
  }));

  return {
    db: { select, insert } as never,
    insertedUsers,
    insertedMemberships,
  };
}

function buildApp(
  mod: typeof import('./admin-empresa-miembros.js'),
  db: ReturnType<typeof makeDb>['db'],
  auth: Auth,
  adminEmail: string = ADMIN_EMAIL,
) {
  const routes = mod.createAdminEmpresaMiembrosRoutes({ db, logger: noopLogger, auth });
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
      user: { id: 'admin-id', email: adminEmail },
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
  return import('./admin-empresa-miembros.js');
}

const BODY = { email: 'fvicencio@me.com', full_name: 'Javier Vicencio', rol: 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /admin/empresas', () => {
  it('lista empresas para que el admin elija a cuál sumar la persona', async () => {
    const mod = await loadMod();
    const d = makeDb({
      empresaRows: [
        {
          id: EMPRESA_ID,
          razonSocial: 'Transportes Van Oosterwyk',
          rut: '76653720-0',
          estado: 'activa',
          esTransportista: true,
          esGeneradorCarga: false,
        },
      ],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/', { method: 'GET' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      empresas: Array<{ id: string; razon_social: string; rut: string }>;
    };
    expect(json.empresas[0]?.razon_social).toBe('Transportes Van Oosterwyk');
    expect(json.empresas[0]?.rut).toBe('76653720-0');
  });

  it('no lista empresas a quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth, 'ajeno@otra.cl');

    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/empresas/:id/miembros', () => {
  it('crea usuario + membresía y devuelve el link de acceso', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      user_id: string;
      membership_id: string;
      rol: string;
      access_link?: string;
    };
    expect(json.membership_id).toBe('membership-uuid');
    expect(json.rol).toBe('admin');
    expect(json.access_link).toBe(
      'https://app.boosterchile.com/__/auth/action?mode=resetPassword&oobCode=inv',
    );

    // Cuenta Firebase real (no un placeholder `pending-rut:`): el invitado
    // tiene que poder autenticarse de verdad.
    expect(a.spies.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'fvicencio@me.com', emailVerified: false }),
    );
    // La membresía queda en la empresa indicada, con el rol pedido y auditando
    // quién invitó.
    const m = d.insertedMemberships[0] as Record<string, unknown>;
    expect(m.empresaId).toBe(EMPRESA_ID);
    expect(m.role).toBe('admin');
    expect(m.invitedByUserId).toBe('admin-id');
  });

  it('rechaza a quien no está en la allowlist de platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth, 'ajeno@otra.cl');

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(403);
    expect(a.spies.createUser).not.toHaveBeenCalled();
  });

  it('404 si la empresa no existe — no crea cuentas huérfanas en Firebase', async () => {
    const mod = await loadMod();
    const d = makeDb({ empresaRows: [] });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(404);
    expect(a.spies.createUser).not.toHaveBeenCalled();
  });

  it('409 si esa persona ya es miembro de la empresa', async () => {
    const mod = await loadMod();
    const d = makeDb({
      userByEmailRows: [{ id: 'user-existente', email: 'fvicencio@me.com' }],
      existingMembershipRows: [{ id: 'membership-previa' }],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('already_member');
  });

  it('reusa el usuario existente en vez de duplicarlo en Firebase', async () => {
    const mod = await loadMod();
    const d = makeDb({
      userByEmailRows: [{ id: 'user-existente', email: 'fvicencio@me.com' }],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(201);
    expect(a.spies.createUser).not.toHaveBeenCalled();
    expect(d.insertedUsers.length).toBe(0);
    const json = (await res.json()) as { user_id: string };
    expect(json.user_id).toBe('user-existente');
  });

  it('rechaza rol conductor: tiene su propio alta con licencia y vencimientos', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...BODY, rol: 'conductor' }),
    });

    expect(res.status).toBe(400);
  });

  it('el alta sobrevive si Firebase no puede generar el link de acceso', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    a.spies.generatePasswordResetLink.mockRejectedValueOnce(new Error('firebase down'));
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as { membership_id: string; access_link?: string };
    expect(json.membership_id).toBe('membership-uuid');
    expect(json.access_link).toBeUndefined();
  });
});
