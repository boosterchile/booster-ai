import {
  type ParametrosRuta,
  type RouteDataSource,
  THRESHOLD_SECUNDARIO_MODELED_PCT,
  type TipoCombustible,
  calcularFactorIncertidumbre,
  derivarNivelRuta,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, empresas, metricasRuta, tripMetrics, trips, vehicles } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import {
  type VehiculoMedido,
  desgloseEmisiones,
  medirVentanaDelVehiculo,
} from './calcular-metricas-viaje.js';
import { cargarRuta } from './cargar-ruta.js';
import { type EmitirResult, emitirCertificadoViaje } from './emitir-certificado-viaje.js';
import {
  type HuellaDeRuta,
  calcularHuellaDeRuta,
  guardarHuellaDeRutaCompartida,
} from './huella-por-ruta.js';
import { resolverOptInHuella } from './resolver-opt-in-huella.js';
import { repartirDistanciaEnTramos, tramosRecorridos } from './tramos-recorridos.js';

/**
 * Cierre de la huella de una ruta con varios servicios (ADR-089, spec
 * huella-consolidada parte 4).
 *
 * Cuando la ruta pasa a `cerrada` se mide una vez, completa: la distancia y el
 * combustible entre la primera recogida y la última entrega. Esa emisión se
 * reparte entre los servicios que el camión llegó a recoger, por
 * toneladas-kilómetro de distancia directa, y recién entonces se emite el
 * certificado de cada servicio entregado (§3.9).
 *
 * La ruta de un solo servicio no pasa por aquí: se mide al entregar su carga
 * (`recalcularNivelPostEntrega`), con el mismo cálculo.
 */

const huellaDeRutaCounter = getBusinessCounter('huella_ruta_cerrada_total');

export type ResultadoHuellaDeRuta =
  | 'medida'
  | 'degradada_cobertura'
  | 'peso_ausente'
  | 'distancia_directa_ausente'
  | 'opt_in_inactivo';

export type ResultadoCierreHuella =
  | {
      readonly estado: 'omitida';
      readonly motivo:
        | 'ruta_no_encontrada'
        | 'ruta_no_cerrada'
        | 'sin_servicios_recogidos'
        | 'sin_vehiculo';
    }
  | {
      readonly estado: 'calculada';
      readonly rutaId: string;
      readonly huella: ResultadoHuellaDeRuta;
      /** Emisión WTW de la ruta completa, en kg CO₂e. `null` si no se midió. */
      readonly emisionesKgco2e: number | null;
      /** Viajes entregados de la ruta: los que reciben certificado. */
      readonly entregados: readonly string[];
    };

