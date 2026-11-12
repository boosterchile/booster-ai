import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { haversineKm } from '../../src/services/calcular-cobertura-telemetria.js';
import {
  cerrarHuellaDeRuta,
  cerrarRutaYCertificar,
} from '../../src/services/cerrar-huella-de-ruta.js';
import { emitirCertificadoViaje } from '../../src/services/emitir-certificado-viaje.js';
import { rutaCompartidaDelViaje } from '../../src/services/ruta-compartida.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * huella-consolidada parte 4 (ADR-089) contra Postgres real: una ruta con
 * varios servicios se mide entera al cerrarse, su emisión se reparte entre los
 * servicios por toneladas-kilómetro de distancia directa, y los certificados
 * salen recién ahí (criterios 5 y 6 de la spec).
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

const t = (hhmmss: string) => new Date(`2026-11-10T${hhmmss}Z`);
// El camión avanza 0,0054° de longitud cada 30 s (≈ 0,5 km): 1 km por minuto.
const KM_POR_MINUTO = 2 * haversineKm(-33.4, -70.6, -33.4, -70.6054);
const num = (v: string | null | undefined) => (v == null ? null : Number(v));
const suma3 = (valores: (number | null)[]) =>
  Math.round(valores.reduce((a: number, b) => a + (b ?? 0), 0) * 1000) / 1000;

interface Carga {
  readonly pesoKg: number | null;
  readonly directaKm: string;
  readonly recogida: string | null;
  readonly entrega: string | null;
  /** Cancelada después de recogida: no se entrega y no recibe certificado. */
  readonly cancelada?: string;
}

