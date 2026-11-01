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
 * T6 de `.specs/alta-personal-booster/spec.md` (SC7): la cadena real del alta
 * del personal de Booster contra Postgres, en el orden del runbook.
 *
 *   1. `POST /admin/personal-booster`            → cuenta provisoria + código
 *   2. el correo todavía no está en la lista     → `/auth/activar` responde 401
 *   3. el PO agrega el correo a la lista          → «Generar código nuevo»
 *   4. `POST /auth/activar` con el código nuevo   → clave propia, sesión
 *   5. `POST /auth/login-rut`                     → entra con esa clave
 *   6. `GET /me`                                  → `is_platform_admin: true`
 *   7. `GET /admin/personal-booster` como ella    → 200
 *
 * La lista de Terraform tiene dos lecturas: `requirePlatformAdmin` y `/me` la
 * leen de `config` al importar (por eso el env se fija en `vi.hoisted`, con el
 * estado final: el admin y la persona), y las rutas nuevas la reciben por
 * opciones. El paso 2 pasa la lista sin la persona para reproducir el orden:
 * primero el alta, después la lista.
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
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS =
    'admin-personal-it@test.invalid,personal-it@test.invalid';
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

function authEnMemoria() {
  const porEmail = new Map<string, { uid: string; email: string }>();
  const porUid = new Map<string, { uid: string; email: string }>();
  const noExiste = (ref: string) =>
    Object.assign(new Error(`no user: ${ref}`), { code: 'auth/user-not-found' });
  const fake = {
    async createUser(props: { email?: string; uid?: string }) {
      const email = props.email ?? `${randomUUID()}@fake.invalid`;
      if (porEmail.has(email)) {
        throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
      }
      const u = { uid: props.uid ?? `fb-${randomUUID().slice(0, 8)}`, email };
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
  return { auth: fake as never as Auth, porUid };
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
  const [personal, activar, universal, me, userContext, empresaMiembros] = await Promise.all([
    import('../../src/routes/admin-personal-booster.js'),
    import('../../src/routes/auth-activar.js'),
    import('../../src/routes/auth-universal.js'),
    import('../../src/routes/me.js'),
    import('../../src/middleware/user-context.js'),
    import('../../src/routes/admin-empresa-miembros.js'),
  ]);
  return {
    createAdminPersonalBoosterRoutes: personal.createAdminPersonalBoosterRoutes,
    createAuthActivarRoutes: activar.createAuthActivarRoutes,
    createAuthUniversalRoutes: universal.createAuthUniversalRoutes,
    createMeRoutes: me.createMeRoutes,
    createUserContextMiddleware: userContext.createUserContextMiddleware,
    createAdminEmpresaMiembrosRoutes: empresaMiembros.createAdminEmpresaMiembrosRoutes,
  };
}

describe('integration: alta del personal de Booster desde el panel (SC7)', () => {
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

  // La persona entra a la lista de Terraform en el paso 3.
  const LISTA_ANTES = [ADMIN_EMAIL];
  const LISTA_DESPUES = [ADMIN_EMAIL, PERSONA_EMAIL];

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
        platformAdminEmails: lista,
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

  test('1. el admin da de alta a la persona antes de que su correo esté en la lista', async () => {
    const res = await app(LISTA_ANTES).request(
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
    // Fuera de la lista no sale correo.
    expect(correo.enviados).toHaveLength(0);

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

  test('2. sin el correo en la lista, /auth/activar responde la 401 genérica y no escribe', async () => {
    const antes = await filaPersona();
    const res = await app(LISTA_ANTES).request(
      '/auth/activar',
      json('POST', { rut: persona.rut, codigo: primerCodigo, clave_numerica: persona.clave }),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'invalid_credentials', code: 'invalid_credentials' });
    const despues = await filaPersona();
    expect(despues.activationPinHash).toBe(antes.activationPinHash);
    expect(despues.claveNumericaHash).toBeNull();
  });

  test('3. con el correo ya en la lista, el admin genera un código nuevo y sale por correo', async () => {
    const res = await app(LISTA_DESPUES).request(
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
    expect(body.en_lista).toBe(true);
    expect(body.codigo_activacion).toMatch(/^\d{6}$/);
    codigo = body.codigo_activacion;

    expect(correo.enviados).toHaveLength(1);
    const msg = correo.enviados[0];
    expect(msg?.to).toBe(PERSONA_EMAIL);
    expect(msg?.text).toContain('https://app.test.invalid/activar');
    expect(msg?.text).toContain(codigo);
    expect(msg?.text).toContain(persona.rut);
  });

  test('4. el código anterior ya no sirve; el nuevo activa con la clave que elige la persona', async () => {
    const a = app(LISTA_DESPUES);
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

  test('5-7. entra por login-rut, /me la ve como platform-admin y una ruta /admin/* responde 200', async () => {
    const a = app(LISTA_DESPUES);
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

  test('8. después de activar, el código ya no sirve y la clave no cambia', async () => {
    const a = app(LISTA_DESPUES);
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

  test('9. una cuenta activa no recibe código nuevo y un alta repetida no la toca', async () => {
    const a = app(LISTA_DESPUES);
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

  test('10. rechazos contra la base real: otro RUT para el correo y RUT de otra persona', async () => {
    const a = app(LISTA_DESPUES);

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

  test('11. sin sesión 401; una cuenta que no es platform-admin 403', async () => {
    const a = app(LISTA_DESPUES);
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

  test('12. una cuenta activa fuera de la lista no se marca; con el correo en la lista, sí', async () => {
    const sufijo = randomUUID().slice(0, 8);
    const correoActiva = `activa-${sufijo}@test.invalid`;
    const rut = rutAleatorio();
    const [cuenta] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-activa-${sufijo}`,
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
    const datos = { email: correoActiva, full_name: 'Dueña Generadora', rut };

    const fuera = await app(LISTA_DESPUES).request(
      '/admin/personal-booster',
      json('POST', datos, adminUid),
    );
    const cuerpoFuera = (await fuera.json()) as Record<string, unknown>;
    expect(fuera.status, JSON.stringify(cuerpoFuera)).toBe(200);
    expect(cuerpoFuera).toMatchObject({
      user_id: cuenta.id,
      vinculo: 'cuenta_activa',
      codigo_activacion: null,
      en_lista: false,
    });
    expect((await filaPorId(cuenta.id)).isPlatformAdmin).toBe(false);

    const dentro = await app([...LISTA_DESPUES, correoActiva]).request(
      '/admin/personal-booster',
      json('POST', datos, adminUid),
    );
    const cuerpoDentro = (await dentro.json()) as Record<string, unknown>;
    expect(dentro.status, JSON.stringify(cuerpoDentro)).toBe(200);
    expect(cuerpoDentro).toMatchObject({ vinculo: 'cuenta_activa', en_lista: true });
    const marcada = await filaPorId(cuenta.id);
    expect(marcada.isPlatformAdmin).toBe(true);
    expect(marcada.claveNumericaHash).toBe('hash-clave-existente');
    expect(marcada.fullName).toBe('Dueña Generadora');
  });

  test('13. el firebase_uid provisorio de ese RUT ya tomado → 409 rut_already_registered, sin escribir', async () => {
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

    const res = await app(LISTA_DESPUES).request(
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

  test('14. la lista trae la cuenta sin marca cuyo correo está en la lista, y el alta encuentra un correo guardado con mayúsculas', async () => {
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
    const a = app([...LISTA_DESPUES, correoGuardado.toLowerCase()]);

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

  test('15. un código que no emitió el panel no activa a una cuenta marcada; el que re-emite el panel, sí', async () => {
    const a = app(LISTA_DESPUES);
    const sufijo = randomUUID().slice(0, 8);
    const rut = rutAleatorio();
    const correoPersona = `personal-empresa-${sufijo}@test.invalid`;
    const clave = '736251';
    const rechazo = { error: 'invalid_credentials', code: 'invalid_credentials' };

    // 1. Alta en el panel: la cuenta queda marcada con un código del panel.
    const alta = await a.request(
      '/admin/personal-booster',
      json('POST', { email: correoPersona, full_name: 'Bea Personal', rut }, adminUid),
    );
    const altaBody = (await alta.json()) as { user_id: string; vinculo: string };
    expect(alta.status, JSON.stringify(altaBody)).toBe(201);
    expect(altaBody.vinculo).toBe('nueva');
    const personaId = altaBody.user_id;

    // 2. Una empresa invita a la misma persona y re-emite el código de esa invitación.
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

    const reemitirEmpresa = await a.request(
      `/admin/empresas/${empresa.empresa_id}/miembros/${invitacion.membership_id}/codigo`,
      json('POST', undefined, adminUid),
    );
    const deLaEmpresa = (await reemitirEmpresa.json()) as { codigo_activacion: string };
    expect(reemitirEmpresa.status, JSON.stringify(deLaEmpresa)).toBe(200);
    const conCodigoDeLaEmpresa = await filaPorId(personaId);
    expect(conCodigoDeLaEmpresa.isPlatformAdmin).toBe(true);

    // 3. Ese código no activa la cuenta marcada, aunque la invitación esté vigente.
    const conElDeLaEmpresa = await a.request(
      '/auth/activar',
      json('POST', { rut, codigo: deLaEmpresa.codigo_activacion, clave_numerica: clave }),
    );
    expect(conElDeLaEmpresa.status).toBe(401);
    expect(await conElDeLaEmpresa.json()).toEqual(rechazo);
    const sinActivar = await filaPorId(personaId);
    expect(sinActivar.claveNumericaHash).toBeNull();
    expect(sinActivar.activationPinHash).toBe(conCodigoDeLaEmpresa.activationPinHash);
    // La re-emisión de la empresa dejó su código sin el vencimiento del panel.
    expect(sinActivar.activacionVenceEn).toBeNull();

    // 4. El panel re-emite: ese código activa la cuenta y la membresía.
    const reemitirPanel = await a.request(
      `/admin/personal-booster/${personaId}/codigo`,
      json('POST', undefined, adminUid),
    );
    const delPanel = (await reemitirPanel.json()) as { codigo_activacion: string };
    expect(reemitirPanel.status, JSON.stringify(delPanel)).toBe(200);
    expect(delPanel.codigo_activacion).not.toBe(deLaEmpresa.codigo_activacion);

    const conElDelPanel = await a.request(
      '/auth/activar',
      json('POST', { rut, codigo: delPanel.codigo_activacion, clave_numerica: clave }),
    );
    const sesion = (await conElDelPanel.json()) as { activated?: boolean };
    expect(conElDelPanel.status, JSON.stringify(sesion)).toBe(200);
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
  });
});
