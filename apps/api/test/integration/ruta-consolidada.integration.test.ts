import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { conductorDeAsignacion } from '../../src/db/configuracion-de-asignacion.js';
import * as schema from '../../src/db/schema.js';
import { createMeRoutes } from '../../src/routes/me.js';
import { createTripRequestsV2Routes } from '../../src/routes/trip-requests-v2.js';
import {
  VehicleNotAssignableError,
  asignarConductorAAssignment,
} from '../../src/services/asignar-conductor-a-assignment.js';
import { cancelarCarga } from '../../src/services/cancelar-carga.js';
import { cargarRuta, pesoQueNoCabeEnLaRuta } from '../../src/services/cargar-ruta.js';
import { confirmarEntregaViaje } from '../../src/services/confirmar-entrega-viaje.js';
import { confirmarRecogidaViaje } from '../../src/services/confirmar-recogida-viaje.js';
import { getPublicTracking } from '../../src/services/get-public-tracking.js';
import { acceptOffer } from '../../src/services/offer-actions.js';
import { contextoDeRuta } from '../../src/services/ruta-en-seguimiento.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ruta-parada-servicio parte 5b contra Postgres real: en una ruta con varios
 * servicios, la ruta es la fuente de verdad. Confirmar una recogida o una
 * entrega resuelve la parada de ese servicio y mueve el estado de la ruta;
 * cancelar una carga no cierra la ruta de las demás; el conductor se declara
 * para toda la ruta.
 *
 * Las rutas de un servicio se prueban en ruta-sigue-asignacion: no cambian.
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

