import {
  type ResultadoEmisiones,
  type ResultadoEmptyBackhaul,
  type RouteDataSource,
  THRESHOLD_SECUNDARIO_MODELED_PCT,
  type TipoCombustible,
  calcularEmisionesViaje,
  calcularEmptyBackhaul,
  calcularFactorIncertidumbre,
  derivarNivelCertificacion,
} from '@booster-ai/carbon-calculator';
import type { Logger } from '@booster-ai/logger';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, empresas, tripMetrics, trips, vehicles } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { type EstimarHuecoKm, computarEscrituraDistanciaReal } from './calcular-distancia-real.js';
import { estimarDistanciaKm } from './estimar-distancia.js';
import {
  type VehiculoFuentePosicion,
  fuentePosicionSegmento,
  resolverPosicionesSegmento,
} from './posicion-segmento.js';
import { resolverOptInHuella } from './resolver-opt-in-huella.js';
import { type VehicleEmissionType, computeRoutes } from './routes-api.js';

/**
 * Métricas de negocio de la huella del segmento (T12/T13, plan
 * medicion-huella-segmento). `huella_segmento_total{resultado, fuente}` cuenta
 * cada cierre con opt-in resuelto; las dos específicas hacen contable cada
 * corte de degradación (spec: nunca `0`, nunca fallo silencioso).
 */
const huellaSegmentoCounter = getBusinessCounter('huella_segmento_total');
const huellaCoberturaDegradadaCounter = getBusinessCounter('huella_cobertura_degradada_total');
const huellaPesoAusenteCounter = getBusinessCounter('huella_peso_ausente_total');

/** Perfil energético del vehículo que decide el modo del cálculo (ADR-017/021). */
type PerfilEnergeticoVehiculo = Pick<
  typeof vehicles.$inferSelect,
  'fuelType' | 'consumptionLPer100kmBaseline' | 'curbWeightKg' | 'capacityKg' | 'vehicleType'
>;

/**
 * Emisiones GLEC según el perfil declarado del vehículo: perfil completo
 * (combustible + consumo base) → `modelado`; incompleto → `por_defecto` con el
 * tipo de vehículo como proxy; sin vehículo → `por_defecto` camión mediano.
 * Misma regla en la estimación (al asignar) y en la huella real (al cerrar):
 * el método no cambia por el momento del cálculo, solo la distancia.
 */
function emisionesSegunPerfil(opts: {
  veh: PerfilEnergeticoVehiculo | undefined;
  distanciaKm: number;
  cargaKg: number;
}): ResultadoEmisiones {
  const { veh, distanciaKm, cargaKg } = opts;
  if (veh) {
    const consumoBase = veh.consumptionLPer100kmBaseline
      ? Number(veh.consumptionLPer100kmBaseline)
      : null;
    if (veh.fuelType && consumoBase != null) {
      return calcularEmisionesViaje({
        metodo: 'modelado',
        distanciaKm,
        cargaKg,
        vehiculo: {
          combustible: veh.fuelType as TipoCombustible,
          consumoBasePor100km: consumoBase,
          pesoVacioKg: veh.curbWeightKg,
          capacidadKg: veh.capacityKg,
        },
      });
    }
    return calcularEmisionesViaje({
      metodo: 'por_defecto',
      distanciaKm,
      cargaKg,
      tipoVehiculo: veh.vehicleType,
    });
  }
  return calcularEmisionesViaje({
    metodo: 'por_defecto',
    distanciaKm,
    cargaKg,
    tipoVehiculo: 'camion_mediano',
  });
}

/**
 * Calcular y persistir métricas ESG de un viaje, usando el carbon-calculator
 * (GLEC v3.0 + factores SEC Chile 2024).
 *
 * Estrategia de modo (precision_method):
 *   1. Si vehículo asignado tiene `teltonika_imei` Y disponemos de
 *      telemetría real → modo `exacto_canbus`. Por ahora la telemetría
 *      no llega aún (Phase 2), entonces caemos al siguiente paso.
 *   2. Si vehículo tiene perfil energético declarado (tipo_combustible
 *      + consumo_l_por_100km_base) → modo `modelado`.
 *   3. Caso contrario → modo `por_defecto` con tipo_vehiculo como proxy.
 *
 * Hooks de invocación (a wirear desde el orquestador):
 *   - Asignación creada → calcular `_estimadas` con distancia planificada
 *     y carga declarada. Permite mostrar al carrier "tu viaje genera ~X
 *     kg CO2e estimado" antes de aceptar.
 *   - Entrega confirmada → recalcular `_reales` con datos del viaje real
 *     (telemetría si la hay, sino se queda con la estimación).
 *
 * Importante: la distancia hoy viene de `estimarDistanciaKm()` (tabla
 * pre-computada Chile). En Phase 2 reemplazar por Google Maps Routes API
 * para precisión geo real (con tráfico + altimetría).
 */
