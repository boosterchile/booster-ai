import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  arrastreDeAsignacion,
  asignacionConConductor,
  asignacionConVehiculo,
  conductorDeAsignacion,
  vehiculoDeAsignacion,
} from '../../src/db/configuracion-de-asignacion.js';
import * as schema from '../../src/db/schema.js';
import { crearRutaDeAsignacion } from '../../src/services/crear-ruta-de-asignacion.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ruta-parada-servicio parte 4b (ADR-088) contra Postgres real: el vehículo,
 * el arrastre y el conductor de un servicio se leen de su ruta. Una
 * asignación que todavía no tiene ruta entrega los suyos.
 */
describe('integration: vehículo, arrastre y conductor leídos de la ruta', () => {
  let handle: TestDbHandle;
  let base: Awaited<ReturnType<typeof crearBase>>;

  beforeAll(async () => {
    handle = createTestDb();
    base = await crearBase();
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

  async function crearBase() {
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
    const crearUsuario = async (nombre: string) =>
      uno(
        await db
          .insert(schema.users)
          .values({
            firebaseUid: `fb-${nombre}-${suffix}`,
            email: `${nombre}-${suffix}@test.invalid`,
            fullName: nombre,
            rut: rutAleatorio(),
          })
          .returning(),
        nombre,
      );
    const conductorA = await crearUsuario('conductor-a');
    const conductorB = await crearUsuario('conductor-b');
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
        .returning(),
      'empresa',
    );
    const crearVehiculo = async (prefijo: string) =>
      uno(
        await db
          .insert(schema.vehicles)
          .values({
            empresaId: empresa.id,
            plate: `${prefijo}${suffix.slice(0, 4).toUpperCase()}`,
            vehicleType: 'camion_mediano',
            capacityKg: 5000,
          })
          .returning(),
        'vehículo',
      );
    const vehiculoA = await crearVehiculo('LA');
    const vehiculoB = await crearVehiculo('LB');
    return { conductorA, conductorB, empresa, vehiculoA, vehiculoB };
  }

  async function asignacion(conRuta: boolean) {
    const { db } = handle;
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: base.empresa.id,
          createdByUserId: base.conductorA.id,
          originAddressRaw: 'Av. Apoquindo 4500',
          destinationAddressRaw: 'Av. Libertad 100',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'asignado',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: base.empresa.id,
          suggestedVehicleId: base.vehiculoA.id,
          score: 80,
          proposedPriceClp: 100_000,
          status: 'aceptada',
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    const fila = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: base.empresa.id,
          vehicleId: base.vehiculoA.id,
          driverUserId: base.conductorA.id,
          agreedPriceClp: 100_000,
        })
        .returning(),
      'asignación',
    );
    if (!conRuta) {
      return { id: fila.id, rutaId: null };
    }
    const { rutaId } = await db.transaction((tx) =>
      crearRutaDeAsignacion(tx, { assignment: fila, userId: null }),
    );
    return { id: fila.id, rutaId };
  }

  const leer = async (id: string) =>
    uno(
      await handle.db
        .select({
          vehiculo: vehiculoDeAsignacion,
          arrastre: arrastreDeAsignacion,
          conductor: conductorDeAsignacion,
        })
        .from(schema.assignments)
        .where(eq(schema.assignments.id, id)),
      'lectura',
    );

  const ids = async (filtro: ReturnType<typeof asignacionConConductor>) =>
    (
      await handle.db.select({ id: schema.assignments.id }).from(schema.assignments).where(filtro)
    ).map((r) => r.id);

  test('con la ruta al día, entrega lo mismo que la asignación', async () => {
    const a = await asignacion(true);
    expect(await leer(a.id)).toEqual({
      vehiculo: base.vehiculoA.id,
      arrastre: null,
      conductor: base.conductorA.id,
    });
  });

  test('la fuente es la ruta: si difiere de la asignación, manda la ruta', async () => {
    const a = await asignacion(true);
    await handle.db
      .update(schema.rutas)
      .set({
        vehicleId: base.vehiculoB.id,
        unidadArrastreId: base.vehiculoA.id,
        driverUserId: null,
      })
      .where(eq(schema.rutas.id, a.rutaId ?? ''));
    expect(await leer(a.id)).toEqual({
      vehiculo: base.vehiculoB.id,
      arrastre: base.vehiculoA.id,
      conductor: null,
    });
  });

  test('una asignación sin ruta entrega los suyos', async () => {
    const a = await asignacion(false);
    expect(await leer(a.id)).toEqual({
      vehiculo: base.vehiculoA.id,
      arrastre: null,
      conductor: base.conductorA.id,
    });
  });

  test('filtrar por conductor mira la ruta, y la asignación solo si no hay ruta', async () => {
    const conRuta = await asignacion(true);
    const sinRuta = await asignacion(false);
    const relevada = await asignacion(true);
    await handle.db
      .update(schema.rutas)
      .set({ driverUserId: base.conductorB.id })
      .where(eq(schema.rutas.id, relevada.rutaId ?? ''));

    const deA = await ids(asignacionConConductor(base.conductorA.id));
    expect(deA).toContain(conRuta.id);
    expect(deA).toContain(sinRuta.id);
    expect(deA).not.toContain(relevada.id);
    expect(await ids(asignacionConConductor(base.conductorB.id))).toEqual([relevada.id]);
  });

  test('filtrar por vehículo mira la ruta, y la asignación solo si no hay ruta', async () => {
    const conRuta = await asignacion(true);
    const sinRuta = await asignacion(false);
    const cambiada = await asignacion(true);
    await handle.db
      .update(schema.rutas)
      .set({ vehicleId: base.vehiculoB.id })
      .where(eq(schema.rutas.id, cambiada.rutaId ?? ''));

    const deA = await ids(asignacionConVehiculo(base.vehiculoA.id));
    expect(deA).toContain(conRuta.id);
    expect(deA).toContain(sinRuta.id);
    expect(deA).not.toContain(cambiada.id);
    expect(await ids(asignacionConVehiculo(base.vehiculoB.id))).toContain(cambiada.id);
  });

  // Las formas en que los lectores usan las expresiones: como columna, como
  // condición de un JOIN (interno y externo), junto a otros filtros y con
  // bloqueo de fila.
  test('sirven como condición de JOIN hacia el vehículo y el conductor', async () => {
    const a = await asignacion(true);
    await handle.db
      .update(schema.rutas)
      .set({ vehicleId: base.vehiculoB.id, driverUserId: base.conductorB.id })
      .where(eq(schema.rutas.id, a.rutaId ?? ''));

    const [fila] = await handle.db
      .select({
        patente: schema.vehicles.plate,
        conductor: schema.users.fullName,
        vehiculo: vehiculoDeAsignacion,
      })
      .from(schema.assignments)
      .innerJoin(schema.vehicles, eq(schema.vehicles.id, vehiculoDeAsignacion))
      .leftJoin(schema.users, eq(schema.users.id, conductorDeAsignacion))
      .where(eq(schema.assignments.id, a.id))
      .limit(1);
    expect(fila).toEqual({
      patente: base.vehiculoB.plate,
      conductor: 'conductor-b',
      vehiculo: base.vehiculoB.id,
    });
  });

  test('sirven en una lectura con bloqueo de fila y junto a otros filtros', async () => {
    const a = await asignacion(true);
    const filas = await handle.db.transaction((tx) =>
      tx
        .select({ id: schema.assignments.id, conductor: conductorDeAsignacion })
        .from(schema.assignments)
        .where(
          and(
            asignacionConVehiculo(base.vehiculoA.id),
            asignacionConConductor(base.conductorA.id),
            inArray(schema.assignments.status, ['asignado', 'recogido']),
            eq(schema.assignments.id, a.id),
          ),
        )
        .for('update')
        .limit(1),
    );
    expect(filas).toEqual([{ id: a.id, conductor: base.conductorA.id }]);
  });
});