describe('integration: ruta con varios servicios', () => {
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

  async function flota() {
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
    const usuario = async (nombre: string) =>
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
    const oficina = await usuario('oficina');
    const conductor = await usuario('conductor');
    const relevo = await usuario('relevo');
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
    for (const [i, u] of [conductor, relevo].entries()) {
      await db.insert(schema.conductores).values({
        userId: u.id,
        empresaId: empresa.id,
        licenseClass: 'A4',
        licenseNumber: `L${i}${suffix}`,
        licenseExpiry: '2028-09-22',
      });
    }
    const vehiculo = async (prefijo: string) =>
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
    return {
      oficina,
      conductor,
      relevo,
      empresa,
      vehiculo: await vehiculo('CA'),
      otro: await vehiculo('CB'),
    };
  }
  type Flota = Awaited<ReturnType<typeof flota>>;

  /** Una carga de la flota con su oferta aceptada: asignación y ruta propia. */
  async function aceptada(f: Flota, pesoKg: number) {
    const { db } = handle;
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: f.empresa.id,
          createdByUserId: f.oficina.id,
          originAddressRaw: 'Origen',
          destinationAddressRaw: 'Destino',
          cargoType: 'carga_seca',
          cargoWeightKg: pesoKg,
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
          empresaId: f.empresa.id,
          suggestedVehicleId: f.vehiculo.id,
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
      empresaId: f.empresa.id,
      userId: f.oficina.id,
    });
    return { viaje, assignment: r.assignment };
  }
  type Servicio = Awaited<ReturnType<typeof aceptada>>;

  /**
   * Agrupa b en la ruta de a, como lo hará la API de la parte 5c: recoge a,
   * recoge b, entrega a, entrega b. La ruta que b deja queda cancelada.
   */
  async function agrupar(a: Servicio, b: Servicio) {
    const { db } = handle;
    const rutaDe = async (s: Servicio) =>
      uno(
        await db
          .select({ rutaId: schema.assignments.rutaId })
          .from(schema.assignments)
          .where(eq(schema.assignments.id, s.assignment.id)),
        'asignación',
      ).rutaId ?? '';
    const destino = await rutaDe(a);
    const origen = await rutaDe(b);
    await db.transaction(async (tx) => {
      const mover = (tripId: string, tipo: 'recogida' | 'entrega', orden: number) =>
        tx
          .update(schema.paradasRuta)
          .set({ rutaId: destino, orden })
          .where(and(eq(schema.paradasRuta.tripId, tripId), eq(schema.paradasRuta.tipo, tipo)));
      await mover(a.viaje.id, 'entrega', 2);
      await mover(b.viaje.id, 'recogida', 1);
      await mover(b.viaje.id, 'entrega', 3);
      await tx
        .update(schema.assignments)
        .set({ rutaId: destino })
        .where(eq(schema.assignments.id, b.assignment.id));
      await tx
        .update(schema.rutas)
        .set({ status: 'cancelada', cancelledAt: sql`now()` })
        .where(eq(schema.rutas.id, origen));
    });
    return destino;
  }

  async function leer(rutaId: string) {
    const { db } = handle;
    const ruta = uno(
      await db.select().from(schema.rutas).where(eq(schema.rutas.id, rutaId)),
      'ruta',
    );
    const paradas = await db
      .select({
        tripId: schema.paradasRuta.tripId,
        tipo: schema.paradasRuta.tipo,
        resolvedAt: schema.paradasRuta.resolvedAt,
      })
      .from(schema.paradasRuta)
      .where(eq(schema.paradasRuta.rutaId, rutaId))
      .orderBy(asc(schema.paradasRuta.orden));
    const eventos = await db
      .select({ tipo: schema.eventosRuta.tipo, payload: schema.eventosRuta.payload })
      .from(schema.eventosRuta)
      .where(eq(schema.eventosRuta.rutaId, rutaId))
      .orderBy(asc(schema.eventosRuta.createdAt), asc(schema.eventosRuta.tipo));
    return { ruta, paradas, eventos };
  }
  const asignacion = async (s: Servicio) =>
    uno(
      await handle.db
        .select()
        .from(schema.assignments)
        .where(eq(schema.assignments.id, s.assignment.id)),
      'asignación',
    );

  const asignarConductor = (
    f: Flota,
    s: Servicio,
    driverUserId = f.conductor.id,
    vehiculoId?: string,
  ) =>
    asignarConductorAAssignment({
      db: handle.db,
      logger,
      assignmentId: s.assignment.id,
      driverUserId,
      empresaId: f.empresa.id,
      actingUserId: f.oficina.id,
      ...(vehiculoId ? { vehiculoId } : {}),
    });
  const recoger = (f: Flota, s: Servicio) =>
    confirmarRecogidaViaje({
      db: handle.db,
      logger,
      assignmentId: s.assignment.id,
      actor: {
        userId: f.oficina.id,
        empresaId: f.empresa.id,
        esConductorAsignado: false,
        esCarrierConEscritura: true,
      },
    });
  const entregar = (f: Flota, s: Servicio) =>
    confirmarEntregaViaje({
      db: handle.db,
      logger,
      tripId: s.viaje.id,
      source: 'carrier',
      actor: { empresaId: f.empresa.id, userId: f.oficina.id },
      config: {},
    });
  const cancelar = (f: Flota, s: Servicio) =>
    cancelarCarga(
      { db: handle.db, logger },
      { tripId: s.viaje.id, empresaId: f.empresa.id, userId: f.oficina.id, reason: 'ya no va' },
    );

  /** Dos servicios agrupados, con conductor declarado. */
  async function consolidada(pesoA = 1000, pesoB = 2000) {
    const f = await flota();
    const a = await aceptada(f, pesoA);
    const b = await aceptada(f, pesoB);
    await asignarConductor(f, a);
    await asignarConductor(f, b);
    const rutaId = await agrupar(a, b);
    return { f, a, b, rutaId };
  }

  test('confirmar la recogida de un servicio resuelve su parada y pone la ruta en curso', async () => {
    const { f, a, b, rutaId } = await consolidada();
    expect((await recoger(f, a)).ok).toBe(true);

    const { ruta, paradas, eventos } = await leer(rutaId);
    const recogidoEn = (await asignacion(a)).pickedUpAt;
    expect(recogidoEn).toBeInstanceOf(Date);
    expect(ruta).toMatchObject({ status: 'en_curso', startedAt: recogidoEn, closedAt: null });
    expect(paradas).toEqual([
      { tripId: a.viaje.id, tipo: 'recogida', resolvedAt: recogidoEn },
      { tripId: b.viaje.id, tipo: 'recogida', resolvedAt: null },
      { tripId: a.viaje.id, tipo: 'entrega', resolvedAt: null },
      { tripId: b.viaje.id, tipo: 'entrega', resolvedAt: null },
    ]);
    expect(eventos.at(-1)).toEqual({
      tipo: 'estado_cambiado',
      payload: { desde: 'planificada', hacia: 'en_curso', origen: 'recogida_confirmada' },
    });
  });

  test('la ruta sigue en curso hasta la última entrega, y ahí se cierra', async () => {
    const { f, a, b, rutaId } = await consolidada();
    await recoger(f, a);
    await recoger(f, b);
    expect((await entregar(f, a)).ok).toBe(true);
    expect((await leer(rutaId)).ruta).toMatchObject({ status: 'en_curso', closedAt: null });

    expect((await entregar(f, b)).ok).toBe(true);
    const { ruta, paradas, eventos } = await leer(rutaId);
    expect(ruta).toMatchObject({ status: 'cerrada', closedAt: (await asignacion(b)).deliveredAt });
    expect(paradas.every((p) => p.resolvedAt instanceof Date)).toBe(true);
    expect(eventos.at(-1)).toMatchObject({
      tipo: 'estado_cambiado',
      payload: { desde: 'en_curso', hacia: 'cerrada', origen: 'entrega_confirmada' },
    });
  });

  test('las paradas se confirman en cualquier orden (D5)', async () => {
    const { f, a, b, rutaId } = await consolidada();
    // b va segunda en la ruta, y se recoge primero.
    expect((await recoger(f, b)).ok).toBe(true);
    const { ruta, paradas } = await leer(rutaId);
    expect(ruta.status).toBe('en_curso');
    expect(paradas.map((p) => p.resolvedAt !== null)).toEqual([false, true, false, false]);
    expect((await recoger(f, a)).ok).toBe(true);
  });

  test('cancelar una carga no recogida no cierra ni cancela la ruta de la otra', async () => {
    const { f, a, b, rutaId } = await consolidada();
    expect(await cancelar(f, b)).toMatchObject({ ok: true });
    expect((await leer(rutaId)).ruta.status).toBe('planificada');

    await recoger(f, a);
    await entregar(f, a);
    const { ruta, paradas } = await leer(rutaId);
    // La única carga vigente se entregó: la ruta se cierra con las paradas de b sin resolver.
    expect(ruta.status).toBe('cerrada');
    expect(paradas.map((p) => p.resolvedAt !== null)).toEqual([true, false, true, false]);
  });

  test('si se cancelan todas las cargas antes de recoger, la ruta queda cancelada', async () => {
    const { f, a, b, rutaId } = await consolidada();
    await cancelar(f, a);
    expect((await leer(rutaId)).ruta.status).toBe('planificada');
    await cancelar(f, b);
    const { ruta, eventos } = await leer(rutaId);
    expect(ruta).toMatchObject({ status: 'cancelada', startedAt: null });
    expect(ruta.cancelledAt).toBeInstanceOf(Date);
    expect(eventos.at(-1)).toMatchObject({
      tipo: 'estado_cambiado',
      payload: { desde: 'planificada', hacia: 'cancelada', origen: 'carga_cancelada' },
    });
  });

  test('asignar conductor a un servicio lo declara para toda la ruta (relevo, D1)', async () => {
    const { f, a, b, rutaId } = await consolidada();
    await recoger(f, a);
    await asignarConductor(f, b, f.relevo.id);

    const { ruta, eventos } = await leer(rutaId);
    expect(ruta).toMatchObject({ status: 'en_curso', driverUserId: f.relevo.id });
    expect(eventos.at(-1)).toMatchObject({
      tipo: 'configuracion_declarada',
      payload: { conductor_id: f.relevo.id, origen: 'conductor_asignado' },
    });
    // La otra asignación de la ruta queda con el mismo conductor, en la fila y para los lectores.
    expect((await asignacion(a)).driverUserId).toBe(f.relevo.id);
    const [lector] = await handle.db
      .select({ conductor: conductorDeAsignacion })
      .from(schema.assignments)
      .where(eq(schema.assignments.id, a.assignment.id));
    expect(lector?.conductor).toBe(f.relevo.id);
  });

  test('confirmar una parada no pisa el conductor de la ruta con el de la asignación', async () => {
    const { f, a, b, rutaId } = await consolidada();
    await asignarConductor(f, a, f.relevo.id);
    // La fila de b queda atrasada a propósito, como un dato anterior al relevo.
    await handle.db
      .update(schema.assignments)
      .set({ driverUserId: f.conductor.id })
      .where(eq(schema.assignments.id, b.assignment.id));
    await recoger(f, b);
    expect((await leer(rutaId)).ruta.driverUserId).toBe(f.relevo.id);
    // Las suites comparten la base: la fila vuelve a quedar igual a su ruta.
    await handle.db
      .update(schema.assignments)
      .set({ driverUserId: f.relevo.id })
      .where(eq(schema.assignments.id, b.assignment.id));
  });

  test('el camión de una ruta con varios servicios no se cambia desde una asignación', async () => {
    const { f, a, rutaId } = await consolidada();
    const error = await asignarConductor(f, a, f.conductor.id, f.otro.id).catch((e) => e);
    expect(error).toBeInstanceOf(VehicleNotAssignableError);
    expect(error.reason).toBe('ruta_con_varios_servicios');
    expect((await leer(rutaId)).ruta.vehicleId).toBe(f.vehiculo.id);
    expect((await asignacion(a)).vehicleId).toBe(f.vehiculo.id);
  });

  test('una recogida sin conductor en la ruta se confirma y la ruta no pasa a en curso', async () => {
    const f = await flota();
    const a = await aceptada(f, 1000);
    const b = await aceptada(f, 2000);
    const rutaId = await agrupar(a, b);
    expect((await recoger(f, a)).ok).toBe(true);
    const { ruta, paradas } = await leer(rutaId);
    expect(ruta.status).toBe('planificada');
    expect(paradas.every((p) => p.resolvedAt === null)).toBe(true);
  });

  test('cargarRuta arma la ruta del paquete: paradas en orden, servicios y capacidad', async () => {
    const { f, a, b, rutaId } = await consolidada();
    await recoger(f, a);
    await cancelar(f, b);
    const cargada = await handle.db.transaction((tx) => cargarRuta(tx, rutaId));
    expect(cargada?.ruta).toEqual({
      empresaId: f.empresa.id,
      estado: 'en_curso',
      configuracion: { capacidadKg: 5000, capacidadM3: null, carrocerias: [null] },
      tieneConductor: true,
      paradas: [
        { servicioId: a.viaje.id, tipo: 'recogida', resuelta: true },
        { servicioId: b.viaje.id, tipo: 'recogida', resuelta: false },
        { servicioId: a.viaje.id, tipo: 'entrega', resuelta: false },
        { servicioId: b.viaje.id, tipo: 'entrega', resuelta: false },
      ],
      servicios: [
        {
          servicioId: a.viaje.id,
          empresaId: f.empresa.id,
          tipoCarga: 'carga_seca',
          pesoKg: 1000,
          volumenM3: null,
          cancelado: false,
        },
        {
          servicioId: b.viaje.id,
          empresaId: f.empresa.id,
          tipoCarga: 'carga_seca',
          pesoKg: 2000,
          volumenM3: null,
          cancelado: true,
        },
      ],
    });
    expect(await handle.db.transaction((tx) => cargarRuta(tx, randomUUID()))).toBeNull();
  });

  test('un cambio de peso se mide contra el tramo de la ruta, no contra el camión vacío', async () => {
    const { a, b, rutaId } = await consolidada(1000, 2000);
    const medir = (tripId: string, pesoKg: number) =>
      handle.db.transaction((tx) => pesoQueNoCabeEnLaRuta(tx, { rutaId, tripId, pesoKg }));
    // a y b viajan juntas en el tramo del medio: 1000 + 2000 de 5000.
    expect(await medir(b.viaje.id, 4000)).toBeNull();
    // 4001 cabe en el camión vacío (5000), pero no junto a los 1000 de a.
    expect(await medir(b.viaje.id, 4001)).toEqual({ capacidadKg: 5000, masaKg: 5001 });
    expect(await medir(a.viaje.id, 3001)).toEqual({ capacidadKg: 5000, masaKg: 5001 });
  });

  test('el conductor recibe la hoja de ruta: todas las paradas en orden, y solo las suyas', async () => {
    const { f, a, b, rutaId } = await consolidada();
    await recoger(f, a);
    const hojaDe = async (firebaseUid: string) => {
      const app = new Hono();
      app.use('/me/*', async (c, next) => {
        c.set('firebaseClaims', {
          uid: firebaseUid,
          email: 'c@test.invalid',
          emailVerified: true,
          name: undefined,
          picture: undefined,
          custom: {},
        });
        await next();
      });
      app.route('/me', createMeRoutes({ db: handle.db, logger }));
      const res = await app.request('/me/assignments');
      return (await res.json()) as {
        assignments: { id: string; ruta_id: string | null }[];
        rutas: {
          id: string;
          estado: string;
          paradas: { tipo: string; asignacion_id: string; resuelta_en: string | null }[];
        }[];
      };
    };

    const hoja = await hojaDe(f.conductor.firebaseUid);
    expect(hoja.assignments.map((x) => x.ruta_id)).toEqual([rutaId, rutaId]);
    expect(hoja.rutas).toHaveLength(1);
    expect(hoja.rutas[0]).toMatchObject({ id: rutaId, estado: 'en_curso' });
    expect(
      hoja.rutas[0]?.paradas.map((p) => [p.tipo, p.asignacion_id, p.resuelta_en !== null]),
    ).toEqual([
      ['recogida', a.assignment.id, true],
      ['recogida', b.assignment.id, false],
      ['entrega', a.assignment.id, false],
      ['entrega', b.assignment.id, false],
    ]);
    // Otro conductor de la misma empresa no ve esta ruta.
    expect(await hojaDe(f.relevo.firebaseUid)).toEqual({ rutas: [], assignments: [] });
  });

  // Parte 7 (spec §4.7): el enlace público de un servicio en una ruta compartida.
  describe('seguimiento público en una ruta compartida', () => {
    const ping = (f: Flota, s: Servicio, minutosAtras: number) =>
      handle.db.insert(schema.posicionesMovilConductor).values({
        assignmentId: s.assignment.id,
        vehicleId: f.vehiculo.id,
        userId: f.conductor.id,
        timestampDevice: new Date(Date.now() - minutosAtras * 60_000),
        latitude: '-33.4500000',
        longitude: '-70.6500000',
        speedKmh: '60',
        headingDeg: 180,
      });
    const seguir = async (s: Servicio) => {
      const token = (await asignacion(s)).publicTrackingToken ?? '';
      const r = await getPublicTracking({ db: handle.db, logger, token });
      if (r.status !== 'found') {
        throw new Error('el enlace no se encontró');
      }
      return r;
    };

    test('antes de su recogida no entrega posición; entre su recogida y su entrega, sí', async () => {
      const { f, a, b } = await consolidada();
      // El teléfono reporta con la carga a, que es la que el conductor tiene abierta.
      await ping(f, a, 2);
      await ping(f, a, 1);
      expect((await seguir(b)).position).toBeNull();
      expect((await seguir(a)).position).toBeNull();

      await recoger(f, a);
      // a ya va a bordo: ve la posición. b todavía no se recoge: no la ve.
      expect((await seguir(a)).position).toMatchObject({ latitude: -33.45, longitude: -70.65 });
      expect((await seguir(b)).position).toBeNull();

      await recoger(f, b);
      // b va a bordo y ve la posición del camión, aunque el teléfono reporte con a.
      expect((await seguir(b)).position).toMatchObject({ latitude: -33.45 });

      await entregar(f, a);
      expect((await seguir(a)).position).toBeNull();
      expect((await seguir(b)).position).not.toBeNull();
    });

    test('un servicio que viaja solo se sigue como siempre: también antes de recoger', async () => {
      const f = await flota();
      const a = await aceptada(f, 1000);
      await asignarConductor(f, a);
      await ping(f, a, 1);
      expect((await seguir(a)).position).toMatchObject({ latitude: -33.45 });
    });

    test('el enlace nunca trae datos de la otra carga', async () => {
      const { f, a, b } = await consolidada();
      await recoger(f, a);
      const cuerpo = JSON.stringify(await seguir(a));
      expect(cuerpo).not.toContain(b.viaje.trackingCode);
      expect(cuerpo).not.toContain(b.viaje.id);
      expect(cuerpo).not.toContain(b.assignment.id);
    });

    test('el generador ve «viaja con otras cargas», sin la ruta ni los datos de las demás (§4.6)', async () => {
      const detalle = async (f: Flota, s: Servicio) => {
        const app = new Hono();
        app.use('*', async (c, next) => {
          c.set('userContext', {
            user: { id: f.oficina.id },
            activeMembership: {
              membership: { role: 'dueno' },
              empresa: {
                id: f.empresa.id,
                isGeneradorCarga: true,
                isTransportista: true,
                status: 'activa',
              },
            },
          } as never);
          await next();
        });
        app.route('/trip-requests-v2', createTripRequestsV2Routes({ db: handle.db, logger }));
        const res = await app.request(`/trip-requests-v2/${s.viaje.id}`);
        expect(res.status).toBe(200);
        return {
          texto: await res.clone().text(),
          cuerpo: (await res.json()) as { assignment: Record<string, unknown> },
        };
      };
      const { f, a, b, rutaId } = await consolidada();
      const junta = await detalle(f, a);
      expect(junta.cuerpo.assignment.viaja_consolidada).toBe(true);
      expect(junta.texto).not.toContain(rutaId);
      expect(junta.texto).not.toContain(b.viaje.trackingCode);
      expect(junta.texto).not.toContain(b.assignment.id);

      const f2 = await flota();
      const solo = await aceptada(f2, 1000);
      expect((await detalle(f2, solo)).cuerpo.assignment.viaja_consolidada).toBe(false);
    });

    test('contextoDeRuta: compartida, sus asignaciones y las paradas que quedan antes de la entrega', async () => {
      const { f, a, b, rutaId } = await consolidada();
      await handle.db
        .update(schema.trips)
        .set({ originLatitude: '-34.1700000', originLongitude: '-70.7400000' })
        .where(eq(schema.trips.id, b.viaje.id));
      await recoger(f, a);
      // Orden: recoge a (hecha), recoge b, entrega a, entrega b.
      const deA = await contextoDeRuta(handle.db, { rutaId, tripId: a.viaje.id });
      expect(deA.compartida).toBe(true);
      expect([...deA.asignacionIds].sort()).toEqual([a.assignment.id, b.assignment.id].sort());
      expect(deA.paradasIntermedias).toEqual([{ lat: -34.17, lng: -70.74 }]);
      // Antes de la entrega de b quedan la recogida de b (propia: no cuenta) y la entrega de a.
      const deB = await contextoDeRuta(handle.db, { rutaId, tripId: b.viaje.id });
      expect(deB.paradasIntermedias).toEqual([null]);

      await cancelar(f, b);
      const sola = await contextoDeRuta(handle.db, { rutaId, tripId: a.viaje.id });
      expect(sola).toMatchObject({ compartida: false, paradasIntermedias: [] });
    });
  });
});
