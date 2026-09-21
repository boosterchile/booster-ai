/**
 * Scorecard GPS de medio plazo (teléfono vs Teltonika).
 *
 * Mide cuatro KPIs de producto. No escribe `metricas_viaje.cobertura_pct`,
 * no usa el hueco de 60 s de ADR-028 (`CONTINUITY_GAP_S`) y no decide el
 * stack: `decidirScorecardGps` deja `cambiaStack: false` siempre.
 *
 * Edad. El KPI pide un fix con edad ≤ 90 s. La tabla
 * `posiciones_movil_conductor` no guarda la edad de captura del
 * `GeolocationPosition`. Lo único persistido es el desfase
 * `timestamp_recibido_en - timestamp_device` (`FUENTE_EDAD_POSICION`).
 * La cola offline puede entregar un fix bueno con más de 90 s de retraso:
 * ese proxy subestima la cobertura. Quien lee la compuerta tiene que ver
 * `sesgoEdad`.
 */

import { getBusinessCounter, getBusinessHistogram } from '../observability/business-metrics.js';
import { esCoordenadaGpsValida } from './coordenada-gps.js';
import { RETENCION_POSICIONES_MOVIL_DIAS } from './purgar-posiciones-movil.js';

const MS_POR_DIA = 86_400_000;

/** Ventana de muestreo del tiempo activo. */
export const VENTANA_COBERTURA_MS = 120_000;
/** Fix usable / fresco solo si su edad es ≤ este valor. */
export const EDAD_MAX_POSICION_MS = 90_000;
/** Precisión máxima del teléfono, inclusive. `0` y null no son un radio real. */
export const PRECISION_MAX_M = 50;
/** Hueco continuo sin posición usable que cuenta para la compuerta. */
export const GAP_LARGO_MS = 5 * 60_000;
/** Hueco que operaciones trata como P0. También cuenta como gap largo. */
export const GAP_P0_MS = 15 * 60_000;
export const MUESTRA_MIN_VIAJES_PROD = 30;
export const COMPUERTA_MEDIANA_COBERTURA_PCT = 85;
/** Estrictamente menor que este porcentaje de viajes. */
export const COMPUERTA_GAPS_LARGOS_PCT = 15;
export const COMPUERTA_FLOTA_TELTONIKA_PCT = 40;
export const VENTANA_FLOTA_DIAS = 30;
export const HEARTBEAT_DIAS = 7;

export const FUENTE_EDAD_POSICION = 'desfase_recepcion_ms' as const;

export const TAMANO_TROZO_SCORECARD = 200;

export interface IntervaloActivo {
  /** `asignaciones.recogido_en`. No hay marca distinta de «abrió la nav». */
  inicioMs: number;
  /** El primer instante terminal: `entregado_en` o `cancelado_en`. */
  finMs: number;
}

export interface PosicionTelefono {
  timestampMs: number;
  /** null = precisión desconocida. No es usable. */
  precisionM: number | null;
  edadMs: number;
}

export interface PuntoFresco {
  timestampMs: number;
  edadMs: number;
}

export interface ViajeParaScorecard {
  viajeId: string;
  intervalo: IntervaloActivo;
  posicionesTelefono: readonly PosicionTelefono[];
  /**
   * null = el vehículo no tiene `teltonika_imei` propio (el espejo no cuenta).
   * [] = hay device y ningún punto con coordenada válida dentro del tramo.
   */
  puntosTeltonika: readonly PuntoFresco[] | null;
}

export interface AnclasScorecard {
  ahoraMs: number;
  pisoPosicionesMs: number;
  flotaDesdeMs: number;
  heartbeatDesdeMs: number;
}

export function anclasScorecard(ahoraMs: number): AnclasScorecard {
  if (!Number.isFinite(ahoraMs)) {
    throw new Error('ahora invalido');
  }
  return {
    ahoraMs,
    pisoPosicionesMs: ahoraMs - RETENCION_POSICIONES_MOVIL_DIAS * MS_POR_DIA,
    flotaDesdeMs: ahoraMs - VENTANA_FLOTA_DIAS * MS_POR_DIA,
    heartbeatDesdeMs: ahoraMs - HEARTBEAT_DIAS * MS_POR_DIA,
  };
}

export function edadRecepcionMs(timestampDeviceMs: number, timestampRecibidoMs: number): number {
  return timestampRecibidoMs - timestampDeviceMs;
}

