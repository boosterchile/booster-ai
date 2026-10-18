import { type Coordenada, distanciaMetros } from './geo.js';

/**
 * Detección de congestión durante un viaje activo (T10-23, ADR-012 Capa 1):
 * velocidad bajo `umbralKmh` sostenida al menos `ventanaSegundos` en el
 * tramo más reciente de posiciones. Función pura: el api le pasa las
 * posiciones del viaje (Teltonika y/o móvil del conductor) y decide qué
 * hacer con el resultado.
 */
export interface MuestraPosicion extends Coordenada {
  tsMs: number;
  /** Velocidad reportada por la fuente; null → se deriva del desplazamiento. */
  velocidadKmh: number | null;
}

export interface ConfigDetector {
  /** Bajo esta velocidad la muestra cuenta como "lenta". */
  umbralKmh: number;
  /** Duración mínima de la racha lenta para declarar congestión. */
  ventanaSegundos: number;
  /** Hueco máximo entre muestras consecutivas sin cortar la racha. */
  maxGapSegundos: number;
  /** Radio alrededor de origen/destino donde detenerse es esperado. */
  radioExclusionM: number;
}

export const DEFAULTS_DETECTOR: ConfigDetector = {
  umbralKmh: 10,
  ventanaSegundos: 60,
  maxGapSegundos: 20,
  radioExclusionM: 300,
};

export type ResultadoDeteccion =
  | {
      congestion: true;
      /** Inicio de la racha lenta. */
      desdeMs: number;
      duracionSegundos: number;
      velocidadMediaKmh: number;
      /** Última posición de la racha (donde está el vehículo). */
      posicion: Coordenada;
    }
  | {
      congestion: false;
      razon:
        | 'sin_datos'
        | 'datos_obsoletos'
        | 'en_movimiento'
        | 'ventana_incompleta'
        | 'zona_excluida';
    };

export interface OpcionesDeteccion {
  ahoraMs: number;
  /** Origen y destino del viaje: detenerse ahí no es congestión. */
  zonasExcluidas?: Coordenada[];
  config?: Partial<ConfigDetector>;
}

function velocidadEfectiva(
  actual: MuestraPosicion,
  previa: MuestraPosicion | undefined,
): number | null {
  if (actual.velocidadKmh !== null) {
    return actual.velocidadKmh;
  }
  if (!previa) {
    return null;
  }
  const dtS = (actual.tsMs - previa.tsMs) / 1000;
  return dtS > 0 ? (distanciaMetros(previa, actual) / dtS) * 3.6 : null;
}

export function detectarCongestion(
  muestras: readonly MuestraPosicion[],
  opciones: OpcionesDeteccion,
): ResultadoDeteccion {
  const cfg = { ...DEFAULTS_DETECTOR, ...opciones.config };
  if (muestras.length === 0) {
    return { congestion: false, razon: 'sin_datos' };
  }
  const orden = [...muestras].sort((a, b) => a.tsMs - b.tsMs);
  const ultima = orden[orden.length - 1] as MuestraPosicion;
  if (opciones.ahoraMs - ultima.tsMs > cfg.maxGapSegundos * 1000) {
    return { congestion: false, razon: 'datos_obsoletos' };
  }

  // Racha lenta contigua que termina en la última muestra, recorriendo hacia atrás.
  let inicio = orden.length;
  let sumaVel = 0;
  for (let i = orden.length - 1; i >= 0; i--) {
    const m = orden[i] as MuestraPosicion;
    const siguiente = orden[i + 1];
    if (siguiente && siguiente.tsMs - m.tsMs > cfg.maxGapSegundos * 1000) {
      break;
    }
    const v = velocidadEfectiva(m, orden[i - 1]);
    if (v === null || v >= cfg.umbralKmh) {
      break;
    }
    inicio = i;
    sumaVel += v;
  }

  if (inicio === orden.length) {
    return { congestion: false, razon: 'en_movimiento' };
  }
  const primera = orden[inicio] as MuestraPosicion;
  const duracionSegundos = (ultima.tsMs - primera.tsMs) / 1000;
  if (duracionSegundos < cfg.ventanaSegundos) {
    return { congestion: false, razon: 'ventana_incompleta' };
  }
  const posicion = { lat: ultima.lat, lng: ultima.lng };
  if (
    (opciones.zonasExcluidas ?? []).some((z) => distanciaMetros(z, posicion) <= cfg.radioExclusionM)
  ) {
    return { congestion: false, razon: 'zona_excluida' };
  }
  return {
    congestion: true,
    desdeMs: primera.tsMs,
    duracionSegundos,
    velocidadMediaKmh: sumaVel / (orden.length - inicio),
    posicion,
  };
}
