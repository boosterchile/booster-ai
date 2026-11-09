import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { createAuthActivarRoutes } from '../../src/routes/auth-activar.js';
import { createMeEmpresaMiembrosRoutes } from '../../src/routes/me-empresa-miembros.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/** Alta de miembro con un RUT ya registrado en Booster. */

const noop = (): void => undefined;
const sinRateLimit: MiddlewareHandler = async (_c, next) => {
  await next();
};
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

function authEnMemoria(): Auth {
  const porEmail = new Map<string, { uid: string; email: string }>();
  const nf = (k: string) =>
    Object.assign(new Error(`no user ${k}`), { code: 'auth/user-not-found' });
  return {
    async createUser(p: { email?: string }) {
      const u = { uid: `fb-${randomUUID().slice(0, 8)}`, email: p.email ?? 'x@x.invalid' };
      porEmail.set(u.email, u);
      return u;
    },
    async getUserByEmail(e: string) {
      const u = porEmail.get(e);
      if (!u) {
        throw nf(e);
      }
      return u;
    },
    async createCustomToken(uid: string) {
      return `custom-token-${uid}`;
    },
  } as unknown as Auth;
}

type Empresa = {
  empresa: typeof schema.empresas.$inferSelect;
  dueno: typeof schema.users.$inferSelect;
  membresia: typeof schema.memberships.$inferSelect;
};

