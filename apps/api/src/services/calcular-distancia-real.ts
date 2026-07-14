import { CONTINUITY_GAP_S, haversineKm } from './calcular-cobertura-telemetria.js';

/**
 * Distancia real híbrida de un trip a partir de su traza GPS (paso 1 del fix
 * F0-0, spec `.specs/distancia-real-hibrida/`).
 *
 * Reemplaza el patrón actual —descartar `kmCubiertos` y calcular la huella con
 * una estimación de ruta— por la distancia REALMENTE recorrida, sin caer en la
 * subestimación de usar solo los tramos observados:
 *
 *     distancia = Σ tramos observados (gap < 60s, haversine entre pings)
 *               + Σ huecos (gap ≥ 60s, estimados POR-TRAMO entre sus extremos)
 *
 * El hueco se estima llamando a Routes API entre los dos pings que lo bordean
 * (`estimarHuecoKm`, inyectado → el core queda testeable sin red). Esto da
 * procedencia granular ("tramo A–B observado; B–C estimado por Routes") y
 * evita el parámetro mágico de un factor de sinuosidad en el camino principal.
 *
 * Nunca se descarta un hueco (daría subestimación direccional a la baja, el
 * mismo error del backhaul que F0-0 corrige) ni se rellena con
 * `(1−coverage)×rutaTotal` (colapsa a la estimación pura y anula el fix).
 */

export interface PingGps {
  /** Timestamp del ping en epoch ms. */
  tMs: number;
  lat: number;
  lng: number;
}

export type TipoSegmento = 'observado' | 'estimado' | 'estimado_fallback';

export interface SegmentoDistancia {
  tipo: TipoSegmento;
  desde: PingGps;
  hasta: PingGps;
  km: number;
}

export interface DistanciaHibridaResultado {
  /** Distancia total = observado + estimado (km). */
  distanciaTotalKm: number;
  /** Suma de tramos observados (gap < 60s). */
  kmObservado: number;
  /** Suma de huecos estimados (gap ≥ 60s). */
  kmEstimado: number;
  /** Fracción MEDIDA del recorrido: kmObservado / distanciaTotal × 100, en [0,100]. */
  coberturaObservadaPct: number;
  /** Desglose por tramo, con su procedencia (para el certificado). */
  segmentos: SegmentoDistancia[];
}

/**
 * Factor de sinuosidad del FALLBACK declarado (NUNCA el camino principal).
 * Solo se usa cuando el resolver de huecos (Routes) falla: aproxima la
 * distancia de ruta desde la línea recta. Fuente: heurística geográfica ya
 * usada en `actualizar-factor-matching.ts` (haversine × 1.3). Documentado y
 * marcado en la procedencia como `estimado_fallback`.
 */
const FALLBACK_FACTOR_SINUOSIDAD = 1.3;

/**
 * Estimador de la distancia de un hueco entre dos pings. En producción se
 * implementa sobre `computeRoutes` (Routes API acepta `"lat,lng"`); en tests
 * se inyecta un mock. Rechaza si Routes falla/timeout → el caller cae al
 * fallback declarado.
 */
export type EstimarHuecoKm = (desde: PingGps, hasta: PingGps) => Promise<number>;

export async function calcularDistanciaHibrida(
  pings: readonly PingGps[],
  estimarHuecoKm: EstimarHuecoKm,
): Promise<DistanciaHibridaResultado> {
  const segmentos: SegmentoDistancia[] = [];
  let kmObservado = 0;
  let kmEstimado = 0;

  for (let i = 1; i < pings.length; i++) {
    const desde = pings[i - 1];
    const hasta = pings[i];
    if (!desde || !hasta) {
      continue;
    }

    const gapS = (hasta.tMs - desde.tMs) / 1000;
    const rectaKm = haversineKm(desde.lat, desde.lng, hasta.lat, hasta.lng);

    if (gapS < CONTINUITY_GAP_S) {
      // Tramo observado: la distancia real entre pings consecutivos.
      segmentos.push({ tipo: 'observado', desde, hasta, km: rectaKm });
      kmObservado += rectaKm;
      continue;
    }

    // Hueco (gap ≥ 60s): estimar por-tramo con Routes; fallback declarado si falla.
    let km: number;
    let tipo: TipoSegmento;
    try {
      km = await estimarHuecoKm(desde, hasta);
      tipo = 'estimado';
    } catch {
      // Routes caído: no reventar el cierre del trip. Fallback declarado (piso =
      // línea recta × factor documentado), nunca descartar el hueco a 0.
      km = rectaKm * FALLBACK_FACTOR_SINUOSIDAD;
      tipo = 'estimado_fallback';
    }
    segmentos.push({ tipo, desde, hasta, km });
    kmEstimado += km;
  }

  const distanciaTotalKm = kmObservado + kmEstimado;
  const coberturaObservadaPct = distanciaTotalKm > 0 ? (kmObservado / distanciaTotalKm) * 100 : 0;

  return { distanciaTotalKm, kmObservado, kmEstimado, coberturaObservadaPct, segmentos };
}
