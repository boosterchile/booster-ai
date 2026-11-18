import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { crearViajePropio } from '../../src/services/crear-viaje-propio.js';
import { agruparServicio } from '../../src/services/operar-ruta.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * BARH-24 Task 4 — mezcla servicio propio + marketplace en la misma ruta.
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

describe('integration: mezcla viaje propio + marketplace en ruta', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  async function planId(): Promise<string> {
    const { db } = handle;
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const id =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!id) {
      throw new Error('fixture: plan no disponible');
    }
    return id;
  }

  test('agrupa assignment marketplace + propio en una ruta', async () => {
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
    const pid = await planId();
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-mix-${suffix}`,
          email: `mix-${suffix}@test.invalid`,
          fullName: 'Despachador Mix',
          rut: rutAleatorio(),
        })
        .returning(),
      'usuario',
    );
    const transportista = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Trans Mix ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `tm-${suffix}@empresa.invalid`,
          contactPhone: '+56922222222',
          addressStreet: 'Calle 2',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: false,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'transportista',
    );
    const generador = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Gen Mix ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `gm-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: false,
          isGeneradorCarga: true,
          status: 'activa',
          planId: pid,
        })
        .returning(),
      'generador',
    );

    // Marketplace: trip + offer + assignment + ruta (sin matching).
    const viajeMkt = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: `BOO-M${suffix.slice(0, 5)}`.slice(0, 12),
          generadorCargaEmpresaId: generador.id,
          createdByUserId: usuario.id,
          originAddressRaw: 'Origen marketplace',
          originRegionCode: '13',
          destinationAddressRaw: 'Destino marketplace',
          destinationRegionCode: '05',
          cargoType: 'agricola',
          cargoWeightKg: 800,
          pickupDateRaw: '2026-11-22',
          proposedPriceClp: 180_000,
          origenAlta: 'marketplace',
          status: 'asignado',
        })
        .returning(),
      'viajeMkt',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viajeMkt.id,
          empresaId: transportista.id,
          suggestedVehicleId: null,
          score: 90,
          proposedPriceClp: 180_000,
          status: 'aceptada',
          expiresAt: new Date(Date.now() + 3_600_000),
          respondedAt: new Date(),
        })
        .returning(),
      'oferta',
    );
    const { crearRutaDeAsignacion } = await import(
      '../../src/services/crear-ruta-de-asignacion.js'
    );
    const assignmentMkt = await db.transaction(async (tx) => {
      const [asig] = await tx
        .insert(schema.assignments)
        .values({
          tripId: viajeMkt.id,
          offerId: oferta.id,
          empresaId: transportista.id,
          vehicleId: null,
          status: 'asignado',
          agreedPriceClp: 180_000,
          publicTrackingToken: randomUUID(),
        })
        .returning();
      if (!asig) {
        throw new Error('assignment marketplace');
      }
      await crearRutaDeAsignacion(tx, { assignment: asig, userId: usuario.id });
      return asig;
    });
    const rutaMkt = uno(
      await db
        .select({ rutaId: schema.assignments.rutaId })
        .from(schema.assignments)
        .where(eq(schema.assignments.id, assignmentMkt.id)),
      'rutaMkt',
    );
    if (!rutaMkt.rutaId) {
      throw new Error('ruta marketplace ausente');
    }

    const propio = await crearViajePropio({
      db,
      logger,
      empresaTransportistaId: transportista.id,
      userId: usuario.id,
      input: {
        origen: { address_raw: 'Origen propio Las Condes', region_code: '13' },
        destino: { address_raw: 'Destino propio San Antonio', region_code: '05' },
        cargo_type: 'carga_seca',
        cargo_weight_kg: 500,
        pickup_date_raw: '2026-11-22',
        cliente: { tipo: 'externo', nombre: 'Cliente Mix SPA' },
      },
    });
    expect(propio.assignment.offerId).toBeNull();
    expect(propio.rutaId).not.toBe(rutaMkt.rutaId);

    const agrupado = await agruparServicio(db, {
      empresaId: transportista.id,
      rutaId: rutaMkt.rutaId,
      asignacionId: propio.assignment.id,
      posicion: { recogida: 1, entrega: 2 },
      userId: usuario.id,
    });
    expect(agrupado).toMatchObject({ ok: true, ruta: { id: rutaMkt.rutaId } });

    const asigPropia = uno(
      await db
        .select({ rutaId: schema.assignments.rutaId })
        .from(schema.assignments)
        .where(eq(schema.assignments.id, propio.assignment.id)),
      'asigPropia',
    );
    expect(asigPropia.rutaId).toBe(rutaMkt.rutaId);
  });
});