/**
 * Arranque de ruta = recogida confirmada. Fin = entrega o cancelación, el
 * que ocurra primero. Sin recogida, sin cierre, o con duración nula: no hay
 * tiempo activo que medir.
 */
export function intervaloActivoViaje(input: {
  recogidoEnMs: number | null;
  entregadoEnMs: number | null;
  canceladoEnMs: number | null;
}): IntervaloActivo | null {
  if (input.recogidoEnMs == null || !Number.isFinite(input.recogidoEnMs)) {
    return null;
  }
  const candidatos = [input.entregadoEnMs, input.canceladoEnMs].filter(
    (valor): valor is number => valor != null && Number.isFinite(valor),
  );
  if (candidatos.length === 0) {
    return null;
  }
  const finMs = Math.min(...candidatos);
  if (finMs <= input.recogidoEnMs) {
    return null;
  }
  return { inicioMs: input.recogidoEnMs, finMs };
}

export function esPosicionTelefonoUsable(posicion: PosicionTelefono): boolean {
  if (!Number.isFinite(posicion.timestampMs)) {
    return false;
  }
  if (posicion.precisionM == null || !Number.isFinite(posicion.precisionM)) {
    return false;
  }
  if (posicion.precisionM <= 0 || posicion.precisionM > PRECISION_MAX_M) {
    return false;
  }
  if (!Number.isFinite(posicion.edadMs) || posicion.edadMs > EDAD_MAX_POSICION_MS) {
    return false;
  }
  return true;
}

/** Teltonika no tiene `precision_m`. Fresco = edad ≤ 90 s y coordenada ya filtrada. */
export function esPuntoFresco(punto: PuntoFresco): boolean {
  return (
    Number.isFinite(punto.timestampMs) &&
    Number.isFinite(punto.edadMs) &&
    punto.edadMs <= EDAD_MAX_POSICION_MS
  );
}

export interface CoberturaVentanas {
  activoMs: number;
  cubiertoMs: number;
  pct: number;
  ventanas: number;
  ventanasCubiertas: number;
}

/**
 * Parte `[inicio, fin]` en ventanas de 2 min alineadas al arranque. La
 * última puede ser más corta y es la única con extremo final inclusivo.
 * Una ventana suma su duración si contiene ≥1 marca.
 */
export function coberturaPorMarcas(
  intervalo: IntervaloActivo,
  timestampsMs: readonly number[],
): CoberturaVentanas {
  if (intervalo.finMs <= intervalo.inicioMs) {
    throw new Error('intervalo activo invalido');
  }
  const marcas = timestampsMs
    .filter((t) => Number.isFinite(t) && t >= intervalo.inicioMs && t <= intervalo.finMs)
    .sort((a, b) => a - b);

  let activoMs = 0;
  let cubiertoMs = 0;
  let ventanas = 0;
  let ventanasCubiertas = 0;
  let cursor = intervalo.inicioMs;
  let idx = 0;

  while (cursor < intervalo.finMs) {
    const finVentana = Math.min(cursor + VENTANA_COBERTURA_MS, intervalo.finMs);
    const duracion = finVentana - cursor;
    const inclusivo = finVentana === intervalo.finMs;
    activoMs += duracion;
    ventanas += 1;

    while (idx < marcas.length) {
      const anterior = marcas[idx];
      if (anterior === undefined || anterior >= cursor) {
        break;
      }
      idx += 1;
    }

    const marca = marcas[idx];
    const cubierta = marca !== undefined && (inclusivo ? marca <= finVentana : marca < finVentana);

    if (cubierta) {
      cubiertoMs += duracion;
      ventanasCubiertas += 1;
    }
    cursor = finVentana;
  }

  return {
    activoMs,
    cubiertoMs,
    pct: (cubiertoMs / activoMs) * 100,
    ventanas,
    ventanasCubiertas,
  };
}

