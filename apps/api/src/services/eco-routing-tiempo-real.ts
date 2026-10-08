import {
  type MuestraPosicion,
  type RutaCandidata,
  detectarCongestion,
  evaluarAlternativas,
} from '@booster-ai/eco-routing';
import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  assignments,
  posicionesMovilConductor,
  sugerenciasRuta,
  telemetryPoints,
  trips,
  vehicles,
} from '../db/schema.js';
import { getBusinessCounter, getBusinessHistogram } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  type ComputeRoutesParams,
  type RouteSuggestion,
  RoutesApiError,
  type VehicleEmissionType,
} from './routes-api.js';
import type { RutaSugeridaPushPayload, SendPushResult } from './web-push.js';

/**
 * Eco-routing en tiempo real (T10-23, ADR-012 Capa 1; spec
 * `.specs/eco-routing-t10-23/`). Se dispara con cada posición del viaje
 * activo: detecta congestión (< 10 km/h sostenido ≥ 60 s, package puro),
 * pide alternativas a Routes API desde la posición actual, elige por
 * emisiones con guardrail de ETA y, si hay mejora material, persiste la
 * sugerencia y la empuja al conductor por Web Push con Aceptar / Seguir.
 * Best-effort: nunca bloquea el reporte de posición.
 */

/** Una sugerencia (o detección) cada 15 min por asignación. */
export const ECO_ROUTING_COOLDOWN_MS = 15 * 60_000;
/** Como máximo una evaluación por minuto por asignación (cuota de Routes API). */
export const ECO_ROUTING_THROTTLE_MS = 60_000;
/** Ventana de posiciones que se le pasa al detector. */
const VENTANA_POSICIONES_MS = 3 * 60_000;

export interface EcoRoutingDeps {
  computeRoutes: (params: ComputeRoutesParams) => Promise<RouteSuggestion[]>;
  sendPush: (opts: { userId: string; payload: RutaSugeridaPushPayload }) => Promise<SendPushResult>;
  now: () => number;
  /** Última evaluación por asignación (ms). Por proceso; inyectable en tests. */
  throttle: Map<string, number>;
}

export type ResultadoEcoRouting =
  | { resultado: 'viaje_no_activo' | 'throttle' | 'cooldown' | 'error_routes' }
  | { resultado: 'sin_congestion'; razon: string }
  | { resultado: 'congestion_sin_alternativa'; sugerenciaId: string }
  | { resultado: 'sugerida'; sugerenciaId: string; pushEnviados: number };

// Instrumentos memoizados por business-metrics; se piden al usarlos (no al
// importar el módulo) para no acoplar la carga de rutas al MeterProvider.
const sugerenciasCounter = () => getBusinessCounter('eco_routing_sugerencias_total');
const respuestasCounter = () => getBusinessCounter('eco_routing_respuestas_total');
const entregaHistogram = () =>
  getBusinessHistogram('eco_routing_entrega_ms', {
    description: 'Desde la decisión de sugerir hasta el Web Push despachado',
    unit: 'ms',
  });

