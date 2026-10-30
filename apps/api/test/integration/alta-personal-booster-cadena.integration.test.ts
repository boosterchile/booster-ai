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
  const [personal, activar, universal, me, userContext] = await Promise.all([
    import('../../src/routes/admin-personal-booster.js'),
    import('../../src/routes/auth-activar.js'),
    import('../../src/routes/auth-universal.js'),
    import('../../src/routes/me.js'),
    import('../../src/middleware/user-context.js'),
  ]);
  return {
    createAdminPersonalBoosterRoutes: personal.createAdminPersonalBoosterRoutes,
    createAuthActivarRoutes: activar.createAuthActivarRoutes,
    createAuthUniversalRoutes: universal.createAuthUniversalRoutes,
    createMeRoutes: me.createMeRoutes,
    createUserContextMiddleware: userContext.createUserContextMiddleware,
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
    if (primerCodigo !== codigo) {
      const viejo = await a.request(
        '/auth/activar',
        json('POST', { rut: persona.rut, codigo: primerCodigo, clave_numerica: persona.clave }),
      );
      expect(viejo.status).toBe(401);
    }

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
});