export function contarGapsSinPosicion(
  intervalo: IntervaloActivo,
  timestampsUsablesMs: readonly number[],
): { sobre5Min: number; sobre15Min: number } {
  if (intervalo.finMs <= intervalo.inicioMs) {
    throw new Error('intervalo activo invalido');
  }
  const instantes = [
    ...new Set(
      timestampsUsablesMs.filter(
        (t) => Number.isFinite(t) && t >= intervalo.inicioMs && t <= intervalo.finMs,
      ),
    ),
  ].sort((a, b) => a - b);
  const marcas = [intervalo.inicioMs, ...instantes, intervalo.finMs];
  let sobre5Min = 0;
  let sobre15Min = 0;
  for (let i = 1; i < marcas.length; i += 1) {
    const prev = marcas[i - 1];
    const curr = marcas[i];
    if (prev === undefined || curr === undefined) {
      continue;
    }
    const gap = curr - prev;
    if (gap > GAP_LARGO_MS) {
      sobre5Min += 1;
    }
    if (gap > GAP_P0_MS) {
      sobre15Min += 1;
    }
  }
  return { sobre5Min, sobre15Min };
}

export type DualViaje =
  | { viajeId: string; estado: 'sin_par' }
  | {
      viajeId: string;
      estado: 'comparado';
      pctTiempoTeltonikaFresco: number;
      pctTiempoTelefonoUsable: number;
      deltaTeltonikaMenosTelefonoPct: number;
    };

export interface EvaluacionTelefonoViaje {
  viajeId: string;
  coberturaPct: number;
  activoMs: number;
  cubiertoMs: number;
  ventanas: number;
  ventanasCubiertas: number;
  gapsSobre5Min: number;
  gapsSobre15Min: number;
  tieneGapSobre5Min: boolean;
  tieneGapSobre15Min: boolean;
  dual: DualViaje;
}

function timestampsUsables(posiciones: readonly PosicionTelefono[]): number[] {
  const marcas: number[] = [];
  for (const posicion of posiciones) {
    if (esPosicionTelefonoUsable(posicion)) {
      marcas.push(posicion.timestampMs);
    }
  }
  return marcas;
}

export function evaluarViajeTelefono(viaje: ViajeParaScorecard): EvaluacionTelefonoViaje {
  const cobertura = coberturaPorMarcas(
    viaje.intervalo,
    timestampsUsables(viaje.posicionesTelefono),
  );
  const gaps = contarGapsSinPosicion(viaje.intervalo, timestampsUsables(viaje.posicionesTelefono));
  const hayTelefono = viaje.posicionesTelefono.length > 0;
  const hayTeltonika = viaje.puntosTeltonika != null && viaje.puntosTeltonika.length > 0;
  let dual: DualViaje = { viajeId: viaje.viajeId, estado: 'sin_par' };
  if (hayTelefono && hayTeltonika && viaje.puntosTeltonika) {
    const frescos: number[] = [];
    for (const punto of viaje.puntosTeltonika) {
      if (esPuntoFresco(punto)) {
        frescos.push(punto.timestampMs);
      }
    }
    const teltonika = coberturaPorMarcas(viaje.intervalo, frescos);
    dual = {
      viajeId: viaje.viajeId,
      estado: 'comparado',
      pctTiempoTeltonikaFresco: teltonika.pct,
      pctTiempoTelefonoUsable: cobertura.pct,
      deltaTeltonikaMenosTelefonoPct: teltonika.pct - cobertura.pct,
    };
  }
  return {
    viajeId: viaje.viajeId,
    coberturaPct: cobertura.pct,
    activoMs: cobertura.activoMs,
    cubiertoMs: cobertura.cubiertoMs,
    ventanas: cobertura.ventanas,
    ventanasCubiertas: cobertura.ventanasCubiertas,
    gapsSobre5Min: gaps.sobre5Min,
    gapsSobre15Min: gaps.sobre15Min,
    tieneGapSobre5Min: gaps.sobre5Min > 0,
    tieneGapSobre15Min: gaps.sobre15Min > 0,
    dual,
  };
}

/** Nearest-rank (el rango 1-based es `ceil(p/100 * n)`). p ∈ (0, 100]. */
export function percentilNearestRank(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) {
    return null;
  }
  if (!(p > 0 && p <= 100)) {
    throw new Error(`percentil fuera de rango: ${p}`);
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * ordenados.length);
  const index = Math.min(ordenados.length, Math.max(1, rank)) - 1;
  return ordenados[index] ?? null;
}

/** Impar: valor central. Par: promedio de los dos centrales. */
export function mediana(valores: readonly number[]): number | null {
  if (valores.length === 0) {
    return null;
  }
  const ordenados = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 1) {
    return ordenados[medio] ?? null;
  }
  const izquierda = ordenados[medio - 1];
  const derecha = ordenados[medio];
  if (izquierda === undefined || derecha === undefined) {
    return null;
  }
  return (izquierda + derecha) / 2;
}

