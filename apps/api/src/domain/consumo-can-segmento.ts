import { THRESHOLD_PRIMARIO_PCT } from '@booster-ai/carbon-calculator';
import { haversineKm } from '../services/calcular-cobertura-telemetria.js';
import {
  KM_MINIMOS_KM_POR_LITRO,
  LITROS_MINIMOS_KM_POR_LITRO,
  consumoAcumuladoDe,
} from './segmentar-trayectos-teltonika.js';

/**
 * Litros medidos por el contador CAN (AVL 83) en el segmento de un viaje
 * (T10-05, ADR-077 §2). Es la única entrada del modo `exacto_canbus`, que con
 * Teltonika y cobertura ≥ 95 % da `primario_verificable`. Por eso descarta
 * todo lo que no sea una medición limpia y dice por qué
 * (`.specs/huella-exacto-canbus-t10-05/spec.md` §3.1).
 *
 * Solo el 83: es un contador acumulado de combustible quemado. El Δ de un
 * nivel (84/89) mezcla cargas de combustible y oleaje y no es una medición
 * primaria de energía.
 */

export interface LecturaSegmentoCan {
  tMs: number;
  lat: number;
  lng: number;
  io: Record<string, number>;
}

export const MOTIVOS_CONSUMO_CAN_NO_USADO = [
  'sin_lecturas',
  'contador_retrocedio',
  'contador_sin_avance',
  'cobertura_insuficiente',
  'muestra_insuficiente',
  'consumo_implausible',
] as const;
export type MotivoConsumoCanNoUsado = (typeof MOTIVOS_CONSUMO_CAN_NO_USADO)[number];

export type ResultadoConsumoCan =
  | { litros: number }
  | { litros: null; motivo: MotivoConsumoCanNoUsado };

/**
 * Banda de consumo creíble para camiones y furgones. Fuera de ella el
 * contador está corrupto o mal provisionado, y no puede certificar.
 */
export const CONSUMO_CAN_MIN_L_100KM = 3;
export const CONSUMO_CAN_MAX_L_100KM = 100;

export function consumoCanSegmento(opts: {
  lecturas: readonly LecturaSegmentoCan[];
  /** Distancia real del segmento, la misma que se persiste y alimenta el cálculo. */
  distanciaSegmentoKm: number;
}): ResultadoConsumoCan {
  const ordenadas = [...opts.lecturas].sort((a, b) => a.tMs - b.tMs);
  const conContador: Array<{ idx: number; litros: number }> = [];
  for (let idx = 0; idx < ordenadas.length; idx++) {
    const litros = consumoAcumuladoDe(ordenadas[idx]?.io ?? {});
    if (litros != null) {
      conContador.push({ idx, litros });
    }
  }
  const primera = conContador[0];
  const ultima = conContador[conContador.length - 1];
  if (conContador.length < 2 || !primera || !ultima) {
    return { litros: null, motivo: 'sin_lecturas' };
  }

  const delta = ultima.litros - primera.litros;
  if (delta < 0) {
    return { litros: null, motivo: 'contador_retrocedio' };
  }
  if (delta === 0) {
    return { litros: null, motivo: 'contador_sin_avance' };
  }

  const cubiertaKm = distanciaRecorrida(ordenadas.slice(primera.idx, ultima.idx + 1));
  if (cubiertaKm + 1e-9 < (THRESHOLD_PRIMARIO_PCT / 100) * opts.distanciaSegmentoKm) {
    return { litros: null, motivo: 'cobertura_insuficiente' };
  }

  if (
    delta + 1e-9 < LITROS_MINIMOS_KM_POR_LITRO ||
    opts.distanciaSegmentoKm + 1e-9 < KM_MINIMOS_KM_POR_LITRO
  ) {
    return { litros: null, motivo: 'muestra_insuficiente' };
  }

  const litrosPor100Km = (delta / opts.distanciaSegmentoKm) * 100;
  if (litrosPor100Km < CONSUMO_CAN_MIN_L_100KM || litrosPor100Km > CONSUMO_CAN_MAX_L_100KM) {
    return { litros: null, motivo: 'consumo_implausible' };
  }

  return { litros: Math.round(delta * 10) / 10 };
}

function distanciaRecorrida(lecturas: readonly LecturaSegmentoCan[]): number {
  let km = 0;
  for (let i = 1; i < lecturas.length; i++) {
    const a = lecturas[i - 1];
    const b = lecturas[i];
    if (a && b) {
      km += haversineKm(a.lat, a.lng, b.lat, b.lng);
    }
  }
  return km;
}
