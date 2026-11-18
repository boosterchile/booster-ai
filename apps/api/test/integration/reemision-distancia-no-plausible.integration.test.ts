import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// KMS y el bucket se simulan: aquí se prueba lo que la corrección y la
// reemisión hacen con la base. La plantilla real se usa para comprobar que el
// PDF se genera con los datos corregidos.
const { emitirCertificado } = vi.hoisted(() => ({ emitirCertificado: vi.fn() }));
vi.mock('@booster-ai/certificate-generator', async (original) => ({
  ...(await original<typeof import('@booster-ai/certificate-generator')>()),
  emitirCertificado,
}));
const { generarPdfBase, presentacionNivel } = await import('@booster-ai/certificate-generator');

import * as schema from '../../src/db/schema.js';
import { main as jobCorregir } from '../../src/jobs/corregir-distancia-no-plausible.js';
import { destinoDe, formatoDestino } from '../../src/jobs/hc001-fuente-combustible-can.js';
import { main as jobReemitir } from '../../src/jobs/reemitir-certificado.js';
import { registrarPrimeraVersion } from '../../src/services/certificados-versionados.js';
import {
  corregirDistanciaNoPlausible,
  prepararCorreccion,
} from '../../src/services/corregir-distancia-no-plausible.js';
import { armarDatosEmision } from '../../src/services/emitir-certificado-viaje.js';
import { reemitirCertificado } from '../../src/services/reemitir-certificado.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * reemision-distancia-no-plausible (§7, criterios 3 a 5) contra Postgres real,
 * con los datos de la ruta de prueba del 2026-11-15 (BOO-4FF3XA + BOO-VZYIN2:
 * 0,03 km medidos de 37,75) y de los dos viajes solos con Teltonika.
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
const sha = (c: string) => c.repeat(64);
const CONFIG = {
  kmsKeyId: 'projects/p/locations/l/keyRings/k/cryptoKeys/c',
  certificatesBucket: 'b',
  verifyBaseUrl: 'https://api.test',
};
const EMITIDO_V1 = new Date('2026-11-16T02:32:02Z');
const EMITIDO_V2 = new Date('2026-11-19T12:00:00Z');
const t = (iso: string) => new Date(iso);
const FACTORES =
  'GLEC Framework v2.0 (2019), ISBN 978-90-82-68790-3, Módulo 1, Tabla 32 (EU), p. 87 (defaults para tipo: camion_mediano)';

interface Carga {
  readonly pesoKg: number;
  readonly directaKm: string;
  readonly estimadasKg: string;
  readonly realesKg: string;
  readonly participacion: string;
  readonly origen: string;
  readonly destino: string;
}
const CARGA_A: Carga = {
  pesoKg: 1500,
  directaKm: '11.69',
  estimadasKg: '20.864',
  realesKg: '0.015',
  participacion: '71.97',
  origen: 'Av. Valparaíso 500, Viña del Mar',
  destino: 'Av. Los Carrera 500, Quilpué',
};
const CARGA_B: Carga = {
  pesoKg: 1000,
  directaKm: '6.83',
  estimadasKg: '8.127',
  realesKg: '0.006',
  participacion: '28.03',
  origen: 'Av. Argentina 1, Valparaíso',
  destino: 'Av. Libertad 100, Viña del Mar',
};