export interface ResumenCoberturaTelefono {
  viajes: number;
  medianaPct: number | null;
  p10Pct: number | null;
  compuerta: 'cumple' | 'no_cumple' | 'muestra_insuficiente';
}

export interface ResumenGaps {
  viajes: number;
  viajesConGapSobre5Min: number;
  viajesConGapSobre15Min: number;
  pctViajesConGapSobre5Min: number | null;
  /** Intervalos > 15 min, no viajes. Un viaje puede aportar más de uno. */
  gapsSobre15Min: number;
  compuerta: 'cumple' | 'no_cumple' | 'sin_viajes';
}

export interface ResumenDual {
  viajesComparados: number;
  viajesSinPar: number;
  medianaPctTeltonika: number | null;
  medianaPctTelefono: number | null;
  medianaDeltaPct: number | null;
  /** No hay umbral numérico de «ventaja clara». Lo lee una persona. */
  ventajaClara: 'lectura_humana';
}

export function resumirEvaluacionesTelefono(evaluaciones: readonly EvaluacionTelefonoViaje[]): {
  cobertura: ResumenCoberturaTelefono;
  gaps: ResumenGaps;
  dual: ResumenDual;
} {
  const coberturas = evaluaciones.map((ev) => ev.coberturaPct);
  const medianaPct = mediana(coberturas);
  const viajes = evaluaciones.length;
  let compuertaCobertura: ResumenCoberturaTelefono['compuerta'] = 'muestra_insuficiente';
  if (viajes >= MUESTRA_MIN_VIAJES_PROD && medianaPct != null) {
    compuertaCobertura = medianaPct >= COMPUERTA_MEDIANA_COBERTURA_PCT ? 'cumple' : 'no_cumple';
  }

  let viajesConGapSobre5Min = 0;
  let viajesConGapSobre15Min = 0;
  let gapsSobre15Min = 0;
  for (const ev of evaluaciones) {
    if (ev.tieneGapSobre5Min) {
      viajesConGapSobre5Min += 1;
    }
    if (ev.tieneGapSobre15Min) {
      viajesConGapSobre15Min += 1;
    }
    gapsSobre15Min += ev.gapsSobre15Min;
  }
  const pctGaps = viajes === 0 ? null : (viajesConGapSobre5Min / viajes) * 100;

  const comparados = evaluaciones
    .map((ev) => ev.dual)
    .filter(
      (dual): dual is Extract<DualViaje, { estado: 'comparado' }> => dual.estado === 'comparado',
    );

  return {
    cobertura: {
      viajes,
      medianaPct,
      p10Pct: percentilNearestRank(coberturas, 10),
      compuerta: compuertaCobertura,
    },
    gaps: {
      viajes,
      viajesConGapSobre5Min,
      viajesConGapSobre15Min,
      pctViajesConGapSobre5Min: pctGaps,
      gapsSobre15Min,
      compuerta:
        pctGaps == null
          ? 'sin_viajes'
          : pctGaps < COMPUERTA_GAPS_LARGOS_PCT
            ? 'cumple'
            : 'no_cumple',
    },
    dual: {
      viajesComparados: comparados.length,
      viajesSinPar: viajes - comparados.length,
      medianaPctTeltonika: mediana(comparados.map((d) => d.pctTiempoTeltonikaFresco)),
      medianaPctTelefono: mediana(comparados.map((d) => d.pctTiempoTelefonoUsable)),
      medianaDeltaPct: mediana(comparados.map((d) => d.deltaTeltonikaMenosTelefonoPct)),
      ventajaClara: 'lectura_humana',
    },
  };
}

export function evaluarCohorteTelefono(viajes: readonly ViajeParaScorecard[]): {
  evaluaciones: EvaluacionTelefonoViaje[];
  cobertura: ResumenCoberturaTelefono;
  gaps: ResumenGaps;
  dual: ResumenDual;
} {
  const evaluaciones = viajes.map(evaluarViajeTelefono);
  return { evaluaciones, ...resumirEvaluacionesTelefono(evaluaciones) };
}

