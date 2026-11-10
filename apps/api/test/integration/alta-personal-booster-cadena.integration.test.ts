import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import type { EmailMessage, EmailSender } from '../../src/services/notifications/email-sender.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T6 de `.specs/alta-personal-booster/spec.md` (SC7) y T9 de
 * `.specs/acceso-panel-plataforma/spec.md` (SC14): la cadena real del personal
 * de Booster contra Postgres, en el orden del runbook.
 *
 *   1. `POST /admin/personal-booster`            → cuenta marcada + código
 *   2. «Generar código nuevo»                     → el anterior deja de servir
 *   3. `POST /auth/activar` con el código nuevo   → clave propia, sesión
 *   4. `POST /auth/login-rut`                     → entra con esa clave
 *   5. `GET /me`                                  → `is_platform_admin: true`
 *   6. `GET /admin/personal-booster` como ella    → 200
 *   7. «Quitar acceso»                            → 403 y `/me` en false
 *
 * El acceso lo da la marca que pone el panel: la persona NO está en la lista
 * de respaldo. `requirePlatformAdmin` y `/me` leen la lista de `config` al
 * importar (por eso el env se fija en `vi.hoisted`, solo con el admin), y las
 * rutas del personal la reciben por opciones.
 *
 * Firebase se inyecta como un `Auth` en memoria (mismo doble que
 * `alta-admin-cadena`). El middleware de idToken se reemplaza por un shim que
 * toma el uid del header `x-test-uid`; el contexto lo resuelve el
 * `userContextMiddleware` real y el gate es el `requirePlatformAdmin` real.
 */

const ADMIN_EMAIL = 'admin-personal-it@test.invalid';
const PERSONA_EMAIL = 'personal-it@test.invalid';

// `config` lee la lista al importarse. vi.hoisted corre antes de los imports
// de este archivo; las rutas se importan recién en beforeAll.
vi.hoisted(() => {
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = 'admin-personal-it@test.invalid';
});

// Códigos de activación predecibles y siempre distintos entre sí, para que el
// paso 4 compruebe sin condiciones que el código anterior deja de servir. El
// hash y la verificación son los reales.
const secuenciaDeCodigos = vi.hoisted(() => ({ siguiente: 410_000 }));
vi.mock('../../src/services/activation-pin.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/services/activation-pin.js')>();
  return {
    ...real,
    generateActivationPin: () => String(secuenciaDeCodigos.siguiente++),
  };
});

/** Cuenta del proveedor en memoria, con los campos del SDK que lee la API. */
interface CuentaFake {
  uid: string;
  email: string;
  providerData: { providerId: string }[];
}

function authEnMemoria() {
  const porEmail = new Map<string, CuentaFake>();
  const porUid = new Map<string, CuentaFake>();
  /**
   * Escritura que corre una vez dentro del próximo `createUser`: en
   * `/auth/activar` cae entre la verificación del código y el UPDATE.
   */
  const ganchos: { antesDeCrear: (() => Promise<void>) | null } = { antesDeCrear: null };
  const noExiste = (ref: string) =>
    Object.assign(new Error(`no user: ${ref}`), { code: 'auth/user-not-found' });
  const fake = {
    async createUser(props: { email?: string; uid?: string }) {
      const gancho = ganchos.antesDeCrear;
      ganchos.antesDeCrear = null;
      if (gancho) {
        await gancho();
      }
      const email = props.email ?? `${randomUUID()}@fake.invalid`;
      if (porEmail.has(email)) {
        throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      }
      const u = { uid: props.uid ?? `fb-${randomUUID().slice(0, 8)}`, email, providerData: [] };
      porEmail.set(email, u);
      porUid.set(u.uid, u);
      return u;
    },
    async getUserByEmail(email: string) {
      const u = porEmail.get(email);
      if (!u) {
        throw noExiste(email);
      }
      return u;
    },
    async getUser(uid: string) {
      const u = porUid.get(uid);
      if (!u) {
        throw noExiste(uid);
      }
      return u;
    },
    async createCustomToken(uid: string) {
      return `custom-token-${uid}`;
    },
  };
  return { auth: fake as never as Auth, porUid, ganchos };
}

function senderEnMemoria() {
  const enviados: EmailMessage[] = [];
  const sender: EmailSender = {
    async send(msg) {
      enviados.push(msg);
      return { enviado: true, id: `m-${enviados.length}` };
    },
  };
  return { sender, enviados };
}

async function cargarRutas() {
  const [personal, activar, universal, me, userContext, empresaMiembros, conductores, driver] =
    await Promise.all([
      import('../../src/routes/admin-personal-booster.js'),
      import('../../src/routes/auth-activar.js'),
      import('../../src/routes/auth-universal.js'),
      import('../../src/routes/me.js'),
      import('../../src/middleware/user-context.js'),
      import('../../src/routes/admin-empresa-miembros.js'),
      import('../../src/routes/conductores.js'),
      import('../../src/routes/auth-driver.js'),
    ]);
  return {
    createAdminPersonalBoosterRoutes: personal.createAdminPersonalBoosterRoutes,
    createAuthActivarRoutes: activar.createAuthActivarRoutes,
    createAuthUniversalRoutes: universal.createAuthUniversalRoutes,
    createMeRoutes: me.createMeRoutes,
    createUserContextMiddleware: userContext.createUserContextMiddleware,
    createAdminEmpresaMiembrosRoutes: empresaMiembros.createAdminEmpresaMiembrosRoutes,
    createConductoresRoutes: conductores.createConductoresRoutes,
    createDriverAuthRoutes: driver.createDriverAuthRoutes,
  };
}

