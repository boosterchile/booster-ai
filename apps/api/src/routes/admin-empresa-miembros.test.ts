import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createImpersonationWriteGuardMiddleware } from '../middleware/impersonation-write-guard.js';

/**
 * Fase 3.5 (onboarding-flow-redesign) — `POST /admin/empresas/:id/miembros`.
 *
 * Cierra el hueco que dejaba el onboarding: solo sabe crear empresa + dueño de
 * cero, y con el RUT ya registrado devuelve 409 `rut_already_registered`. Para
 * la segunda persona de un cliente (caso real: el gestor de Transportes Van
 * Oosterwyk, empresa creada en mayo con 8 vehículos y 6 conductores) no había
 * camino de producto — se resolvía con INSERT a mano en prod.
 *
 * El alta de admin emite el mismo código de activación que el equipo de la
 * empresa: la persona lo usa en POST /auth/activar y elige su clave. No se
 * crea usuario Firebase ni se devuelve un reset de contraseña.
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
  updatedRows?: unknown[];
  /** Cola de `select().limit()` cuando el test no usa el orden del invite. */
  lookupQueue?: unknown[][];
  /** Filas del `select` que hizo `innerJoin` (pendientes y reemisión). */
  joinedMembershipRows?: unknown[];
}

function makeDb(opts: DbOpts = {}) {
  const selectQueue: unknown[][] = opts.lookupQueue ?? [
    opts.empresaRows ?? [
      {
        id: EMPRESA_ID,
        razonSocial: 'Transportes Van Oosterwyk',
        status: 'pendiente_verificacion',
      },
    ],
    opts.userByEmailRows ?? [],
    opts.existingMembershipRows ?? [],
  ];
  const insertedUsers: Record<string, unknown>[] = [];
  const insertedMemberships: Record<string, unknown>[] = [];
  const insertedEmpresas: Record<string, unknown>[] = [];
  const insertedCarrierMemberships: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  // Listado (`from().orderBy().limit()` y `from().where().orderBy().limit()`),
  // join de pendientes (`innerJoin`) y lookups (`from().where().limit()`).
  // Cada `select()` arma su propia cadena.
  const listRows = opts.empresaRows ?? [];
  const joinedMembershipRows = opts.joinedMembershipRows ?? [];
  const selectChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.orderBy = vi.fn(() => chain);
    chain.limit = vi.fn(async () => {
      if ((chain.innerJoin as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        return joinedMembershipRows;
      }
      // Si el caller pidió orderBy (listado) y no hizo join, devolvemos listRows.
      // Si no, consume la cola de lookups.
      if ((chain.orderBy as ReturnType<typeof vi.fn>).mock.calls.length > 0) {
        return listRows;
      }
      return selectQueue.shift() ?? [];
    });
    return chain;
  };
  const select = vi.fn(() => selectChain());

  const insert = vi.fn((table: { _: { name?: string } } | unknown) => ({
    values: vi.fn((vals: Record<string, unknown>) => ({
      returning: vi.fn(async () => {
        if ('legalName' in vals) {
          insertedEmpresas.push(vals);
          return [
            {
              id: 'empresa-nueva-uuid',
              legalName: vals.legalName,
              rut: vals.rut,
              status: 'pendiente_verificacion',
              isGeneradorCarga: vals.isGeneradorCarga,
              isTransportista: vals.isTransportista,
            },
          ];
        }
        if ('tierSlug' in vals) {
          insertedCarrierMemberships.push(vals);
          return [{ id: 'carrier-membership-uuid' }];
        }
        // La membresía de persona trae `empresaId` y `userId`.
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

  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      updates.push(vals);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(
            async () => opts.updatedRows ?? [{ id: EMPRESA_ID, status: vals.status }],
          ),
        })),
      };
    }),
  }));

  const db = { select, insert, update };
  return {
    db: {
      ...db,
      transaction: async (fn: (tx: typeof db) => Promise<unknown>) => fn(db),
    } as never,
    insertedUsers,
    insertedMemberships,
    insertedEmpresas,
    insertedCarrierMemberships,
    updates,
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

const BODY = {
  email: 'fvicencio@me.com',
  full_name: 'Javier Vicencio',
  rut: '12345678-5',
  rol: 'admin',
};

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

  it('sin join deja miembros_pendientes vacío y dueno_pendiente null y conserva la ficha', async () => {
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
      empresas: Array<{
        razon_social: string;
        rut: string;
        estado: string;
        es_transportista: boolean;
        es_generador_carga: boolean;
        miembros_pendientes: unknown[];
        dueno_pendiente: unknown;
      }>;
    };
    expect(json.empresas).toHaveLength(1);
    const empresa = json.empresas[0];
    expect(empresa?.razon_social).toBe('Transportes Van Oosterwyk');
    expect(empresa?.rut).toBe('76653720-0');
    expect(empresa?.estado).toBe('activa');
    expect(empresa?.es_transportista).toBe(true);
    expect(empresa?.es_generador_carga).toBe(false);
    expect(empresa?.miembros_pendientes).toEqual([]);
    expect(empresa?.dueno_pendiente).toBeNull();
  });

  it('join con un dueño y un admin pendientes los lista y deja al dueño en dueno_pendiente', async () => {
    const mod = await loadMod();
    const duenoInvitado = new Date('2026-09-20T15:00:00.000Z');
    const adminInvitado = new Date('2026-09-21T15:00:00.000Z');
    const duenoMembershipId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const adminMembershipId = '8d0f7780-8536-51ef-a55c-f18ed20a1bf8';
    const duenoUserId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const adminUserId = '4eb96f75-6828-5673-a40d-3da74077b0b7';
    const d = makeDb({
      empresaRows: [
        {
          id: EMPRESA_ID,
          razonSocial: 'Transportes Van Oosterwyk',
          rut: '76653720-0',
          estado: 'pendiente_verificacion',
          esTransportista: true,
          esGeneradorCarga: false,
        },
      ],
      joinedMembershipRows: [
        {
          membershipId: adminMembershipId,
          userId: adminUserId,
          empresaId: EMPRESA_ID,
          nombre: 'Ana Admin',
          rut: '22222222-2',
          email: 'ana@van.cl',
          rol: 'admin',
          estado: 'pendiente_invitacion',
          invitadoEn: adminInvitado,
          claveNumericaHash: null,
          firebaseUid: 'pending-rut:22222222-2',
        },
        {
          membershipId: duenoMembershipId,
          userId: duenoUserId,
          empresaId: EMPRESA_ID,
          nombre: 'Javier Vicencio',
          rut: '12345678-5',
          email: 'fvicencio@me.com',
          rol: 'dueno',
          estado: 'pendiente_invitacion',
          invitadoEn: duenoInvitado,
          claveNumericaHash: null,
          firebaseUid: 'pending-rut:12345678-5',
        },
      ],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/', { method: 'GET' });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      empresas: Array<{
        miembros_pendientes: Array<{
          user_id: string;
          membership_id: string;
          nombre: string;
          rut: string;
          email: string;
          rol: string;
          invitado_en: string;
          expira_en: string;
          codigo_activacion?: string;
        }>;
        dueno_pendiente: { membership_id: string; rol: string } | null;
      }>;
    };
    const empresa = json.empresas[0];
    expect(empresa?.miembros_pendientes).toHaveLength(2);
    const sieteDias = 7 * 24 * 60 * 60 * 1000;
    for (const miembro of empresa?.miembros_pendientes ?? []) {
      expect(miembro.codigo_activacion).toBeUndefined();
      expect(Date.parse(miembro.expira_en) - Date.parse(miembro.invitado_en)).toBe(sieteDias);
    }
    const dueno = empresa?.miembros_pendientes.find((m) => m.rol === 'dueno');
    const admin = empresa?.miembros_pendientes.find((m) => m.rol === 'admin');
    expect(dueno).toEqual({
      user_id: duenoUserId,
      membership_id: duenoMembershipId,
      nombre: 'Javier Vicencio',
      rut: '12345678-5',
      email: 'fvicencio@me.com',
      rol: 'dueno',
      invitado_en: duenoInvitado.toISOString(),
      expira_en: new Date(duenoInvitado.getTime() + sieteDias).toISOString(),
    });
    expect(admin).toMatchObject({
      user_id: adminUserId,
      membership_id: adminMembershipId,
      nombre: 'Ana Admin',
      rut: '22222222-2',
      email: 'ana@van.cl',
      rol: 'admin',
      invitado_en: adminInvitado.toISOString(),
    });
    expect(empresa?.dueno_pendiente).toEqual(dueno);
    expect(JSON.stringify(json)).not.toContain('codigo_activacion');
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
  it('crea la persona pendiente y devuelve un código de activación, no un reset', async () => {
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
      estado: string;
      codigo_activacion?: string;
      access_link?: string;
    };
    expect(json.membership_id).toBe('membership-uuid');
    expect(json.rol).toBe('admin');
    expect(json.estado).toBe('pendiente_invitacion');
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    expect(json.access_link).toBeUndefined();
    expect(a.spies.createUser).not.toHaveBeenCalled();
    expect(a.spies.generatePasswordResetLink).not.toHaveBeenCalled();

    const user = d.insertedUsers[0] as Record<string, unknown>;
    expect(user.firebaseUid).toBe('pending-rut:12345678-5');
    expect(user.rut).toBe('12345678-5');
    expect(user.email).toBe('fvicencio@me.com');
    expect(user.status).toBe('pendiente_verificacion');
    expect(typeof user.activationPinHash).toBe('string');
    expect(user.activationPinHash).not.toBe(json.codigo_activacion);

    const m = d.insertedMemberships[0] as Record<string, unknown>;
    expect(m.empresaId).toBe(EMPRESA_ID);
    expect(m.role).toBe('admin');
    expect(m.status).toBe('pendiente_invitacion');
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
      userByEmailRows: [
        {
          id: 'user-existente',
          email: 'fvicencio@me.com',
          firebaseUid: 'fb-real',
          claveNumericaHash: 'hash-clave',
          activationPinHash: null,
        },
      ],
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
    expect(d.updates).toEqual([]);
    expect(d.insertedMemberships[0]).toEqual(
      expect.objectContaining({ status: 'activa', userId: 'user-existente' }),
    );
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

  it('sin RUT → 400 y no crea persona', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);
    const { rut: _rut, ...sinRut } = BODY;

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sinRut),
    });

    expect(res.status).toBe(400);
    expect(d.insertedUsers.length).toBe(0);
  });

  it('correo de otra persona → 409 email_already_registered', async () => {
    const mod = await loadMod();
    const d = makeDb({
      userByEmailRows: [],
      existingMembershipRows: [{ id: 'otro-user' }],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(BODY),
    });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('email_already_registered');
    expect(d.insertedUsers.length).toBe(0);
  });
});