export interface HechoVehiculoFlota {
  vehicleId: string;
  tuvoViaje30d: boolean;
  /** IMEI propio. null o blanco = sin device asociado. El espejo no entra acá. */
  teltonikaImei: string | null;
  /**
   * Filas de `telemetria_puntos` en 7 días. No hay tabla de heartbeat:
   * una fila es el latido medible. null = no se consultó (no se inventa 0).
   */
  heartbeats7d: number | null;
}

export interface ResumenFlotaTeltonika {
  vehiculosConViaje30d: number;
  vehiculosConDeviceYHeartbeat: number;
  vehiculosSinMedicionHeartbeat: number;
  pct: number | null;
  compuerta: 'cumple' | 'no_cumple' | 'sin_flota' | 'medicion_incompleta';
}

function imeiAsociado(imei: string | null): boolean {
  return imei != null && imei.trim().length > 0;
}

export function resumirFlotaTeltonika(
  hechos: readonly HechoVehiculoFlota[],
): ResumenFlotaTeltonika {
  const porId = new Map<string, HechoVehiculoFlota>();
  for (const hecho of hechos) {
    if (
      hecho.heartbeats7d != null &&
      (!Number.isFinite(hecho.heartbeats7d) || hecho.heartbeats7d < 0)
    ) {
      throw new Error('heartbeats7d invalido');
    }
    const previo = porId.get(hecho.vehicleId);
    if (
      previo &&
      (previo.teltonikaImei !== hecho.teltonikaImei ||
        previo.heartbeats7d !== hecho.heartbeats7d ||
        previo.tuvoViaje30d !== hecho.tuvoViaje30d)
    ) {
      throw new Error('hechos de flota contradictorios');
    }
    porId.set(hecho.vehicleId, hecho);
  }

  let vehiculosConViaje30d = 0;
  let vehiculosConDeviceYHeartbeat = 0;
  let vehiculosSinMedicionHeartbeat = 0;
  for (const hecho of porId.values()) {
    if (!hecho.tuvoViaje30d) {
      continue;
    }
    vehiculosConViaje30d += 1;
    if (!imeiAsociado(hecho.teltonikaImei)) {
      continue;
    }
    if (hecho.heartbeats7d == null) {
      vehiculosSinMedicionHeartbeat += 1;
      continue;
    }
    if (hecho.heartbeats7d >= 1) {
      vehiculosConDeviceYHeartbeat += 1;
    }
  }

  if (vehiculosSinMedicionHeartbeat > 0) {
    return {
      vehiculosConViaje30d,
      vehiculosConDeviceYHeartbeat,
      vehiculosSinMedicionHeartbeat,
      pct: null,
      compuerta: 'medicion_incompleta',
    };
  }
  if (vehiculosConViaje30d === 0) {
    return {
      vehiculosConViaje30d,
      vehiculosConDeviceYHeartbeat,
      vehiculosSinMedicionHeartbeat,
      pct: null,
      compuerta: 'sin_flota',
    };
  }
  const pct = (vehiculosConDeviceYHeartbeat / vehiculosConViaje30d) * 100;
  return {
    vehiculosConViaje30d,
    vehiculosConDeviceYHeartbeat,
    vehiculosSinMedicionHeartbeat,
    pct,
    compuerta: pct >= COMPUERTA_FLOTA_TELTONIKA_PCT ? 'cumple' : 'no_cumple',
  };
}

export type DecisionNativo =
  | 'no_evaluar_nativo'
  | 'muestra_insuficiente'
  | 'considerar_nativo'
  | 'telefono_suficiente';

export type DecisionTeltonika =
  | 'sin_flota'
  | 'flota_insuficiente'
  | 'medicion_incompleta'
  | 'umbral_flota_alcanzado_lectura_humana';

export interface DecisionScorecard {
  cambiaStack: false;
  sesgoEdad: 'subestima_si_la_cola_supera_90s';
  nativo: DecisionNativo;
  teltonikaPrimero: DecisionTeltonika;
}

/**
 * Reglas de lectura, no de producto. Nativo solo se *considera* si la nav
 * in-app y el Wake Lock ya están estables y, con n ≥ 30, falla la mediana
 * o los gaps. Teltonika-first no sale de acá: con flota ≥ 40 % igual hace
 * falta que una persona vea ventaja clara en el dual.
 */