describe('integration: alta de miembro con RUT existente', () => {
  let h: TestDbHandle;
  const firebase = authEnMemoria();
  let A: Empresa;
  let B: Empresa;
  let C: Empresa;

  async function crearEmpresa(tag: string): Promise<Empresa> {
    const s = randomUUID().slice(0, 6);
    await h.db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'p', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await h.db.select().from(schema.plans).where(eq(schema.plans.slug, 'gratis'));
    const [dueno] = await h.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-${tag}-${s}`,
        email: `dueno-${tag}-${s}@test.invalid`,
        fullName: `Dueño ${tag}`,
        rut: rutAleatorio(),
      })
      .returning();
    const [empresa] = await h.db
      .insert(schema.empresas)
      .values({
        legalName: `Empresa ${tag} ${s}`,
        rut: rutAleatorio(),
        contactEmail: `${tag}-${s}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        isGeneradorCarga: true,
        status: 'activa',
        planId: plan?.id ?? '',
      })
      .returning();
    const [membresia] = await h.db
      .insert(schema.memberships)
      .values({
        userId: dueno?.id ?? '',
        empresaId: empresa?.id ?? '',
        role: 'dueno',
        status: 'activa',
        joinedAt: new Date(),
      })
      .returning();
    if (!dueno || !empresa || !membresia) {
      throw new Error('fixture incompleto');
    }
    return { empresa, dueno, membresia };
  }

  function app(e: Empresa) {
    const activa = { membership: e.membresia, empresa: e.empresa };
    const ctx = {
      user: e.dueno,
      memberships: [activa],
      activeMembership: activa,
      impersonatedBy: null,
    } as unknown as UserContext;
    const a = new Hono();
    a.use('/me/*', async (c, next) => {
      c.set('userContext', ctx);
      await next();
    });
    a.route('/me/empresa/miembros', createMeEmpresaMiembrosRoutes({ db: h.db, logger }));
    a.route(
      '/auth',
      createAuthActivarRoutes({
        db: h.db,
        logger,
        firebaseAuth: firebase,
        // Nadie del personal de Booster en estos casos.
        platformAdminEmails: [],
        rateLimitPerRut: sinRateLimit,
      }),
    );
    return a;
  }

  async function post(e: Empresa, path: string, body: unknown) {
    const res = await app(e).request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  }

  async function membresias(userId: string) {
    return h.db
      .select({ empresaId: schema.memberships.empresaId, status: schema.memberships.status })
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, userId));
  }

  beforeAll(async () => {
    h = createTestDb();
    A = await crearEmpresa('A');
    B = await crearEmpresa('B');
    C = await crearEmpresa('C');
  });
  afterAll(async () => {
    await h.pool.end();
  });

  const rutP = rutAleatorio();
  let userP = '';
  let codigoA = '';
  let respuestaExistente: Record<string, unknown> = {};

  test('alta de RUT registrado: respuesta y lista uniformes', async () => {
    const alta = await post(A, '/me/empresa/miembros', {
      full_name: 'Persona P',
      rut: rutP,
      email: 'p-real@test.invalid',
      rol: 'despachador',
    });
    expect(alta.status).toBe(201);
    userP = String(alta.json.user_id);
    codigoA = String(alta.json.codigo_activacion);
    // La persona ya existía cuando otra empresa la suma.
    await h.db
      .update(schema.users)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(schema.users.id, userP));

    const r = await post(B, '/me/empresa/miembros', {
      full_name: 'Otro Nombre',
      rut: rutP,
      email: 'otro@test.invalid',
      rol: 'visualizador',
    });
    expect(r.status).toBe(201);
    expect(r.json.codigo_activacion).toBeNull();
    expect(r.json.estado).toBe('pendiente_invitacion');
    respuestaExistente = r.json;

    const lista = await app(B).request('/me/empresa/miembros');
    const texto = JSON.stringify(await lista.json());
    expect(texto).not.toContain('p-real@test.invalid');
    expect(texto).not.toContain(rutP);
    expect(texto).not.toContain('Persona P');
  });

  test('la lista del equipo no muestra datos de un miembro que no está activo', async () => {
    const rutN = rutAleatorio();
    const alta = await post(C, '/me/empresa/miembros', {
      full_name: 'Persona Nueva',
      rut: rutN,
      email: 'nueva@test.invalid',
      rol: 'despachador',
    });
    expect(alta.status).toBe(201);
    const lista = await app(C).request('/me/empresa/miembros');
    const texto = JSON.stringify(await lista.json());
    expect(texto).not.toContain('Persona Nueva');
    expect(texto).not.toContain('nueva@test.invalid');
    expect(texto).not.toContain(rutN);
  });

  test('activación con membresías en dos empresas', async () => {
    const r = await post(A, '/auth/activar', {
      rut: rutP,
      codigo: codigoA,
      clave_numerica: '482913',
    });
    expect(r.status).toBe(200);
    const ms = await membresias(userP);
    expect(ms.find((m) => m.empresaId === A.empresa.id)?.status).toBe('activa');
    expect(ms.find((m) => m.empresaId === B.empresa.id)?.status).toBe('pendiente_invitacion');
  });

  test('alta de RUT existente con cuenta activa queda pendiente y con respuesta uniforme', async () => {
    const r = await post(C, '/me/empresa/miembros', {
      full_name: 'Otro Nombre',
      rut: rutP,
      email: 'c@test.invalid',
      rol: 'admin',
    });
    expect(r.status).toBe(201);
    expect(r.json.estado).toBe('pendiente_invitacion');
    expect(r.json.codigo_activacion).toBeNull();
    expect(r.json.vinculo).toBe(respuestaExistente.vinculo);
    const ms = await membresias(userP);
    expect(ms.find((m) => m.empresaId === C.empresa.id)?.status).toBe('pendiente_invitacion');
  });

  test('alta de RUT registrado sin activar: respuesta uniforme', async () => {
    const rutQ = rutAleatorio();
    const [q] = await h.db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rutQ}`,
        email: 'q-real@test.invalid',
        fullName: 'Persona Q',
        rut: rutQ,
        status: 'pendiente_verificacion',
      })
      .returning();
    const r = await post(B, '/me/empresa/miembros', {
      full_name: 'Otro Nombre',
      rut: rutQ,
      email: 'b@test.invalid',
      rol: 'visualizador',
    });
    expect(r.status).toBe(201);
    expect(r.json.codigo_activacion).toBeNull();
    expect(r.json.vinculo).toBe(respuestaExistente.vinculo);
    const [u] = await h.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, q?.id ?? ''));
    expect(u?.activationPinHash).toBeNull();
  });

  test('alta de RUT registrado mantiene la vigencia anterior', async () => {
    const rutV = rutAleatorio();
    const alta = await post(A, '/me/empresa/miembros', {
      full_name: 'Persona V',
      rut: rutV,
      email: 'v-real@test.invalid',
      rol: 'despachador',
    });
    const codigoViejo = String(alta.json.codigo_activacion);
    const hace8Dias = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await h.db
      .update(schema.memberships)
      .set({ invitedAt: hace8Dias, createdAt: hace8Dias })
      .where(eq(schema.memberships.id, String(alta.json.membership_id)));

    const r = await post(B, '/me/empresa/miembros', {
      full_name: 'Otro Nombre',
      rut: rutV,
      email: 'b2@test.invalid',
      rol: 'visualizador',
    });
    expect(r.status).toBe(201);
    expect(r.json.codigo_activacion).toBeNull();
    expect(r.json.expira_en).toBeNull();

    const act = await post(A, '/auth/activar', {
      rut: rutV,
      codigo: codigoViejo,
      clave_numerica: '482913',
    });
    expect(act.status).toBe(401);
    const ms = await membresias(String(alta.json.user_id));
    expect(ms.every((m) => m.status === 'pendiente_invitacion')).toBe(true);
  });
});