/** tipo_combustible → enum de Routes API (los 4 valores que acepta). */
export function combustibleARoutesEmissionType(
  combustible: string | null,
): VehicleEmissionType | undefined {
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

/** Texto de la notificación: corto, legible manejando (lo lee la PWA o el SO). */
export function textoSugerencia(ahorroSegundos: number, ahorroKgco2e: number | null): string {
  const partes: string[] = [];
  const min = Math.round(Math.abs(ahorroSegundos) / 60);
  if (min >= 1) {
    partes.push(ahorroSegundos > 0 ? `${min} min menos` : `${min} min más`);
  }
  if (ahorroKgco2e !== null && ahorroKgco2e > 0) {
    partes.push(`${ahorroKgco2e.toFixed(1).replace('.', ',')} kg CO₂e menos`);
  }
  return partes.length > 0
    ? `Hay una ruta alternativa: ${partes.join(' y ')}.`
    : 'Hay una ruta alternativa con menos emisiones.';
}

function aRutaCandidata(r: RouteSuggestion): RutaCandidata {
  return {
    duracionSegundos: r.durationS,
    distanciaKm: r.distanceKm,
    combustibleL: r.fuelL,
    polylineCodificada: r.polylineEncoded,
  };
}

async function cargarPosiciones(
  db: Db,
  ctx: { assignmentId: string; vehicleId: string | null },
  desde: Date,
): Promise<MuestraPosicion[]> {
  // rls-allowlist: scope por asignación del conductor (caller ya autorizado)
  const movil = await db
    .select({
      ts: posicionesMovilConductor.timestampDevice,
      lat: posicionesMovilConductor.latitude,
      lng: posicionesMovilConductor.longitude,
      speed: posicionesMovilConductor.speedKmh,
    })
    .from(posicionesMovilConductor)
    .where(
      and(
        eq(posicionesMovilConductor.assignmentId, ctx.assignmentId),
        gte(posicionesMovilConductor.timestampDevice, desde),
      ),
    );
  const teltonika = ctx.vehicleId
    ? // rls-allowlist: scope por el vehículo de la asignación (caller ya autorizado)
      await db
        .select({
          ts: telemetryPoints.timestampDevice,
          lat: telemetryPoints.latitude,
          lng: telemetryPoints.longitude,
          speed: telemetryPoints.speedKmh,
        })
        .from(telemetryPoints)
        .where(
          and(
            eq(telemetryPoints.vehicleId, ctx.vehicleId),
            gte(telemetryPoints.timestampDevice, desde),
          ),
        )
    : [];
  const muestras: MuestraPosicion[] = [];
  for (const p of movil) {
    muestras.push({
      tsMs: p.ts.getTime(),
      lat: Number(p.lat),
      lng: Number(p.lng),
      velocidadKmh: p.speed === null ? null : Number(p.speed),
    });
  }
  for (const p of teltonika) {
    if (p.lat === null || p.lng === null) {
      continue; // sin fix GPS
    }
    muestras.push({
      tsMs: p.ts.getTime(),
      lat: Number(p.lat),
      lng: Number(p.lng),
      velocidadKmh: p.speed,
    });
  }
  return muestras;
}

export async function evaluarEcoRoutingAsignacion(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  routesProjectId?: string | undefined;
  deps: EcoRoutingDeps;
}): Promise<ResultadoEcoRouting> {
  return withBusinessSpan(
    { name: 'eco_routing.evaluar', attributes: { 'booster.assignment_id': opts.assignmentId } },
    async (span) => {
      const r = await evaluarInterno(opts);
      sugerenciasCounter().add(1, { resultado: r.resultado });
      setResultAttributes(span, { 'booster.eco_routing.resultado': r.resultado });
      return r;
    },
  );
}

