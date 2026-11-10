import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Auth } from 'firebase-admin/auth';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { hashActivationPin } from '../../src/services/activation-pin.js';
import { verifyClaveNumerica } from '../../src/services/clave-numerica.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T6 de `.specs/correos-solicitudes-panel/spec.md` (SC2), contra Postgres
 * real: la primera activación de un conductor tiene una sola entrada aunque
 * lleguen dos pedidos a la vez, sin cuenta previa del proveedor de identidad.
 *
 * Los dos pedidos leen que no hay cuenta del proveedor y los dos la crean. El
 * doble acepta la primera y rechaza la segunda con `auth/email-already-exists`,
 * como el proveedor real. La escritura con predicado de `bordes-autenticacion`
 * SC3 decide en Postgres cuál entra; el otro recibe la 401 de un código
 * incorrecto.
 */

const PIN = '246810';
const RECHAZO = { error: 'invalid_credentials', code: 'invalid_credentials' };

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

/**
 * Proveedor de identidad en memoria. `getUserByEmail` retiene a los pedidos
 * hasta que llegan `esperados` (o 3 s, para no colgar el test si uno no
 * llega), así los dos leen que la cuenta no existe antes de que alguno la
 * cree. `createUser` rechaza un correo repetido con `auth/email-already-exists`.
 */
function proveedorConBarrera(esperados: number) {
  const porEmail = new Map<
    string,
    { uid: string; email: string; providerData: { providerId: string }[] }
  >();
  let llegados = 0;
  let abrir: () => void = noop;
  const barrera = new Promise<void>((resolve) => {
    abrir = resolve;
    setTimeout(resolve, 3_000);
  });
  const tokens: string[] = [];
  const doble = {
    async getUserByEmail(email: string) {
      llegados += 1;
      if (llegados >= esperados) {
        abrir();
      }
      await barrera;
      const cuenta = porEmail.get(email);
      if (!cuenta) {
        throw Object.assign(new Error(`no user: ${email}`), { code: 'auth/user-not-found' });
      }
      return cuenta;
    },
    async createUser(props: { email: string }) {
      if (porEmail.has(props.email)) {
        throw Object.assign(new Error(`email exists: ${props.email}`), {
          code: 'auth/email-already-exists',
        });
      }
      const cuenta = {
        uid: `fb-${randomUUID().slice(0, 8)}`,
        email: props.email,
        providerData: [],
      };
      porEmail.set(props.email, cuenta);
      return cuenta;
    },
    async createCustomToken(uid: string) {
      const token = `custom-token-${uid}-${tokens.length + 1}`;
      tokens.push(token);
      return token;
    },
  };
  return { auth: doble as never as Auth, porEmail, tokens };
}

describe('integration: primera activación simultánea del conductor (correos-solicitudes-panel SC2)', () => {
  let handle: TestDbHandle;
  let empresaId = '';

  beforeAll(async () => {
    handle = createTestDb();
    await handle.db
      .insert(schema.plans)
      .values({ slug: 'gratis', name: 'p', description: 'f', monthlyPriceClp: 0, features: {} })
      .onConflictDoNothing({ target: schema.plans.slug });
    const [plan] = await handle.db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.slug, 'gratis'));
    const [empresa] = await handle.db
      .insert(schema.empresas)
      .values({
        legalName: 'Transportes Simultánea SpA',
        rut: rutAleatorio(),
        contactEmail: `simultanea-${randomUUID().slice(0, 6)}@empresa.invalid`,
        contactPhone: '+56911111111',
        addressStreet: 'Calle Falsa 123',
        addressCity: 'Santiago',
        addressRegion: 'RM',
        isTransportista: true,
        isGeneradorCarga: false,
        status: 'activa',
        planId: plan?.id ?? '',
      })
      .returning();
    if (!empresa) {
      throw new Error('fixture: empresa no creada');
    }
    empresaId = empresa.id;
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function conductorPendiente() {
    const rut = rutAleatorio();
    const [persona] = await handle.db
      .insert(schema.users)
      .values({
        firebaseUid: `pending-rut:${rut}`,
        email: `conductor-${randomUUID().slice(0, 8)}@test.invalid`,
        fullName: 'Conductor Pendiente',
        rut,
        activationPinHash: hashActivationPin(PIN),
        status: 'pendiente_verificacion',
      })
      .returning();
    if (!persona) {
      throw new Error('fixture: conductor no creado');
    }
    await handle.db.insert(schema.conductores).values({
      userId: persona.id,
      empresaId,
      licenseClass: 'A5',
      licenseNumber: `LIC-${randomUUID().slice(0, 6)}`,
      licenseExpiry: '2028-12-31',
    });
    return { id: persona.id, rut };
  }

  async function app(auth: Auth) {
    const { createDriverAuthRoutes } = await import('../../src/routes/auth-driver.js');
    const a = new Hono();
    a.route('/auth', createDriverAuthRoutes({ db: handle.db, logger, firebaseAuth: auth }));
    return a;
  }

  function activar(a: Hono, rut: string, clave: string) {
    return a.request('/auth/driver-activate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rut, pin: PIN, clave_numerica: clave }),
    });
  }

  test('dos primeras activaciones a la vez: una entra con su clave y la otra recibe la misma 401', async () => {
    const persona = await conductorPendiente();
    const proveedor = proveedorConBarrera(2);
    const a = await app(proveedor.auth);

    const [r1, r2] = await Promise.all([
      activar(a, persona.rut, '555555'),
      activar(a, persona.rut, '666666'),
    ]);

    const estados = [r1.status, r2.status].sort();
    expect(estados, JSON.stringify([await r1.clone().text(), await r2.clone().text()])).toEqual([
      200, 401,
    ]);
    const perdedor = r1.status === 401 ? r1 : r2;
    expect(await perdedor.json()).toEqual(RECHAZO);
    // Una sola cuenta del proveedor y una sola sesión.
    expect(proveedor.porEmail.size).toBe(1);
    expect(proveedor.tokens).toHaveLength(1);

    const [cuenta] = await handle.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, persona.id));
    expect(cuenta?.status).toBe('activo');
    expect(cuenta?.activationPinHash).toBeNull();
    expect(cuenta?.firebaseUid).toBe([...proveedor.porEmail.values()][0]?.uid);
    const claveGanadora = r1.status === 200 ? '555555' : '666666';
    const claveOtra = claveGanadora === '555555' ? '666666' : '555555';
    expect(verifyClaveNumerica(claveGanadora, cuenta?.claveNumericaHash ?? '')).toBe(true);
    expect(verifyClaveNumerica(claveOtra, cuenta?.claveNumericaHash ?? '')).toBe(false);
  });
});
