import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { asignarConductorAAssignment } from '../../src/services/asignar-conductor-a-assignment.js';
import { cancelarCarga } from '../../src/services/cancelar-carga.js';
import { confirmarEntregaViaje } from '../../src/services/confirmar-entrega-viaje.js';
import { confirmarRecogidaViaje } from '../../src/services/confirmar-recogida-viaje.js';
import { acceptOffer } from '../../src/services/offer-actions.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ruta-parada-servicio parte 4 (ADR-088) contra Postgres real: la ruta sigue
 * a la asignación. Cada escritura que cambia el conductor, el vehículo o el
 * estado de una asignación deja su ruta igual, en la misma transacción.
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

describe('integration: la ruta sigue a su asignación', () => {
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

  /** Una carga con su oferta aceptada: asignación `asignado` y ruta `planificada`. */
  async function aceptada() {
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
    const oficina = await crearUsuario('oficina');
    const conductor = await crearUsuario('conductor');
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
    await db.insert(schema.conductores).values({
      userId: conductor.id,
      empresaId: empresa.id,
      licenseClass: 'A4',
      licenseNumber: `L${suffix}`,
      licenseExpiry: '2028-09-22',
    });
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
    const vehiculo = await crearVehiculo('SA');
    const otroVehiculo = await crearVehiculo('SB');
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: empresa.id,
          createdByUserId: oficina.id,
          originAddressRaw: 'Av. Apoquindo 4500',
          destinationAddressRaw: 'Av. Libertad 100',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-11-20',
          status: 'ofertas_enviadas',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: empresa.id,
          suggestedVehicleId: vehiculo.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    const r = await acceptOffer({
      db: handle.db,
      logger,
      offerId: oferta.id,
      empresaId: empresa.id,
      userId: oficina.id,
    });
    return { oficina, conductor, empresa, vehiculo, otroVehiculo, viaje, assignment: r.assignment };
  }

  type Escenario = Awaited<ReturnType<typeof aceptada>>;

  async function leer(asignacionId: string) {
    const { db } = handle;
    const [asignacion] = await db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.id, asignacionId));
    const rutaId = asignacion?.rutaId ?? '';
    const [ruta] = await db.select().from(schema.rutas).where(eq(schema.rutas.id, rutaId));
    const paradas = await db
      .select({ tipo: schema.paradasRuta.tipo, resolvedAt: schema.paradasRuta.resolvedAt })
      .from(schema.paradasRuta)
      .where(eq(schema.paradasRuta.rutaId, rutaId))
      .orderBy(asc(schema.paradasRuta.orden));
    const eventos = await db
      .select({
        tipo: schema.eventosRuta.tipo,
        payload: schema.eventosRuta.payload,
        recordedByUserId: schema.eventosRuta.recordedByUserId,
      })
      .from(schema.eventosRuta)
      .where(eq(schema.eventosRuta.rutaId, rutaId))
      .orderBy(asc(schema.eventosRuta.createdAt), asc(schema.eventosRuta.tipo));
    return { asignacion, ruta: ruta ?? null, paradas, eventos };
  }

  const asignarConductor = (e: Escenario, vehiculoId?: string) =>
    asignarConductorAAssignment({
      db: handle.db,
      logger,
      assignmentId: e.assignment.id,
      driverUserId: e.conductor.id,
      empresaId: e.empresa.id,
      actingUserId: e.oficina.id,
      ...(vehiculoId ? { vehiculoId } : {}),
    });

  const recoger = (e: Escenario) =>
    confirmarRecogidaViaje({
      db: handle.db,
      logger,
      assignmentId: e.assignment.id,
      actor: {
        userId: e.oficina.id,
        empresaId: e.empresa.id,
        esConductorAsignado: false,
        esCarrierConEscritura: true,
      },
    });

  const entregar = (e: Escenario) =>
    confirmarEntregaViaje({
      db: handle.db,
      logger,
      tripId: e.viaje.id,
      source: 'carrier',
      actor: { empresaId: e.empresa.id, userId: e.oficina.id },
      config: {},
    });

  test('asignar conductor y cambiar el camión deja la ruta con los dos', async () => {
    const e = await aceptada();
    await asignarConductor(e, e.otroVehiculo.id);

    const { ruta, eventos } = await leer(e.assignment.id);
    expect(ruta).toMatchObject({
      status: 'planificada',
      driverUserId: e.conductor.id,
      vehicleId: e.otroVehiculo.id,
    });
    expect(eventos.at(-1)).toEqual({
      tipo: 'configuracion_declarada',
      payload: {
        vehiculo_id: e.otroVehiculo.id,
        unidad_arrastre_id: null,
        conductor_id: e.conductor.id,
        origen: 'conductor_asignado',
      },
      recordedByUserId: e.oficina.id,
    });
  });

  test('confirmar la recogida deja la ruta en curso con esa parada resuelta', async () => {
    const e = await aceptada();
    await asignarConductor(e);
    const r = await recoger(e);
    expect(r.ok).toBe(true);

    const { asignacion, ruta, paradas, eventos } = await leer(e.assignment.id);
    expect(asignacion?.pickedUpAt).toBeInstanceOf(Date);
    expect(ruta).toMatchObject({
      status: 'en_curso',
      startedAt: asignacion?.pickedUpAt,
      closedAt: null,
    });
    expect(paradas).toEqual([
      { tipo: 'recogida', resolvedAt: asignacion?.pickedUpAt },
      { tipo: 'entrega', resolvedAt: null },
    ]);
    expect(eventos.at(-1)).toEqual({
      tipo: 'estado_cambiado',
      payload: { desde: 'planificada', hacia: 'en_curso', origen: 'recogida_confirmada' },
      recordedByUserId: e.oficina.id,
    });
  });

  test('confirmar la entrega cierra la ruta con las dos paradas resueltas', async () => {
    const e = await aceptada();
    await asignarConductor(e);
    await recoger(e);
    const r = await entregar(e);
    expect(r.ok).toBe(true);

    const { asignacion, ruta, paradas, eventos } = await leer(e.assignment.id);
    expect(ruta).toMatchObject({
      status: 'cerrada',
      startedAt: asignacion?.pickedUpAt,
      closedAt: asignacion?.deliveredAt,
    });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([
      asignacion?.pickedUpAt,
      asignacion?.deliveredAt,
    ]);
    expect(eventos.at(-1)).toMatchObject({
      tipo: 'estado_cambiado',
      payload: { desde: 'en_curso', hacia: 'cerrada', origen: 'entrega_confirmada' },
    });
  });

  test('cancelar la carga antes de recoger cancela la ruta', async () => {
    const e = await aceptada();
    const r = await cancelarCarga(
      { db: handle.db, logger },
      { tripId: e.viaje.id, empresaId: e.empresa.id, userId: e.oficina.id, reason: 'ya no va' },
    );
    expect(r).toMatchObject({ ok: true, tipo: 'cancelacion' });

    const { asignacion, ruta, paradas, eventos } = await leer(e.assignment.id);
    expect(ruta).toMatchObject({
      status: 'cancelada',
      cancelledAt: asignacion?.cancelledAt,
      startedAt: null,
    });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([null, null]);
    expect(eventos.at(-1)).toMatchObject({
      tipo: 'estado_cambiado',
      payload: { desde: 'planificada', hacia: 'cancelada', origen: 'carga_cancelada' },
    });
  });

  test('una recogida sin conductor se confirma igual y la ruta no pasa a en curso', async () => {
    const e = await aceptada();
    const r = await recoger(e);
    expect(r.ok).toBe(true);

    const { asignacion, ruta, paradas } = await leer(e.assignment.id);
    expect(asignacion?.status).toBe('recogido');
    expect(ruta).toMatchObject({ status: 'planificada', startedAt: null });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([null, null]);
  });

  test('al asignar el conductor que faltaba, la ruta recogida pasa a en curso', async () => {
    const e = await aceptada();
    await recoger(e);
    await asignarConductor(e);

    const { asignacion, ruta, paradas } = await leer(e.assignment.id);
    expect(ruta).toMatchObject({
      status: 'en_curso',
      driverUserId: e.conductor.id,
      startedAt: asignacion?.pickedUpAt,
    });
    expect(paradas.map((p) => p.resolvedAt)).toEqual([asignacion?.pickedUpAt, null]);
  });

  test('una asignación anterior a la ruta la recibe con su primera escritura', async () => {
    const e = await aceptada();
    // Como las asignaciones previas a la migración 0078: sin ruta.
    const { ruta: original } = await leer(e.assignment.id);
    await handle.db
      .update(schema.assignments)
      .set({ rutaId: null })
      .where(eq(schema.assignments.id, e.assignment.id));
    await asignarConductor(e);

    const { asignacion, ruta, paradas } = await leer(e.assignment.id);
    expect(asignacion?.rutaId).toBeTruthy();
    expect(asignacion?.rutaId).not.toBe(original?.id);
    expect(ruta).toMatchObject({
      status: 'planificada',
      driverUserId: e.conductor.id,
      vehicleId: e.vehiculo.id,
    });
    expect(paradas).toHaveLength(2);
  });
});
