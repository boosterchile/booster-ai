import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Auth, UserRecord } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import * as schema from '../../src/db/schema.js';
import type { SignupRequestNotifier } from '../../src/services/notifications/signup-request-email.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T5 de `.specs/correos-solicitudes-panel/spec.md`, contra Postgres real:
 *   - SC1: la aprobación de una solicitud, la exención y la solicitud pública
 *     tratan un correo de la lista de respaldo como uno ya usado.
 *   - SC3: las altas comparan el correo con las cuentas existentes sin
 *     distinguir mayúsculas, y en las tres invitaciones una alta simultánea
 *     con el mismo correo responde el mismo 409.
 *
 * `requirePlatformAdmin` y las rutas del panel leen la lista y los flags de
 * `config` al importarse: el env se fija en `vi.hoisted` y las rutas se
 * importan dentro de los tests.
 */

const ADMIN_LISTA = 'admin-correo-it@test.invalid';
/** Correo de la lista de respaldo que no tiene cuenta. */
const RESPALDO_SIN_CUENTA = 'respaldo-correo-it@test.invalid';
const LISTA = [ADMIN_LISTA, RESPALDO_SIN_CUENTA];

vi.hoisted(() => {
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS =
    'admin-correo-it@test.invalid,respaldo-correo-it@test.invalid';
  process.env.SIGNUP_REQUEST_FLOW_ACTIVATED = 'true';
});

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

const YA_REGISTRADO = { error: 'conflict', code: 'email_already_registered' };

/** Proveedor de identidad para la aprobación: registra si se le pidió una cuenta. */
function proveedorDeIdentidad() {
  const createUser = vi.fn<Auth['createUser']>(
    async () => ({ uid: `fb-aprobado-${randomUUID().slice(0, 8)}` }) as UserRecord,
  );
  const generatePasswordResetLink = vi.fn<Auth['generatePasswordResetLink']>(
    async () => 'https://enlace.invalid/reset',
  );
  const auth: Pick<Auth, 'createUser' | 'generatePasswordResetLink'> = {
    createUser,
    generatePasswordResetLink,
  };
  return { auth: auth as Auth, createUser, generatePasswordResetLink };
}

function notificador(): SignupRequestNotifier {
  return {
    notifyAdminsOfNewRequest: vi.fn(async () => undefined),
    notifyUserOfApproval: vi.fn(async () => undefined),
    notifyUserOfRejection: vi.fn(async () => undefined),
  };
}

type InsertarCuenta = (tabla: unknown) => {
  values: (fila: { email?: unknown }) => {
    returning: (...columnas: unknown[]) => Promise<unknown>;
  };
};
type ConTransaccion = (
  cb: (tx: object) => Promise<unknown>,
  ...resto: unknown[]
) => Promise<unknown>;

/**
 * Envuelve la base para que otra alta guarde el mismo correo justo cuando la
 * ruta va a insertar la cuenta: después de su búsqueda y antes de su INSERT.
 * Cubre la escritura directa y la que va dentro de una transacción.
 */
function conAltaSimultanea<T extends object>(
  base: T,
  otraAlta: (email: string) => Promise<void>,
): T {
  return new Proxy(base, {
    get(objetivo, prop, receptor) {
      const valor: unknown = Reflect.get(objetivo, prop, receptor);
      if (prop === 'transaction' && typeof valor === 'function') {
        const transaccion = valor as ConTransaccion;
        return (cb: (tx: object) => Promise<unknown>, ...resto: unknown[]) =>
          transaccion.call(objetivo, (tx: object) => cb(conAltaSimultanea(tx, otraAlta)), ...resto);
      }
      if (prop === 'insert' && typeof valor === 'function') {
        const insertar = valor as InsertarCuenta;
        return (tabla: unknown) => {
          const real = insertar.call(objetivo, tabla);
          if (tabla !== schema.users) {
            return real;
          }
          return {
            values: (fila: { email?: unknown }) => {
              const conValores = real.values(fila);
              return {
                returning: async (...columnas: unknown[]) => {
                  await otraAlta(String(fila.email));
                  return await conValores.returning(...columnas);
                },
              };
            },
          };
        };
      }
      // El resto de los métodos corre sobre el objeto real.
      return typeof valor === 'function' ? valor.bind(objetivo) : valor;
    },
  });
}