export class TripNotFoundError extends Error {
  constructor(public readonly tripId: string) {
    super(`Trip ${tripId} not found`);
    this.name = 'TripNotFoundError';
  }
}

export interface CalcularMetricasResult {
  tripId: string;
  /** True si esta llamada inserta el registro por primera vez. */
  isInitialCalculation: boolean;
  /** Resultado del cálculo (siempre presente; usa por_defecto como fallback). */
  emisiones: ResultadoEmisiones;
}

/**
 * Mapeo de tipo_combustible interno (TipoCombustible) al enum de Routes
 * API (VehicleEmissionType). Routes API solo acepta 4 valores; los
 * combustibles más específicos del schema interno (GLP, GNC, hidrógeno)
 * se mapean al más cercano:
 *
 *   - diesel              → DIESEL
 *   - gasolina            → GASOLINE
 *   - gas_glp / gas_gnc   → GASOLINE (closest behavioral analog)
 *   - electrico           → ELECTRIC
 *   - hibrido_*           → HYBRID
 *   - hidrogeno           → ELECTRIC (closest hop, no H2 enum aún)
 *
 * Si el tipo no es uno de los del schema, devolvemos undefined → Routes
 * API no calcula FUEL_CONSUMPTION para esa request (ahorra costo).
 */
function mapFuelToEmissionType(combustible: string): VehicleEmissionType | undefined {
  switch (combustible) {
    case 'diesel':
      return 'DIESEL';
    case 'gasolina':
    case 'gas_glp':
    case 'gas_gnc':
      return 'GASOLINE';
    case 'electrico':
    case 'hidrogeno':
      return 'ELECTRIC';
    case 'hibrido_diesel':
    case 'hibrido_gasolina':
      return 'HYBRID';
    default:
      return undefined;
  }
}

/**
 * Obtiene la distancia origen→destino del trip en km.
 *
 * Prioridad:
 *   1. Si hay GOOGLE_ROUTES_API_KEY configurada Y el vehículo tiene
 *      fuelType conocido → llamar Routes API. Usa la distancia de la
 *      mejor ruta (TRAFFIC_AWARE_OPTIMAL).
 *   2. Si Routes API falla (timeout, quota exceeded, etc.) o no hay
 *      key → fallback a estimarDistanciaKm (tabla pre-computada Chile).
 *
 * Fallback explícito: cualquier error del Routes API se loggea WARN y
 * caemos al fallback. NO bloquea el cálculo de métricas — el carrier
 * recibe igual su confirmación de asignación.
 *
 * Función con I/O — no debe correrse dentro de una transacción de DB
 * para no extender el lock por la duración del HTTP call (~500ms-1s).
 */
async function obtenerDistanciaKm(opts: {
  origenDireccion: string;
  destinoDireccion: string;
  origenRegionCode: string | null;
  destinoRegionCode: string | null;
  fuelType: string | null;
  routesProjectId: string | undefined;
  logger: Logger;
}): Promise<number> {
  const {
    origenDireccion,
    destinoDireccion,
    origenRegionCode,
    destinoRegionCode,
    fuelType,
    routesProjectId,
    logger,
  } = opts;

  if (routesProjectId) {
    try {
      const emissionType = fuelType ? mapFuelToEmissionType(fuelType) : undefined;
      const routes = await computeRoutes({
        projectId: routesProjectId,
        origin: origenDireccion,
        destination: destinoDireccion,
        emissionType,
        logger,
      });
      const best = routes[0];
      if (best && best.distanceKm > 0) {
        logger.info(
          { distanciaKm: best.distanceKm, durationS: best.durationS, source: 'routes_api' },
          'distancia obtenida via Routes API',
        );
        return best.distanceKm;
      }
      logger.warn(
        { origenDireccion, destinoDireccion },
        'Routes API devolvió 0 rutas, fallback a estimarDistanciaKm',
      );
    } catch (err) {
      logger.warn(
        { err, origenDireccion, destinoDireccion },
        'Routes API falló, fallback a estimarDistanciaKm',
      );
    }
  }

  return estimarDistanciaKm(origenRegionCode, destinoRegionCode);
}

/**
 * Calcular métricas estimadas (al asignar viaje, antes de la entrega).
 */
