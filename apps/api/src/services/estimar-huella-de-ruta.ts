import {
  type ParametrosRuta,
  type TipoCombustible,
  calcularFactorIncertidumbre,
  derivarNivelRuta,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { claseMasChicaQueCubre } from '@booster-ai/matching-algorithm';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripMetrics, trips, vehicles } from '../db/schema.js';
import { desgloseEmisiones, obtenerDistanciaKm } from './calcular-metricas-viaje.js';
import { cargarRuta } from './cargar-ruta.js';
import {
  type HuellaDeRuta,
  calcularHuellaDeRuta,
  guardarHuellaDeRutaCompartida,
} from './huella-por-ruta.js';
import { tramosPlanificados } from './tramos-recorridos.js';

/**
 * La estimación de la huella de una ruta mientras está planificada o en curso
 * (ADR-089, spec huella-consolidada §3.9).
 *
 * Es el mismo cálculo del cierre, sobre el plan en vez de lo medido: los
 * tramos son los de las paradas en su orden, con la distancia de mapas entre
 * una y otra, y la emisión se reparte entre los servicios por
 * toneladas-kilómetro de distancia directa. Se vuelve a calcular cada vez que
 * la ruta cambia: al agrupar, quitar, reordenar o declarar otro camión.
 *
 * Con un solo servicio la ruta es su viaje y la estimación es la de siempre.
 */

export type ResultadoEstimacionDeRuta =
  | {
      readonly estado: 'omitida';
      readonly motivo:
        | 'ruta_no_encontrada'
        | 'ruta_no_vigente'
        | 'sin_servicios'
        | 'distancia_directa_ausente'
        | 'sin_actividad';
    }
  | {
      readonly estado: 'estimada';
      readonly rutaId: string;
      readonly servicios: number;
      /** Emisión WTW estimada de la ruta completa, en kg CO₂e. */
      readonly emisionesKgco2e: number;
    };

const mismaDireccion = (a: string, b: string) =>
  a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es');