describe('integration: el correo de una cuenta nueva (correos-solicitudes-panel)', () => {
  let h: TestDbHandle;
  const sufijo = randomUUID().slice(0, 8);
  /** Cuenta existente guardada con mayúsculas, como la crea `/me` con el correo de Google. */
  const CORREO_GUARDADO = `Mayus.${sufijo}@Test.Invalid`;
  const VARIANTE = CORREO_GUARDADO.toLowerCase();
  let comoAdmin: UserContext;
  let comoDueno: UserContext;
  let empresaId = '';
  let orgId = '';

  beforeAll(async () => {
    h = createTestDb();
    await h.db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'p', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await h.db.select().from(schema.plans).where(eq(schema.plans.slug, 'gratis'));
    const [admin] = await h.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-admin-correo-${sufijo}`,
        email: ADMIN_LISTA,
        fullName: 'Admin Lista',
        isPlatformAdmin: true,
        status: 'activo',
      })
      .returning();
    const [dueno] = await h.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-dueno-correo-${sufijo}`,
        email: `dueno-correo-${sufijo}@test.invalid`,
        fullName: 'Dueña Empresa',
        rut: rutAleatorio(),
        status: 'activo',
      })
      .returning();
    const [empresa] = await h.db
      .insert(schema.empresas)
      .values({
        legalName: `Empresa Correo ${sufijo}`,
        rut: rutAleatorio(),
        contactEmail: `correo-${sufijo}@empresa.invalid`,
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
    const [org] = await h.db
      .insert(schema.organizacionesStakeholder)
      .values({ nombreLegal: `Observatorio ${sufijo}`, tipo: 'observatorio_academico' })
      .returning({ id: schema.organizacionesStakeholder.id });
    if (!admin || !dueno || !empresa || !membresia || !org) {
      throw new Error('fixture incompleto');
    }
    await h.db.insert(schema.users).values({
      firebaseUid: `fb-mayus-${sufijo}`,
      email: CORREO_GUARDADO,
      fullName: 'Persona Mayúsculas',
      rut: rutAleatorio(),
      status: 'activo',
    });
    const activa = { membership: membresia, empresa };
    comoAdmin = { user: admin, memberships: [], activeMembership: null, impersonatedBy: null };
    comoDueno = {
      user: dueno,
      memberships: [activa],
      activeMembership: activa,
      impersonatedBy: null,
    };
    empresaId = empresa.id;
    orgId = org.id;
  });
  afterAll(async () => {
    await h.pool.end();
  });

  /** App con las tres invitaciones, sobre la base que recibe. */
  async function invitaciones(db: Db) {
    const [empresaMiembros, stakeholder, meMiembros] = await Promise.all([
      import('../../src/routes/admin-empresa-miembros.js'),
      import('../../src/routes/admin-stakeholder-orgs.js'),
      import('../../src/routes/me-empresa-miembros.js'),
    ]);
    const a = new Hono();
    a.use('/admin/*', async (c, next) => {
      c.set('userContext', comoAdmin);
      await next();
    });
    a.use('/me/*', async (c, next) => {
      c.set('userContext', comoDueno);
      await next();
    });
    a.route(
      '/admin/empresas',
      empresaMiembros.createAdminEmpresaMiembrosRoutes({
        db,
        logger,
        auth: proveedorDeIdentidad().auth,
      }),
    );
    a.route(
      '/admin/stakeholder-orgs',
      stakeholder.createAdminStakeholderOrgsRoutes({ db, logger }),
    );
    a.route(
      '/me/empresa/miembros',
      meMiembros.createMeEmpresaMiembrosRoutes({ db, logger, platformAdminEmails: LISTA }),
    );
    return a;
  }

  /** Ruta y cuerpo de cada invitación, con un RUT nuevo y el correo de `correo(i)`. */
  function cadaInvitacion(correo: (i: number) => string) {
    const rutas: { ruta: string; extra: Record<string, string> }[] = [
      { ruta: `/admin/empresas/${empresaId}/miembros`, extra: { rol: 'admin' } },
      { ruta: `/admin/stakeholder-orgs/${orgId}/invitar`, extra: {} },
      { ruta: '/me/empresa/miembros', extra: { rol: 'admin' } },
    ];
    return rutas.map(({ ruta, extra }, i) => {
      const rut = rutAleatorio();
      const email = correo(i);
      return {
        ruta,
        rut,
        email,
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, full_name: 'Otra Persona', rut, ...extra }),
        } satisfies RequestInit,
      };
    });
  }

  async function cuentasConCorreo(email: string) {
    const filas = await h.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(${schema.users.email}) = lower(${email})`);
    return filas.length;
  }

  async function cuentasConRut(rut: string) {
    const filas = await h.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.rut, rut));
    return filas.length;
  }

  test('SC3: las tres invitaciones rechazan la variante en minúsculas de una cuenta guardada con mayúsculas', async () => {
    const a = await invitaciones(h.db);
    for (const { ruta, rut, init } of cadaInvitacion(() => VARIANTE)) {
      const res = await a.request(ruta, init);
      expect(res.status, `${ruta}: ${await res.clone().text()}`).toBe(409);
      expect(await res.json()).toEqual(YA_REGISTRADO);
      expect(await cuentasConRut(rut), ruta).toBe(0);
    }
    expect(await cuentasConCorreo(VARIANTE)).toBe(1);
  });

  test('SC1: las tres invitaciones rechazan un correo de la lista sin cuenta, con mayúsculas', async () => {
    const a = await invitaciones(h.db);
    for (const { ruta, rut, init } of cadaInvitacion(() => RESPALDO_SIN_CUENTA.toUpperCase())) {
      const res = await a.request(ruta, init);
      expect(res.status, `${ruta}: ${await res.clone().text()}`).toBe(409);
      expect(await res.json()).toEqual(YA_REGISTRADO);
      expect(await cuentasConRut(rut), ruta).toBe(0);
    }
    expect(await cuentasConCorreo(RESPALDO_SIN_CUENTA)).toBe(0);
  });

  test('SC3: una alta simultánea con el mismo correo responde el mismo 409 en las tres invitaciones', async () => {
    let n = 0;
    const db = conAltaSimultanea(h.db, async (email) => {
      n += 1;
      await h.db.insert(schema.users).values({
        firebaseUid: `fb-simultanea-${n}-${sufijo}`,
        email,
        fullName: 'Alta simultánea',
        status: 'activo',
      });
    });
    const a = await invitaciones(db);

    for (const { ruta, rut, email, init } of cadaInvitacion(
      (i) => `simultanea-${i}-${sufijo}@test.invalid`,
    )) {
      const res = await a.request(ruta, init);
      expect(res.status, `${ruta}: ${await res.clone().text()}`).toBe(409);
      expect(await res.json()).toEqual(YA_REGISTRADO);
      // Queda solo la cuenta de la otra alta, y ninguna con el RUT invitado.
      expect(await cuentasConCorreo(email), ruta).toBe(1);
      expect(await cuentasConRut(rut), ruta).toBe(0);
    }
    expect(n).toBe(3);
  });

  test('SC3: onboardEmpresa ve la cuenta guardada con mayúsculas', async () => {
    const { onboardEmpresa, EmailAlreadyInUseError } = await import(
      '../../src/services/onboarding.js'
    );

    await expect(
      onboardEmpresa({
        db: h.db,
        logger,
        firebaseUid: `fb-onb-${sufijo}`,
        firebaseEmail: VARIANTE,
        authorizedBy: 'self_service',
        selfServiceEnabled: true,
        platformAdminEmails: LISTA,
        input: {
          user: {
            full_name: 'Dueño Nuevo',
            phone: '+56912345678',
            whatsapp_e164: '+56912345678',
            rut: rutAleatorio(),
            clave_numerica: '482915',
          },
          empresa: {
            legal_name: 'Empresa Onboarding',
            rut: rutAleatorio(),
            contact_email: `onb-${sufijo}@empresa.invalid`,
            contact_phone: '+56912345678',
            address: {
              street: 'Av. Siempre Viva',
              number: '742',
              commune: 'Santiago',
              city: 'Santiago',
              region: 'RM',
              country: 'CL',
            },
            is_generador_carga: true,
            is_transportista: false,
          },
          plan_slug: 'gratis',
        },
      }),
    ).rejects.toThrow(EmailAlreadyInUseError);
    expect(await cuentasConCorreo(VARIANTE)).toBe(1);
  });

  test('SC1 y SC3: la solicitud pública no guarda la variante de una cuenta ni un correo de la lista', async () => {
    const { submitSignupRequest } = await import('../../src/services/signup-request.js');

    for (const email of [VARIANTE, RESPALDO_SIN_CUENTA.toUpperCase()]) {
      const resultado = await submitSignupRequest(
        h.db,
        logger,
        { email, nombreCompleto: 'Otra Persona' },
        `corr-submit-${sufijo}`,
        LISTA,
      );
      expect(resultado, email).toEqual({ outcome: 'shadowed' });
      const solicitudes = await h.db
        .select({ id: schema.solicitudesRegistro.id })
        .from(schema.solicitudesRegistro)
        .where(eq(schema.solicitudesRegistro.email, email.toLowerCase()));
      expect(solicitudes, email).toEqual([]);
    }
  });

  test('SC1: la ruta de aprobación sin enlace responde 409 sin cuenta ni enlace, y la solicitud sigue pendiente', async () => {
    const { createAdminSignupRequestsRoutes } = await import(
      '../../src/routes/admin-signup-requests.js'
    );
    // Solicitudes que ya estaban en la cola: un correo de la lista y la
    // variante de una cuenta guardada.
    const filas = await h.db
      .insert(schema.solicitudesRegistro)
      .values([
        { email: RESPALDO_SIN_CUENTA, nombreCompleto: 'Solicitante Lista' },
        { email: VARIANTE, nombreCompleto: 'Solicitante Variante' },
      ])
      .returning({ id: schema.solicitudesRegistro.id });

    for (const { id } of filas) {
      const proveedor = proveedorDeIdentidad();
      const a = new Hono();
      a.use('*', async (c, next) => {
        c.set('userContext', comoAdmin);
        await next();
      });
      a.route(
        '/',
        createAdminSignupRequestsRoutes({
          db: h.db,
          logger,
          auth: proveedor.auth,
          notifier: notificador(),
        }),
      );

      const res = await a.request(`/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status, await res.clone().text()).toBe(409);
      expect(await res.json()).toEqual({ error: 'conflict', code: 'firebase_user_already_exists' });
      expect(proveedor.createUser).not.toHaveBeenCalled();
      expect(proveedor.generatePasswordResetLink).not.toHaveBeenCalled();
      const [solicitud] = await h.db
        .select({ estado: schema.solicitudesRegistro.estado })
        .from(schema.solicitudesRegistro)
        .where(eq(schema.solicitudesRegistro.id, id));
      expect(solicitud?.estado).toBe('pendiente_aprobacion');
    }
    expect(await cuentasConCorreo(RESPALDO_SIN_CUENTA)).toBe(0);
    expect(await cuentasConCorreo(VARIANTE)).toBe(1);
  });

  test('SC1: la aprobación con enlace de onboarding tampoco crea la cuenta ni emite el enlace', async () => {
    const { approveSignupRequest } = await import('../../src/services/signup-request.js');
    const filas = await h.db
      .insert(schema.solicitudesRegistro)
      .values([
        { email: RESPALDO_SIN_CUENTA, nombreCompleto: 'Solicitante Lista' },
        { email: VARIANTE, nombreCompleto: 'Solicitante Variante' },
      ])
      .returning({ id: schema.solicitudesRegistro.id });

    for (const { id } of filas) {
      const proveedor = proveedorDeIdentidad();
      const resultado = await approveSignupRequest(h.db, logger, proveedor.auth, notificador(), {
        id,
        approverEmail: ADMIN_LISTA,
        loginLinkUrl: 'https://app.boosterchile.com/login',
        correlationId: `corr-aprobar-${sufijo}`,
        platformAdminEmails: LISTA,
        adminProvisionedOnboarding: { signingSecret: 's'.repeat(48), ttlMs: 60 * 60 * 1000 },
      });

      expect(resultado, id).toEqual({ outcome: 'firebase_user_already_exists' });
      expect(proveedor.createUser).not.toHaveBeenCalled();
      const [solicitud] = await h.db
        .select({
          estado: schema.solicitudesRegistro.estado,
          tokenHash: schema.solicitudesRegistro.tokenHash,
        })
        .from(schema.solicitudesRegistro)
        .where(eq(schema.solicitudesRegistro.id, id));
      expect(solicitud).toEqual({ estado: 'pendiente_aprobacion', tokenHash: null });
    }
  });

  test('SC1 y SC3: la exención rechaza un correo de la lista y la variante de una cuenta, sin solicitud', async () => {
    const { emitirAltaExencion } = await import('../../src/services/emitir-alta-exencion.js');

    for (const email of [RESPALDO_SIN_CUENTA.toUpperCase(), VARIANTE]) {
      const proveedor = proveedorDeIdentidad();
      const antes = await h.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.solicitudesRegistro);

      const resultado = await emitirAltaExencion(h.db, logger, proveedor.auth, notificador(), {
        email,
        nombreCompleto: 'Alta Exención',
        approverEmail: ADMIN_LISTA,
        correlationId: `corr-exencion-${sufijo}`,
        loginLinkUrl: 'https://app.boosterchile.com/login',
        adminProvisionedOnboarding: { signingSecret: 's'.repeat(48), ttlMs: 60 * 60 * 1000 },
        platformAdminEmails: LISTA,
      });

      expect(resultado, email).toEqual({ outcome: 'email_already_registered' });
      expect(proveedor.createUser).not.toHaveBeenCalled();
      const despues = await h.db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.solicitudesRegistro);
      expect(despues[0]?.n, email).toBe(antes[0]?.n);
    }
  });
});
