import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { UserContext } from '../../src/services/user-context.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T6 de `.specs/alta-desde-panel-admin/spec.md` (plan multi-tenant §2.F):
 * la cadena real de alta contra Postgres, tal como la recorre el panel.
 *
 *   1. `POST /admin/empresas`            → empresa `pendiente_verificacion`
 *   2. `PATCH /admin/empresas/:id`       → `activa`
 *   3. `POST /admin/empresas/:id/miembros` (rol dueño) → código de activación
 *   4. `POST /auth/activar`              → clave propia, membresía `activa`, custom token
 *   5. `POST /auth/login-rut`            → entra con RUT + clave
 *
 * Son cinco llamadas, no una transacción: ese es el contrato en producción y
 * no se reescribe acá. Firebase se inyecta (decisión §3.4 (i)): las rutas ya
 * reciben `Auth` por opts, así que un Auth en memoria basta y el job de
 * integración no necesita el emulador.
 */

const ADMIN_EMAIL = 'admin-alta@test.invalid';

function authEnMemoria() {
  const porEmail = new Map<string, { uid: string; email: string }>();
  const porUid = new Map<string, { uid: string; email: string }>();
  const tokens: string[] = [];
  const noExiste = (email: string) =>
    Object.assign(new Error(`no user: ${email}`), { code: 'auth/user-not-found' });
  const auth = {
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
    async updateUser(uid: string, props: { email?: string }) {
      const u = porUid.get(uid);
      if (!u) {
        throw noExiste(uid);
      }
      if (props.email && props.email !== u.email) {
        porEmail.delete(u.email);
        u.email = props.email;
        porEmail.set(u.email, u);
      }
      return u;
    },
    async createCustomToken(uid: string) {
      const t = `custom-token-${uid}-${tokens.length + 1}`;
      tokens.push(t);
      return t;
    },
    async generatePasswordResetLink() {
      return 'https://app.test.invalid/__/auth/action?mode=resetPassword&oobCode=x';
    },
  };
  return { auth: auth as unknown as Auth, porUid, tokens };
}

async function cargarRutas() {
  // `config.ts` lee env al importarse: el allowlist de platform-admin tiene
  // que estar antes del primer import de rutas (cada archivo tiene su propio
  // registro de módulos en vitest).
  process.env.BOOSTER_PLATFORM_ADMIN_EMAILS = ADMIN_EMAIL;
  const [admin, activar, universal] = await Promise.all([
    import('../../src/routes/admin-empresa-miembros.js'),
    import('../../src/routes/auth-activar.js'),
    import('../../src/routes/auth-universal.js'),
  ]);
  return {
    createAdminEmpresaMiembrosRoutes: admin.createAdminEmpresaMiembrosRoutes,
    createAuthActivarRoutes: activar.createAuthActivarRoutes,
    createAuthUniversalRoutes: universal.createAuthUniversalRoutes,
  };
}