describe('integration: el panel otorga y quita el acceso del personal de Booster', () => {
  let handle: TestDbHandle;
  let rutas: Awaited<ReturnType<typeof cargarRutas>>;
  let firebase: ReturnType<typeof authEnMemoria>;
  let correo: ReturnType<typeof senderEnMemoria>;
  let adminUid = '';
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

  // La lista de respaldo: solo el admin. La persona entra al panel por la marca.
  const LISTA = [ADMIN_EMAIL];

  beforeAll(async () => {
    handle = createTestDb();
    rutas = await cargarRutas();
    firebase = authEnMemoria();
    correo = senderEnMemoria();
    adminUid = `fb-admin-${randomUUID().slice(0, 8)}`;
    await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: adminUid,
        email: ADMIN_EMAIL,
        fullName: 'Admin Plataforma',
        isPlatformAdmin: true,
        status: 'activo',
      })
      .onConflictDoUpdate({ target: schema.users.email, set: { firebaseUid: adminUid } });
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function app(lista: readonly string[]) {
    const { db } = handle;
    const sinRateLimit: MiddlewareHandler = async (_c, next) => {
      await next();
    };
    // Shim del idToken: el uid viaja en un header; el resto de la cadena es real.
    const sesion: MiddlewareHandler = async (c, next) => {
      const uid = c.req.header('x-test-uid');
      if (!uid) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      const claims: FirebaseClaims = {
        uid,
        email: undefined,
        emailVerified: false,
        name: undefined,
        picture: undefined,
        custom: {},
      };
      c.set('firebaseClaims', claims);
      await next();
    };
    const userContext = rutas.createUserContextMiddleware({ db, logger });
    const a = new Hono();
    a.use('/admin/*', sesion, userContext);
    a.use('/me', sesion);
    a.route(
      '/admin/personal-booster',
      rutas.createAdminPersonalBoosterRoutes({
        db,
        logger,
        platformAdminEmails: lista,
        emailSender: correo.sender,
        webAppUrl: 'https://app.test.invalid',
      }),
    );
    a.route(
      '/auth',
      rutas.createAuthActivarRoutes({
        db,
        logger,
        firebaseAuth: firebase.auth,
        rateLimitPerRut: sinRateLimit,
      }),
    );
    a.route(
      '/auth',
      rutas.createAuthUniversalRoutes({
        db,
        logger,
        firebaseAuth: firebase.auth,
        rateLimitLogin: sinRateLimit,
      }),
    );
    a.route('/auth', rutas.createDriverAuthRoutes({ db, logger, firebaseAuth: firebase.auth }));
    a.route('/me', rutas.createMeRoutes({ db, logger }));
    // Otro emisor de códigos sobre la misma cuenta: la invitación a una empresa.
    a.route(
      '/admin/empresas',
      rutas.createAdminEmpresaMiembrosRoutes({ db, logger, auth: firebase.auth }),
    );
    return a;
  }

  function json(method: string, body: unknown, uid?: string): RequestInit {
    // Content-Type solo cuando hay cuerpo.
    return {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(uid ? { 'x-test-uid': uid } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    };
  }

  async function filaPersona() {
    const [u] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, PERSONA_EMAIL));
    if (!u) {
      throw new Error('fixture: la persona no está en usuarios');
    }
    return u;
  }

  const persona = { rut: rutAleatorio(), clave: '583920', nombre: 'Ana Soto Personal' };
  let userId = '';
  let primerCodigo = '';
  let codigo = '';

  /** Correos enviados a una dirección con un asunto que empieza así. */
  function correosA(to: string, asunto: string) {
    return correo.enviados.filter((m) => m.to === to && m.subject.startsWith(asunto));
  }

  test('1. el admin da de alta a la persona fuera de la lista: queda marcada, el código sale por correo y la lista recibe el aviso', async () => {
    const res = await app(LISTA).request(
      '/admin/personal-booster',
      json('POST', { email: PERSONA_EMAIL, full_name: persona.nombre, rut: persona.rut }, adminUid),
    );
    const body = (await res.json()) as {
      user_id: string;
      vinculo: string;
      codigo_activacion: string | null;
      expira_en: string | null;
      en_lista: boolean;
    };
    expect(res.status, JSON.stringify(body)).toBe(201);
    expect(body.vinculo).toBe('nueva');
    expect(body.en_lista).toBe(false);
    expect(body.codigo_activacion).toMatch(/^\d{6}$/);
    expect(body.expira_en).toBeTruthy();
    userId = body.user_id;
    primerCodigo = body.codigo_activacion ?? '';

    // La lista ya no es condición: el código sale por correo a la persona.
    const activacion = correosA(PERSONA_EMAIL, 'Activa tu acceso');
    expect(activacion).toHaveLength(1);
    expect(activacion[0]?.text).toContain(primerCodigo);
    // Aviso a la lista de respaldo, sin el código.
    const aviso = correosA(ADMIN_EMAIL, 'Booster: acceso al panel otorgado');
    expect(aviso).toHaveLength(1);
    expect(aviso[0]?.text).toContain(PERSONA_EMAIL);
    expect(aviso[0]?.text).not.toContain(primerCodigo);

    const u = await filaPersona();
    expect(u.id).toBe(userId);
    expect(u.isPlatformAdmin).toBe(true);
    expect(u.status).toBe('pendiente_verificacion');
    expect(u.firebaseUid).toBe(`pending-rut:${persona.rut}`);
    expect(u.claveNumericaHash).toBeNull();
    expect(u.activationPinHash).toBeTruthy();
    expect(u.activationPinHash).not.toBe(primerCodigo);
    expect(u.activacionVenceEn).toBeInstanceOf(Date);
    expect(new Date(body.expira_en ?? '').getTime()).toBe(u.activacionVenceEn?.getTime());
  });

  test('2. el admin genera un código nuevo y sale por correo aunque la persona no esté en la lista', async () => {
    const res = await app(LISTA).request(
      `/admin/personal-booster/${userId}/codigo`,
      json('POST', undefined, adminUid),
    );
    const body = (await res.json()) as {
      user_id: string;
      codigo_activacion: string;
      expira_en: string;
      en_lista: boolean;
    };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.user_id).toBe(userId);
    expect(body.en_lista).toBe(false);
    expect(body.codigo_activacion).toMatch(/^\d{6}$/);
    codigo = body.codigo_activacion;

    const activacion = correosA(PERSONA_EMAIL, 'Activa tu acceso');
    expect(activacion).toHaveLength(2);
    const msg = activacion[1];
    expect(msg?.text).toContain('https://app.test.invalid/activar');
    expect(msg?.text).toContain(codigo);
    expect(msg?.text).toContain(persona.rut);
  });

  test('3. el código anterior ya no sirve; el nuevo activa sin la lista, con la clave que elige la persona', async () => {
    const a = app(LISTA);
    expect(primerCodigo).not.toBe(codigo);
    const viejo = await a.request(
      '/auth/activar',
      json('POST', { rut: persona.rut, codigo: primerCodigo, clave_numerica: persona.clave }),
    );
    expect(viejo.status).toBe(401);

    const res = await a.request(
      '/auth/activar',
      json('POST', { rut: persona.rut, codigo, clave_numerica: persona.clave }),
    );
    const body = (await res.json()) as { ok: boolean; activated: boolean; custom_token?: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.activated).toBe(true);
    expect(body.custom_token).toMatch(/^custom-token-/);

    const u = await filaPersona();
    expect(u.status).toBe('activo');
    expect(u.claveNumericaHash).toBeTruthy();
    expect(u.claveNumericaHash).not.toBe(persona.clave);
    expect(u.activationPinHash).toBeNull();
    expect(u.activacionVenceEn).toBeNull();
    expect(u.firebaseUid.startsWith('pending-rut:')).toBe(false);
    expect(firebase.porUid.has(u.firebaseUid)).toBe(true);
    // El correo de la persona no se toca.
    expect(u.email).toBe(PERSONA_EMAIL);
  });

  test('4-6. entra por login-rut, /me la ve como platform-admin por la marca y una ruta /admin/* responde 200', async () => {
    const a = app(LISTA);
    const u = await filaPersona();

    const login = await a.request(
      '/auth/login-rut',
      json('POST', { rut: persona.rut, clave: persona.clave }),
    );
    const entrada = (await login.json()) as { custom_token?: string };
    expect(login.status, JSON.stringify(entrada)).toBe(200);
    expect(entrada.custom_token).toBe(`custom-token-${u.firebaseUid}`);

    const me = await a.request('/me', { headers: { 'x-test-uid': u.firebaseUid } });
    const perfil = (await me.json()) as {
      needs_onboarding: boolean;
      user: { id: string; is_platform_admin: boolean; email: string };
    };
    expect(me.status, JSON.stringify(perfil)).toBe(200);
    expect(perfil.needs_onboarding).toBe(false);
    expect(perfil.user.id).toBe(userId);
    expect(perfil.user.is_platform_admin).toBe(true);

    const panel = await a.request('/admin/personal-booster', {
      headers: { 'x-test-uid': u.firebaseUid },
    });
    const lista = (await panel.json()) as {
      personal: Array<{ email: string; estado: string; user_id: string | null }>;
    };
    expect(panel.status, JSON.stringify(lista)).toBe(200);
    expect(lista.personal).toContainEqual(
      expect.objectContaining({ email: PERSONA_EMAIL, estado: 'activa', user_id: userId }),
    );
  });

  test('7. después de activar, el código ya no sirve y la clave no cambia', async () => {
    const a = app(LISTA);
    const antes = await filaPersona();
    const reuso = await a.request(
      '/auth/activar',
      json('POST', { rut: persona.rut, codigo, clave_numerica: '111222' }),
    );
    expect(reuso.status).toBe(401);
    const despues = await filaPersona();
    expect(despues.claveNumericaHash).toBe(antes.claveNumericaHash);

    const mal = await a.request(
      '/auth/login-rut',
      json('POST', { rut: persona.rut, clave: '111222' }),
    );
    expect(mal.status).toBe(401);
  });

  test('8. una cuenta activa no recibe código nuevo y un alta repetida no la toca', async () => {
    const a = app(LISTA);
    const antes = await filaPersona();

    const reemision = await a.request(
      `/admin/personal-booster/${userId}/codigo`,
      json('POST', undefined, adminUid),
    );
    expect(reemision.status).toBe(409);
    expect(((await reemision.json()) as { code: string }).code).toBe('already_activated');

    const repetida = await a.request(
      '/admin/personal-booster',
      json(
        'POST',
        { email: PERSONA_EMAIL.toUpperCase(), full_name: 'Otro Nombre', rut: persona.rut },
        adminUid,
      ),
    );
    const body = (await repetida.json()) as { vinculo: string; codigo_activacion: string | null };
    expect(repetida.status, JSON.stringify(body)).toBe(200);
    expect(body.vinculo).toBe('cuenta_activa');
    expect(body.codigo_activacion).toBeNull();

    const despues = await filaPersona();
    expect(despues.fullName).toBe(antes.fullName);
    expect(despues.claveNumericaHash).toBe(antes.claveNumericaHash);
    expect(despues.activationPinHash).toBeNull();
    expect(despues.firebaseUid).toBe(antes.firebaseUid);
  });

  test('9. rechazos contra la base real: otro RUT para el correo y RUT de otra persona', async () => {
    const a = app(LISTA);

    const mismatch = await a.request(
      '/admin/personal-booster',
      json(
        'POST',
        { email: PERSONA_EMAIL, full_name: persona.nombre, rut: rutAleatorio() },
        adminUid,
      ),
    );
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as { code: string }).code).toBe('rut_mismatch');

    const otroCorreo = `otra-${randomUUID().slice(0, 8)}@test.invalid`;
    const rutAjeno = await a.request(
      '/admin/personal-booster',
      json('POST', { email: otroCorreo, full_name: 'Otra Persona', rut: persona.rut }, adminUid),
    );
    expect(rutAjeno.status).toBe(409);
    expect(((await rutAjeno.json()) as { code: string }).code).toBe('rut_already_registered');

    const creadas = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, otroCorreo));
    expect(creadas).toEqual([]);
  });

  test('10. sin sesión 401; una cuenta que no es platform-admin 403', async () => {
    const a = app(LISTA);
    expect((await a.request('/admin/personal-booster')).status).toBe(401);

    const otraUid = `fb-otra-${randomUUID().slice(0, 8)}`;
    await handle.db.insert(schema.users).values({
      firebaseUid: otraUid,
      email: `otra-${randomUUID().slice(0, 8)}@test.invalid`,
      fullName: 'Usuaria Común',
      status: 'activo',
    });
    const res = await a.request('/admin/personal-booster', { headers: { 'x-test-uid': otraUid } });
    expect(res.status).toBe(403);
  });

  async function filaPorId(id: string) {
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!u) {
      throw new Error(`fixture: no está la fila ${id}`);
    }
    return u;
  }

  test('11. una cuenta activa fuera de la lista queda con acceso al darla de alta, y «Quitar acceso» se lo quita', async () => {
    const a = app(LISTA);
    const sufijo = randomUUID().slice(0, 8);
    const correoActiva = `activa-${sufijo}@test.invalid`;
    const uidActiva = `fb-activa-${sufijo}`;
    const rut = rutAleatorio();
    const [cuenta] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: uidActiva,
        email: correoActiva,
        fullName: 'Dueña Generadora',
        rut,
        claveNumericaHash: 'hash-clave-existente',
        status: 'activo',
      })
      .returning({ id: schema.users.id });
    if (!cuenta) {
      throw new Error('fixture: cuenta activa no creada');
    }
    const comoElla = { headers: { 'x-test-uid': uidActiva } };
    const esAdmin = async () =>
      (
        (await (await a.request('/me', comoElla)).json()) as {
          user: { is_platform_admin: boolean };
        }
      ).user.is_platform_admin;

    // Antes del alta: sin acceso.
    expect((await a.request('/admin/personal-booster', comoElla)).status).toBe(403);
    expect(await esAdmin()).toBe(false);

    // El alta la marca y le da el acceso, aunque su correo no esté en la lista.
    const alta = await a.request(
      '/admin/personal-booster',
      json('POST', { email: correoActiva, full_name: 'Dueña Generadora', rut }, adminUid),
    );
    const cuerpo = (await alta.json()) as Record<string, unknown>;
    expect(alta.status, JSON.stringify(cuerpo)).toBe(200);
    expect(cuerpo).toMatchObject({
      user_id: cuenta.id,
      vinculo: 'cuenta_activa',
      codigo_activacion: null,
      en_lista: false,
    });
    const marcada = await filaPorId(cuenta.id);
    expect(marcada.isPlatformAdmin).toBe(true);
    expect(marcada.claveNumericaHash).toBe('hash-clave-existente');
    expect(marcada.fullName).toBe('Dueña Generadora');
    expect((await a.request('/admin/personal-booster', comoElla)).status).toBe(200);
    expect(await esAdmin()).toBe(true);
    expect(correosA(ADMIN_EMAIL, 'Booster: acceso al panel otorgado a Dueña')).toHaveLength(1);

    // «Quitar acceso»: el guard lo ve en la request siguiente.
    const baja = await a.request(
      `/admin/personal-booster/${cuenta.id}/quitar-acceso`,
      json('POST', undefined, adminUid),
    );
    expect(baja.status, JSON.stringify(await baja.clone().json())).toBe(200);
    expect(await baja.json()).toEqual({ ok: true, user_id: cuenta.id });
    const desmarcada = await filaPorId(cuenta.id);
    expect(desmarcada.isPlatformAdmin).toBe(false);
    expect(desmarcada.claveNumericaHash).toBe('hash-clave-existente');
    expect(desmarcada.status).toBe('activo');
    expect((await a.request('/admin/personal-booster', comoElla)).status).toBe(403);
    expect(await esAdmin()).toBe(false);
    expect(correosA(ADMIN_EMAIL, 'Booster: acceso al panel quitado a Dueña')).toHaveLength(1);

    // Ya no está marcada: 404. Y el correo de la lista no se quita desde el panel.
    const otraVez = await a.request(
      `/admin/personal-booster/${cuenta.id}/quitar-acceso`,
      json('POST', undefined, adminUid),
    );
    expect(otraVez.status).toBe(404);
    const [admin] = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.firebaseUid, adminUid));
    const alRespaldo = await a.request(
      `/admin/personal-booster/${admin?.id}/quitar-acceso`,
      json('POST', undefined, adminUid),
    );
    expect(alRespaldo.status).toBe(409);
    expect(((await alRespaldo.json()) as { code: string }).code).toBe('en_lista_respaldo');
  });

  test('12. el firebase_uid provisorio de ese RUT ya tomado → 409 rut_already_registered, sin escribir', async () => {
    const sufijo = randomUUID().slice(0, 8);
    const rut = rutAleatorio();
    // Fila con el uid provisorio del RUT pero sin el RUT en su columna.
    await handle.db.insert(schema.users).values({
      firebaseUid: `pending-rut:${rut}`,
      email: `heredada-${sufijo}@test.invalid`,
      fullName: 'Fila Heredada',
      status: 'pendiente_verificacion',
    });
    const correoNuevo = `nueva-${sufijo}@test.invalid`;

    const res = await app(LISTA).request(
      '/admin/personal-booster',
      json('POST', { email: correoNuevo, full_name: 'Persona Nueva', rut }, adminUid),
    );

    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('rut_already_registered');
    const creadas = await handle.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, correoNuevo));
    expect(creadas).toEqual([]);
  });

  test('13. la lista trae la cuenta sin marca cuyo correo está en la lista, y el alta encuentra un correo guardado con mayúsculas', async () => {
    const sufijo = randomUUID().slice(0, 8);
    const correoGuardado = `Mayus-${sufijo}@Test.Invalid`;
    const rut = rutAleatorio();
    const [cuenta] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-mayus-${sufijo}`,
        email: correoGuardado,
        fullName: 'Persona Mayúsculas',
        rut,
        claveNumericaHash: 'hash-clave',
        status: 'activo',
      })
      .returning({ id: schema.users.id });
    if (!cuenta) {
      throw new Error('fixture: cuenta con mayúsculas no creada');
    }
    const a = app([...LISTA, correoGuardado.toLowerCase()]);

    const panel = await a.request('/admin/personal-booster', {
      headers: { 'x-test-uid': adminUid },
    });
    const lista = (await panel.json()) as {
      personal: Array<{ email: string; user_id: string | null; en_lista: boolean; estado: string }>;
    };
    expect(panel.status, JSON.stringify(lista)).toBe(200);
    expect(lista.personal).toContainEqual(
      expect.objectContaining({ user_id: cuenta.id, en_lista: true, estado: 'activa' }),
    );
    expect(
      lista.personal.filter((p) => p.email.toLowerCase() === correoGuardado.toLowerCase()),
    ).toHaveLength(1);

    const alta = await a.request(
      '/admin/personal-booster',
      json(
        'POST',
        { email: correoGuardado.toLowerCase(), full_name: 'Persona Mayúsculas', rut },
        adminUid,
      ),
    );
    const cuerpo = (await alta.json()) as Record<string, unknown>;
    expect(alta.status, JSON.stringify(cuerpo)).toBe(200);
    expect(cuerpo).toMatchObject({ user_id: cuenta.id, vinculo: 'cuenta_activa', en_lista: true });
  });

  test('14. el código de una cuenta del personal sale solo del panel del personal, también frente a la re-emisión del panel de empresas', async () => {
    const a = app(LISTA);
    const sufijo = randomUUID().slice(0, 8);
    const rut = rutAleatorio();
    const correoPersona = `personal-empresa-${sufijo}@test.invalid`;
    const clave = '736251';

    // 1. Alta en el panel: la cuenta queda marcada con un código del panel.
    const alta = await a.request(
      '/admin/personal-booster',
      json('POST', { email: correoPersona, full_name: 'Bea Personal', rut }, adminUid),
    );
    const altaBody = (await alta.json()) as {
      user_id: string;
      vinculo: string;
      codigo_activacion: string;
    };
    expect(alta.status, JSON.stringify(altaBody)).toBe(201);
    expect(altaBody.vinculo).toBe('nueva');
    const personaId = altaBody.user_id;
    const codigoDelPanel = altaBody.codigo_activacion;

    // 2. Una empresa invita a la misma persona y pide re-emitir el código de esa invitación.
    await handle.db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan personal booster',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug });
    const crear = await a.request(
      '/admin/empresas',
      json(
        'POST',
        {
          legal_name: `Personal Booster SpA ${sufijo}`,
          rut: rutAleatorio(),
          contact_email: `contacto-${sufijo}@test.invalid`,
          contact_phone: '+56912345678',
          address_street: 'Av. Apoquindo 3000',
          address_city: 'Santiago',
          address_region: 'XIII',
          is_generador_carga: true,
          is_transportista: false,
        },
        adminUid,
      ),
    );
    const empresa = (await crear.json()) as { empresa_id: string };
    expect(crear.status, JSON.stringify(empresa)).toBe(201);

    const invitar = await a.request(
      `/admin/empresas/${empresa.empresa_id}/miembros`,
      json(
        'POST',
        { email: correoPersona, full_name: 'Bea Personal', rut, rol: 'dueno' },
        adminUid,
      ),
    );
    const invitacion = (await invitar.json()) as {
      membership_id: string;
      vinculo: string;
      codigo_activacion: string | null;
    };
    expect(invitar.status, JSON.stringify(invitacion)).toBe(201);
    expect(invitacion.vinculo).toBe('codigo_vigente');
    expect(invitacion.codigo_activacion).toBeNull();

    const antes = await filaPorId(personaId);
    const reemitirEmpresa = await a.request(
      `/admin/empresas/${empresa.empresa_id}/miembros/${invitacion.membership_id}/codigo`,
      json('POST', undefined, adminUid),
    );
    // Ese código se le entrega a la empresa: para una cuenta del personal, 409.
    expect(reemitirEmpresa.status).toBe(409);
    expect(await reemitirEmpresa.json()).toMatchObject({ code: 'cuenta_personal_booster' });
    const sinCambios = await filaPorId(personaId);
    expect(sinCambios.activationPinHash).toBe(antes.activationPinHash);
    expect(sinCambios.activacionVenceEn?.getTime()).toBe(antes.activacionVenceEn?.getTime());

    // 3. El código del panel del personal activa la cuenta y la invitación vigente.
    const activar = await a.request(
      '/auth/activar',
      json('POST', { rut, codigo: codigoDelPanel, clave_numerica: clave }),
    );
    const sesion = (await activar.json()) as { activated?: boolean };
    expect(activar.status, JSON.stringify(sesion)).toBe(200);
    expect(sesion.activated).toBe(true);
    const activada = await filaPorId(personaId);
    expect(activada.status).toBe('activo');
    expect(activada.claveNumericaHash).toBeTruthy();
    expect(activada.activationPinHash).toBeNull();
    expect(activada.activacionVenceEn).toBeNull();
    const [membresia] = await handle.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.id, invitacion.membership_id));
    expect(membresia?.status).toBe('activa');

    // 4. Orden inverso: la empresa invita primero y re-emite; después el panel
    //    da de alta a la persona. El alta le emite un código propio, y el que
    //    conoce la empresa ya no activa.
    const rutB = rutAleatorio();
    const correoB = `personal-despues-${sufijo}@test.invalid`;
    const invitarB = await a.request(
      `/admin/empresas/${empresa.empresa_id}/miembros`,
      json(
        'POST',
        { email: correoB, full_name: 'Gabi Despues', rut: rutB, rol: 'despachador' },
        adminUid,
      ),
    );
    const invitacionB = (await invitarB.json()) as { membership_id: string; user_id: string };
    expect(invitarB.status, JSON.stringify(invitacionB)).toBe(201);
    const reemitirB = await a.request(
      `/admin/empresas/${empresa.empresa_id}/miembros/${invitacionB.membership_id}/codigo`,
      json('POST', undefined, adminUid),
    );
    const deLaEmpresaB = (await reemitirB.json()) as { codigo_activacion: string };
    expect(reemitirB.status, JSON.stringify(deLaEmpresaB)).toBe(200);
    // SC9: la re-emisión del panel de empresas deja su vencimiento.
    expect((await filaPorId(invitacionB.user_id)).activacionVenceEn).toBeInstanceOf(Date);

    const altaB = await a.request(
      '/admin/personal-booster',
      json('POST', { email: correoB, full_name: 'Gabi Despues', rut: rutB }, adminUid),
    );
    const altaBBody = (await altaB.json()) as { vinculo: string; codigo_activacion: string | null };
    expect(altaB.status, JSON.stringify(altaBBody)).toBe(200);
    expect(altaBBody.vinculo).toBe('provisoria_sin_codigo');
    expect(altaBBody.codigo_activacion).toMatch(/^\d{6}$/);

    const conElDeLaEmpresa = await a.request(
      '/auth/activar',
      json('POST', { rut: rutB, codigo: deLaEmpresaB.codigo_activacion, clave_numerica: clave }),
    );
    expect(conElDeLaEmpresa.status).toBe(401);
    const conElDelPanel = await a.request(
      '/auth/activar',
      json('POST', { rut: rutB, codigo: altaBBody.codigo_activacion, clave_numerica: clave }),
    );
    expect(conElDelPanel.status, JSON.stringify(await conElDelPanel.clone().json())).toBe(200);
  });

  /** Transportista de prueba y su sesión de dueño para `/conductores`. */
  async function transportista(sufijo: string) {
    const { db } = handle;
    await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan personal booster',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await db.select({ id: schema.plans.id }).from(schema.plans).limit(1);
    if (!plan) {
      throw new Error('fixture: plan no disponible');
    }
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Transportes Personal ${sufijo}`,
        rut: rutAleatorio(),
        contactEmail: `flota-${sufijo}@test.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'XIII',
        isTransportista: true,
        planId: plan.id,
      })
      .returning({ id: schema.empresas.id, legalName: schema.empresas.legalName });
    if (!empresa) {
      throw new Error('fixture: transportista no creada');
    }
    const flota = new Hono();
    flota.use('*', async (c, next) => {
      c.set('userContext', {
        user: { id: randomUUID(), firebaseUid: `fb-flota-${sufijo}`, email: 'dueno@test.invalid' },
        memberships: [],
        activeMembership: {
          membership: { id: randomUUID(), role: 'dueno' },
          empresa: { id: empresa.id, legalName: empresa.legalName },
        },
      });
      await next();
    });
    flota.route(
      '/conductores',
      rutas.createConductoresRoutes({ db, logger, platformAdminEmails: LISTA }),
    );
    return flota;
  }

  test('15. la flota no gestiona una cuenta del personal: 409 cuenta_personal_booster; el código del panel activa por /auth/driver-activate', async () => {
    const a = app(LISTA);
    const sufijo = randomUUID().slice(0, 8);
    const rut = rutAleatorio();
    const correoPersona = `personal-conductor-${sufijo}@test.invalid`;
    const clave = '648213';
    const rechazo = { error: 'invalid_credentials', code: 'invalid_credentials' };
    const personalBooster = {
      code: 'cuenta_personal_booster',
      message: 'Esta persona es del personal de Booster; su cuenta se gestiona desde Booster.',
    };

    // 1. Una transportista registra a la persona como conductor: recibe su PIN.
    const flota = await transportista(sufijo);
    const conductor = await flota.request(
      '/conductores',
      json('POST', {
        rut,
        full_name: 'Caro Personal',
        email: correoPersona,
        phone: '+56987654321',
        license_class: 'A4',
        license_number: `LIC-${sufijo}`,
        license_expiry: '2028-09-22',
        is_extranjero: false,
      }),
    );
    const conductorBody = (await conductor.json()) as {
      conductor: { id: string };
      activation_pin?: string;
    };
    expect(conductor.status, JSON.stringify(conductorBody)).toBe(201);
    const pinDeLaFlota = conductorBody.activation_pin ?? '';
    expect(pinDeLaFlota).toMatch(/^\d{6}$/);

    // 2. El panel la da de alta: su código no era del panel, así que emite uno.
    const alta = await a.request(
      '/admin/personal-booster',
      json('POST', { email: correoPersona, full_name: 'Caro Personal', rut }, adminUid),
    );
    const altaBody = (await alta.json()) as {
      user_id: string;
      vinculo: string;
      codigo_activacion: string | null;
    };
    expect(alta.status, JSON.stringify(altaBody)).toBe(200);
    expect(altaBody.vinculo).toBe('provisoria_sin_codigo');
    const codigoDelPanel = altaBody.codigo_activacion ?? '';
    const personaId = altaBody.user_id;
    const marcada = await filaPorId(personaId);
    expect(marcada.isPlatformAdmin).toBe(true);
    expect(marcada.activacionVenceEn).toBeInstanceOf(Date);

    // 3. Desde ahí la flota ya no toca la cuenta: teléfono, correo ni alta.
    const telefono = await flota.request(
      `/conductores/${conductorBody.conductor.id}/telefono`,
      json('POST', { phone: '+56987654322', reenviar_invitacion: true }),
    );
    expect(telefono.status).toBe(409);
    expect(await telefono.json()).toMatchObject(personalBooster);
    const email = await flota.request(
      `/conductores/${conductorBody.conductor.id}/email`,
      json('POST', { email: `otro-${sufijo}@test.invalid` }),
    );
    expect(email.status).toBe(409);
    expect(await email.json()).toMatchObject(personalBooster);
    const sinCambios = await filaPorId(personaId);
    expect(sinCambios.activationPinHash).toBe(marcada.activationPinHash);
    expect(sinCambios.email).toBe(correoPersona);
    expect(sinCambios.phone).toBe('+56987654321');

    // 4. El PIN de la flota ya no activa; el código del panel, sí.
    const conElDeLaFlota = await a.request(
      '/auth/driver-activate',
      json('POST', { rut, pin: pinDeLaFlota, clave_numerica: clave }),
    );
    expect(conElDeLaFlota.status).toBe(401);
    expect(await conElDeLaFlota.json()).toEqual(rechazo);

    const conElDelPanel = await a.request(
      '/auth/driver-activate',
      json('POST', { rut, pin: codigoDelPanel, clave_numerica: clave }),
    );
    const sesion = (await conElDelPanel.json()) as { custom_token?: string };
    expect(conElDelPanel.status, JSON.stringify(sesion)).toBe(200);
    expect(sesion.custom_token).toMatch(/^custom-token-/);
    const activada = await filaPorId(personaId);
    expect(activada.status).toBe('activo');
    expect(activada.claveNumericaHash).toBeTruthy();
    expect(activada.activationPinHash).toBeNull();
    expect(activada.activacionVenceEn).toBeNull();
  });

  test('16. /auth/activar escribe solo si el código sigue siendo el verificado y la cuenta sigue sin clave', async () => {
    const sufijo = randomUUID().slice(0, 8);
    const rechazo = { error: 'invalid_credentials', code: 'invalid_credentials' };
    const clave = '529184';

    // a) El panel re-emite el código entre la verificación y la escritura.
    const correoA = `personal-reemite-${sufijo}@test.invalid`;
    const rutA = rutAleatorio();
    const a = app(LISTA);
    const altaA = await a.request(
      '/admin/personal-booster',
      json('POST', { email: correoA, full_name: 'Dani Personal', rut: rutA }, adminUid),
    );
    const cuerpoA = (await altaA.json()) as { user_id: string; codigo_activacion: string };
    expect(altaA.status, JSON.stringify(cuerpoA)).toBe(201);
    let codigoNuevo = '';
    let hashNuevo: string | null = null;
    firebase.ganchos.antesDeCrear = async () => {
      const reemision = await a.request(
        `/admin/personal-booster/${cuerpoA.user_id}/codigo`,
        json('POST', undefined, adminUid),
      );
      expect(reemision.status).toBe(200);
      codigoNuevo = ((await reemision.json()) as { codigo_activacion: string }).codigo_activacion;
      hashNuevo = (await filaPorId(cuerpoA.user_id)).activationPinHash;
    };

    const conElAnterior = await a.request(
      '/auth/activar',
      json('POST', { rut: rutA, codigo: cuerpoA.codigo_activacion, clave_numerica: clave }),
    );
    expect(conElAnterior.status).toBe(401);
    expect(await conElAnterior.json()).toEqual(rechazo);
    expect(hashNuevo).toBeTruthy();
    const trasLaReemision = await filaPorId(cuerpoA.user_id);
    expect(trasLaReemision.claveNumericaHash).toBeNull();
    expect(trasLaReemision.activationPinHash).toBe(hashNuevo);
    expect(trasLaReemision.firebaseUid).toBe(`pending-rut:${rutA}`);

    // El código re-emitido sí activa.
    const conElNuevo = await a.request(
      '/auth/activar',
      json('POST', { rut: rutA, codigo: codigoNuevo, clave_numerica: clave }),
    );
    expect(conElNuevo.status, JSON.stringify(await conElNuevo.clone().json())).toBe(200);

    // b) La cuenta recibe una clave entre la verificación y la escritura.
    const correoB = `personal-clave-${sufijo}@test.invalid`;
    const rutB = rutAleatorio();
    const b = app(LISTA);
    const altaB = await b.request(
      '/admin/personal-booster',
      json('POST', { email: correoB, full_name: 'Eva Personal', rut: rutB }, adminUid),
    );
    const cuerpoB = (await altaB.json()) as { user_id: string; codigo_activacion: string };
    expect(altaB.status, JSON.stringify(cuerpoB)).toBe(201);
    firebase.ganchos.antesDeCrear = async () => {
      await handle.db
        .update(schema.users)
        .set({ claveNumericaHash: 'hash-de-otra-escritura' })
        .where(eq(schema.users.id, cuerpoB.user_id));
    };

    const conClaveYaPuesta = await b.request(
      '/auth/activar',
      json('POST', { rut: rutB, codigo: cuerpoB.codigo_activacion, clave_numerica: clave }),
    );
    expect(conClaveYaPuesta.status).toBe(401);
    expect(await conClaveYaPuesta.json()).toEqual(rechazo);
    const conClave = await filaPorId(cuerpoB.user_id);
    expect(conClave.claveNumericaHash).toBe('hash-de-otra-escritura');
    expect(conClave.activationPinHash).toBeTruthy();
    expect(conClave.firebaseUid).toBe(`pending-rut:${rutB}`);
  });

  test('17. una cuenta suspendida o eliminada con un código vigente no se activa por ningún endpoint', async () => {
    const a = app(LISTA);
    const rechazo = { error: 'invalid_credentials', code: 'invalid_credentials' };
    for (const estado of ['suspendido', 'eliminado'] as const) {
      const sufijo = randomUUID().slice(0, 8);
      const rut = rutAleatorio();
      const alta = await a.request(
        '/admin/personal-booster',
        json(
          'POST',
          { email: `suspendida-${sufijo}@test.invalid`, full_name: 'Fran Suspendida', rut },
          adminUid,
        ),
      );
      const cuerpo = (await alta.json()) as { user_id: string; codigo_activacion: string };
      expect(alta.status, JSON.stringify(cuerpo)).toBe(201);
      await handle.db
        .update(schema.users)
        .set({ status: estado })
        .where(eq(schema.users.id, cuerpo.user_id));
      const antes = await filaPorId(cuerpo.user_id);

      for (const [ruta, body] of [
        ['/auth/activar', { rut, codigo: cuerpo.codigo_activacion, clave_numerica: '615243' }],
        ['/auth/driver-activate', { rut, pin: cuerpo.codigo_activacion, clave_numerica: '615243' }],
      ] as const) {
        const res = await a.request(ruta, json('POST', body));
        expect(res.status, `${estado} ${ruta}`).toBe(401);
        expect(await res.json()).toEqual(rechazo);
      }
      const despues = await filaPorId(cuerpo.user_id);
      expect(despues.status).toBe(estado);
      expect(despues.claveNumericaHash).toBeNull();
      expect(despues.activationPinHash).toBe(antes.activationPinHash);
      expect(despues.firebaseUid).toBe(`pending-rut:${rut}`);
    }
  });
});