describe('integration: huella de una ruta con varios servicios', () => {
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

  /**
   * Una ruta de la flota con sus cargas ya recorridas, coherente entre
   * asignaciones, paradas y ruta. `cerrada: false` la deja en curso.
   */
  async function ruta(
    cargas: readonly Carga[],
    opts: { huella?: boolean; cerrada?: boolean; minutosConGps?: number } = {},
  ) {
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
    const conductor = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-h4-${suffix}`,
          email: `h4-${suffix}@test.invalid`,
          fullName: 'Conductor',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
      'conductor',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Transportes H4 ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `h4-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
          carbonMeasurementEnabled: opts.huella !== false,
        })
        .returning({ id: schema.empresas.id }),
      'empresa',
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `H4${suffix.toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
          fuelType: 'diesel',
          consumptionLPer100kmBaseline: '30.00',
          curbWeightKg: 6000,
        })
        .returning({ id: schema.vehicles.id }),
      'vehículo',
    );

    const cerrada = opts.cerrada !== false;
    const instantes = cargas.flatMap((c) =>
      [c.recogida, c.entrega, c.cancelada].flatMap((x) => (x ? [t(x).getTime()] : [])),
    );
    const laRuta = uno(
      await db
        .insert(schema.rutas)
        .values({
          empresaId: empresa.id,
          vehicleId: vehiculo.id,
          driverUserId: conductor.id,
          status: cerrada ? 'cerrada' : 'en_curso',
          startedAt: new Date(Math.min(...instantes)),
          closedAt: cerrada ? new Date(Math.max(...instantes)) : null,
        })
        .returning({ id: schema.rutas.id }),
      'ruta',
    );

    const viajes: string[] = [];
    for (const [i, c] of cargas.entries()) {
      const entregada = c.entrega !== null;
      const viaje = uno(
        await db
          .insert(schema.trips)
          .values({
            trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
            generadorCargaEmpresaId: empresa.id,
            originAddressRaw: `Origen ${i}`,
            destinationAddressRaw: `Destino ${i}`,
            cargoType: 'carga_seca',
            cargoWeightKg: c.pesoKg,
            pickupDateRaw: '2026-11-10',
            status: entregada ? 'entregado' : c.cancelada ? 'cancelado' : 'asignado',
          })
          .returning({ id: schema.trips.id }),
        'viaje',
      );
      const oferta = uno(
        await db
          .insert(schema.offers)
          .values({
            tripId: viaje.id,
            empresaId: empresa.id,
            score: 80,
            proposedPriceClp: 100_000,
            expiresAt: t('23:00:00'),
          })
          .returning({ id: schema.offers.id }),
        'oferta',
      );
      await db.insert(schema.assignments).values({
        tripId: viaje.id,
        offerId: oferta.id,
        empresaId: empresa.id,
        vehicleId: vehiculo.id,
        driverUserId: conductor.id,
        rutaId: laRuta.id,
        agreedPriceClp: 100_000,
        status: entregada
          ? 'entregado'
          : c.cancelada
            ? 'cancelado'
            : c.recogida
              ? 'recogido'
              : 'asignado',
        acceptedAt: t('09:30:00'),
        pickedUpAt: c.recogida ? t(c.recogida) : null,
        deliveredAt: c.entrega ? t(c.entrega) : null,
        ...(c.cancelada
          ? {
              cancelledAt: t(c.cancelada),
              cancelledByActor: 'transportista' as const,
              cancellationReason: 'fixture',
            }
          : {}),
      });
      await db.insert(schema.paradasRuta).values([
        {
          rutaId: laRuta.id,
          orden: i,
          tipo: 'recogida',
          tripId: viaje.id,
          resolvedAt: c.recogida ? t(c.recogida) : null,
        },
        {
          rutaId: laRuta.id,
          orden: cargas.length + i,
          tipo: 'entrega',
          tripId: viaje.id,
          resolvedAt: c.entrega ? t(c.entrega) : null,
        },
      ]);
      await db.insert(schema.tripMetrics).values({
        tripId: viaje.id,
        distanceKmEstimated: c.directaKm,
        carbonEmissionsKgco2eEstimated: '9.999',
        precisionMethod: 'modelado',
        routeDataSource: 'maps_directions',
        coveragePct: '0.00',
        certificationLevel: 'secundario_modeled',
      });
      viajes.push(viaje.id);
    }

    // GPS del celular del conductor: un punto cada 30 s desde las 10:00.
    const minutos = opts.minutosConGps ?? 9;
    if (minutos > 0) {
      await db.insert(schema.posicionesMovilConductor).values(
        Array.from({ length: minutos * 2 + 1 }, (_, k) => ({
          vehicleId: vehiculo.id,
          userId: conductor.id,
          timestampDevice: new Date(t('10:00:00').getTime() + k * 30_000),
          latitude: '-33.4000000',
          longitude: (-70.6 - k * 0.0054).toFixed(7),
        })),
      );
    }
    return { rutaId: laRuta.id, viajes, empresaId: empresa.id };
  }

  const metricasDeViajes = async (ids: readonly string[]) => {
    const filas = await handle.db
      .select()
      .from(schema.tripMetrics)
      .where(inArray(schema.tripMetrics.tripId, [...ids]));
    return ids.map((id) =>
      uno(
        filas.filter((f) => f.tripId === id),
        'métricas',
      ),
    );
  };
  const metricasDeRuta = async (rutaId: string) =>
    (
      await handle.db
        .select()
        .from(schema.metricasRuta)
        .where(eq(schema.metricasRuta.rutaId, rutaId))
    )[0];

  // A sube 2.000 kg, B 1.000 kg, baja A, sube C con 1.500 kg, baja B, baja C.
  const TRES: Carga[] = [
    { pesoKg: 2000, directaKm: '10.00', recogida: '10:00:00', entrega: '10:04:00' },
    { pesoKg: 1000, directaKm: '6.00', recogida: '10:02:00', entrega: '10:07:00' },
    { pesoKg: 1500, directaKm: '4.00', recogida: '10:05:00', entrega: '10:09:00' },
  ];

  test('al cerrar una ruta de tres servicios: una fila de ruta y tres de viaje que suman el total (criterio 5)', async () => {
    const { rutaId, viajes } = await ruta(TRES);

    const r = await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });

    expect(r).toMatchObject({ estado: 'calculada', huella: 'medida' });
    if (r.estado !== 'calculada') {
      throw new Error('se esperaba la huella calculada');
    }
    expect([...r.entregados].sort()).toEqual([...viajes].sort());

    const deRuta = await metricasDeRuta(rutaId);
    expect(deRuta).toBeDefined();
    expect(num(deRuta?.carbonEmissionsKgco2eActual)).toBe(r.emisionesKgco2e);
    expect(num(deRuta?.carbonEmissionsKgco2eActual)).toBeGreaterThan(0);
    expect(num(deRuta?.distanceKmActual)).toBeCloseTo(9 * KM_POR_MINUTO, 1);
    expect(deRuta).toMatchObject({
      routeDataSource: 'movil_gps',
      precisionMethod: 'modelado',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });
    // Carga a bordo por tramo: 2.000 kg 2 min, 3.000 kg 2 min, 1.000 kg 1 min,
    // 2.500 kg 2 min y 1.500 kg 2 min, a 1 km por minuto: 19 t·km.
    expect(num(deRuta?.actividadTkm)).toBeCloseTo(19 * KM_POR_MINUTO, 1);

    const deViajes = await metricasDeViajes(viajes);
    expect(suma3(deViajes.map((m) => num(m.carbonEmissionsKgco2eActual)))).toBe(
      num(deRuta?.carbonEmissionsKgco2eActual),
    );
    expect(suma3(deViajes.map((m) => num(m.emisionesKgco2eTtw)))).toBe(
      num(deRuta?.emisionesKgco2eTtw),
    );
    expect(suma3(deViajes.map((m) => num(m.emisionesKgco2eWtt)))).toBe(
      num(deRuta?.emisionesKgco2eWtt),
    );
    expect(suma3(deViajes.map((m) => num(m.fuelConsumedLActual)))).toBe(
      num(deRuta?.fuelConsumedLActual),
    );
    expect(suma3(deViajes.map((m) => num(m.participacion)))).toBe(100);
    // a = 20, 6 y 6 t·km de distancia directa sobre 32.
    expect(deViajes.map((m) => num(m.actividadTkm))).toEqual([20, 6, 6]);
    expect(deViajes.map((m) => num(m.participacion))).toEqual([62.5, 18.75, 18.75]);
    for (const m of deViajes) {
      expect(m).toMatchObject({
        rutaId,
        routeDataSource: 'movil_gps',
        certificationLevel: deRuta?.certificationLevel,
        coveragePct: deRuta?.coveragePct,
        precisionMethod: 'modelado',
        versionMetodoReparto: 'tkm-distancia-directa-v1',
        // Cada servicio publica su distancia directa, que es la estimada.
        distanceKmActual: null,
      });
      // La estimación previa no se toca.
      expect(m.carbonEmissionsKgco2eEstimated).toBe('9.999');
    }
  });

  test('cerrar dos veces deja las mismas cifras', async () => {
    const { rutaId, viajes } = await ruta(TRES);
    await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });
    const antes = (await metricasDeViajes(viajes)).map((m) => m.carbonEmissionsKgco2eActual);
    await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });
    const despues = (await metricasDeViajes(viajes)).map((m) => m.carbonEmissionsKgco2eActual);
    expect(despues).toEqual(antes);
  });

  test('al cerrar la ruta se emite un certificado por cada servicio entregado (criterio 5)', async () => {
    const { rutaId, viajes } = await ruta(TRES);
    const emitir = vi.fn(async () => ({
      skipped: false as const,
      pdfGcsUri: 'gs://x/y.pdf',
      sigGcsUri: 'gs://x/y.sig',
      pdfSha256: 'abc',
      kmsKeyVersion: '1',
      issuedAt: new Date(),
      pdfBytes: 1,
    }));

    const r = await cerrarRutaYCertificar({ db: handle.db, logger, rutaId, config: {}, emitir });

    expect(r.certificados).toBe(3);
    expect(emitir.mock.calls.map(([o]) => (o as { tripId: string }).tripId).sort()).toEqual(
      [...viajes].sort(),
    );
    // La huella ya estaba repartida cuando se emitió.
    expect(num((await metricasDeRuta(rutaId))?.carbonEmissionsKgco2eActual)).toBeGreaterThan(0);
  });

  test('una ruta en curso no se mide ni emite certificados aunque un servicio esté entregado (criterio 6)', async () => {
    const { rutaId, viajes } = await ruta(
      [
        { pesoKg: 2000, directaKm: '10.00', recogida: '10:00:00', entrega: '10:04:00' },
        { pesoKg: 1000, directaKm: '6.00', recogida: '10:02:00', entrega: null },
      ],
      { cerrada: false },
    );
    const entregado = viajes[0] ?? '';

    expect(await rutaCompartidaDelViaje(handle.db, entregado)).toEqual({ rutaId, cerrada: false });
    expect(await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId })).toEqual({
      estado: 'omitida',
      motivo: 'ruta_no_cerrada',
    });
    expect(await metricasDeRuta(rutaId)).toBeUndefined();
    const r = await emitirCertificadoViaje({
      db: handle.db,
      logger,
      tripId: entregado,
      config: {
        kmsKeyId: 'projects/p/locations/l/keyRings/r/cryptoKeys/k',
        certificatesBucket: 'bucket',
        verifyBaseUrl: 'https://api.test.invalid',
      },
    });
    expect(r).toEqual({ skipped: true, reason: 'ruta_no_cerrada' });
    expect((await metricasDeViajes([entregado]))[0]?.certificateIssuedAt).toBeNull();
  });

  test('un servicio cancelado después de recogido participa y su parte no se carga a los demás (§3.7)', async () => {
    const { rutaId, viajes } = await ruta([
      { pesoKg: 2000, directaKm: '10.00', recogida: '10:00:00', entrega: '10:04:00' },
      { pesoKg: 1000, directaKm: '6.00', recogida: '10:02:00', entrega: '10:09:00' },
      {
        pesoKg: 1500,
        directaKm: '4.00',
        recogida: '10:05:00',
        entrega: null,
        cancelada: '10:08:00',
      },
    ]);

    const r = await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });

    if (r.estado !== 'calculada') {
      throw new Error('se esperaba la huella calculada');
    }
    expect([...r.entregados].sort()).toEqual([viajes[0], viajes[1]].sort());
    const [a, b, cancelado] = await metricasDeViajes(viajes);
    const total = r.emisionesKgco2e ?? 0;
    expect(num(cancelado?.participacion)).toBe(18.75);
    expect(num(cancelado?.carbonEmissionsKgco2eActual)).toBeGreaterThan(0);
    expect(
      suma3([num(a?.carbonEmissionsKgco2eActual), num(b?.carbonEmissionsKgco2eActual)]),
    ).toBeLessThan(total);
    expect(suma3([a, b, cancelado].map((m) => num(m?.carbonEmissionsKgco2eActual)))).toBe(total);
  });

  test('un servicio cancelado antes de su recogida no participa', async () => {
    const { rutaId, viajes } = await ruta([
      { pesoKg: 2000, directaKm: '10.00', recogida: '10:00:00', entrega: '10:04:00' },
      { pesoKg: 1000, directaKm: '6.00', recogida: '10:02:00', entrega: '10:09:00' },
      { pesoKg: 1500, directaKm: '4.00', recogida: null, entrega: null, cancelada: '10:01:00' },
    ]);

    const r = await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });

    expect(r).toMatchObject({ estado: 'calculada', huella: 'medida' });
    const [a, b, fuera] = await metricasDeViajes(viajes);
    expect(suma3([num(a?.participacion), num(b?.participacion)])).toBe(100);
    expect(fuera).toMatchObject({
      participacion: null,
      carbonEmissionsKgco2eActual: null,
      rutaId: null,
    });
  });

  test('sin GPS en la ventana no hay cifras reales: el certificado cae a la estimación', async () => {
    const { rutaId, viajes } = await ruta(TRES, { minutosConGps: 0 });

    const r = await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });

    expect(r).toMatchObject({
      estado: 'calculada',
      huella: 'degradada_cobertura',
      emisionesKgco2e: null,
    });
    expect((await metricasDeRuta(rutaId))?.carbonEmissionsKgco2eActual).toBeNull();
    for (const m of await metricasDeViajes(viajes)) {
      expect(m.carbonEmissionsKgco2eActual).toBeNull();
      expect(m.carbonEmissionsKgco2eEstimated).toBe('9.999');
      expect(m.routeDataSource).toBe('maps_directions');
    }
  });

  test('un servicio sin peso declarado deja la ruta sin cifras reales, nunca en cero', async () => {
    const { rutaId, viajes } = await ruta([
      { pesoKg: 2000, directaKm: '10.00', recogida: '10:00:00', entrega: '10:04:00' },
      { pesoKg: null, directaKm: '6.00', recogida: '10:02:00', entrega: '10:09:00' },
    ]);

    const r = await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });

    expect(r).toMatchObject({ estado: 'calculada', huella: 'peso_ausente', emisionesKgco2e: null });
    for (const m of await metricasDeViajes(viajes)) {
      expect(m.carbonEmissionsKgco2eActual).toBeNull();
    }
  });

  test('sin opt-in de huella solo quedan la fuente, la cobertura y el nivel', async () => {
    const { rutaId, viajes } = await ruta(TRES, { huella: false });

    const r = await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId });

    expect(r).toMatchObject({
      estado: 'calculada',
      huella: 'opt_in_inactivo',
      emisionesKgco2e: null,
    });
    const deRuta = await metricasDeRuta(rutaId);
    expect(deRuta).toMatchObject({
      routeDataSource: 'movil_gps',
      carbonEmissionsKgco2eActual: null,
    });
    expect(num(deRuta?.distanceKmActual)).toBeCloseTo(9 * KM_POR_MINUTO, 1);
    for (const m of await metricasDeViajes(viajes)) {
      expect(m).toMatchObject({ routeDataSource: 'movil_gps', carbonEmissionsKgco2eActual: null });
    }
  });

  test('una carga que viaja sola en su ruta no es una ruta compartida', async () => {
    const { viajes } = await ruta([
      { pesoKg: 2000, directaKm: '10.00', recogida: '10:00:00', entrega: '10:04:00' },
    ]);
    expect(await rutaCompartidaDelViaje(handle.db, viajes[0] ?? '')).toBeNull();
    expect(await rutaCompartidaDelViaje(handle.db, randomUUID())).toBeNull();
  });

  test('una ruta que no existe se omite', async () => {
    expect(await cerrarHuellaDeRuta({ db: handle.db, logger, rutaId: randomUUID() })).toEqual({
      estado: 'omitida',
      motivo: 'ruta_no_encontrada',
    });
  });
});