export function decidirScorecardGps(input: {
  cobertura: ResumenCoberturaTelefono;
  gaps: ResumenGaps;
  flota: ResumenFlotaTeltonika;
  precondicionNavWakeLockEstable: boolean;
}): DecisionScorecard {
  let nativo: DecisionNativo;
  if (!input.precondicionNavWakeLockEstable) {
    nativo = 'no_evaluar_nativo';
  } else if (
    input.cobertura.compuerta === 'muestra_insuficiente' ||
    input.cobertura.viajes < MUESTRA_MIN_VIAJES_PROD ||
    input.gaps.compuerta === 'sin_viajes'
  ) {
    nativo = 'muestra_insuficiente';
  } else if (input.cobertura.compuerta === 'no_cumple' || input.gaps.compuerta === 'no_cumple') {
    nativo = 'considerar_nativo';
  } else {
    nativo = 'telefono_suficiente';
  }

  let teltonikaPrimero: DecisionTeltonika;
  switch (input.flota.compuerta) {
    case 'sin_flota':
      teltonikaPrimero = 'sin_flota';
      break;
    case 'medicion_incompleta':
      teltonikaPrimero = 'medicion_incompleta';
      break;
    case 'no_cumple':
      teltonikaPrimero = 'flota_insuficiente';
      break;
    case 'cumple':
      teltonikaPrimero = 'umbral_flota_alcanzado_lectura_humana';
      break;
  }

  return {
    cambiaStack: false,
    sesgoEdad: 'subestima_si_la_cola_supera_90s',
    nativo,
    teltonikaPrimero,
  };
}

export type UmbralGap = '5min' | '15min';

export interface InstrumentosScorecard {
  coberturaUsablePct: { record(value: number): void };
  viajesConGap: { add(value: number, attributes: { umbral: UmbralGap }): void };
  gapsDetectados: { add(value: number, attributes: { umbral: UmbralGap }): void };
  flotaTeltonikaPct: { record(value: number): void };
  dualDeltaPct: { record(value: number): void };
}

function instrumentosPorDefecto(): InstrumentosScorecard {
  return {
    coberturaUsablePct: getBusinessHistogram('gps_scorecard_cobertura_usable_pct', {
      description: 'Cobertura usable del telefono por viaje, 0-100',
      unit: '%',
    }),
    viajesConGap: getBusinessCounter('gps_scorecard_viajes_con_gap_total'),
    gapsDetectados: getBusinessCounter('gps_scorecard_gaps_detectados_total'),
    flotaTeltonikaPct: getBusinessHistogram('gps_scorecard_flota_teltonika_pct', {
      description: 'Flota con viaje en 30d, Teltonika asociado y latido en 7d',
      unit: '%',
    }),
    dualDeltaPct: getBusinessHistogram('gps_scorecard_dual_delta_pct', {
      description: 'Tiempo fresco Teltonika menos telefono, por viaje con ambos',
      unit: '%',
    }),
  };
}

/** Emite la cohorte ya calculada. No inventa observaciones si el dato falta. */
export function emitirMetricasScorecardGps(
  input: {
    evaluaciones: readonly EvaluacionTelefonoViaje[];
    flotaPct: number | null;
  },
  instrumentos: InstrumentosScorecard = instrumentosPorDefecto(),
): void {
  for (const ev of input.evaluaciones) {
    instrumentos.coberturaUsablePct.record(ev.coberturaPct);
    if (ev.gapsSobre5Min > 0) {
      instrumentos.viajesConGap.add(1, { umbral: '5min' });
      instrumentos.gapsDetectados.add(ev.gapsSobre5Min, { umbral: '5min' });
    }
    if (ev.gapsSobre15Min > 0) {
      instrumentos.viajesConGap.add(1, { umbral: '15min' });
      instrumentos.gapsDetectados.add(ev.gapsSobre15Min, { umbral: '15min' });
    }
    if (ev.dual.estado === 'comparado') {
      instrumentos.dualDeltaPct.record(ev.dual.deltaTeltonikaMenosTelefonoPct);
    }
  }
  if (input.flotaPct != null) {
    instrumentos.flotaTeltonikaPct.record(input.flotaPct);
  }
}

export function esEmpresaCohorteProd(empresa: {
  esDemo: boolean;
  esUsuarioPrueba: boolean;
}): boolean {
  return !empresa.esDemo && !empresa.esUsuarioPrueba;
}