export async function estimarHuellaDeRuta(opts: {
  db: Db;
  logger: Logger;
  rutaId: string;
  routesProjectId?: string | undefined;
}): Promise<ResultadoEstimacionDeRuta> {
  const { db, logger, rutaId, routesProjectId } = opts;

  const cargada = await db.transaction((tx) => cargarRuta(tx, rutaId));
  if (!cargada) {
    return { estado: 'omitida', motivo: 'ruta_no_encontrada' };
  }
  if (cargada.fila.status !== 'planificada' && cargada.fila.status !== 'en_curso') {
    return { estado: 'omitida', motivo: 'ruta_no_vigente' };
  }
  const vigentes = cargada.servicios.filter((s) => s.estado !== 'cancelado');
  if (vigentes.length === 0) {
    return { estado: 'omitida', motivo: 'sin_servicios' };
  }
  const tripIds = vigentes.map((s) => s.tripId);

  // rls-allowlist: viajes de la ruta tomada por id; quien llama ya autorizó la empresa
  const viajes = await db
    .select({
      id: trips.id,
      cargoType: trips.cargoType,
      cargoWeightKg: trips.cargoWeightKg,
      cargoVolumeM3: trips.cargoVolumeM3,
      origen: trips.originAddressRaw,
      destino: trips.destinationAddressRaw,
      origenRegion: trips.originRegionCode,
      destinoRegion: trips.destinationRegionCode,
    })
    .from(trips)
    .where(inArray(trips.id, tripIds))
    .limit(tripIds.length);
  const metricas = await db
    .select({ tripId: tripMetrics.tripId, distanceKmEstimated: tripMetrics.distanceKmEstimated })
    .from(tripMetrics)
    .where(inArray(tripMetrics.tripId, tripIds))
    .limit(tripIds.length);
  const viajeDe = new Map(viajes.map((v) => [v.id, v]));
  const directaDe = new Map(
    metricas.map((m) => [
      m.tripId,
      m.distanceKmEstimated == null ? null : Number(m.distanceKmEstimated),
    ]),
  );
  if (tripIds.some((id) => !((directaDe.get(id) ?? 0) > 0))) {
    // Sin la distancia directa de un servicio no hay con qué repartir. Pasa si
    // la estimación del viaje todavía no corrió; la próxima operación reintenta.
    logger.warn(
      { rutaId },
      'estimación de la ruta omitida: falta la distancia directa de un servicio',
    );
    return { estado: 'omitida', motivo: 'distancia_directa_ausente' };
  }

  // rls-allowlist: vehículo declarado en la ruta tomada por id
  const [veh] = cargada.fila.vehicleId
    ? await db
        .select({
          fuelType: vehicles.fuelType,
          consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
          curbWeightKg: vehicles.curbWeightKg,
          capacityKg: vehicles.capacityKg,
          vehicleType: vehicles.vehicleType,
        })
        .from(vehicles)
        .where(eq(vehicles.id, cargada.fila.vehicleId))
        .limit(1)
    : [];

  // Distancia de cada tramo, fuera de toda transacción: son llamadas a Routes.
  // Con un servicio el tramo es su distancia directa, sin volver a consultarla.
  const paradas = cargada.paradas.filter((p) => tripIds.includes(p.tripId));
  const [unico] = tripIds;
  const distancias: number[] = [];
  if (tripIds.length === 1 && unico) {
    distancias.push(directaDe.get(unico) ?? 0);
  } else {
    const lugar = (p: (typeof paradas)[number]) => {
      const v = viajeDe.get(p.tripId);
      return p.tipo === 'recogida'
        ? { direccion: v?.origen ?? '', region: v?.origenRegion ?? null }
        : { direccion: v?.destino ?? '', region: v?.destinoRegion ?? null };
    };
    for (let i = 1; i < paradas.length; i += 1) {
      const anterior = paradas[i - 1];
      const actual = paradas[i];
      if (!anterior || !actual) {
        continue;
      }
      const desde = lugar(anterior);
      const hasta = lugar(actual);
      distancias.push(
        mismaDireccion(desde.direccion, hasta.direccion)
          ? 0
          : await obtenerDistanciaKm({
              origenDireccion: desde.direccion,
              destinoDireccion: hasta.direccion,
              origenRegionCode: desde.region,
              destinoRegionCode: hasta.region,
              fuelType: veh?.fuelType ?? null,
              routesProjectId,
              logger,
            }),
      );
    }
  }
  const pesoDe = new Map(tripIds.map((id) => [id, viajeDe.get(id)?.cargoWeightKg ?? 0]));
  const tramos = tramosPlanificados(
    tripIds.length === 1 ? paradas.slice(0, 2) : paradas,
    pesoDe,
    distancias,
  );

  const consumoBase = veh?.consumptionLPer100kmBaseline
    ? Number(veh.consumptionLPer100kmBaseline)
    : null;
  const tipoPorDefecto =
    veh?.vehicleType ??
    claseMasChicaQueCubre(
      viajes.map((v) => ({
        cargoType: v.cargoType,
        weightKg: v.cargoWeightKg,
        volumeM3: v.cargoVolumeM3,
      })),
    );
  const params: ParametrosRuta =
    veh?.fuelType && consumoBase != null
      ? {
          metodo: 'modelado',
          tramos,
          vehiculo: {
            combustible: veh.fuelType as TipoCombustible,
            consumoBasePor100km: consumoBase,
            pesoVacioKg: veh.curbWeightKg,
            capacidadKg: veh.capacityKg,
          },
        }
      : { metodo: 'por_defecto', tramos, tipoVehiculo: tipoPorDefecto };

  let huella: HuellaDeRuta;
  try {
    huella = calcularHuellaDeRuta(
      params,
      tripIds.map((id) => ({
        servicioId: id,
        masaKg: pesoDe.get(id) ?? 0,
        distanciaDirectaKm: directaDe.get(id) ?? 0,
      })),
    );
  } catch (err) {
    // Varios servicios y ninguno declara peso: no hay actividad que repartir.
    logger.warn(
      { err, rutaId },
      'estimación de la ruta omitida: sus servicios no tienen actividad',
    );
    return { estado: 'omitida', motivo: 'sin_actividad' };
  }

  // Antes de la entrega no hay telemetría: fuente de mapas y cobertura 0,
  // igual que en la estimación de un viaje.
  const routeDataSource = 'maps_directions' as const;
  const coveragePct = 0;
  const certificationLevel = derivarNivelRuta({
    precisionMethod: huella.ruta.metodoPrecision,
    tramos: [{ distanciaKm: huella.ruta.distanciaKm, routeDataSource, coveragePct }],
  }).nivel;
  const uncertaintyFactor = calcularFactorIncertidumbre({
    nivelCertificacion: certificationLevel,
    coveragePct,
    vehicleTypeMatchesRoutesApi: true,
  });

  await db.transaction(async (tx) => {
    for (const { servicioId, huella: parte } of huella.servicios) {
      const { emisiones } = parte;
      // rls-allowlist: métricas de un viaje de la ruta tomada por id
      await tx
        .update(tripMetrics)
        .set({
          carbonEmissionsKgco2eEstimated: emisiones.emisionesKgco2eWtw.toString(),
          ...desgloseEmisiones(emisiones, pesoDe.get(servicioId) ?? null, veh?.fuelType ?? null),
          fuelConsumedLEstimated:
            emisiones.unidadCombustible === 'L' ? emisiones.combustibleConsumido.toString() : null,
          precisionMethod: emisiones.metodoPrecision,
          glecVersion: emisiones.versionGlec,
          emissionFactorUsed: emisiones.factorEmisionUsado.toString(),
          routeDataSource,
          coveragePct: coveragePct.toString(),
          certificationLevel,
          uncertaintyFactor: uncertaintyFactor.toString(),
          calculatedAt: new Date(),
          updatedAt: sql`now()`,
        })
        .where(eq(tripMetrics.tripId, servicioId));
    }
    await guardarHuellaDeRutaCompartida(tx, {
      rutaId,
      momento: 'estimado',
      huella,
      nivel: { routeDataSource, coveragePct, certificationLevel, uncertaintyFactor },
      distanciaKmReal: null,
      tripIds,
    });
  });

  logger.info(
    {
      rutaId,
      servicios: tripIds.length,
      tramos: tramos.length,
      distanciaKm: huella.ruta.distanciaKm,
      emisionesKgco2e: huella.ruta.emisionesKgco2eWtw,
      precisionMethod: huella.ruta.metodoPrecision,
    },
    'huella estimada de la ruta calculada y repartida',
  );
  return {
    estado: 'estimada',
    rutaId,
    servicios: tripIds.length,
    emisionesKgco2e: huella.ruta.emisionesKgco2eWtw,
  };
}