describe('integration: cadena de alta desde el panel admin (T6)', () => {
  let handle: TestDbHandle;
  let rutas: Awaited<ReturnType<typeof cargarRutas>>;
  let firebase: ReturnType<typeof authEnMemoria>;
  let adminUserId: string;
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

  beforeAll(async () => {
    handle = createTestDb();
    rutas = await cargarRutas();
    firebase = authEnMemoria();
    const { db } = handle;
    await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan alta admin',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [admin] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-admin-${randomUUID().slice(0, 8)}`,
        email: ADMIN_EMAIL,
        fullName: 'Admin Plataforma',
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id });
    adminUserId =
      admin?.id ??
      (
        await db
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.email, ADMIN_EMAIL))
          .limit(1)
      )[0]?.id ??
      '';
    if (!adminUserId) {
      throw new Error('fixture: admin no creado');
    }
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function app() {
    const { db } = handle;
    const sinRateLimit: MiddlewareHandler = async (_c, next) => {
      await next();
    };
    const a = new Hono();
    // El panel manda la sesión del platform-admin; /auth/* es pre-auth.
    a.use('/admin/*', async (c, next) => {
      const ctx: UserContext = {
        user: { id: adminUserId, email: ADMIN_EMAIL } as UserContext['user'],
        memberships: [],
        activeMembership: null,
        impersonatedBy: null,
      };
      c.set('userContext', ctx);
      await next();
    });
    a.route(
      '/admin/empresas',
      rutas.createAdminEmpresaMiembrosRoutes({ db, logger, auth: firebase.auth }),
    );
    a.route('/auth', rutas.createAuthActivarRoutes({ db, logger, firebaseAuth: firebase.auth }));
    a.route(
      '/auth',
      rutas.createAuthUniversalRoutes({
        db,
        logger,
        firebaseAuth: firebase.auth,
        rateLimitLogin: sinRateLimit,
      }),
    );
    return a;
  }

  function json(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  const dueno = {
    rut: rutAleatorio(),
    clave: '482913',
    email: `dueno-${randomUUID().slice(0, 8)}@test.invalid`,
  };
  let empresaId = '';
  let codigo = '';
  let userId = '';

  test('1-3. el admin crea la empresa, la activa e invita al dueño: sale un código, no una clave', async () => {
    const a = app();
    const crear = await a.request(
      '/admin/empresas',
      json('POST', {
        legal_name: `Alta Admin SpA ${randomUUID().slice(0, 6)}`,
        rut: rutAleatorio(),
        contact_email: `contacto-${randomUUID().slice(0, 8)}@test.invalid`,
        contact_phone: '+56912345678',
        address_street: 'Av. Apoquindo 3000',
        address_city: 'Santiago',
        address_region: 'XIII',
        is_generador_carga: true,
        is_transportista: true,
      }),
    );
    const creada = (await crear.json()) as { empresa_id: string; estado: string };
    expect(crear.status, JSON.stringify(creada)).toBe(201);
    expect(creada.estado).toBe('pendiente_verificacion');
    empresaId = creada.empresa_id;

    const activar = await a.request(
      `/admin/empresas/${empresaId}`,
      json('PATCH', { estado: 'activa' }),
    );
    const activada = (await activar.json()) as { estado: string };
    expect(activar.status, JSON.stringify(activada)).toBe(200);
    expect(activada.estado).toBe('activa');

    const invitar = await a.request(
      `/admin/empresas/${empresaId}/miembros`,
      json('POST', { email: dueno.email, full_name: 'Dueña Alta', rut: dueno.rut, rol: 'dueno' }),
    );
    const invitado = (await invitar.json()) as {
      user_id: string;
      estado: string;
      codigo_activacion: string | null;
      expira_en: string | null;
      vinculo: string;
    };
    expect(invitar.status, JSON.stringify(invitado)).toBe(201);
    expect(invitado.vinculo).toBe('nueva');
    expect(invitado.estado).toBe('pendiente_invitacion');
    expect(invitado.codigo_activacion).toMatch(/^\d{6}$/);
    expect(invitado.expira_en).toBeTruthy();
    codigo = invitado.codigo_activacion ?? '';
    userId = invitado.user_id;

    // En la BD: hash del código, sin clave, sin cuenta Firebase real.
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u?.activationPinHash).toBeTruthy();
    expect(u?.activationPinHash).not.toBe(codigo);
    expect(u?.claveNumericaHash).toBeNull();
    expect(u?.firebaseUid.startsWith('pending-rut:')).toBe(true);
  });

  test('4. /auth/activar con RUT + código: clave propia, membresía activa, custom token', async () => {
    expect(codigo).toMatch(/^\d{6}$/);
    const res = await app().request(
      '/auth/activar',
      json('POST', { rut: dueno.rut, codigo, clave_numerica: dueno.clave }),
    );
    const body = (await res.json()) as { ok: boolean; activated: boolean; custom_token?: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.activated).toBe(true);
    expect(body.custom_token).toMatch(/^custom-token-/);

    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u?.claveNumericaHash).toBeTruthy();
    expect(u?.claveNumericaHash).not.toBe(dueno.clave);
    expect(u?.activationPinHash).toBeNull();
    expect(u?.firebaseUid.startsWith('pending-rut:')).toBe(false);
    expect(firebase.porUid.has(u?.firebaseUid ?? '')).toBe(true);

    const [m] = await handle.db
      .select()
      .from(schema.memberships)
      .where(eq(schema.memberships.userId, userId));
    expect(m?.empresaId).toBe(empresaId);
    expect(m?.role).toBe('dueno');
    expect(m?.status).toBe('activa');
    expect(m?.joinedAt).toBeTruthy();
  });

  test('5. login-rut entra con la clave elegida; el código ya no sirve; otra clave no entra', async () => {
    const a = app();
    const ok = await a.request(
      '/auth/login-rut',
      json('POST', { rut: dueno.rut, clave: dueno.clave }),
    );
    const entrada = (await ok.json()) as { custom_token?: string; synthetic_email?: string };
    expect(ok.status, JSON.stringify(entrada)).toBe(200);
    expect(entrada.custom_token).toMatch(/^custom-token-/);

    const reuso = await a.request(
      '/auth/activar',
      json('POST', { rut: dueno.rut, codigo, clave_numerica: '999999' }),
    );
    expect(reuso.status).toBe(401);
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId));
    const mal = await a.request(
      '/auth/login-rut',
      json('POST', { rut: dueno.rut, clave: '000000' }),
    );
    expect(mal.status).toBe(401);
    // La clave no cambió por el intento de reuso del código.
    const [u2] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u2?.claveNumericaHash).toBe(u?.claveNumericaHash);
  });

  test('6. invitar un RUT ya activo a otra empresa: membresía activa, sin código, la clave anterior sigue', async () => {
    const a = app();
    const crear = await a.request(
      '/admin/empresas',
      json('POST', {
        legal_name: `Segunda Empresa SpA ${randomUUID().slice(0, 6)}`,
        rut: rutAleatorio(),
        contact_email: `contacto2-${randomUUID().slice(0, 8)}@test.invalid`,
        contact_phone: '+56912345678',
        address_street: 'Calle Falsa 123',
        address_city: 'Santiago',
        address_region: 'XIII',
        is_generador_carga: false,
        is_transportista: true,
      }),
    );
    const segunda = (await crear.json()) as { empresa_id: string };
    expect(crear.status).toBe(201);
    await a.request(`/admin/empresas/${segunda.empresa_id}`, json('PATCH', { estado: 'activa' }));

    const [antes] = await handle.db.select().from(schema.users).where(eq(schema.users.id, userId));
    const invitar = await a.request(
      `/admin/empresas/${segunda.empresa_id}/miembros`,
      json('POST', { email: dueno.email, full_name: 'Dueña Alta', rut: dueno.rut, rol: 'admin' }),
    );
    const invitado = (await invitar.json()) as {
      user_id: string;
      estado: string;
      codigo_activacion: string | null;
      vinculo: string;
    };
    expect(invitar.status, JSON.stringify(invitado)).toBe(201);
    expect(invitado.user_id).toBe(userId);
    expect(invitado.vinculo).toBe('cuenta_activa');
    expect(invitado.estado).toBe('activa');
    expect(invitado.codigo_activacion).toBeNull();

    const [despues] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId));
    expect(despues?.claveNumericaHash).toBe(antes?.claveNumericaHash);
    expect(despues?.activationPinHash).toBeNull();
    expect(despues?.firebaseUid).toBe(antes?.firebaseUid);

    const login = await a.request(
      '/auth/login-rut',
      json('POST', { rut: dueno.rut, clave: dueno.clave }),
    );
    expect(login.status).toBe(200);
  });
});
