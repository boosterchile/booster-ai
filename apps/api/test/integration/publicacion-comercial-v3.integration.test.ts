import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import * as schema from '../../src/db/schema.js';
import { createTripRequestsV2Routes } from '../../src/routes/trip-requests-v2.js';
import {
  crearLectorConfiguracionComercial,
  leerConfiguracionPublicada,
} from '../../src/services/configuracion-comercial.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-079 §1–§2 contra Postgres real: con PRICING_V3_ACTIVATED, publicar
 * congela la tasa y la versión vigente en `viajes`; el detalle del generador
 * reconstruye el desglose desde lo congelado, aunque después se publique
 * otra configuración.
 */
vi.mock('../../src/services/matching.js', () => ({
  runMatching: vi.fn(async () => ({
    tripId: 'x',
    candidatesEvaluated: 0,
    offersCreated: 0,
    offers: [],
  })),
  TripRequestNotFoundError: class extends Error {},
  TripRequestNotMatchableError: class extends Error {},
}));

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

const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: publicación con modelo comercial v3', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterEach(() => {
    appConfig.PRICING_V3_ACTIVATED = false;
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  test('congela tasa y versión al publicar y el detalle devuelve el desglose', async () => {
    appConfig.PRICING_V3_ACTIVATED = true;
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: `P ${s}`,
            description: 'f',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const user = uno(
      await db
        .insert(schema.users)
        .values({ firebaseUid: `fb-pc-${s}`, email: `pc-${s}@test.invalid`, fullName: 'G' })
        .returning(),
      'user',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Gen ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `g-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'C 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isGeneradorCarga: true,
          status: 'activa',
          planId: plan.id,
        })
        .returning(),
      'empresa',
    );

    const lector = crearLectorConfiguracionComercial({
      leer: () => leerConfiguracionPublicada(db),
    });
    const vigente = await lector.obtener();
    const app = new Hono();
    app.use('/trip-requests-v2/*', async (c, next) => {
      c.set(
        'userContext' as never,
        {
          user,
          memberships: [],
          activeMembership: { membership: { role: 'dueno' }, empresa },
        } as never,
      );
      await next();
    });
    app.route(
      '/trip-requests-v2',
      createTripRequestsV2Routes({ db, logger, lectorComercial: lector }),
    );

    const start = Date.now() + 24 * 3_600_000;
    const res = await app.request('/trip-requests-v2', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: { address_raw: 'Av. Apoquindo 5550', region_code: 'XIII' },
        destination: { address_raw: 'Concepción centro', region_code: 'VIII' },
        cargo: { cargo_type: 'carga_seca', weight_kg: 1500 },
        pickup_window: {
          start_at: new Date(start).toISOString(),
          end_at: new Date(start + 3_600_000).toISOString(),
        },
        proposed_price_clp: 700_000,
      }),
    });
    expect(res.status).toBe(201);
    const creado = (await res.json()) as { trip_request: { id: string } };

    const fila = uno(
      await db.select().from(schema.trips).where(eq(schema.trips.id, creado.trip_request.id)),
      'viaje',
    );
    const spot = vigente.config.comisiones.spot_pct;
    expect(fila.modalidadCarga).toBe('spot');
    expect(Number(fila.comisionPctAplicada)).toBe(spot);
    expect(fila.configuracionComercialId).toBe(vigente.id);

    const detalle = await app.request(`/trip-requests-v2/${creado.trip_request.id}`);
    expect(detalle.status).toBe(200);
    const body = (await detalle.json()) as {
      trip_request: { modalidad_carga: string; comercial: Record<string, number | string> };
    };
    expect(body.trip_request.modalidad_carga).toBe('spot');
    expect(body.trip_request.comercial).toMatchObject({
      modalidad_carga: 'spot',
      precio_transportista_clp: 700_000,
      comision_pct: spot,
      comision_clp: Math.round((700_000 * spot) / 100),
    });
  });
});