interface CalcularMetricasEstimadasOptions {
  db: Db;
  logger: Logger;
  tripId: string;
  vehicleId: string | null;
  /**
   * GCP project ID — header X-Goog-User-Project para Routes API (ADR-038).
   * Si presente, se usa Routes API via ADC para distancia precisa.
   * Si no, fallback a estimarDistanciaKm.
   */
  routesProjectId?: string | undefined;
}

export async function calcularMetricasEstimadas(
  opts: CalcularMetricasEstimadasOptions,
): Promise<CalcularMetricasResult> {
  return await withBusinessSpan(
    {
      name: 'carbon.calcular_metricas_estimadas',
      attributes: {
        'booster.trip_id': opts.tripId,
        'booster.vehicle_id': opts.vehicleId ?? undefined,
      },
    },
    async (span) => {
      const result = await calcularMetricasEstimadasInner(opts);
      setResultAttributes(span, {
        'booster.carbon.precision_method': result.emisiones.metodoPrecision,
        'booster.carbon.distancia_km': result.emisiones.distanciaKm,
        'booster.carbon.emisiones_kgco2e_wtw': result.emisiones.emisionesKgco2eWtw,
        'booster.carbon.glec_version': result.emisiones.versionGlec,
        'booster.carbon.is_initial_calculation': result.isInitialCalculation,
      });
      return result;
    },
  );
}

async function calcularMetricasEstimadasInner(
  opts: CalcularMetricasEstimadasOptions,
): Promise<CalcularMetricasResult> {
  const { db, logger, tripId, vehicleId, routesProjectId } = opts;

  // (1) Lectura de trip + vehicle FUERA de la transacción. Esto permite
  // hacer el HTTP a Routes API sin extender el lock de la tx (que sería
  // anti-patrón: un HTTP de ~500ms-1s holding row lock genera contención
  // en re-cálculos concurrentes del mismo trip). Postgres MVCC garantiza
  // que las lecturas son consistentes punto-en-tiempo aunque sean fuera
  // del begin/commit del UPDATE final.
  // rls-allowlist: pipeline de métricas scoped por tripId ya validado en la ruta llamadora (censo §2 nota C / rls-viabilidad §2C)
  const tripRows = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  const trip = tripRows[0];
  if (!trip) {
    throw new TripNotFoundError(tripId);
  }

  // rls-allowlist: vehículo scoped por vehicleId ya validado del trip (censo §2 nota C)
  const veh = vehicleId
    ? (await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)).limit(1))[0]
    : undefined;

  // (2) HTTP out-of-tx — Routes API o fallback a tabla.
  const distanciaKm = await obtenerDistanciaKm({
    origenDireccion: trip.originAddressRaw,
    destinoDireccion: trip.destinationAddressRaw,
    origenRegionCode: trip.originRegionCode,
    destinoRegionCode: trip.destinationRegionCode,
    fuelType: veh?.fuelType ?? null,
    routesProjectId,
    logger,
  });

  // (3) Compute emisiones (puro, GLEC v3.0). En la ESTIMACIÓN el peso ausente
  // se trata como 0 (es un preview pre-asignación); la huella REAL del cierre
  // exige peso declarado (T13, `recalcularNivelPostEntrega`).
  const cargaKg = trip.cargoWeightKg ?? 0;
  const emisiones = emisionesSegunPerfil({ veh, distanciaKm, cargaKg });

  // (4) Persistencia — tx corta con todo pre-computado.
  return await db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(tripMetrics)
      .where(eq(tripMetrics.tripId, tripId))
      .limit(1);
    const isInitialCalculation = existing.length === 0;

    // ADR-028 — derivar fuente de datos y nivel de certificación.
    //
    // En esta fase pre-entrega no hay telemetría real disponible — la
    // distancia viene de `estimarDistanciaKm` (tabla Chile) y se trata
    // conceptualmente como ruta modelada Maps-style. Si en Phase 1 se
    // reemplaza por Routes API, la fuente sigue siendo `maps_directions`.
    //
    // `coveragePct = 0` porque no hay pings GPS aún; cuando se cierre el
    // trip y telemetry-processor calcule la cobertura real, este servicio
    // se llamará de nuevo (post-entrega) y los valores se actualizarán.
    const routeDataSource: RouteDataSource = 'maps_directions';
    const coveragePct = 0;
    const certificationLevel = derivarNivelCertificacion({
      precisionMethod: emisiones.metodoPrecision,
      routeDataSource,
      coveragePct,
    });
    const uncertaintyFactor = calcularFactorIncertidumbre({
      nivelCertificacion: certificationLevel,
      coveragePct,
      // En modo estimado pre-entrega no comparamos contra Routes API, así
      // que asumimos que el tipo declarado matchea (no penalizamos sin
      // evidencia). La verificación real ocurre post-entrega.
      vehicleTypeMatchesRoutesApi: true,
    });

    // ADR-021 §6.4 — empty backhaul allocation (GLEC v3.0).
    //
    // En la fase estimada pre-entrega el matching de retorno todavía no
    // se conoce — por GLEC default, asumimos factorMatching = 0 (peor
    // caso: camión vuelve 100% vacío) para no inflar el certificado
    // con un ahorro especulativo. Post-entrega, `actualizarFactorMatchingViaje`
    // recalcula con la heurística geo del próximo trip del vehículo.
    //
    // Sólo aplicable cuando tenemos perfil completo del vehículo
    // (consumo + combustible + capacidad). En modo `por_defecto` el
    // calculator no expone consumo base, así que skipeamos — el
    // certificate-generator interpreta `null` como "no estimado".
    const emptyBackhaul = calcularBackhaulSiCorresponde({ emisiones, veh });

    const valuesToWrite = {
      distanceKmEstimated: emisiones.distanciaKm.toString(),
      carbonEmissionsKgco2eEstimated: emisiones.emisionesKgco2eWtw.toString(),
      fuelConsumedLEstimated:
        emisiones.unidadCombustible === 'L' ? emisiones.combustibleConsumido.toString() : null,
      precisionMethod: emisiones.metodoPrecision,
      glecVersion: emisiones.versionGlec,
      emissionFactorUsed: emisiones.factorEmisionUsado.toString(),
      source: 'modelado',
      // ADR-028 — campos nuevos del modelo dual.
      routeDataSource,
      coveragePct: coveragePct.toString(),
      certificationLevel,
      uncertaintyFactor: uncertaintyFactor.toString(),
      // ADR-021 — empty backhaul.
      factorMatchingAplicado: emptyBackhaul ? '0.00' : null,
      emisionesEmptyBackhaulKgco2eWtw: emptyBackhaul
        ? emptyBackhaul.emisionesKgco2eWtw.toString()
        : null,
      ahorroCo2eVsSinMatchingKgco2e: emptyBackhaul
        ? emptyBackhaul.ahorroVsSinMatchingKgco2e.toString()
        : null,
      calculatedAt: new Date(),
    };

    if (isInitialCalculation) {
      await tx.insert(tripMetrics).values({ tripId, ...valuesToWrite });
    } else {
      await tx
        .update(tripMetrics)
        .set({ ...valuesToWrite, updatedAt: sql`now()` })
        .where(eq(tripMetrics.tripId, tripId));
    }

    logger.info(
      {
        tripId,
        vehicleId,
        metodoPrecision: emisiones.metodoPrecision,
        distanciaKm: emisiones.distanciaKm,
        cargaKg,
        emisionesKgco2eWtw: emisiones.emisionesKgco2eWtw,
        intensidadGco2ePorTonKm: emisiones.intensidadGco2ePorTonKm,
        isInitialCalculation,
      },
      'metricas estimadas calculadas',
    );

    return { tripId, isInitialCalculation, emisiones };
  });
}

