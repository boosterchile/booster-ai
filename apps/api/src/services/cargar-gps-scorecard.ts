/**
 * Lee la cohorte medible y calcula el scorecard. No cierra viajes y no
 * toca `cobertura_pct`. Pensado como batch: el camino de un request no lo llama.
 *
 * Cohorte teléfono: asignaciones de empresas reales, con recogida dentro de
 * la retención de `posiciones_movil_conductor` y con entrega o cancelación.
 * Flota: vehículos con ≥1 recogida en 30 días (el viaje puede seguir abierto).
 * Heartbeat: ≥1 fila en `telemetria_puntos` en 7 días. No hay otra tabla.
 */

import type { Logger } from '@booster-ai/logger';
import { and, eq, gte, inArray, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  assignments,
  empresas,
  posicionesMovilConductor,
  telemetryPoints,
  vehicles,
} from '../db/schema.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  type AnclasScorecard,
  type AsignacionCerradaFila,
  type DecisionScorecard,
  type EvaluacionTelefonoViaje,
  FUENTE_EDAD_POSICION,
  type HechoVehiculoFlota,
  type InstrumentosScorecard,
  type PosicionMovilFila,
  type PuntoTeltonikaFila,
  type ResumenCoberturaTelefono,
  type ResumenDual,
  type ResumenFlotaTeltonika,
  type ResumenGaps,
  TAMANO_TROZO_SCORECARD,
  anclasScorecard,
  armarViajesScorecard,
  decidirScorecardGps,
  emitirMetricasScorecardGps,
  esEmpresaCohorteProd,
  evaluarCohorteTelefono,
  resumirFlotaTeltonika,
  trocear,
} from './gps-scorecard-medio-plazo.js';

export interface ScorecardMedioPlazo {
  fuenteEdad: typeof FUENTE_EDAD_POSICION;
  anclas: AnclasScorecard;
  precondicionNavWakeLockEstable: boolean;
  viajesEvaluados: number;
  viajesDescartados: number;
  evaluaciones: readonly EvaluacionTelefonoViaje[];
  telefono: { cobertura: ResumenCoberturaTelefono; gaps: ResumenGaps };
  flota: ResumenFlotaTeltonika;
  dual: ResumenDual;
  decision: DecisionScorecard;
}

function enteroObligatorio(value: unknown, campo: string): number {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) {
    throw new Error(`conteo invalido en ${campo}`);
  }
  return n;
}

function ms(fecha: Date | null): number | null {
  if (fecha == null) {
    return null;
  }
  const valor = fecha.getTime();
  return Number.isFinite(valor) ? valor : null;
}