describe('PATCH /admin/empresas/:id — activar sin SQL', () => {
  it('pasa pendiente_verificacion → activa y audita quién', async () => {
    const mod = await loadMod();
    const d = makeDb({
      empresaRows: [{ id: EMPRESA_ID, status: 'pendiente_verificacion' }],
      updatedRows: [{ id: EMPRESA_ID, status: 'activa' }],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado: 'activa' }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      estado: string;
      estado_anterior: string;
      unchanged: boolean;
    };
    expect(json.ok).toBe(true);
    expect(json.estado).toBe('activa');
    expect(json.estado_anterior).toBe('pendiente_verificacion');
    expect(json.unchanged).toBe(false);
    expect(d.updates[0]).toEqual(expect.objectContaining({ status: 'activa' }));
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: EMPRESA_ID,
        estadoAnterior: 'pendiente_verificacion',
        estadoNuevo: 'activa',
        adminEmail: ADMIN_EMAIL,
        actorUserId: 'admin-id',
        unchanged: false,
      }),
      'admin-empresas: estado actualizado',
    );
  });

  it('idempotente: mismo estado → 200 sin UPDATE', async () => {
    const mod = await loadMod();
    const d = makeDb({
      empresaRows: [{ id: EMPRESA_ID, status: 'activa' }],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado: 'activa' }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { unchanged: boolean; estado: string };
    expect(json.unchanged).toBe(true);
    expect(json.estado).toBe('activa');
    expect(d.updates).toHaveLength(0);
  });

  it('404 si la empresa no existe', async () => {
    const mod = await loadMod();
    const d = makeDb({ empresaRows: [] });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado: 'activa' }),
    });

    expect(res.status).toBe(404);
    expect(d.updates).toHaveLength(0);
  });

  it('niega a quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth, 'ajeno@otra.cl');

    const res = await app.request(`/${EMPRESA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado: 'activa' }),
    });

    expect(res.status).toBe(403);
    expect(d.updates).toHaveLength(0);
  });

  it('rechaza un estado fuera del enum', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ estado: 'borrada' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /admin/empresas?estado=', () => {
  it('filtra por estado pendiente_verificacion', async () => {
    const mod = await loadMod();
    const d = makeDb({
      empresaRows: [
        {
          id: EMPRESA_ID,
          razonSocial: 'Pendiente SpA',
          rut: '76653720-0',
          estado: 'pendiente_verificacion',
          esTransportista: true,
          esGeneradorCarga: false,
        },
      ],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/?estado=pendiente_verificacion', { method: 'GET' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { empresas: Array<{ estado: string }> };
    expect(json.empresas[0]?.estado).toBe('pendiente_verificacion');
  });

  it('rechaza un filtro de estado ilegal', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/?estado=borrada', { method: 'GET' });
    expect(res.status).toBe(400);
  });
});

const EMPRESA_BODY = {
  legal_name: 'Retail Norte SpA',
  rut: '12345678-5',
  contact_email: 'contacto@retailnorte.cl',
  contact_phone: '+56912345678',
  address_street: 'Av. Apoquindo 3000',
  address_city: 'Santiago',
  address_region: 'XIII',
  is_generador_carga: true,
  is_transportista: false,
};

describe('POST /admin/empresas', () => {
  it('crea un generador de carga pendiente, sin usuario ni clave', async () => {
    const mod = await loadMod();
    const d = makeDb({
      lookupQueue: [[{ id: 'plan-gratis', isActive: true }], []],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(EMPRESA_BODY),
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      ok: boolean;
      empresa_id: string;
      estado: string;
      es_generador_carga: boolean;
      es_transportista: boolean;
      codigo_activacion?: string;
    };
    expect(json.ok).toBe(true);
    expect(json.empresa_id).toBe('empresa-nueva-uuid');
    expect(json.estado).toBe('pendiente_verificacion');
    expect(json.es_generador_carga).toBe(true);
    expect(json.es_transportista).toBe(false);
    expect(json.codigo_activacion).toBeUndefined();
    expect(d.insertedUsers).toHaveLength(0);
    expect(d.insertedEmpresas[0]).toMatchObject({
      legalName: 'Retail Norte SpA',
      rut: '12345678-5',
      isGeneradorCarga: true,
      isTransportista: false,
      planId: 'plan-gratis',
      status: 'pendiente_verificacion',
      isDemo: false,
    });
    expect(d.insertedCarrierMemberships).toHaveLength(0);
    expect(a.spies.createUser).not.toHaveBeenCalled();
  });

  it('abre carrier_memberships free cuando la empresa es transportista', async () => {
    const mod = await loadMod();
    const d = makeDb({
      lookupQueue: [[{ id: 'plan-gratis', isActive: true }], []],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...EMPRESA_BODY,
        is_generador_carga: false,
        is_transportista: true,
      }),
    });

    expect(res.status).toBe(201);
    expect(d.insertedCarrierMemberships[0]).toMatchObject({
      empresaId: 'empresa-nueva-uuid',
      tierSlug: 'free',
      status: 'activa',
    });
  });

  it('rechaza el RUT de empresa ya registrado', async () => {
    const mod = await loadMod();
    const d = makeDb({
      lookupQueue: [[{ id: 'plan-gratis', isActive: true }], [{ id: 'ya-existe' }]],
    });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(EMPRESA_BODY),
    });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('rut_already_registered');
    expect(d.insertedEmpresas).toHaveLength(0);
  });

  it('rechaza una ficha que no es generador ni transportista', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...EMPRESA_BODY,
        is_generador_carga: false,
        is_transportista: false,
      }),
    });

    expect(res.status).toBe(400);
    expect(d.insertedEmpresas).toHaveLength(0);
  });

  it('no crea empresas a quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb();
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth, 'ajeno@otra.cl');

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(EMPRESA_BODY),
    });

    expect(res.status).toBe(403);
  });
});

const MEMBERSHIP_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const REEMITIR_USER_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function filaPendienteReemision(overrides: Record<string, unknown> = {}) {
  return {
    membershipId: MEMBERSHIP_ID,
    userId: REEMITIR_USER_ID,
    empresaId: EMPRESA_ID,
    nombre: 'Javier Vicencio',
    rut: '12345678-5',
    email: 'fvicencio@me.com',
    rol: 'dueno',
    estado: 'pendiente_invitacion',
    invitadoEn: new Date('2026-09-21T12:00:00.000Z'),
    claveNumericaHash: null,
    firebaseUid: 'pending-rut:12345678-5',
    ...overrides,
  };
}

describe('POST /admin/empresas/:id/miembros/:membershipId/codigo', () => {
  it('reemite un código nuevo y lo devuelve una sola vez', async () => {
    const mod = await loadMod();
    const d = makeDb({ joinedMembershipRows: [filaPendienteReemision()] });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros/${MEMBERSHIP_ID}/codigo`, {
      method: 'POST',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      codigo_activacion: string;
      estado: string;
      expira_en: string;
      membership_id: string;
      user_id: string;
      rol: string;
    };
    expect(json.codigo_activacion).toMatch(/^\d{6}$/);
    expect(json.estado).toBe('pendiente_invitacion');
    expect(json.membership_id).toBe(MEMBERSHIP_ID);
    expect(json.user_id).toBe(REEMITIR_USER_ID);
    expect(json.rol).toBe('dueno');
    const expira = Date.parse(json.expira_en);
    expect(Math.abs(expira - (Date.now() + SIETE_DIAS_MS))).toBeLessThan(10_000);

    const pinUpdate = d.updates.find((u) => 'activationPinHash' in u);
    const inviteUpdate = d.updates.find((u) => 'invitedAt' in u);
    expect(pinUpdate?.activationPinHash).toEqual(expect.any(String));
    expect(pinUpdate?.activationPinHash).not.toBe(json.codigo_activacion);
    expect(inviteUpdate?.invitedAt).toBeInstanceOf(Date);
    expect(d.updates.some((u) => u.status === 'activa')).toBe(false);
    expect(d.updates.some((u) => 'claveNumericaHash' in u)).toBe(false);

    const logs = JSON.stringify([
      vi.mocked(noopLogger.info).mock.calls,
      vi.mocked(noopLogger.warn).mock.calls,
      vi.mocked(noopLogger.error).mock.calls,
    ]);
    expect(logs).not.toContain(json.codigo_activacion);
  });

  it('409 already_activated si la persona ya activó, sin escribir', async () => {
    const variantes = [
      filaPendienteReemision({ estado: 'activa' }),
      filaPendienteReemision({ claveNumericaHash: 'hash-clave' }),
      filaPendienteReemision({ firebaseUid: 'firebase-uid-real' }),
    ];
    for (const fila of variantes) {
      const mod = await loadMod();
      const d = makeDb({ joinedMembershipRows: [fila] });
      const a = makeAuthStub();
      const app = buildApp(mod, d.db, a.auth);

      const res = await app.request(`/${EMPRESA_ID}/miembros/${MEMBERSHIP_ID}/codigo`, {
        method: 'POST',
      });

      expect(res.status).toBe(409);
      expect(((await res.json()) as { code: string }).code).toBe('already_activated');
      expect(d.updates).toHaveLength(0);
    }
  });

  it('404 membership_not_found si el join no trae la membresía', async () => {
    const mod = await loadMod();
    const d = makeDb({ joinedMembershipRows: [] });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth);

    const res = await app.request(`/${EMPRESA_ID}/miembros/${MEMBERSHIP_ID}/codigo`, {
      method: 'POST',
    });

    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe('membership_not_found');
    expect(d.updates).toHaveLength(0);
  });

  it('niega la reemisión a quien no es platform-admin', async () => {
    const mod = await loadMod();
    const d = makeDb({ joinedMembershipRows: [filaPendienteReemision()] });
    const a = makeAuthStub();
    const app = buildApp(mod, d.db, a.auth, 'ajeno@otra.cl');

    const res = await app.request(`/${EMPRESA_ID}/miembros/${MEMBERSHIP_ID}/codigo`, {
      method: 'POST',
    });

    expect(res.status).toBe(403);
    expect(d.updates).toHaveLength(0);
  });

  it('la impersonación responde 403 y no llama a update', async () => {
    const mod = await loadMod();
    const d = makeDb({ joinedMembershipRows: [filaPendienteReemision()] });
    const a = makeAuthStub();
    const routes = mod.createAdminEmpresaMiembrosRoutes({
      db: d.db,
      logger: noopLogger,
      auth: a.auth,
    });
    const app = new Hono();
    app.use('*', async (c, next) => {
      (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
        user: { id: 'admin-id', email: ADMIN_EMAIL },
      });
      (c as unknown as { set: (k: string, v: unknown) => void }).set('firebaseClaims', {
        uid: 'target-firebase-uid',
        email: undefined,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: { impersonated_by: 'admin-uuid-1' },
      });
      await next();
    });
    app.use('*', createImpersonationWriteGuardMiddleware({ logger: noopLogger }));
    app.route('/', routes);

    const updateSpy = (d.db as unknown as { update: ReturnType<typeof vi.fn> }).update;
    const res = await app.request(`/${EMPRESA_ID}/miembros/${MEMBERSHIP_ID}/codigo`, {
      method: 'POST',
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('forbidden_impersonation_write');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