/**
 * Re-deriva el nivel de certificación post-entrega usando la cobertura
 * telemétrica real (ADR-028 §5).
 *
 * Disparo: al confirmar entrega, ANTES de emitir el certificado. Tiene
 * que correr en este orden porque emitirCertificadoViaje lee
 * `certification_level` y `uncertainty_factor` del row de
 * `metricas_viaje` para elegir el template del PDF (primario vs
 * secundario) y el ± impreso.
 *
 * Lógica:
 *   1. Cargar trip + assignment + métricas existentes.
 *   2. Si el vehículo NO tiene Teltonika asociado, no hay forma de
 *      mejorar la cobertura — skip silencioso (el cert sale con los
 *      valores estimados pre-entrega: maps_directions + 0%).
 *   3. Si el vehículo tiene Teltonika, calcular cobertura entre
 *      pickupAt y deliveredAt; promover routeDataSource a teltonika_gps.
 *   4. Re-derivar nivel + uncertainty con los nuevos valores.
 *   5. UPDATE selectivo de los 4 campos (no toca emisiones, factor, etc.
 *      — esos se mantienen del cálculo estimado, salvo que en una
 *      revisión futura agreguemos modo `exacto_canbus` con consumo real
 *      del CAN bus).
 *
 * Idempotente: si la cobertura nueva da el mismo nivel, el UPDATE es
 * no-op (drizzle igual hace el round-trip — opt: chequeo de igualdad
 * antes de update si esto se vuelve hot path).
 */