async function evaluarInterno(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  routesProjectId?: string | undefined;
  deps: EcoRoutingDeps;
}): Promise<ResultadoEcoRouting> {
  const { db, logger, assignmentId, deps } = opts;
  const ahoraMs = deps.now();

  const ultima = deps.throttle.get(assignmentId);
  if (ultima !== undefined && ahoraMs - ultima < ECO_ROUTING_THROTTLE_MS) {
    return { resultado: 'throttle' };
  }
  deps.throttle.set(assignmentId, ahoraMs);

  // rls-allowlist: scope por asignación del conductor (caller ya autorizado)
  const [ctx] = await db
    .select({
      status: assignments.status,
      driverUserId: assignments.driverUserId,
      vehicleId: assignments.vehicleId,
      tripId: trips.id,
      originLatitude: trips.originLatitude,
      originLongitude: trips.originLongitude,
      destinationAddressRaw: trips.destinationAddressRaw,
      fuelType: vehicles.fuelType,
      consumo: vehicles.consumptionLPer100kmBaseline,
    })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  if (!ctx || ctx.status !== 'recogido' || !ctx.driverUserId) {
    return { resultado: 'viaje_no_activo' };
  }

  // rls-allowlist: scope por asignación del conductor (caller ya autorizado)
  const [reciente] = await db
    .select({ id: sugerenciasRuta.id })
    .from(sugerenciasRuta)
    .where(
      and(
        eq(sugerenciasRuta.assignmentId, assignmentId),
        gte(sugerenciasRuta.detectedAt, new Date(ahoraMs - ECO_ROUTING_COOLDOWN_MS)),
      ),
    )
    .limit(1);
  if (reciente) {
    return { resultado: 'cooldown' };
  }

  const muestras = await cargarPosiciones(
    db,
    { assignmentId, vehicleId: ctx.vehicleId },
    new Date(ahoraMs - VENTANA_POSICIONES_MS),
  );
  const origen =
    ctx.originLatitude !== null && ctx.originLongitude !== null
      ? [{ lat: Number(ctx.originLatitude), lng: Number(ctx.originLongitude) }]
      : [];
  const deteccion = detectarCongestion(muestras, { ahoraMs, zonasExcluidas: origen });
  if (!deteccion.congestion) {
    return { resultado: 'sin_congestion', razon: deteccion.razon };
  }

  let rutas: RouteSuggestion[];
  try {
    rutas = await deps.computeRoutes({
      projectId: opts.routesProjectId ?? '',
      origin: deteccion.posicion,
      destination: ctx.destinationAddressRaw,
      computeAlternatives: true,
      ...(combustibleARoutesEmissionType(ctx.fuelType)
        ? { emissionType: combustibleARoutesEmissionType(ctx.fuelType) }
        : {}),
      logger,
    });
  } catch (err) {
    if (err instanceof RoutesApiError) {
      logger.warn(
        { err, assignmentId, code: err.code },
        'eco-routing: Routes API falló, se reintenta en la próxima posición',
      );
      return { resultado: 'error_routes' };
    }
    throw err;
  }

  const [actual, ...alternativas] = rutas;
  const evaluacion = actual
    ? evaluarAlternativas({
        actual: aRutaCandidata(actual),
        alternativas: alternativas.map(aRutaCandidata),
        combustible: ctx.fuelType ?? 'diesel',
        consumoBaseLPor100km: ctx.consumo === null ? null : Number(ctx.consumo),
      })
    : ({ tipo: 'ninguna', razon: 'sin_alternativas' } as const);

  const base = {
    assignmentId,
    tripId: ctx.tripId,
    congestionDesde: new Date(deteccion.desdeMs),
    detectedAt: new Date(ahoraMs),
    latitude: deteccion.posicion.lat.toFixed(7),
    longitude: deteccion.posicion.lng.toFixed(7),
    averageSpeedKmh: deteccion.velocidadMediaKmh.toFixed(2),
  };

  if (evaluacion.tipo === 'ninguna') {
    const [fila] = await db
      .insert(sugerenciasRuta)
      .values({ ...base, estado: 'congestion_sin_alternativa' })
      .returning({ id: sugerenciasRuta.id });
    logger.info(
      { assignmentId, razon: evaluacion.razon },
      'eco-routing: congestión sin alternativa material',
    );
    return { resultado: 'congestion_sin_alternativa', sugerenciaId: fila?.id ?? '' };
  }

  const [fila] = await db
    .insert(sugerenciasRuta)
    .values({
      ...base,
      estado: 'sugerida',
      motivo: evaluacion.motivo,
      alternativePolyline: evaluacion.alternativa.polylineCodificada,
      savingSeconds: Math.round(evaluacion.ahorroSegundos),
      savingKgco2e: evaluacion.ahorroKgco2e === null ? null : evaluacion.ahorroKgco2e.toFixed(3),
      currentKgco2e: evaluacion.kgco2eActual === null ? null : evaluacion.kgco2eActual.toFixed(3),
    })
    .returning({ id: sugerenciasRuta.id });
  if (!fila) {
    throw new Error('eco-routing: el INSERT de la sugerencia no devolvió fila');
  }

  const inicioEntrega = deps.now();
  const push = await deps.sendPush({
    userId: ctx.driverUserId,
    payload: {
      title: 'Congestión en tu ruta',
      body: textoSugerencia(evaluacion.ahorroSegundos, evaluacion.ahorroKgco2e),
      tag: `eco-routing-${assignmentId}`,
      data: {
        tipo: 'sugerencia_ruta',
        assignment_id: assignmentId,
        sugerencia_id: fila.id,
        url: `/app/conductor?sugerencia=${fila.id}`,
      },
      actions: [
        { action: 'aceptar', title: 'Aceptar' },
        { action: 'seguir', title: 'Seguir mi ruta' },
      ],
    },
  });
  if (push.sent > 0) {
    const enviadaEn = deps.now();
    entregaHistogram().record(enviadaEn - inicioEntrega);
    // rls-allowlist: fila recién creada por este mismo flujo
    await db
      .update(sugerenciasRuta)
      .set({ sentAt: new Date(enviadaEn) })
      .where(eq(sugerenciasRuta.id, fila.id));
  } else {
    logger.info(
      { assignmentId, sugerenciaId: fila.id },
      'eco-routing: conductor sin suscripción push activa',
    );
  }
  return { resultado: 'sugerida', sugerenciaId: fila.id, pushEnviados: push.sent };
}

/**
 * Barrido por minuto (Cloud Scheduler → `POST /admin/jobs/eco-routing-barrido`)
 * para los viajes con Teltonika: con equipo en el camión la PWA no reporta
 * posición (la huella se mide con el equipo), así que el disparo desde
 * `driver-position` nunca correría. Evalúa cada asignación `recogido` cuyo
 * vehículo tiene IMEI; el throttle y el cooldown del flujo normal aplican igual.
 */
export async function barrerEcoRoutingTeltonika(opts: {
  db: Db;
  logger: Logger;
  routesProjectId?: string | undefined;
  deps: EcoRoutingDeps;
}): Promise<{ evaluadas: number; resultados: Record<string, number> }> {
  // rls-allowlist: job interno de plataforma (OIDC del scheduler), cross-empresa por diseño
  const activas = await opts.db
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
    .where(and(eq(assignments.status, 'recogido'), isNotNull(vehicles.teltonikaImei)));
  const resultados: Record<string, number> = {};
  for (const a of activas) {
    try {
      const r = await evaluarEcoRoutingAsignacion({
        db: opts.db,
        logger: opts.logger,
        assignmentId: a.id,
        routesProjectId: opts.routesProjectId,
        deps: opts.deps,
      });
      resultados[r.resultado] = (resultados[r.resultado] ?? 0) + 1;
    } catch (err) {
      // Una asignación que falla no corta el barrido de las demás.
      opts.logger.error({ err, assignmentId: a.id }, 'eco-routing barrido: la evaluación falló');
      resultados.error = (resultados.error ?? 0) + 1;
    }
  }
  return { evaluadas: activas.length, resultados };
}

