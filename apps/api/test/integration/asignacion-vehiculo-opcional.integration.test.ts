import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * matching-desde-la-carga parte 3 (ADR-090) contra Postgres real: la
 * migración 0079 es `expand`. El vehículo de la asignación pasa a opcional y
 * los vehículos ganan la marca de unidad de tercero. Ningún código escribe
 * todavía una asignación sin vehículo: eso es la parte 4.
 */
describe('integration: migración 0079 — vehículo opcional y unidad de tercero', () => {
  let handle: TestDbHandle;
  let base: { empresaId: string; usuarioId: string; vehiculoId: string };

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }

  beforeAll(async () => {
    handle = createTestDb();
    const { db } = handle;
    const suffix = randomUUID().slice(0, 8);
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
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const usuario = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-${suffix}`,
          email: `u-${suffix}@test.invalid`,
          fullName: 'Oficina',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
      'usuario',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Empresa ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `e-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id }),
      'empresa',
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `VO${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning({ id: schema.vehicles.id }),
      'vehículo',
    );
    base = { empresaId: empresa.id, usuarioId: usuario.id, vehiculoId: vehiculo.id };
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function viajeConOferta() {
    const { db } = handle;
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: base.empresaId,
          createdByUserId: base.usuarioId,
          originAddressRaw: 'A',
          destinationAddressRaw: 'B',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
        })
        .returning({ id: schema.trips.id }),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: base.empresaId,
          suggestedVehicleId: base.vehiculoId,
          score: 80,
          proposedPriceClp: 100_000,
          status: 'aceptada',
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning({ id: schema.offers.id }),
      'oferta',
    );
    return { viajeId: viaje.id, ofertaId: oferta.id };
  }

  const columna = async (tabla: string, nombre: string) =>
    uno(
      (
        await handle.pool.query<{
          is_nullable: string;
          data_type: string;
          column_default: string | null;
        }>(
          `SELECT is_nullable, data_type, column_default FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
          [tabla, nombre],
        )
      ).rows,
      `${tabla}.${nombre}`,
    );

  test('asignaciones.vehiculo_id acepta nulo y conserva su llave foránea', async () => {
    expect((await columna('asignaciones', 'vehiculo_id')).is_nullable).toBe('YES');
    const fk = await handle.pool.query(
      `SELECT 1
         FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
        WHERE c.contype = 'f'
          AND c.conrelid = 'public.asignaciones'::regclass
          AND c.confrelid = 'public.vehiculos'::regclass
          AND a.attname = 'vehiculo_id'`,
    );
    expect(fk.rowCount).toBe(1);
  });

  test('se puede guardar una asignación sin vehículo', async () => {
    const { viajeId, ofertaId } = await viajeConOferta();
    const [asignacion] = await handle.db
      .insert(schema.assignments)
      .values({
        tripId: viajeId,
        offerId: ofertaId,
        empresaId: base.empresaId,
        vehicleId: null,
        agreedPriceClp: 100_000,
      })
      .returning({ id: schema.assignments.id, vehicleId: schema.assignments.vehicleId });
    expect(asignacion?.vehicleId).toBeNull();
  });

  test('una asignación con vehículo se sigue guardando igual', async () => {
    const { viajeId, ofertaId } = await viajeConOferta();
    const [asignacion] = await handle.db
      .insert(schema.assignments)
      .values({
        tripId: viajeId,
        offerId: ofertaId,
        empresaId: base.empresaId,
        vehicleId: base.vehiculoId,
        agreedPriceClp: 100_000,
      })
      .returning({ vehicleId: schema.assignments.vehicleId });
    expect(asignacion?.vehicleId).toBe(base.vehiculoId);
  });

  test('un vehículo que no existe sigue sin poder asignarse', async () => {
    const { viajeId, ofertaId } = await viajeConOferta();
    await expect(
      handle.db.insert(schema.assignments).values({
        tripId: viajeId,
        offerId: ofertaId,
        empresaId: base.empresaId,
        vehicleId: randomUUID(),
        agreedPriceClp: 100_000,
      }),
    ).rejects.toThrow();
  });

  test('vehiculos.es_de_tercero es obligatorio y falso por defecto', async () => {
    expect(await columna('vehiculos', 'es_de_tercero')).toEqual({
      is_nullable: 'NO',
      data_type: 'boolean',
      column_default: 'false',
    });
  });

  test('los vehículos que ya existían quedan como propios', async () => {
    const [vehiculo] = await handle.db
      .select({ esDeTercero: schema.vehicles.esDeTercero })
      .from(schema.vehicles)
      .where(eq(schema.vehicles.id, base.vehiculoId));
    expect(vehiculo).toEqual({ esDeTercero: false });
  });

  test('se puede registrar una unidad de tercero', async () => {
    const [vehiculo] = await handle.db
      .insert(schema.vehicles)
      .values({
        empresaId: base.empresaId,
        plate: `VT${randomUUID().slice(0, 4).toUpperCase()}`,
        vehicleType: 'camion_mediano',
        capacityKg: 8000,
        esDeTercero: true,
      })
      .returning({ esDeTercero: schema.vehicles.esDeTercero });
    expect(vehiculo).toEqual({ esDeTercero: true });
  });
});