/** Motivo por el que NO se persistió una distancia real. Contable (F0-0): distingue
 *  "no aplica" (sin_observacion) de "está roto" (routes_error). */
type AbortReconstruccion = 'sin_observacion' | 'cap_exceeded' | 'routes_error';

/** De dónde salió el ancla de inicio de la ventana medida (T11, spec Q6). */
type AnclaVentana = 'recogido_en' | 'pickup_window_start' | 'created_at';

/**
 * Resultado de la huella real del segmento (T12/T13):
 *   - `medida`: opt-in activo, cobertura ≥ umbral y peso declarado →
 *     `emisiones_kgco2e_reales` poblado desde la distancia real.
 *   - `degradada_cobertura`: opt-in activo pero cobertura < umbral (o sin
 *     reconstrucción) → emisiones reales null + métrica (corte #2 del spec).
 *   - `peso_ausente`: opt-in activo, cobertura ok, sin `carga_peso_kg` →
 *     emisiones reales null + métrica (corte #3). NUNCA 0.
 *   - `opt_in_inactivo`: el viaje no mide huella; distancia/nivel como T11.
 */
type ResultadoHuella = 'medida' | 'degradada_cobertura' | 'peso_ausente' | 'opt_in_inactivo';

interface RecalcularNivelPostEntregaResult {
  recomputed: boolean;
  /** Nivel resultante (puede ser igual al previo). */
  certificationLevel?: 'primario_verificable' | 'secundario_modeled' | 'secundario_default';
  /** Cobertura calculada (0..100). */
  coveragePct?: number;
  /** Distancia real persistida (km); null si se abortó (cae a la estimación). */
  distanciaKmReal?: number | null;
  /** Motivo del abort para observabilidad; null en éxito. */
  abortReason?: AbortReconstruccion | null;
  /** Distancia MEDIDA (Σ tramos observados, km); insumo de T12. */
  kmCubiertos?: number;
  /** Fuente real de los pings (ADR-077 §1): la que se persiste, nunca disfrazada. */
  routeDataSource?: RouteDataSource;
  /** Ancla de inicio de la ventana medida. */
  pickupAtSource?: AnclaVentana;
  /** Qué pasó con la huella real del segmento (T12/T13). */
  huella?: ResultadoHuella;
  /** `emisiones_kgco2e_reales` persistidas; null si se degradó o no aplica. */
  emisionesKgco2eReales?: number | null;
}

export async function recalcularNivelPostEntrega(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  /** Project id para Routes API (rellena huecos de la traza). */
  routesProjectId?: string | undefined;
}): Promise<RecalcularNivelPostEntregaResult> {
  return await withBusinessSpan(
    {
      name: 'carbon.recalcular_nivel_post_entrega',
      attributes: { 'booster.trip_id': opts.tripId },
    },
    async (span) => {
      const result = await recalcularNivelPostEntregaInner(opts);
      setResultAttributes(span, {
        'booster.carbon.recomputed': result.recomputed,
        'booster.carbon.certification_level': result.certificationLevel ?? undefined,
        'booster.carbon.coverage_pct': result.coveragePct ?? undefined,
        // Contable: un distancia_km_real=null dice POR QUÉ (no aplica vs roto).
        'booster.carbon.abort_reason': result.abortReason ?? undefined,
        'booster.carbon.route_data_source': result.routeDataSource ?? undefined,
        'booster.carbon.pickup_at_source': result.pickupAtSource ?? undefined,
        'booster.carbon.km_cubiertos': result.kmCubiertos ?? undefined,
        'booster.carbon.huella': result.huella ?? undefined,
        'booster.carbon.emisiones_kgco2e_reales': result.emisionesKgco2eReales ?? undefined,
      });
      return result;
    },
  );
}