function precisionDeFila(raw: string | null): number | null {
  if (raw == null) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function coord(raw: string | null): number | null {
  if (raw == null) {
    return null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function cargarEnTrozos<T>(
  ids: readonly string[],
  tamano: number,
  cargar: (trozo: readonly string[]) => Promise<T[]>,
): Promise<T[]> {
  const todo: T[] = [];
  for (const trozo of trocear(ids, tamano)) {
    const filas = await cargar(trozo);
    for (const fila of filas) {
      todo.push(fila);
    }
  }
  return todo;
}

export async function cargarScorecardMedioPlazo(opts: {
  db: Db;
  logger: Logger;
  ahora: Date;
  precondicionNavWakeLockEstable?: boolean;
  instrumentos?: InstrumentosScorecard;
  tamanoTrozo?: number;
}): Promise<ScorecardMedioPlazo> {
  const ahoraMs = opts.ahora.getTime();
  const anclas = anclasScorecard(ahoraMs);
  const precondicion = opts.precondicionNavWakeLockEstable ?? false;
  const tamano = opts.tamanoTrozo ?? TAMANO_TROZO_SCORECARD;
  const piso = new Date(anclas.pisoPosicionesMs);
  const flotaDesde = new Date(anclas.flotaDesdeMs);
  const heartbeatDesde = new Date(anclas.heartbeatDesdeMs);

  return withBusinessSpan(
    { name: 'gps_scorecard.medio_plazo', attributes: { fuente_edad: FUENTE_EDAD_POSICION } },
    async (span) => {
      const cerrado = or(isNotNull(assignments.deliveredAt), isNotNull(assignments.cancelledAt));
      if (!cerrado) {
        throw new Error('filtro de cierre invalido');
      }

      const filasAsignacion = await opts.db
        .select({
          viajeId: assignments.tripId,
          asignacionId: assignments.id,
          vehicleId: assignments.vehicleId,
          teltonikaImei: vehicles.teltonikaImei,
          esDemo: empresas.isDemo,
          esUsuarioPrueba: empresas.isTestUser,
          recogidoEn: assignments.pickedUpAt,
          entregadoEn: assignments.deliveredAt,
          canceladoEn: assignments.cancelledAt,
        })
        .from(assignments)
        .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
        .innerJoin(empresas, eq(empresas.id, assignments.empresaId))
        .where(
          and(
            isNotNull(assignments.pickedUpAt),
            gte(assignments.pickedUpAt, piso),
            cerrado,
            eq(empresas.isDemo, false),
            eq(empresas.isTestUser, false),
          ),
        );

      const asignaciones: AsignacionCerradaFila[] = [];
      for (const fila of filasAsignacion) {
        const recogidoEnMs = ms(fila.recogidoEn);
        if (recogidoEnMs == null) {
          continue;
        }
        asignaciones.push({
          viajeId: fila.viajeId,
          asignacionId: fila.asignacionId,
          vehicleId: fila.vehicleId,
          teltonikaImei: fila.teltonikaImei,
          esDemo: fila.esDemo,
          esUsuarioPrueba: fila.esUsuarioPrueba,
          recogidoEnMs,
          entregadoEnMs: ms(fila.entregadoEn),
          canceladoEnMs: ms(fila.canceladoEn),
        });
      }

      const prod = asignaciones.filter((fila) => esEmpresaCohorteProd(fila));
      const inicios = prod.map((fila) => fila.recogidoEnMs);
      const fines = prod.map(
        (fila) => fila.entregadoEnMs ?? fila.canceladoEnMs ?? fila.recogidoEnMs,
      );
      const desdeMs = inicios.length > 0 ? Math.min(...inicios) : anclas.ahoraMs;
      const hastaMs = fines.length > 0 ? Math.max(...fines) : anclas.ahoraMs;
      const desde = new Date(desdeMs);
      const hasta = new Date(hastaMs);
      const vehicleIds = [...new Set(prod.map((fila) => fila.vehicleId))];
      const vehicleIdsConImei = [
        ...new Set(
          prod
            .filter((fila) => fila.teltonikaImei != null && fila.teltonikaImei.trim() !== '')
            .map((fila) => fila.vehicleId),
        ),
      ];

      const posiciones = await cargarEnTrozos(vehicleIds, tamano, async (trozo) => {
        const filas = await opts.db
          .select({
            asignacionId: posicionesMovilConductor.assignmentId,
            timestampDevice: posicionesMovilConductor.timestampDevice,
            timestampRecibido: posicionesMovilConductor.timestampReceivedAt,
            precisionM: posicionesMovilConductor.accuracyM,
            lat: posicionesMovilConductor.latitude,
            lng: posicionesMovilConductor.longitude,
          })
          .from(posicionesMovilConductor)
          .where(
            and(
              inArray(posicionesMovilConductor.vehicleId, [...trozo]),
              gte(posicionesMovilConductor.timestampDevice, desde),
              lte(posicionesMovilConductor.timestampDevice, hasta),
            ),
          );
        const mapeadas: PosicionMovilFila[] = [];
        for (const fila of filas) {
          if (fila.asignacionId == null) {
            continue;
          }
          const timestampDeviceMs = ms(fila.timestampDevice);
          const timestampRecibidoMs = ms(fila.timestampRecibido);
          const lat = coord(fila.lat);
          const lng = coord(fila.lng);
          if (
            timestampDeviceMs == null ||
            timestampRecibidoMs == null ||
            lat == null ||
            lng == null
          ) {
            continue;
          }
          mapeadas.push({
            asignacionId: fila.asignacionId,
            timestampDeviceMs,
            timestampRecibidoMs,
            precisionM: precisionDeFila(fila.precisionM),
            lat,
            lng,
          });
        }
        return mapeadas;
      });

      const puntosTeltonika = await cargarEnTrozos(vehicleIdsConImei, tamano, async (trozo) => {
        const filas = await opts.db
          .select({
            vehicleId: telemetryPoints.vehicleId,
            timestampDevice: telemetryPoints.timestampDevice,
            timestampRecibido: telemetryPoints.timestampReceivedAt,
            lat: telemetryPoints.latitude,
            lng: telemetryPoints.longitude,
          })
          .from(telemetryPoints)
          .where(
            and(
              inArray(telemetryPoints.vehicleId, [...trozo]),
              gte(telemetryPoints.timestampDevice, desde),
              lte(telemetryPoints.timestampDevice, hasta),
            ),
          );
        const mapeadas: PuntoTeltonikaFila[] = [];
        for (const fila of filas) {
          const timestampDeviceMs = ms(fila.timestampDevice);
          const timestampRecibidoMs = ms(fila.timestampRecibido);
          const lat = coord(fila.lat);
          const lng = coord(fila.lng);
          if (
            timestampDeviceMs == null ||
            timestampRecibidoMs == null ||
            lat == null ||
            lng == null
          ) {
            continue;
          }
          mapeadas.push({
            vehicleId: fila.vehicleId,
            timestampDeviceMs,
            timestampRecibidoMs,
            lat,
            lng,
          });
        }
        return mapeadas;
      });

      const armado = armarViajesScorecard({ asignaciones: prod, posiciones, puntosTeltonika });
      const cohorte = evaluarCohorteTelefono(armado.viajes);

      const filasFlota = await opts.db
        .select({
          vehicleId: assignments.vehicleId,
          teltonikaImei: vehicles.teltonikaImei,
          esDemo: empresas.isDemo,
          esUsuarioPrueba: empresas.isTestUser,
        })
        .from(assignments)
        .innerJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
        .innerJoin(empresas, eq(empresas.id, assignments.empresaId))
        .where(
          and(
            isNotNull(assignments.pickedUpAt),
            gte(assignments.pickedUpAt, flotaDesde),
            eq(empresas.isDemo, false),
            eq(empresas.isTestUser, false),
          ),
        );

      const flotaPorVehiculo = new Map<string, { teltonikaImei: string | null }>();
      for (const fila of filasFlota) {
        if (!esEmpresaCohorteProd(fila)) {
          continue;
        }
        flotaPorVehiculo.set(fila.vehicleId, { teltonikaImei: fila.teltonikaImei });
      }

      const idsConDevice = [...flotaPorVehiculo.entries()]
        .filter(([, datos]) => datos.teltonikaImei != null && datos.teltonikaImei.trim() !== '')
        .map(([vehicleId]) => vehicleId);
      const conteos = await cargarEnTrozos(idsConDevice, tamano, async (trozo) => {
        const filas = await opts.db
          .select({
            vehicleId: telemetryPoints.vehicleId,
            n: sql<number>`count(*)::int`,
          })
          .from(telemetryPoints)
          .where(
            and(
              inArray(telemetryPoints.vehicleId, [...trozo]),
              gte(telemetryPoints.timestampDevice, heartbeatDesde),
            ),
          )
          .groupBy(telemetryPoints.vehicleId);
        return filas.map((fila) => ({
          vehicleId: fila.vehicleId,
          n: enteroObligatorio(fila.n, 'heartbeats7d'),
        }));
      });
      const heartbeatPorVehiculo = new Map(conteos.map((fila) => [fila.vehicleId, fila.n]));

      const hechos: HechoVehiculoFlota[] = [];
      for (const [vehicleId, datos] of flotaPorVehiculo) {
        const tieneDevice = datos.teltonikaImei != null && datos.teltonikaImei.trim() !== '';
        const medido = heartbeatPorVehiculo.get(vehicleId);
        hechos.push({
          vehicleId,
          tuvoViaje30d: true,
          teltonikaImei: datos.teltonikaImei,
          // Sin device no hace falta el conteo. Con device, ausencia en el
          // GROUP BY es 0 filas medidas, no un hueco de la consulta.
          heartbeats7d: tieneDevice ? (medido ?? 0) : null,
        });
      }
      const flota = resumirFlotaTeltonika(hechos);
      const decision = decidirScorecardGps({
        cobertura: cohorte.cobertura,
        gaps: cohorte.gaps,
        flota,
        precondicionNavWakeLockEstable: precondicion,
      });

      emitirMetricasScorecardGps(
        { evaluaciones: cohorte.evaluaciones, flotaPct: flota.pct },
        opts.instrumentos,
      );

      const resultado: ScorecardMedioPlazo = {
        fuenteEdad: FUENTE_EDAD_POSICION,
        anclas,
        precondicionNavWakeLockEstable: precondicion,
        viajesEvaluados: cohorte.evaluaciones.length,
        viajesDescartados: armado.descartados,
        evaluaciones: cohorte.evaluaciones,
        telefono: { cobertura: cohorte.cobertura, gaps: cohorte.gaps },
        flota,
        dual: cohorte.dual,
        decision,
      };

      opts.logger.info(
        {
          viajesEvaluados: resultado.viajesEvaluados,
          viajesDescartados: resultado.viajesDescartados,
          medianaCoberturaPct: resultado.telefono.cobertura.medianaPct,
          pctViajesConGapSobre5Min: resultado.telefono.gaps.pctViajesConGapSobre5Min,
          gapsSobre15Min: resultado.telefono.gaps.gapsSobre15Min,
          flotaPct: resultado.flota.pct,
          flotaCompuerta: resultado.flota.compuerta,
          dualComparados: resultado.dual.viajesComparados,
          decisionNativo: resultado.decision.nativo,
          decisionTeltonika: resultado.decision.teltonikaPrimero,
          fuenteEdad: resultado.fuenteEdad,
        },
        'scorecard gps medio plazo calculado',
      );
      setResultAttributes(span, {
        viajes_evaluados: resultado.viajesEvaluados,
        viajes_descartados: resultado.viajesDescartados,
        mediana_cobertura_pct: resultado.telefono.cobertura.medianaPct ?? undefined,
        compuerta_cobertura: resultado.telefono.cobertura.compuerta,
        compuerta_gaps: resultado.telefono.gaps.compuerta,
        compuerta_flota: resultado.flota.compuerta,
        decision_nativo: resultado.decision.nativo,
        decision_teltonika: resultado.decision.teltonikaPrimero,
      });
      return resultado;
    },
  );
}
