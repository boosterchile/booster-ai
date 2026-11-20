import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { FirebaseClaims } from '../../src/middleware/firebase-auth.js';
import { hashActivationPin } from '../../src/services/activation-pin.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T6 de `.specs/bordes-autenticacion/spec.md`, contra Postgres real:
 *   - SC3: `/auth/driver-activate` escribe solo si el código sigue siendo el
 *     verificado y la cuenta sigue sin clave.
 *   - SC4: una sesión impersonada se corta en la request siguiente cuando
 *     quien impersona pierde el acceso al panel.
 */

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

const RECHAZO = { error: 'invalid_credentials', code: 'invalid_credentials' };

/** Firebase en memoria con un gancho que corre dentro del próximo `createUser`. */
function authEnMemoria() {
  const ganchos: { antesDeCrear: (() => Promise<void>) | null } = { antesDeCrear: null };
  const porEmail = new Map<string, { uid: string; providerData: { providerId: string }[] }>();
  const fake = {
    async getUserByEmail(email: string) {
      const u = porEmail.get(email);
      if (!u) {
        throw Object.assign(new Error('no user'), { code: 'auth/user-not-found' });
      }
      return u;
    },
    async createUser(props: { email: string }) {
      const gancho = ganchos.antesDeCrear;
      ganchos.antesDeCrear = null;
      if (gancho) {
        await gancho();
      }
      const u = { uid: `fb-${randomUUID().slice(0, 8)}`, providerData: [] };
      porEmail.set(props.email, u);
      return u;
    },
    // Como el SDK: una activación revoca las sesiones de una cuenta libre que reutiliza.
    async revokeRefreshTokens(_uid: string) {
      return undefined;
    },
    async createCustomToken(uid: string) {
      return `custom-token-${uid}`;
    },
  };
  return { auth: fake as never as Auth, ganchos };
}

describe('integration: bordes de autenticación', () => {
  let handle: TestDbHandle;

  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function fila(id: string) {
    const [u] = await handle.db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!u) {
      throw new Error(`fixture: no está la fila ${id}`);
    }
    return u;
  }

  /** Conductor pendiente con un PIN, en una transportista nueva. */
  async function conductorPendiente(pin: string) {
    const { db } = handle;
    const sufijo = randomUUID().slice(0, 8);
    const rut = rutAleatorio();
    await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan bordes',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await db.select({ id: schema.plans.id }).from(schema.plans).limit(1);
    const [empresa] = await db
      .insert(schema.empresas)
      .values({
        legalName: `Transportes Bordes ${sufijo}`,
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
    const [persona] = await db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: `conductor-${sufijo}@test.invalid`,
        fullName: 'Conductor Bordes',
        rut,
        activationPinHash: hashActivationPin(pin),
        status: 'pendiente_verificacion',
      })
      .returning({ id: schema.users.id });
    if (!empresa || !persona) {
      throw new Error('fixture: conductor no creado');
    }
    await db.insert(schema.conductores).values({
      userId: persona.id,
      empresaId: empresa.id,
      licenseClass: 'A4',
      licenseNumber: `LIC-${sufijo}`,
      licenseExpiry: '2028-09-22',
      isExtranjero: false,
      driverStatus: 'activo',
    });
    return { id: persona.id, rut };
  }

  async function appConductor() {
    const { createDriverAuthRoutes } = await import('../../src/routes/auth-driver.js');
    const firebase = authEnMemoria();
    const app = new Hono();
    app.route(
      '/auth',
      createDriverAuthRoutes({ db: handle.db, logger, firebaseAuth: firebase.auth }),
    );
    return { app, ganchos: firebase.ganchos };
  }

  function activar(app: Hono, rut: string, pin: string) {
    return app.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut, pin, clave_numerica: '615243' }),
    });
  }

  test('SC3: si el código cambió entre la verificación y la escritura, no se activa ni hay sesión', async () => {
    const persona = await conductorPendiente('402613');
    const { app, ganchos } = await appConductor();
    const hashNuevo = hashActivationPin('509172');
    ganchos.antesDeCrear = async () => {
      await handle.db
        .update(schema.users)
        .set({ activationPinHash: hashNuevo })
        .where(eq(schema.users.id, persona.id));
    };

    const res = await activar(app, persona.rut, '402613');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RECHAZO);
    const despues = await fila(persona.id);
    expect(despues.claveNumericaHash).toBeNull();
    expect(despues.activationPinHash).toBe(hashNuevo);
    expect(despues.firebaseUid).toBe(`pending-rut:${persona.rut}`);
  });

  test('SC3: si la cuenta recibió una clave entre la verificación y la escritura, no se reescribe', async () => {
    const persona = await conductorPendiente('718293');
    const { app, ganchos } = await appConductor();
    ganchos.antesDeCrear = async () => {
      await handle.db
        .update(schema.users)
        .set({ claveNumericaHash: 'hash-de-otra-activacion' })
        .where(eq(schema.users.id, persona.id));
    };

    const res = await activar(app, persona.rut, '718293');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(RECHAZO);
    expect((await fila(persona.id)).claveNumericaHash).toBe('hash-de-otra-activacion');
  });

  test('SC3: sin carrera, el mismo código activa una vez y después ya no sirve', async () => {
    const persona = await conductorPendiente('826401');
    const { app } = await appConductor();

    const primera = await activar(app, persona.rut, '826401');
    expect(primera.status, JSON.stringify(await primera.clone().json())).toBe(200);
    const segunda = await activar(app, persona.rut, '826401');
    expect(segunda.status).toBe(410);
    expect(await segunda.json()).toEqual({ error: 'already_activated', code: 'already_activated' });
  });

  test('SC4: la sesión impersonada se corta en la request siguiente cuando quien impersona pierde el acceso', async () => {
    const { createImpersonationWriteGuardMiddleware } = await import(
      '../../src/middleware/impersonation-write-guard.js'
    );
    const sufijo = randomUUID().slice(0, 8);
    const [admin] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `fb-admin-bordes-${sufijo}`,
        email: `admin-bordes-${sufijo}@test.invalid`,
        fullName: 'Admin Bordes',
        isPlatformAdmin: true,
        status: 'activo',
      })
      .returning({ id: schema.users.id });
    if (!admin) {
      throw new Error('fixture: admin no creado');
    }
    const claims: FirebaseClaims = {
      uid: 'target-firebase-uid',
      email: undefined,
      emailVerified: false,
      name: undefined,
      picture: undefined,
      custom: { impersonated_by: admin.id },
    };
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('firebaseClaims', claims);
      await next();
    });
    app.use(
      '*',
      createImpersonationWriteGuardMiddleware({ logger, db: handle.db, platformAdminEmails: [] }),
    );
    app.get('/lectura', (c) => c.json({ ok: true }));

    expect((await app.request('/lectura')).status).toBe(200);

    await handle.db
      .update(schema.users)
      .set({ isPlatformAdmin: false })
      .where(eq(schema.users.id, admin.id));

    const cortada = await app.request('/lectura');
    expect(cortada.status).toBe(401);
    expect(await cortada.json()).toEqual({ error: 'unauthorized', code: 'impersonation_revoked' });
  });
});