export async function cerrarHuellaDeRuta(opts: {
  db: Db;
  logger: Logger;
  rutaId: string;
  routesProjectId?: string | undefined;
}): Promise<ResultadoCierreHuella> {
  const { db, logger, rutaId, routesProjectId } = opts;

  const cargada = await db.transaction((tx) => cargarRuta(tx, rutaId));
  if (!cargada) {
    return { estado: 'omitida', motivo: 'ruta_no_encontrada' };
  }
  if (cargada.fila.status !== 'cerrada') {
    return { estado: 'omitida', motivo: 'ruta_no_cerrada' };
  }
  // Participa todo servicio que el camión llegó a recoger, aunque después se
  // haya cancelado (§3.7). El cancelado antes de su recogida no participa.
  const recogidos = cargada.servicios.flatMap((s) =>
    s.pickedUpAt ? [{ ...s, pickedUpAt: s.pickedUpAt }] : [],
  );
  if (recogidos.length === 0) {
    return { estado: 'omitida', motivo: 'sin_servicios_recogidos' };
  }
  const entregados = recogidos.filter((s) => s.estado === 'entregado').map((s) => s.tripId);
  const tripIds = recogidos.map((s) => s.tripId);

  // rls-allowlist: vehículo de la ruta tomada por id (cierre de plataforma)
  const [vehiculo]: VehiculoMedido[] = cargada.fila.vehicleId
    ? await db
        .select({
          id: vehicles.id,
          teltonikaImei: vehicles.teltonikaImei,
          teltonikaImeiEspejo: vehicles.teltonikaImeiEspejo,
          fuelType: vehicles.fuelType,
          consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
          curbWeightKg: vehicles.curbWeightKg,
          capacityKg: vehicles.capacityKg,
          vehicleType: vehicles.vehicleType,
          capacidadEstanqueL: vehicles.capacidadEstanqueL,
          fuenteCombustibleCan: vehicles.fuenteCombustibleCan,
        })
        .from(vehicles)
        .where(eq(vehicles.id, cargada.fila.vehicleId))
        .limit(1)
    : [];
  if (!vehiculo) {
    logger.warn({ rutaId }, 'cierre de huella: la ruta no tiene vehículo — sin medición');
    return { estado: 'omitida', motivo: 'sin_vehiculo' };
  }

  // rls-allowlist: viajes de la ruta tomada por id (cierre de plataforma)
  const viajes = await db
    .select({
      id: trips.id,
      cargoWeightKg: trips.cargoWeightKg,
      generadorCargaEmpresaId: trips.generadorCargaEmpresaId,
      carbonMeasurementOverride: trips.carbonMeasurementOverride,
    })
    .from(trips)
    .where(inArray(trips.id, tripIds))
    .limit(tripIds.length);
  const metricas = await db
    .select({
      tripId: tripMetrics.tripId,
      distanceKmEstimated: tripMetrics.distanceKmEstimated,
      precisionMethod: tripMetrics.precisionMethod,
    })
    .from(tripMetrics)
    .where(inArray(tripMetrics.tripId, tripIds))
    .limit(tripIds.length);
  const viajeDe = new Map(viajes.map((v) => [v.id, v]));
  const metricasDe = new Map(metricas.map((m) => [m.tripId, m]));

  const empresaIds = [
    ...new Set(
      [cargada.fila.empresaId, ...viajes.map((v) => v.generadorCargaEmpresaId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  // rls-allowlist: flags de opt-in de las empresas que participan en la ruta
  const flags = await db
    .select({ id: empresas.id, carbonMeasurementEnabled: empresas.carbonMeasurementEnabled })
    .from(empresas)
    .where(inArray(empresas.id, empresaIds))
    .limit(empresaIds.length);
  const flagDe = (id: string | null): boolean | null =>
    id === null ? null : (flags.find((f) => f.id === id)?.carbonMeasurementEnabled ?? null);
  const activaDe = new Map(
    recogidos.map((s) => {
      const viaje = viajeDe.get(s.tripId);
      return [
        s.tripId,
        resolverOptInHuella({
          tripOverride: viaje?.carbonMeasurementOverride ?? null,
          generadorCarbonEnabled: flagDe(viaje?.generadorCargaEmpresaId ?? null),
          transportistaCarbonEnabled: flagDe(cargada.fila.empresaId),
        }),
      ] as const;
    }),
  );
  const huellaActiva = [...activaDe.values()].some(Boolean);

  const pesoDeclarado = recogidos.every((s) => viajeDe.get(s.tripId)?.cargoWeightKg != null);
  const recorrido = tramosRecorridos(
    recogidos.map((s) => ({
      tripId: s.tripId,
      masaKg: viajeDe.get(s.tripId)?.cargoWeightKg ?? 0,
      recogidoEn: s.pickedUpAt,
      entregadoEn: s.deliveredAt,
    })),
    cargada.fila.closedAt ?? new Date(),
  );

  const medicion = await medirVentanaDelVehiculo({
    db,
    logger,
    vehiculo,
    desde: recorrido.desde,
    hasta: recorrido.hasta,
    routesProjectId,
    pesoDeclarado,
    contexto: { rutaId },
  });
  const { pings, escritura, abortReason, decision, columnasDecision, fuente } = medicion;

  const reconstruida =
    abortReason === null && escritura !== null && escritura.distanciaKmReal !== null;
  const distanciaKmReal = reconstruida ? (escritura?.distanciaKmReal ?? null) : null;
  const coveragePct = reconstruida ? (escritura?.coveragePct ?? 0) : 0;
  const routeDataSource: RouteDataSource = reconstruida ? fuente : 'maps_directions';

  // Los mismos cortes que el viaje solo: sin opt-in no se mide; con cobertura
  // bajo el umbral o sin un peso declarado, las cifras reales quedan en null y
  // el certificado cae a la estimación. Nunca un 0.
  let resultado: ResultadoHuellaDeRuta = 'opt_in_inactivo';
  let huella: HuellaDeRuta | null = null;
  if (huellaActiva) {
    const directas = recogidos.map((s) => {
      const km = metricasDe.get(s.tripId)?.distanceKmEstimated;
      return km == null ? null : Number(km);
    });
    if (
      !reconstruida ||
      distanciaKmReal === null ||
      coveragePct < THRESHOLD_SECUNDARIO_MODELED_PCT
    ) {
      resultado = 'degradada_cobertura';
    } else if (!pesoDeclarado) {
      resultado = 'peso_ausente';
    } else if (directas.some((km) => km === null || !(km > 0))) {
      resultado = 'distancia_directa_ausente';
    } else {
      const tramos = repartirDistanciaEnTramos(recorrido.tramos, pings, distanciaKmReal);
      const consumoBase = vehiculo.consumptionLPer100kmBaseline
        ? Number(vehiculo.consumptionLPer100kmBaseline)
        : null;
      // `exacto_canbus` solo si la decisión eligió el combustible por CAN, con
      // los mismos litros que validó (HC-005).
      const litrosCan =
        decision?.fuenteEnergia === 'can_83' && decision.litrosCan !== null
          ? Math.round(decision.litrosCan * 10) / 10
          : null;
      const perfil = vehiculo.fuelType
        ? {
            combustible: vehiculo.fuelType as TipoCombustible,
            consumoBasePor100km: consumoBase,
            pesoVacioKg: vehiculo.curbWeightKg,
            capacidadKg: vehiculo.capacityKg,
          }
        : null;
      const params: ParametrosRuta =
        litrosCan !== null && perfil
          ? { metodo: 'exacto_canbus', tramos, combustibleConsumido: litrosCan, vehiculo: perfil }
          : perfil && consumoBase != null
            ? { metodo: 'modelado', tramos, vehiculo: perfil }
            : { metodo: 'por_defecto', tramos, tipoVehiculo: vehiculo.vehicleType };
      huella = calcularHuellaDeRuta(
        params,
        recogidos.map((s, i) => ({
          servicioId: s.tripId,
          masaKg: viajeDe.get(s.tripId)?.cargoWeightKg ?? 0,
          distanciaDirectaKm: directas[i] ?? 0,
        })),
      );
      resultado = 'medida';
    }
  }
  huellaDeRutaCounter.add(1, { resultado, fuente });

  if (abortReason !== null && !huellaActiva) {
    // Sin opt-in y sin distancia real no hay nada que medir: solo queda
    // registrada la decisión de fuente en cada viaje (HC-001).
    if (decision !== null) {
      await db
        .update(tripMetrics)
        .set(columnasDecision)
        .where(inArray(tripMetrics.tripId, tripIds));
    }
    logger.info(
      { rutaId, resultado, abortReason },
      'huella de la ruta no medida (opt-in inactivo)',
    );
    return { estado: 'calculada', rutaId, huella: resultado, emisionesKgco2e: null, entregados };
  }

  // rls-allowlist: métricas de la ruta tomada por id (cierre de plataforma)
  const [previa] = await db
    .select({ precisionMethod: metricasRuta.precisionMethod })
    .from(metricasRuta)
    .where(eq(metricasRuta.rutaId, rutaId))
    .limit(1);
  const metodoFinal =
    huella?.ruta.metodoPrecision ??
    previa?.precisionMethod ??
    metricasDe.get(tripIds[0] ?? '')?.precisionMethod ??
    'por_defecto';
  const certificationLevel = derivarNivelRuta({
    precisionMethod: metodoFinal,
    tramos: [{ distanciaKm: distanciaKmReal ?? 0, routeDataSource, coveragePct }],
  }).nivel;
  const uncertaintyFactor = calcularFactorIncertidumbre({
    nivelCertificacion: certificationLevel,
    coveragePct,
    vehicleTypeMatchesRoutesApi: true,
  });
  const parteDe = new Map(huella?.servicios.map((s) => [s.servicioId, s.huella]) ?? []);
  // Varios servicios: cada uno publica su distancia directa, que es la
  // estimada que ya tiene. La distancia real es de la ruta y queda en ella.
  const distanciaDelViaje = recogidos.length === 1 ? distanciaKmReal : null;

  // Todo o nada: la ruta y las partes de sus servicios quedan escritas juntas,
  // para que nunca haya partes que no sumen el total guardado.
  await db.transaction(async (tx) => {
    for (const servicio of recogidos) {
      const activa = activaDe.get(servicio.tripId) ?? false;
      const parte = activa ? (parteDe.get(servicio.tripId)?.emisiones ?? null) : null;
      // rls-allowlist: métricas de un viaje de la ruta tomada por id (cierre de plataforma)
      await tx
        .update(tripMetrics)
        .set({
          distanceKmActual: distanciaDelViaje === null ? null : distanciaDelViaje.toString(),
          routeDataSource,
          coveragePct: coveragePct.toString(),
          certificationLevel,
          uncertaintyFactor: uncertaintyFactor.toString(),
          ...columnasDecision,
          ...(activa
            ? {
                carbonEmissionsKgco2eActual:
                  parte === null ? null : parte.emisionesKgco2eWtw.toString(),
                fuelConsumedLActual:
                  parte !== null && parte.unidadCombustible === 'L'
                    ? parte.combustibleConsumido.toString()
                    : null,
                ...(parte !== null
                  ? {
                      precisionMethod: parte.metodoPrecision,
                      emissionFactorUsed: parte.factorEmisionUsado.toString(),
                      glecVersion: parte.versionGlec,
                      ...desgloseEmisiones(
                        parte,
                        viajeDe.get(servicio.tripId)?.cargoWeightKg ?? null,
                        vehiculo.fuelType,
                      ),
                    }
                  : {
                      emisionesKgco2eTtw: null,
                      emisionesKgco2eWtt: null,
                      intensidadGco2ePorTkm: null,
                    }),
              }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(tripMetrics.tripId, servicio.tripId));
    }
    await guardarHuellaDeRutaCompartida(tx, {
      rutaId,
      momento: huellaActiva ? 'real' : 'nivel',
      huella,
      nivel: { routeDataSource, coveragePct, certificationLevel, uncertaintyFactor },
      distanciaKmReal,
      tripIds,
    });
  });

  logger.info(
    {
      rutaId,
      resultado,
      servicios: recogidos.length,
      entregados: entregados.length,
      tramos: recorrido.tramos.length,
      fuente,
      routeDataSource,
      distanciaKmReal,
      coveragePct,
      certificationLevel,
      precisionMethod: metodoFinal,
      emisionesKgco2e: huella?.ruta.emisionesKgco2eWtw ?? null,
      abortReason,
    },
    'huella de la ruta calculada y repartida al cierre',
  );
  return {
    estado: 'calculada',
    rutaId,
    huella: resultado,
    emisionesKgco2e: huella?.ruta.emisionesKgco2eWtw ?? null,
    entregados,
  };
}

/**
 * Lo que pasa cuando una ruta compartida se cierra: se calcula y reparte su
 * huella, y se emite el certificado de cada servicio entregado. Si el cálculo
 * falla, los certificados salen igual con la estimación, como en el viaje
 * solo: el cliente no se queda sin documento.
 */
export async function cerrarRutaYCertificar(opts: {
  db: Db;
  logger: Logger;
  rutaId: string;
  config: Parameters<typeof emitirCertificadoViaje>[0]['config'];
  routesProjectId?: string | undefined;
  /** Solo para tests. */
  emitir?: typeof emitirCertificadoViaje;
}): Promise<{ readonly cierre: ResultadoCierreHuella | null; readonly certificados: number }> {
  const { db, logger, rutaId, config, routesProjectId } = opts;
  const emitir = opts.emitir ?? emitirCertificadoViaje;

  let cierre: ResultadoCierreHuella | null = null;
  try {
    cierre = await cerrarHuellaDeRuta({ db, logger, rutaId, routesProjectId });
  } catch (err) {
    logger.error(
      { err, rutaId },
      'cierre de huella de la ruta falló — los certificados salen con la estimación',
    );
  }

  let entregados: readonly string[];
  if (cierre?.estado === 'calculada') {
    entregados = cierre.entregados;
  } else {
    // rls-allowlist: servicios entregados de la ruta tomada por id (cierre de plataforma)
    const filas = await db
      .select({ tripId: assignments.tripId })
      .from(assignments)
      .where(sql`${assignments.rutaId} = ${rutaId} and ${assignments.status} = 'entregado'`)
      .limit(500);
    entregados = filas.map((f) => f.tripId);
  }

  let certificados = 0;
  for (const tripId of entregados) {
    try {
      const res: EmitirResult = await emitir({ db, logger, tripId, config });
      if (res.skipped) {
        logger.warn(
          { tripId, rutaId, reason: res.reason },
          'certificado no emitido al cerrar la ruta',
        );
      } else {
        certificados += 1;
        logger.info(
          { tripId, rutaId, pdfSha256: res.pdfSha256 },
          'certificado emitido al cerrar la ruta',
        );
      }
    } catch (err) {
      logger.error(
        { err, tripId, rutaId },
        'la emisión del certificado falló — queda para el relleno',
      );
    }
  }
  return { cierre, certificados };
}