export interface SugerenciaRutaActiva {
  id: string;
  motivo: 'emisiones' | 'tiempo';
  polylineAlternativa: string;
  ahorroSegundos: number;
  ahorroKgco2e: number | null;
  detectadaEn: Date;
  texto: string;
}

/** Última sugerencia sin responder de la asignación, si sigue vigente (15 min). */
export async function obtenerSugerenciaRutaActiva(opts: {
  db: Db;
  assignmentId: string;
  userId: string;
  nowMs: number;
}): Promise<SugerenciaRutaActiva | null> {
  // rls-allowlist: scope por asignación + conductor asignado
  const [fila] = await opts.db
    .select({
      id: sugerenciasRuta.id,
      motivo: sugerenciasRuta.motivo,
      polyline: sugerenciasRuta.alternativePolyline,
      ahorroSegundos: sugerenciasRuta.savingSeconds,
      ahorroKgco2e: sugerenciasRuta.savingKgco2e,
      detectadaEn: sugerenciasRuta.detectedAt,
    })
    .from(sugerenciasRuta)
    .innerJoin(assignments, eq(assignments.id, sugerenciasRuta.assignmentId))
    .where(
      and(
        eq(sugerenciasRuta.assignmentId, opts.assignmentId),
        eq(assignments.driverUserId, opts.userId),
        eq(sugerenciasRuta.estado, 'sugerida'),
        isNull(sugerenciasRuta.respuesta),
        gte(sugerenciasRuta.detectedAt, new Date(opts.nowMs - ECO_ROUTING_COOLDOWN_MS)),
      ),
    )
    .orderBy(desc(sugerenciasRuta.detectedAt))
    .limit(1);
  if (!fila || fila.motivo === null || fila.polyline === null || fila.ahorroSegundos === null) {
    return null;
  }
  const ahorroKgco2e = fila.ahorroKgco2e === null ? null : Number(fila.ahorroKgco2e);
  return {
    id: fila.id,
    motivo: fila.motivo,
    polylineAlternativa: fila.polyline,
    ahorroSegundos: fila.ahorroSegundos,
    ahorroKgco2e,
    detectadaEn: fila.detectadaEn,
    texto: textoSugerencia(fila.ahorroSegundos, ahorroKgco2e),
  };
}

export type ResultadoRespuesta = 'ok' | 'not_found' | 'forbidden' | 'ya_respondida';

/** Registra Aceptar / Seguir del conductor. Una sola vez (UPDATE condicionado). */
export async function registrarRespuestaSugerenciaRuta(opts: {
  db: Db;
  assignmentId: string;
  sugerenciaId: string;
  userId: string;
  respuesta: 'aceptada' | 'rechazada';
  nowMs: number;
}): Promise<ResultadoRespuesta> {
  // rls-allowlist: scope por asignación; la autorización es el conductor asignado
  const [fila] = await opts.db
    .select({
      driverUserId: assignments.driverUserId,
      estado: sugerenciasRuta.estado,
      respuesta: sugerenciasRuta.respuesta,
    })
    .from(sugerenciasRuta)
    .innerJoin(assignments, eq(assignments.id, sugerenciasRuta.assignmentId))
    .where(
      and(
        eq(sugerenciasRuta.id, opts.sugerenciaId),
        eq(sugerenciasRuta.assignmentId, opts.assignmentId),
      ),
    )
    .limit(1);
  if (!fila || fila.estado !== 'sugerida') {
    return 'not_found';
  }
  if (fila.driverUserId !== opts.userId) {
    return 'forbidden';
  }
  if (fila.respuesta !== null) {
    return 'ya_respondida';
  }
  // rls-allowlist: misma fila validada arriba; respuesta IS NULL evita carreras
  const actualizadas = await opts.db
    .update(sugerenciasRuta)
    .set({ respuesta: opts.respuesta, respondedAt: new Date(opts.nowMs) })
    .where(and(eq(sugerenciasRuta.id, opts.sugerenciaId), isNull(sugerenciasRuta.respuesta)))
    .returning({ id: sugerenciasRuta.id });
  if (actualizadas.length === 0) {
    return 'ya_respondida';
  }
  respuestasCounter().add(1, { respuesta: opts.respuesta });
  return 'ok';
}