async function recalcularNivelPostEntregaInner(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  routesProjectId?: string | undefined;
}): Promise<RecalcularNivelPostEntregaResult> {
  const { db, logger, tripId, routesProjectId } = opts;

  // rls-allowlist: recálculo de nivel post-entrega scoped por tripId ya validado (censo §2 nota C / rls-viabilidad §2C)
  const tripRows = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  const trip = tripRows[0];
  if (!trip) {
    throw new TripNotFoundError(tripId);
  }

  const metricsRows = await db
    .select()
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  const existing = metricsRows[0];
  if (!existing) {
    // No hay métricas previas — no hay nada que recalcular. Esto
    // normalmente no debería ocurrir en producción (calcularMetricasEstimadas
    // corre al asignar), pero defensivo: log + skip.
    logger.warn({ tripId }, 'recalcularNivelPostEntrega: trip sin metricas_viaje');
    return { recomputed: false };
  }

  // Necesitamos vehicleId + deliveredAt del assignment. Si no hay
  // assignment cerrado, no se debería estar llamando esta función todavía.
  // rls-allowlist: assignment scoped por tripId ya validado (censo §2 nota C)
  const assignmentRows = await db
    .select({
      vehicleId: assignments.vehicleId,
      deliveredAt: assignments.deliveredAt,
      pickedUpAt: assignments.pickedUpAt,
      empresaId: assignments.empresaId,
    })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = assignmentRows[0];

  if (!assignment?.vehicleId || !assignment.deliveredAt) {
    logger.info(
      { tripId, hasAssignment: !!assignment, hasVehicle: !!assignment?.vehicleId },
      'recalcularNivelPostEntrega: skip (sin assignment con vehicle + deliveredAt)',
    );
    return { recomputed: false };
  }

  // Fuente de posición por vehículo (Task 10 / ADR-077 §1): con Teltonika lee
  // `telemetria_puntos`; sin dispositivo lee `posiciones_movil_conductor` (GPS
  // del móvil del conductor). Un viaje se mide desde UNA sola fuente, y la que
  // se persiste es la real — nunca se disfraza de otra (ADR-077 §1).
  // rls-allowlist: vehículo scoped por vehicleId del assignment ya validado (censo §2 nota C)
  const vehRows = await db
    .select({
      id: vehicles.id,
      teltonikaImei: vehicles.teltonikaImei,
      teltonikaImeiEspejo: vehicles.teltonikaImeiEspejo,
      fuelType: vehicles.fuelType,
      consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
      curbWeightKg: vehicles.curbWeightKg,
      capacityKg: vehicles.capacityKg,
      vehicleType: vehicles.vehicleType,
    })
    .from(vehicles)
    .where(eq(vehicles.id, assignment.vehicleId))
    .limit(1);
  const vehiculo: (VehiculoFuentePosicion & PerfilEnergeticoVehiculo) | undefined = vehRows[0];
  if (!vehiculo) {
    logger.warn(
      { tripId, vehicleId: assignment.vehicleId },
      'recalcularNivelPostEntrega: vehicle del assignment no existe — skip',
    );
    return { recomputed: false };
  }
  const fuente = fuentePosicionSegmento(vehiculo).fuente;

  // Opt-in efectivo de huella (Task 3, T12): override del viaje ?? OR de las
  // empresas participantes. Se resuelve ANTES de medir para no gastar Routes
  // ni computar emisiones que nadie pidió.
  const empresaIds = [assignment.empresaId, trip.generadorCargaEmpresaId].filter(
    (id): id is string => id !== null,
  );
  // rls-allowlist: flags de opt-in de las empresas participantes del viaje ya validado (T12, censo §2 nota C)
  const flagRows =
    empresaIds.length > 0
      ? await db
          .select({ id: empresas.id, carbonMeasurementEnabled: empresas.carbonMeasurementEnabled })
          .from(empresas)
          .where(inArray(empresas.id, empresaIds))
          .limit(empresaIds.length)
      : [];
  const flagDe = (id: string | null): boolean | null =>
    id === null ? null : (flagRows.find((r) => r.id === id)?.carbonMeasurementEnabled ?? null);
  const huellaActiva = resolverOptInHuella({
    tripOverride: trip.carbonMeasurementOverride,
    generadorCarbonEnabled: flagDe(trip.generadorCargaEmpresaId),
    transportistaCarbonEnabled: flagDe(assignment.empresaId),
  });

  // Ventana = segmento REAL `[recogido_en, entregado_en]` (spec Q6, T11): la
  // huella se mide sobre lo que pasó entre la recogida confirmada (F1) y la
  // entrega, no sobre la ventana planificada. Fallbacks declarados en cascada
  // para viajes sin recogida confirmada; el ancla usada queda en el log y el
  // span para auditoría.
  const pickupAtSource: AnclaVentana = assignment.pickedUpAt
    ? 'recogido_en'
    : trip.pickupWindowStart
      ? 'pickup_window_start'
      : 'created_at';
  const pickupAt = assignment.pickedUpAt ?? trip.pickupWindowStart ?? trip.createdAt;

  const precisionMethod =
    (existing.precisionMethod as 'exacto_canbus' | 'modelado' | 'por_defecto' | null) ??
    'por_defecto';

  // Reconstrucción de la distancia real (F0-0 paso 1): pings observados +
  // huecos rellenados por-tramo con Routes. Los pings salen de la fuente
  // ruteada del vehículo (T11), no de `telemetria_puntos` a secas.
  const pings = await resolverPosicionesSegmento({
    db,
    vehicle: vehiculo,
    desde: pickupAt,
    hasta: assignment.deliveredAt,
  });

  // Resolver de huecos sobre Routes API con coordenadas (`location.latLng`;
  // como texto «lat,lng» Routes responde 400). Si Routes falla, PROPAGA →
  // abortamos (no un número parte-medido parte-inventado).
  const estimarHuecoKm: EstimarHuecoKm = async (desde, hasta) => {
    const rutas = await computeRoutes({
      projectId: routesProjectId ?? '',
      origin: { lat: desde.lat, lng: desde.lng },
      destination: { lat: hasta.lat, lng: hasta.lng },
      logger,
    });
    const mejor = rutas[0];
    if (!mejor || mejor.distanceKm <= 0) {
      throw new Error('Routes: sin ruta para el hueco');
    }
    return mejor.distanceKm;
  };

  // Política de abort → sin distancia real reconstruida. Con huella INACTIVA es
  // un no-op honesto (el cert cae a la estimación via `??`): forzar la fuente
  // real con coverage 0 etiquetaría la procedencia de la DISTANCIA con la
  // fuente de la UBICACIÓN — F0-0 en miniatura. Con huella ACTIVA la
  // degradación se REGISTRA (spec: nunca fallo silencioso), más abajo.
  let escritura: Awaited<ReturnType<typeof computarEscrituraDistanciaReal>> = null;
  let abortReason: AbortReconstruccion | null = null;
  try {
    escritura = await computarEscrituraDistanciaReal(pings, estimarHuecoKm);
  } catch (err) {
    logger.warn(
      { err, tripId, fuente, pickupAtSource },
      'recalcular: reconstrucción abortada — Routes falló (roto)',
    );
    abortReason = 'routes_error';
  }
  if (abortReason === null && escritura === null) {
    logger.info(
      { tripId, fuente, pickupAtSource },
      'recalcular: reconstrucción abortada — demasiados huecos (cap)',
    );
    abortReason = 'cap_exceeded';
  }
  if (abortReason === null && escritura !== null && escritura.distanciaKmReal === null) {
    logger.info(
      { tripId, fuente, pickupAtSource, pings: pings.length },
      'recalcular: sin observación continua en el segmento — no aplica upgrade',
    );
    abortReason = 'sin_observacion';
  }

  if (abortReason !== null && !huellaActiva) {
    huellaSegmentoCounter.add(1, { resultado: 'opt_in_inactivo', fuente });
    return {
      recomputed: false,
      abortReason,
      distanciaKmReal: null,
      routeDataSource: fuente,
      pickupAtSource,
      huella: 'opt_in_inactivo',
      emisionesKgco2eReales: null,
    };
  }

  // Distancia + cobertura + fuente que se persisten (§5-ext, #624): salen de la
  // MISMA híbrida. Sin reconstrucción (solo con huella activa llegamos acá) no
  // hay distancia real: fuente `maps_directions`, cobertura 0.
  const reconstruida =
    abortReason === null && escritura !== null && escritura.distanciaKmReal !== null;
  const distanciaKmReal = reconstruida ? (escritura?.distanciaKmReal ?? null) : null;
  const kmCubiertos = reconstruida ? (escritura?.kmCubiertos ?? 0) : 0;
  const coveragePct = reconstruida ? (escritura?.coveragePct ?? 0) : 0;
  const routeDataSource: RouteDataSource = reconstruida ? fuente : 'maps_directions';
  const certificationLevel = derivarNivelCertificacion({
    precisionMethod,
    routeDataSource,
    coveragePct,
  });
  const uncertaintyFactor = calcularFactorIncertidumbre({
    nivelCertificacion: certificationLevel,
    coveragePct,
    vehicleTypeMatchesRoutesApi: true,
  });

  // Huella real del segmento (T12) con sus dos cortes de degradación:
  //   corte #2 — cobertura < umbral (o sin reconstrucción): emisiones null.
  //   corte #3 — peso declarado ausente: emisiones null (T13). NUNCA 0: el
  //   cert lee `actual ?? estimated`, y un 0 no es nullish.
  // El umbral es el mismo de la matriz de certificación (fuente única).
  let huella: ResultadoHuella = 'opt_in_inactivo';
  let emisionesReales: ResultadoEmisiones | null = null;
  if (huellaActiva) {
    if (
      !reconstruida ||
      distanciaKmReal === null ||
      coveragePct < THRESHOLD_SECUNDARIO_MODELED_PCT
    ) {
      huella = 'degradada_cobertura';
      huellaCoberturaDegradadaCounter.add(1, {
        fuente,
        motivo: abortReason ?? 'cobertura_bajo_umbral',
      });
    } else if (trip.cargoWeightKg === null) {
      huella = 'peso_ausente';
      huellaPesoAusenteCounter.add(1, { fuente });
    } else {
      // La distancia que alimenta la huella es la MISMA que se persiste como
      // real (híbrida con cobertura declarada): el cert muestra X km y las
      // emisiones se calcularon sobre esos X km.
      emisionesReales = emisionesSegunPerfil({
        veh: vehiculo,
        distanciaKm: distanciaKmReal,
        cargaKg: trip.cargoWeightKg,
      });
      huella = 'medida';
    }
  }
  huellaSegmentoCounter.add(1, { resultado: huella, fuente });

  // ATOMICIDAD: distancia + cobertura + fuente + nivel + uncertainty (+ huella)
  // en UN solo UPDATE (todo-o-nada). Un write a medias dejaría cobertura que
  // no corresponde a la distancia → el cert declararía "medido X%" sobre un
  // número que no es esa X.
  await db
    .update(tripMetrics)
    .set({
      distanceKmActual: distanciaKmReal === null ? null : distanciaKmReal.toString(),
      routeDataSource,
      coveragePct: coveragePct.toString(),
      certificationLevel,
      uncertaintyFactor: uncertaintyFactor.toString(),
      ...(huellaActiva
        ? {
            carbonEmissionsKgco2eActual:
              emisionesReales === null ? null : emisionesReales.emisionesKgco2eWtw.toString(),
            fuelConsumedLActual:
              emisionesReales !== null && emisionesReales.unidadCombustible === 'L'
                ? emisionesReales.combustibleConsumido.toString()
                : null,
            ...(emisionesReales !== null
              ? { precisionMethod: emisionesReales.metodoPrecision }
              : {}),
          }
        : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(tripMetrics.tripId, tripId));

  logger.info(
    {
      tripId,
      vehicleId: assignment.vehicleId,
      routeDataSource,
      fuente,
      pickupAtSource,
      pickupAt,
      distanciaKmReal,
      kmCubiertos,
      coveragePct,
      certificationLevel,
      uncertaintyFactor,
      precisionMethod: emisionesReales?.metodoPrecision ?? precisionMethod,
      huellaActiva,
      huella,
      emisionesKgco2eReales: emisionesReales?.emisionesKgco2eWtw ?? null,
      abortReason,
    },
    'distancia real + huella del segmento recalculadas post-entrega',
  );

  return {
    recomputed: reconstruida,
    certificationLevel,
    coveragePct,
    distanciaKmReal,
    kmCubiertos,
    routeDataSource,
    pickupAtSource,
    abortReason,
    huella,
    emisionesKgco2eReales: emisionesReales?.emisionesKgco2eWtw ?? null,
  };
}

/**
 * Devuelve el cálculo de empty backhaul cuando hay perfil completo del
 * vehículo. Default: factorMatching = 0 (peor caso conservador, GLEC §6.4.2).
 * El upgrade post-entrega lo aplica `actualizarFactorMatchingViaje`.
 *
 * Vehículo sin perfil energético (modo `por_defecto`) → retorna null:
 * el calculator no expone consumo base, así que no podemos calcular
 * empty backhaul honrando GLEC. El certificate-generator interpreta
 * `null` como "no estimado" en lugar de mostrar 0.
 */
function calcularBackhaulSiCorresponde(opts: {
  emisiones: ResultadoEmisiones;
  veh:
    | {
        fuelType: string | null;
        consumptionLPer100kmBaseline: string | null;
        capacityKg: number | null;
      }
    | undefined;
}): ResultadoEmptyBackhaul | null {
  const { emisiones, veh } = opts;
  if (!veh?.fuelType || !veh.consumptionLPer100kmBaseline || !veh.capacityKg) {
    return null;
  }
  // ADR-021 §6.4 — la distancia de retorno se asume igual a la del leg
  // cargado (ida = vuelta) como aproximación honest-default. Una versión
  // futura podrá pedir el destino del próximo trip al Routes API.
  return calcularEmptyBackhaul({
    distanciaRetornoKm: emisiones.distanciaKm,
    factorMatching: 0,
    consumoBasePor100km: Number(veh.consumptionLPer100kmBaseline),
    combustible: veh.fuelType as TipoCombustible,
    capacidadKg: veh.capacityKg,
  });
}