export function trocear<T>(items: readonly T[], tamano: number): T[][] {
  if (!Number.isInteger(tamano) || tamano < 1) {
    throw new Error('tamano de troceo invalido');
  }
  const trozos: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) {
    trozos.push(items.slice(i, i + tamano));
  }
  return trozos;
}

export interface AsignacionCerradaFila {
  viajeId: string;
  asignacionId: string;
  vehicleId: string;
  teltonikaImei: string | null;
  esDemo: boolean;
  esUsuarioPrueba: boolean;
  recogidoEnMs: number;
  entregadoEnMs: number | null;
  canceladoEnMs: number | null;
}

export interface PosicionMovilFila {
  asignacionId: string;
  timestampDeviceMs: number;
  timestampRecibidoMs: number;
  precisionM: number | null;
  lat: number;
  lng: number;
}

export interface PuntoTeltonikaFila {
  vehicleId: string;
  timestampDeviceMs: number;
  timestampRecibidoMs: number;
  lat: number;
  lng: number;
}

export function armarViajesScorecard(input: {
  asignaciones: readonly AsignacionCerradaFila[];
  posiciones: readonly PosicionMovilFila[];
  puntosTeltonika: readonly PuntoTeltonikaFila[];
}): { viajes: ViajeParaScorecard[]; descartados: number } {
  const posicionesPorAsignacion = new Map<string, PosicionMovilFila[]>();
  for (const posicion of input.posiciones) {
    const lista = posicionesPorAsignacion.get(posicion.asignacionId) ?? [];
    lista.push(posicion);
    posicionesPorAsignacion.set(posicion.asignacionId, lista);
  }
  const teltonikaPorVehiculo = new Map<string, PuntoTeltonikaFila[]>();
  for (const punto of input.puntosTeltonika) {
    const lista = teltonikaPorVehiculo.get(punto.vehicleId) ?? [];
    lista.push(punto);
    teltonikaPorVehiculo.set(punto.vehicleId, lista);
  }

  const viajes: ViajeParaScorecard[] = [];
  let descartados = 0;
  for (const asignacion of input.asignaciones) {
    if (!esEmpresaCohorteProd(asignacion)) {
      continue;
    }
    const intervalo = intervaloActivoViaje({
      recogidoEnMs: asignacion.recogidoEnMs,
      entregadoEnMs: asignacion.entregadoEnMs,
      canceladoEnMs: asignacion.canceladoEnMs,
    });
    if (!intervalo) {
      descartados += 1;
      continue;
    }
    const posicionesTelefono: PosicionTelefono[] = [];
    for (const fila of posicionesPorAsignacion.get(asignacion.asignacionId) ?? []) {
      if (!esCoordenadaGpsValida(fila.lat, fila.lng)) {
        continue;
      }
      if (!Number.isFinite(fila.timestampDeviceMs) || !Number.isFinite(fila.timestampRecibidoMs)) {
        continue;
      }
      if (fila.timestampDeviceMs < intervalo.inicioMs || fila.timestampDeviceMs > intervalo.finMs) {
        continue;
      }
      posicionesTelefono.push({
        timestampMs: fila.timestampDeviceMs,
        precisionM: fila.precisionM,
        edadMs: edadRecepcionMs(fila.timestampDeviceMs, fila.timestampRecibidoMs),
      });
    }

    let puntosTeltonika: PuntoFresco[] | null = null;
    if (imeiAsociado(asignacion.teltonikaImei)) {
      puntosTeltonika = [];
      for (const fila of teltonikaPorVehiculo.get(asignacion.vehicleId) ?? []) {
        if (!esCoordenadaGpsValida(fila.lat, fila.lng)) {
          continue;
        }
        if (
          !Number.isFinite(fila.timestampDeviceMs) ||
          !Number.isFinite(fila.timestampRecibidoMs)
        ) {
          continue;
        }
        if (
          fila.timestampDeviceMs < intervalo.inicioMs ||
          fila.timestampDeviceMs > intervalo.finMs
        ) {
          continue;
        }
        puntosTeltonika.push({
          timestampMs: fila.timestampDeviceMs,
          edadMs: edadRecepcionMs(fila.timestampDeviceMs, fila.timestampRecibidoMs),
        });
      }
    }

    viajes.push({
      viajeId: asignacion.viajeId,
      intervalo,
      posicionesTelefono,
      puntosTeltonika,
    });
  }
  return { viajes, descartados };
}
