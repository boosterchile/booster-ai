import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import { hashActivationPin } from '../../src/services/activation-pin.js';
import { hashClaveNumerica } from '../../src/services/clave-numerica.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T12 de `.specs/correos-solicitudes-panel/spec.md`, contra Postgres real.
 *
 * SC5: las activaciones (`/auth/driver-activate`, `/auth/activar`,
 * `/auth/login-rut`) y el bootstrap reutilizan una cuenta del proveedor
 * encontrada por correo solo si está libre.
 * SC6: `/me` no vincula por correo ni crea la cuenta de la lista para una
 * sesión cuyo uid es el de una solicitud.
 * SC7: la solicitud aprobada se inserta como queda hoy en la base, sin marca
 * nueva: las reglas leen el estado al usarlo.
 */

const LISTA_EMAIL = 'lista-cuentas-it@test.invalid';

// `config` lee la lista al importarse. vi.hoisted corre antes de los imports
// de este archivo; las rutas se importan recién en beforeAll.
vi.hoisted(() => {
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'lista-cuentas-it@test.invalid';
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

const PIN = '135790';
const CLAVE = '482915';

/** Cuenta del proveedor en memoria, con los campos del SDK que lee la API. */
interface CuentaFake {
  uid: string;
  email: string;
  providerData: { providerId: string }[];
}

function authEnMemoria() {
  const porEmail = new Map<string, CuentaFake>();
  const creadas: string[] = [];
  const auth = {
    async getUserByEmail(email: string) {
      const cuenta = porEmail.get(email);
      if (!cuenta) {
        throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      }
      return cuenta;
    },
    async createUser(props: { email: string }) {
      if (porEmail.has(props.email)) {
        throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      }
      const cuenta = {
        uid: `fb-${randomUUID().slice(0, 8)}`,
        email: props.email,
        providerData: [],
      };
      porEmail.set(props.email, cuenta);
      creadas.push(props.email);
      return cuenta;
    },
    async createCustomToken(uid: string) {
      return `custom-token-${uid}`;
    },
  };
  /** Deja una cuenta en el proveedor, como la que crea una aprobación. */
  function sembrar(email: string, providerData: { providerId: string }[] = []): string {
    const uid = `fb-sembrada-${randomUUID().slice(0, 8)}`;
    porEmail.set(email, { uid, email, providerData });
    return uid;
  }
  return { auth: auth as never as Auth, sembrar, creadas };
}

function compacto(rut: string): string {
  return rut.replace(/[.\-]/g, '');
}

describe('integration: cuentas del proveedor de una aprobación (correos-solicitudes-panel SC5–SC7)', () => {
  let handle: TestDbHandle;
  let rutas: Awaited<ReturnType<typeof cargarRutas>>;
  let empresaId = '';

  async function cargarRutas() {
    const [driver, activar, universal, me, bootstrap] = await Promise.all([
      import('../../src/routes/auth-driver.js'),
      import('../../src/routes/auth-activar.js'),
      import('../../src/routes/auth-universal.js'),
      import('../../src/routes/me.js'),
      import('../../src/services/bootstrap-platform-admin.js'),
    ]);
    return {
      createDriverAuthRoutes: driver.createDriverAuthRoutes,
      createAuthActivarRoutes: activar.createAuthActivarRoutes,
      createAuthUniversalRoutes: universal.createAuthUniversalRoutes,
      createMeRoutes: me.createMeRoutes,
      bootstrapPlatformAdmin: bootstrap.bootstrapPlatformAdmin,
      CuentaDeSolicitudError: bootstrap.CuentaDeSolicitudError,
    };
  }

  beforeAll(async () => {
    handle = createTestDb();
    rutas = await cargarRutas();
    const { db } = handle;
    const sufijo = randomUUID().slice(0, 8);
    await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan cuentas',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await db.select({ id: schema.plans.id }).from(schema.plans).limit(1);
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Transportes Cuentas ${sufijo}`,
        rut: rutAleatorio(),
        contactEmail: `flota-${sufijo}@test.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'XIII',
        isTransportista: true,
        planId: plan?.id ?? '',
      })
      .returning({ id: schema.empresas.id });
    if (!empresa) {
      throw new Error('fixture: empresa no creada');
    }
    empresaId = empresa.id;
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function app(firebase: Auth) {
    const { db } = handle;
    const sinRateLimit: MiddlewareHandler = async (_c, next) => {
      await next();
    };
    // Shim del idToken: los claims viajan en un header; `/me` es el real.
    const sesion: MiddlewareHandler = async (c, next) => {
      const crudo = c.req.header('x-test-claims');
      if (!crudo) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const p = JSON.parse(crudo) as { uid: string; email: string; emailVerified: boolean };
      const claims: FirebaseClaims = {
        uid: p.uid,
        email: p.email,
        emailVerified: p.emailVerified,
        name: undefined,
        picture: undefined,
        custom: {},
      };
      c.set('firebaseClaims', claims);
      await next();
    };
    const a = new Hono();
    a.use('/me', sesion);
    a.route('/auth', rutas.createDriverAuthRoutes({ db, logger, firebaseAuth: firebase }));
    a.route(
      '/auth',
      rutas.createAuthActivarRoutes({
        db,
        logger,
        firebaseAuth: firebase,
        rateLimitPerRut: sinRateLimit,
      }),
    );
    a.route(
      '/auth',
      rutas.createAuthUniversalRoutes({
        db,
        logger,
        firebaseAuth: firebase,
        rateLimitLogin: sinRateLimit,
      }),
    );
    a.route('/me', rutas.createMeRoutes({ db, logger }));
    return a;
  }

  /** Solicitud aprobada con el enlace de onboarding, tal como la deja el approve. */
  async function solicitudAprobada(email: string, firebaseUid: string) {
    await handle.db.insert(schema.solicitudesRegistro).values({
      email,
      nombreCompleto: 'Persona Solicitud',
      estado: 'aprobado',
      aprobadoPor: 'admin@test.invalid',
      aprobadoEn: new Date(),
      tokenHash: `hash-${randomUUID()}`,
      expiraEn: new Date(Date.now() + 24 * 60 * 60 * 1000),
      firebaseUid,
    });
  }

  async function fila(id: string) {
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!u) {
      throw new Error(`fixture: no está la fila ${id}`);
    }
    return u;
  }

  async function conductorPendiente() {
    const { db } = handle;
    const sufijo = randomUUID().slice(0, 8);
    const rut = rutAleatorio();
    const [persona] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: `conductor-${sufijo}@test.invalid`,
        fullName: 'Conductor Cuentas',
        rut,
        activationPinHash: hashActivationPin(PIN),
        status: 'pendiente_verificacion',
      })
      .returning({ id: schema.users.id });
    if (!persona) {
      throw new Error('fixture: conductor no creado');
    }
    await db.insert(schema.conductores).values({
      userId: persona.id,
      empresaId,
      licenseClass: 'A4',
      licenseNumber: `LIC-${sufijo}`,
      licenseExpiry: '2028-09-22',
      isExtranjero: false,
      driverStatus: 'activo',
    });
    return { id: persona.id, rut, sintetico: `drivers+${compacto(rut)}@boosterchile.invalid` };
  }

  /** Cuenta marcada del personal con el código del panel vigente y sin invitación. */
  async function personalPendiente() {
    const rut = rutAleatorio();
    const [persona] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: `personal-${randomUUID().slice(0, 8)}@test.invalid`,
        fullName: 'Personal Cuentas',
        rut,
        activationPinHash: hashActivationPin(PIN),
        activacionVenceEn: new Date(Date.now() + 24 * 60 * 60 * 1000),
        isPlatformAdmin: true,
        status: 'pendiente_verificacion',
      })
      .returning({ id: schema.users.id });
    if (!persona) {
      throw new Error('fixture: personal no creado');
    }
    return { id: persona.id, rut, sintetico: `users+${compacto(rut)}@boosterchile.invalid` };
  }

  /** Cuenta provisoria con clave, que `login-rut` promueve a una cuenta real. */
  async function provisoriaConClave() {
    const rut = rutAleatorio();
    const [persona] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: `provisoria-${randomUUID().slice(0, 8)}@test.invalid`,
        fullName: 'Provisoria Cuentas',
        rut,
        claveNumericaHash: hashClaveNumerica(CLAVE),
        status: 'activo',
      })
      .returning({ id: schema.users.id });
    if (!persona) {
      throw new Error('fixture: provisoria no creada');
    }
    return { id: persona.id, rut, sintetico: `users+${compacto(rut)}@boosterchile.invalid` };
  }

  function activarConductor(a: Hono, rut: string) {
    return a.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut, pin: PIN, clave_numerica: CLAVE }),
    });
  }

  describe('SC5 — /auth/driver-activate', () => {
    test('una cuenta con el uid de una solicitud aprobada no se reutiliza: 502 y la fila sigue pendiente', async () => {
      const persona = await conductorPendiente();
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(persona.sintetico);
      await solicitudAprobada(persona.sintetico, uid);

      const res = await activarConductor(app(firebase.auth), persona.rut);

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'firebase_error', code: 'firebase_error' });
      const despues = await fila(persona.id);
      expect(despues.firebaseUid).toBe(`pending-rut:${persona.rut}`);
      expect(despues.claveNumericaHash).toBeNull();
      expect(despues.activationPinHash).not.toBeNull();
    });

    test('una cuenta con contraseña no se reutiliza: 502 y la fila sigue pendiente', async () => {
      const persona = await conductorPendiente();
      const firebase = authEnMemoria();
      firebase.sembrar(persona.sintetico, [{ providerId: 'password' }]);

      const res = await activarConductor(app(firebase.auth), persona.rut);

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'firebase_error', code: 'firebase_error' });
      expect((await fila(persona.id)).claveNumericaHash).toBeNull();
    });

    test('una cuenta con el uid de otra fila de usuarios no se reutiliza (aprobación sin enlace): 502', async () => {
      const persona = await conductorPendiente();
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(persona.sintetico);
      // La aprobación sin enlace de onboarding crea una fila con ese uid.
      await handle.db.insert(schema.users).values({
        firebaseUid: uid,
        email: `aprobada-${randomUUID().slice(0, 8)}@test.invalid`,
        fullName: 'Fila de una aprobación',
        status: 'pendiente_verificacion',
      });

      const res = await activarConductor(app(firebase.auth), persona.rut);

      // La falla del proveedor, no un choque del UNIQUE de `firebase_uid` al escribir.
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'firebase_error', code: 'firebase_error' });
      expect((await fila(persona.id)).firebaseUid).toBe(`pending-rut:${persona.rut}`);
    });

    test('una cuenta libre se reutiliza: 200 con ese uid', async () => {
      const persona = await conductorPendiente();
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(persona.sintetico);

      const res = await activarConductor(app(firebase.auth), persona.rut);

      expect(res.status).toBe(200);
      expect((await fila(persona.id)).firebaseUid).toBe(uid);
      expect(firebase.creadas).toHaveLength(0);
    });
  });

  describe('SC5 — /auth/activar', () => {
    test('una cuenta con el uid de una solicitud aprobada no se reutiliza: 503 y nada escrito', async () => {
      const persona = await personalPendiente();
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(persona.sintetico);
      await solicitudAprobada(persona.sintetico, uid);

      const res = await app(firebase.auth).request('/auth/activar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rut: persona.rut, codigo: PIN, clave_numerica: CLAVE }),
      });

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'service_unavailable', code: 'firebase_error' });
      const despues = await fila(persona.id);
      expect(despues.firebaseUid).toBe(`pending-rut:${persona.rut}`);
      expect(despues.claveNumericaHash).toBeNull();
    });

    test('una cuenta libre se reutiliza: 200 con ese uid', async () => {
      const persona = await personalPendiente();
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(persona.sintetico);

      const res = await app(firebase.auth).request('/auth/activar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rut: persona.rut, codigo: PIN, clave_numerica: CLAVE }),
      });

      expect(res.status).toBe(200);
      expect((await fila(persona.id)).firebaseUid).toBe(uid);
    });
  });

  describe('SC5 — /auth/login-rut', () => {
    test('una cuenta con el uid de una solicitud aprobada no se reutiliza: 502 y la fila sigue provisoria', async () => {
      const persona = await provisoriaConClave();
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(persona.sintetico);
      await solicitudAprobada(persona.sintetico, uid);

      const res = await app(firebase.auth).request('/auth/login-rut', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rut: persona.rut, clave: CLAVE }),
      });

      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'firebase_error', code: 'firebase_error' });
      expect((await fila(persona.id)).firebaseUid).toBe(`pending-rut:${persona.rut}`);
    });
  });

  describe('SC5 — bootstrapPlatformAdmin', () => {
    test('una cuenta del correo de la lista con el uid de una solicitud: CuentaDeSolicitudError, sin fila', async () => {
      const firebase = authEnMemoria();
      const uid = firebase.sembrar(LISTA_EMAIL);
      await solicitudAprobada(LISTA_EMAIL, uid);

      await expect(
        rutas.bootstrapPlatformAdmin({
          db: handle.db,
          firebaseAuth: firebase.auth,
          logger,
          allowlist: [LISTA_EMAIL],
          input: { email: LISTA_EMAIL, fullName: 'Lista', rut: rutAleatorio(), clave: CLAVE },
        }),
      ).rejects.toThrow(rutas.CuentaDeSolicitudError);
      const filas = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${LISTA_EMAIL}`);
      expect(filas).toHaveLength(0);
    });
  });

  describe('SC6 — /me', () => {
    function me(a: Hono, claims: { uid: string; email: string }) {
      return a.request('/me', {
        headers: { 'x-test-claims': JSON.stringify({ ...claims, emailVerified: true }) },
      });
    }

    test('una sesión con el uid de una solicitud no vincula por correo una cuenta existente', async () => {
      const email = `invitada-${randomUUID().slice(0, 8)}@test.invalid`;
      const rut = rutAleatorio();
      const [invitada] = await handle.db
        .insert(schema.users)
        .values({
          firebaseUid: `pending-rut:${rut}`,
          email,
          fullName: 'Persona Invitada',
          rut,
          activationPinHash: hashActivationPin(PIN),
          status: 'pendiente_verificacion',
        })
        .returning({ id: schema.users.id });
      if (!invitada) {
        throw new Error('fixture: invitada no creada');
      }
      const uid = `fb-solicitud-${randomUUID().slice(0, 8)}`;
      await solicitudAprobada(email, uid);

      const res = await me(app(authEnMemoria().auth), { uid, email });

      expect(res.status).toBe(200);
      expect(((await res.json()) as { needs_onboarding: boolean }).needs_onboarding).toBe(true);
      expect((await fila(invitada.id)).firebaseUid).toBe(`pending-rut:${rut}`);
    });

    test('una sesión con el uid de una solicitud y el correo de la lista no crea la cuenta', async () => {
      const uid = `fb-solicitud-${randomUUID().slice(0, 8)}`;
      await solicitudAprobada(LISTA_EMAIL, uid);

      const res = await me(app(authEnMemoria().auth), { uid, email: LISTA_EMAIL });

      expect(res.status).toBe(200);
      expect(((await res.json()) as { needs_onboarding: boolean }).needs_onboarding).toBe(true);
      const filas = await handle.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.firebaseUid, uid));
      expect(filas).toHaveLength(0);
    });

    test('una sesión sin solicitud sigue vinculando por correo verificado', async () => {
      const email = `vinculo-${randomUUID().slice(0, 8)}@test.invalid`;
      const [existente] = await handle.db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-anterior-${randomUUID().slice(0, 8)}`,
          email,
          fullName: 'Persona Vínculo',
          status: 'activo',
        })
        .returning({ id: schema.users.id });
      if (!existente) {
        throw new Error('fixture: cuenta no creada');
      }
      const uid = `fb-google-${randomUUID().slice(0, 8)}`;

      const res = await me(app(authEnMemoria().auth), { uid, email });

      expect(res.status).toBe(200);
      expect(((await res.json()) as { needs_onboarding: boolean }).needs_onboarding).toBe(false);
      expect((await fila(existente.id)).firebaseUid).toBe(uid);
    });
  });
});