describe('integration: corrección y reemisión por distancia medida no plausible', () => {
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
          firebaseUid: `fb-dnp-${suffix}`,
          email: `dnp-${suffix}@test.invalid`,
          fullName: 'PO',
          rut: rutAleatorio(),
        })
        .returning({ id: schema.users.id }),
      'usuario',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Transportes DNP ${suffix}`,
          rut: rutAleatorio(),
          contactEmail: `dnp-${suffix}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
          carbonMeasurementEnabled: true,
        })
        .returning({ id: schema.empresas.id }),
      'empresa',
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `DN${suffix.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
          fuelType: 'diesel',
          consumptionLPer100kmBaseline: '30.00',
          curbWeightKg: 6000,
        })
        .returning({ id: schema.vehicles.id }),
      'vehículo',
    );
    base = { empresaId: empresa.id, usuarioId: usuario.id, vehiculoId: vehiculo.id };
  });
  afterAll(async () => {
    await handle.pool.end();
  });
  beforeEach(() => {
    emitirCertificado.mockReset();
    emitirCertificado.mockResolvedValue({
      pdfGcsUri: 'gs://b/certificates/e/X.v2.pdf',
      sigGcsUri: 'gs://b/certificates/e/X.v2.pdf.sig',
      pdfSha256: sha('b'),
      kmsKeyVersion: '1',
      issuedAt: EMITIDO_V2,
      pdfBytes: 1234,
    });
  });

  /** Un viaje entregado con su asignación; con `rutaId`, en esa ruta. */
  async function viajeEntregado(opts: {
    readonly origen: string;
    readonly destino: string;
    readonly pesoKg: number;
    readonly rutaId?: string;
  }) {
    const { db } = handle;
    const tracking = `BOO-${randomUUID().slice(0, 6).toUpperCase()}`;
    const trip = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: tracking,
          generadorCargaEmpresaId: base.empresaId,
          createdByUserId: base.usuarioId,
          originAddressRaw: opts.origen,
          originRegionCode: 'V',
          destinationAddressRaw: opts.destino,
          destinationRegionCode: 'V',
          cargoType: 'carga_seca',
          cargoWeightKg: opts.pesoKg,
          pickupDateRaw: '2026-11-16',
          status: 'entregado',
        })
        .returning({ id: schema.trips.id }),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: trip.id,
          empresaId: base.empresaId,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: t('2026-11-16T23:00:00Z'),
        })
        .returning({ id: schema.offers.id }),
      'oferta',
    );
    await db.insert(schema.assignments).values({
      tripId: trip.id,
      offerId: oferta.id,
      empresaId: base.empresaId,
      vehicleId: base.vehiculoId,
      driverUserId: base.usuarioId,
      ...(opts.rutaId ? { rutaId: opts.rutaId } : {}),
      agreedPriceClp: 100_000,
      status: 'entregado',
      acceptedAt: t('2026-11-16T01:00:00Z'),
      pickedUpAt: t('2026-11-16T02:29:30Z'),
      deliveredAt: t('2026-11-16T02:31:33Z'),
    });
    return { tripId: trip.id, tracking };
  }

  /** Certificado v1 emitido sobre las métricas que ya tiene el viaje. */
  async function certificadoV1(tripId: string, tracking: string, fuenteDistancia: string | null) {
    const { db } = handle;
    await db
      .update(schema.tripMetrics)
      .set({
        certificateSha256: sha('a'),
        certificatePdfUrl: `gs://b/certificates/e/${tracking}.pdf`,
        certificateKmsKeyVersion: '1',
        certificateIssuedAt: EMITIDO_V1,
      })
      .where(eq(schema.tripMetrics.tripId, tripId));
    const v1 = await db.transaction((tx) =>
      registrarPrimeraVersion(tx, {
        tripId,
        sha256: sha('a'),
        pdfUrl: `gs://b/certificates/e/${tracking}.pdf`,
        kmsVersion: '1',
        emitidoEn: EMITIDO_V1,
        fuenteDistancia,
        motivoFallback: fuenteDistancia === null ? null : 'sin_dispositivo',
        decisionVersion: fuenteDistancia === null ? null : 2,
      }),
    );
    await db
      .update(schema.tripMetrics)
      .set({ certificadoVigenteId: v1.id })
      .where(eq(schema.tripMetrics.tripId, tripId));
    return v1.id;
  }

  /** La ruta de prueba: dos cargas, cerrada, medida con el GPS del móvil en 0,03 km de 37,75. */
  async function rutaDePrueba() {
    const { db } = handle;
    const ruta = uno(
      await db
        .insert(schema.rutas)
        .values({
          empresaId: base.empresaId,
          vehicleId: base.vehiculoId,
          driverUserId: base.usuarioId,
          status: 'cerrada',
          startedAt: t('2026-11-16T02:29:00Z'),
          closedAt: t('2026-11-16T02:32:00Z'),
        })
        .returning({ id: schema.rutas.id }),
      'ruta',
    );
    const cargas: Array<{ tripId: string; tracking: string; v1Id: string }> = [];
    for (const c of [CARGA_A, CARGA_B]) {
      const v = await viajeEntregado({ ...c, rutaId: ruta.id });
      await db.insert(schema.tripMetrics).values({
        tripId: v.tripId,
        distanceKmEstimated: c.directaKm,
        distanceKmActual: null,
        carbonEmissionsKgco2eEstimated: c.estimadasKg,
        carbonEmissionsKgco2eActual: c.realesKg,
        fuelConsumedLEstimated: '6.44',
        fuelConsumedLActual: '0.01',
        emisionesKgco2eTtw: '0.012',
        emisionesKgco2eWtt: '0.003',
        intensidadGco2ePorTkm: '0.860',
        precisionMethod: 'por_defecto',
        glecVersion: 'v3.0',
        emissionFactorUsed: '3.24000',
        factoresFuente: FACTORES,
        routeDataSource: 'movil_gps',
        coveragePct: '100.00',
        certificationLevel: 'secundario_modeled',
        uncertaintyFactor: '0.150',
        calculatedAt: t('2026-11-16T02:26:08Z'),
        fuenteDistancia: 'movil_gps',
        motivoFallback: 'sin_dispositivo',
        decisionVersion: 2,
        decididoEn: t('2026-11-16T02:31:58Z'),
        rutaId: ruta.id,
        participacion: c.participacion,
        versionMetodoReparto: 'tkm-distancia-directa-v1',
      });
      const v1Id = await certificadoV1(v.tripId, v.tracking, 'movil_gps');
      cargas.push({ ...v, v1Id });
    }
    await db.insert(schema.metricasRuta).values({
      rutaId: ruta.id,
      distanceKmEstimated: '37.75',
      distanceKmActual: '0.03',
      carbonEmissionsKgco2eEstimated: '28.991',
      carbonEmissionsKgco2eActual: '0.021',
      fuelConsumedLEstimated: '8.95',
      fuelConsumedLActual: '0.01',
      emisionesKgco2eTtw: '0.017',
      emisionesKgco2eWtt: '0.004',
      intensidadGco2ePorTkm: '0.870',
      precisionMethod: 'por_defecto',
      glecVersion: 'v3.0',
      emissionFactorUsed: '3.24000',
      factoresFuente: FACTORES,
      routeDataSource: 'movil_gps',
      coveragePct: '100.00',
      certificationLevel: 'secundario_modeled',
      uncertaintyFactor: '0.150',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
      calculatedAt: t('2026-11-16T02:31:58Z'),
    });
    return { rutaId: ruta.id, cargas };
  }

  /** Un viaje solo medido por Teltonika con las cifras indicadas. */
  async function viajeSolo(
    kmEstimados: string,
    kmReales: string,
    kgEstimados: string,
    kgReales: string,
  ) {
    const { db } = handle;
    const v = await viajeEntregado({ origen: 'Origen', destino: 'Destino', pesoKg: 8000 });
    await db.insert(schema.tripMetrics).values({
      tripId: v.tripId,
      distanceKmEstimated: kmEstimados,
      distanceKmActual: kmReales,
      carbonEmissionsKgco2eEstimated: kgEstimados,
      carbonEmissionsKgco2eActual: kgReales,
      fuelConsumedLEstimated: '10.30',
      fuelConsumedLActual: '0.83',
      precisionMethod: 'modelado',
      glecVersion: 'v3.0',
      emissionFactorUsed: '3.25000',
      routeDataSource: 'teltonika_gps',
      coveragePct: '100.00',
      certificationLevel: 'secundario_modeled',
      uncertaintyFactor: '0.150',
      calculatedAt: t('2026-09-14T17:01:57Z'),
    });
    const v1Id = await certificadoV1(v.tripId, v.tracking, null);
    return { ...v, v1Id };
  }

  const metricas = async (tripId: string) =>
    uno(
      await handle.db
        .select()
        .from(schema.tripMetrics)
        .where(eq(schema.tripMetrics.tripId, tripId)),
      'métricas',
    );
  const metricasRuta = async (rutaId: string) =>
    uno(
      await handle.db
        .select()
        .from(schema.metricasRuta)
        .where(eq(schema.metricasRuta.rutaId, rutaId)),
      'métricas de la ruta',
    );
  const eventos = (tripId: string, tipo: 'carbono_calculado' | 'certificado_reemitido') =>
    handle.db
      .select({
        payload: schema.tripEvents.payload,
        recordedByUserId: schema.tripEvents.recordedByUserId,
      })
      .from(schema.tripEvents)
      .where(and(eq(schema.tripEvents.tripId, tripId), eq(schema.tripEvents.eventType, tipo)));
  const versiones = (tripId: string) =>
    handle.db
      .select()
      .from(schema.certificadosViaje)
      .where(eq(schema.certificadosViaje.tripId, tripId))
      .orderBy(schema.certificadosViaje.version);
  const trip = async (tripId: string) =>
    uno(await handle.db.select().from(schema.trips).where(eq(schema.trips.id, tripId)), 'viaje');

  const corregir = (tripId: string) =>
    corregirDistanciaNoPlausible({
      db: handle.db,
      logger,
      tripId,
      solicitadoPorUserId: base.usuarioId,
    });
  const reemitirPorDistancia = (tripId: string) =>
    reemitirCertificado({
      db: handle.db,
      logger,
      tripId,
      correccion: { motivo: 'distancia_medida_no_plausible' },
      solicitadoPorUserId: base.usuarioId,
      config: CONFIG,
    });

  /** Lo que el cierre deja hoy en `metricas_viaje` cuando la medición no cuenta. */
  const SIN_MEDICION = {
    distanceKmActual: null,
    carbonEmissionsKgco2eActual: null,
    fuelConsumedLActual: null,
    emisionesKgco2eTtw: null,
    emisionesKgco2eWtt: null,
    intensidadGco2ePorTkm: null,
    routeDataSource: 'maps_directions',
    coveragePct: '0.00',
    certificationLevel: 'secundario_modeled',
    uncertaintyFactor: '0.350',
  };

  test('antes de corregir la huella, la reemisión por distancia no corresponde', async () => {
    const { cargas } = await rutaDePrueba();
    const a = cargas[0];
    if (!a) {
      throw new Error('fixture');
    }
    await expect(reemitirPorDistancia(a.tripId)).resolves.toMatchObject({
      ok: false,
      code: 'correccion_no_corresponde',
    });
    expect(emitirCertificado).not.toHaveBeenCalled();
  });

  test('la ruta de prueba se corrige entera: ruta, dos cargas y un evento por carga', async () => {
    const { rutaId, cargas } = await rutaDePrueba();
    const [a, b] = cargas;
    if (!a || !b) {
      throw new Error('fixture');
    }

    await expect(
      prepararCorreccion({ db: handle.db, logger, tripId: b.tripId }),
    ).resolves.toMatchObject({
      ok: true,
      plan: {
        unidad: 'ruta',
        rutaId,
        distanciaMedidaKm: 0.03,
        distanciaReferenciaKm: 37.75,
        viajes: [
          { tripId: a.tripId, certificadoEmitido: true, emisionesKgco2eEstimadas: 20.864 },
          { tripId: b.tripId, certificadoEmitido: true, emisionesKgco2eEstimadas: 8.127 },
        ],
      },
    });

    const r = await corregir(a.tripId);
    expect(r).toMatchObject({ ok: true, plan: { unidad: 'ruta', rutaId } });

    expect(await metricasRuta(rutaId)).toMatchObject({
      ...SIN_MEDICION,
      carbonEmissionsKgco2eEstimated: '28.991',
      distanceKmEstimated: '37.75',
    });
    for (const [carga, datos] of [
      [a, CARGA_A],
      [b, CARGA_B],
    ] as const) {
      const m = await metricas(carga.tripId);
      expect(m).toMatchObject({
        ...SIN_MEDICION,
        carbonEmissionsKgco2eEstimated: datos.estimadasKg,
        distanceKmEstimated: datos.directaKm,
        participacion: datos.participacion,
        fuenteDistancia: 'routes_estimada',
        motivoFallback: 'distancia_no_plausible',
        decisionVersion: 3,
        // El certificado vigente no cambia con el paso 1.
        certificateSha256: sha('a'),
        certificadoVigenteId: carga.v1Id,
      });
      expect(m.decididoEn?.getTime()).toBeGreaterThan(EMITIDO_V1.getTime());
      expect(await eventos(carga.tripId, 'carbono_calculado')).toEqual([
        {
          recordedByUserId: base.usuarioId,
          payload: {
            correccion: 'distancia_medida_no_plausible',
            motivo_fallback: 'distancia_no_plausible',
            unidad: 'ruta',
            ruta_id: rutaId,
            distancia_medida_km: 0.03,
            distancia_referencia_km: 37.75,
            minimo_pct: 50,
            fuente_distancia_anterior: 'movil_gps',
            emisiones_kgco2e_reales_anterior: Number(datos.realesKg),
            emisiones_kgco2e_estimadas: Number(datos.estimadasKg),
            certificado_emitido: true,
            decision_version: 3,
          },
        },
      ]);
    }

    // Con eso, la emisión arma cada certificado con su estimación y el total estimado de la ruta.
    const armado = await armarDatosEmision({
      db: handle.db,
      logger,
      trip: await trip(a.tripId),
      metrics: await metricas(a.tripId),
    });
    if (!armado.ok) {
      throw new Error(armado.reason);
    }
    expect(armado.datos.metricas).toMatchObject({
      kgco2eWtwActual: null,
      kgco2eWtwEstimated: 20.864,
      distanciaKmActual: null,
      distanciaKmEstimated: 11.69,
      routeDataSource: 'maps_directions',
      coveragePct: 0,
      uncertaintyFactor: 0.35,
      consolidacion: { participacionPct: 71.97, kgco2eWtwRuta: 28.991 },
    });
    expect(presentacionNivel(armado.datos.metricas).presentacion).toBe('estimado');

    // Volver a correrlo no escribe: ya no hay distancia medida.
    await expect(corregir(b.tripId)).resolves.toMatchObject({
      ok: false,
      code: 'sin_distancia_medida',
    });
    expect(await eventos(b.tripId, 'carbono_calculado')).toHaveLength(1);
  });

  test('reemitir una carga corregida crea la versión 2 con el motivo, sin tocar la huella', async () => {
    const { cargas } = await rutaDePrueba();
    const a = cargas[0];
    if (!a) {
      throw new Error('fixture');
    }
    await corregir(a.tripId);
    const antes = await metricas(a.tripId);

    const r = await reemitirPorDistancia(a.tripId);
    expect(r).toMatchObject({
      ok: true,
      version: 2,
      sha256Anterior: sha('a'),
      sha256Nuevo: sha('b'),
    });

    const params = emitirCertificado.mock.calls[0]?.[0];
    expect(params).toMatchObject({
      version: 2,
      metricas: {
        kgco2eWtwActual: null,
        kgco2eWtwEstimated: 20.864,
        routeDataSource: 'maps_directions',
      },
      viaje: {
        version: {
          numero: 2,
          reemplazaA: 1,
          reemplazaEmitidoEn: EMITIDO_V1,
          motivo: 'distancia_medida_no_plausible',
        },
      },
    });
    // Con esos datos la plantilla real genera el PDF reemitido.
    await expect(
      generarPdfBase({
        viaje: params.viaje,
        metricas: params.metricas,
        empresaShipper: params.empresaShipper,
        transportista: params.transportista,
        verifyUrl: 'https://x/verify',
      }),
    ).resolves.toBeInstanceOf(Uint8Array);

    const [v1, v2] = await versiones(a.tripId);
    expect(v1).toMatchObject({ id: a.v1Id, estado: 'reemplazado', reemplazadoPor: v2?.id });
    expect(v2).toMatchObject({
      version: 2,
      estado: 'vigente',
      sha256: sha('b'),
      motivoReemision: 'distancia_medida_no_plausible',
      fuenteDistancia: 'routes_estimada',
      motivoFallback: 'distancia_no_plausible',
      decisionVersion: 3,
    });
    const despues = await metricas(a.tripId);
    // Solo cambia el espejo del certificado vigente; la huella queda como la dejó el paso 1.
    expect(despues).toMatchObject({
      ...SIN_MEDICION,
      emissionFactorUsed: antes.emissionFactorUsed,
      decididoEn: antes.decididoEn,
      certificadoVigenteId: v2?.id,
      certificateSha256: sha('b'),
      certificateIssuedAt: EMITIDO_V2,
    });
    expect(await eventos(a.tripId, 'certificado_reemitido')).toEqual([
      {
        recordedByUserId: base.usuarioId,
        payload: {
          motivo: 'distancia_medida_no_plausible',
          version_anterior: 1,
          version_nueva: 2,
          sha256_anterior: sha('a'),
          sha256_nuevo: sha('b'),
          pdf_uri: 'gs://b/certificates/e/X.v2.pdf',
          correccion: {
            distancia_medida: 'no_plausible',
            fuente_distancia_anterior: 'movil_gps',
            emisiones_kgco2e_publicadas: 20.864,
          },
        },
      },
    ]);
    // La segunda reemisión del mismo viaje ya no corresponde: la vigente es posterior a la corrección.
    await expect(reemitirPorDistancia(a.tripId)).resolves.toMatchObject({
      code: 'correccion_no_corresponde',
    });
  });

  test('viaje solo con Teltonika: 2,51 km de 500 se corrige; 504,72 de 464,85 es plausible y no se toca', async () => {
    const bkaxik = await viajeSolo('500.00', '2.51', '33.475', '2.691');
    const ywkzwr = await viajeSolo('464.85', '504.72', '545.764', '590.746');

    await expect(corregir(bkaxik.tripId)).resolves.toMatchObject({
      ok: true,
      plan: { unidad: 'viaje', rutaId: null, distanciaMedidaKm: 2.51, distanciaReferenciaKm: 500 },
    });
    expect(await metricas(bkaxik.tripId)).toMatchObject({
      ...SIN_MEDICION,
      carbonEmissionsKgco2eEstimated: '33.475',
      fuenteDistancia: 'routes_estimada',
      motivoFallback: 'distancia_no_plausible',
    });
    expect(await eventos(bkaxik.tripId, 'carbono_calculado')).toHaveLength(1);
    await expect(reemitirPorDistancia(bkaxik.tripId)).resolves.toMatchObject({
      ok: true,
      version: 2,
    });

    await expect(corregir(ywkzwr.tripId)).resolves.toMatchObject({
      ok: false,
      code: 'distancia_plausible',
    });
    expect(await metricas(ywkzwr.tripId)).toMatchObject({
      distanceKmActual: '504.72',
      carbonEmissionsKgco2eActual: '590.746',
      routeDataSource: 'teltonika_gps',
    });
    expect(await eventos(ywkzwr.tripId, 'carbono_calculado')).toHaveLength(0);
  });

  test('job de corrección: en seco informa y no escribe; para escribir exige el destino', async () => {
    const { cargas } = await rutaDePrueba();
    const a = cargas[0];
    if (!a) {
      throw new Error('fixture');
    }
    const env = { DATABASE_URL: handle.url, CODIGO_SEGUIMIENTO: a.tracking.toLowerCase() };

    const seco = await jobCorregir(env);
    expect(seco).toMatchObject({
      dryRun: true,
      codigoSeguimiento: a.tracking,
      ok: true,
      plan: {
        unidad: 'ruta',
        viajes: [{ certificadoEmitido: true }, { certificadoEmitido: true }],
      },
    });
    expect(await metricas(a.tripId)).toMatchObject({ routeDataSource: 'movil_gps' });

    await expect(jobCorregir({ ...env, DRY_RUN: 'false' })).rejects.toThrow(/CONFIRMAR_DESTINO/);
    expect(await metricas(a.tripId)).toMatchObject({ routeDataSource: 'movil_gps' });

    const destino = formatoDestino(destinoDe(handle.url));
    const real = await jobCorregir({
      ...env,
      DRY_RUN: 'false',
      CONFIRMAR_DESTINO: destino,
      SOLICITADO_POR_USER_ID: base.usuarioId,
    });
    expect(real).toMatchObject({ dryRun: false, ok: true, plan: { unidad: 'ruta' } });
    expect(await metricas(a.tripId)).toMatchObject({
      routeDataSource: 'maps_directions',
      motivoFallback: 'distancia_no_plausible',
    });
    expect(await eventos(a.tripId, 'carbono_calculado')).toEqual([
      expect.objectContaining({ recordedByUserId: base.usuarioId }),
    ]);

    await expect(jobCorregir(env)).resolves.toMatchObject({
      ok: false,
      code: 'sin_distancia_medida',
    });
  });

  test('job de reemisión: el motivo nuevo no lleva factor, y el del factor lo sigue exigiendo', async () => {
    const { cargas } = await rutaDePrueba();
    const a = cargas[0];
    if (!a) {
      throw new Error('fixture');
    }
    await corregir(a.tripId);
    const env = {
      DATABASE_URL: handle.url,
      CODIGO_SEGUIMIENTO: a.tracking,
      MOTIVO: 'distancia_medida_no_plausible',
    };

    await expect(jobReemitir({ ...env, MOTIVO: 'factor_impreso_no_corresponde' })).rejects.toThrow(
      /FACTOR_ANTERIOR/,
    );

    const seco = await jobReemitir(env);
    expect(seco).toMatchObject({
      dryRun: true,
      ok: true,
      motivo: 'distancia_medida_no_plausible',
      versionVigente: 1,
      versionNueva: 2,
      emisionesKg: 20.864,
      fuenteDistanciaAnterior: 'movil_gps',
    });
    expect(seco).not.toHaveProperty('factorNuevo');
    expect(emitirCertificado).not.toHaveBeenCalled();

    const real = await jobReemitir({
      ...env,
      DRY_RUN: 'false',
      CONFIRMAR_DESTINO: formatoDestino(destinoDe(handle.url)),
      CERTIFICATE_SIGNING_KEY_ID: CONFIG.kmsKeyId,
      CERTIFICATES_BUCKET: CONFIG.certificatesBucket,
      SOLICITADO_POR_USER_ID: base.usuarioId,
    });
    expect(real).toMatchObject({ dryRun: false, ok: true, version: 2 });
    expect(emitirCertificado).toHaveBeenCalledTimes(1);
    const [, v2] = await versiones(a.tripId);
    expect(v2).toMatchObject({ version: 2, motivoReemision: 'distancia_medida_no_plausible' });
    expect(
      (
        await handle.db
          .select({ id: schema.certificadosViaje.id })
          .from(schema.certificadosViaje)
          .where(
            inArray(
              schema.certificadosViaje.tripId,
              cargas.map((c) => c.tripId),
            ),
          )
      ).length,
    ).toBe(3);
  });
});
