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

export type TipoSegmento = 'observado' | 'estimado';

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

    if (gapS < CONTINUITY_GAP_S) {
      // Tramo observado: la distancia real entre pings consecutivos.
      const rectaKm = haversineKm(desde.lat, desde.lng, hasta.lat, hasta.lng);
      segmentos.push({ tipo: 'observado', desde, hasta, km: rectaKm });
      kmObservado += rectaKm;
      continue;
    }

    // Hueco (gap ≥ 60s): estimar por-tramo con Routes. Si Routes falla, PROPAGA
    // (decisión del PO: no inventar un fallback silencioso — un número parte
    // medido parte haversine "parece medido y no lo es"). El caller aborta el
    // write → el cert cae a la estimación via el `??`, que es honesto.
    const km = await estimarHuecoKm(desde, hasta);
    segmentos.push({ tipo: 'estimado', desde, hasta, km });
    kmEstimado += km;
  }

  const distanciaTotalKm = kmObservado + kmEstimado;
  const coberturaObservadaPct = distanciaTotalKm > 0 ? (kmObservado / distanciaTotalKm) * 100 : 0;

  return { distanciaTotalKm, kmObservado, kmEstimado, coberturaObservadaPct, segmentos };
}

/** Payload de escritura en `metricas_viaje`, derivado de una sola híbrida. */
export interface EscrituraDistanciaReal {
  /**
   * Distancia real a persistir en `distancia_km_real`; **null** si no hay
   * observación → el cert cae a la estimación via `distanceKmActual ??
   * distanceKmEstimated` (`certificates.ts:128`). **NUNCA 0**: un 0 no es
   * nullish, así que el `??` lo mostraría como "0 km medidos".
   */
  distanciaKmReal: number | null;
  /**
   * Cobertura CONSISTENTE con `distanciaKmReal` — fracción medida de la
   * distancia real (ADR-028 §5-ext: denominador = distancia_km_real, no la
   * estimada). 0 cuando no hay observación (fuerza path secundario, ADR-028 §5).
   */
  coveragePct: number;
}

/**
 * Decide QUÉ persistir a partir de la híbrida, acoplando `distancia_km_real` y
 * `coverage_pct` a la MISMA fuente (imposible mezclar cálculos distintos) y
 * blindando los dos agujeros del `??`:
 *   - distancia: null (no 0) cuando no hay observación.
 *   - cobertura: 0 finito (nunca `kmObs/null` → NaN).
 *
 * Pura e idempotente. El caller la escribe en UN solo UPDATE (misma transacción).
 */
export function resolverEscrituraDistanciaReal(
  hibrida: DistanciaHibridaResultado,
): EscrituraDistanciaReal {
  // Sin observación real (sin pings, o todos los tramos son huecos): no hay
  // "distancia medida". No persistir → el cert cae a la estimación.
  if (hibrida.kmObservado <= 0) {
    return { distanciaKmReal: null, coveragePct: 0 };
  }
  // Con observación: distancia y cobertura salen de la misma híbrida → "medido
  // X%" corresponde exactamente a la distancia mostrada (X = kmObservado /
  // distanciaTotalKm).
  return {
    distanciaKmReal: hibrida.distanciaTotalKm,
    coveragePct: hibrida.coberturaObservadaPct,
  };
}

/**
 * Cota de huecos por trip. Cada hueco = 1 llamada a Routes (~$5/1000, ~ms de
 * latencia). Un trip con GPS muy fragmentado puede tener decenas → costo y
 * latencia sin control. Por encima de esta cota el trip se considera demasiado
 * fragmentado para reconstruir con confianza: se **aborta a la estimación** (no
 * se llama a Routes). Tunable; medido en el test (nº llamadas == nº huecos).
 */
export const MAX_HUECOS_ROUTES = 20;

/**
 * Orquesta híbrida + decisión de escritura con las dos políticas de la
 * integración:
 *
 *   - **Fallo de Routes** en cualquier hueco → `calcularDistanciaHibrida`
 *     propaga → esta función propaga → el caller **no persiste** (cae a la
 *     estimación via `??`). Nunca un número parte-medido parte-fallback.
 *   - **Costo**: si hay más de `MAX_HUECOS_ROUTES` huecos → **aborta** (devuelve
 *     `null`) **sin llamar a Routes** → cae a la estimación.
 *
 * Devuelve el payload a persistir, o `null` si se aborta a la estimación.
 * (Distinto de propagar: `null` = política de costo esperada; throw = fallo de
 * Routes que el caller debe loguear.)
 */
export async function computarEscrituraDistanciaReal(
  pings: readonly PingGps[],
  estimarHuecoKm: EstimarHuecoKm,
): Promise<EscrituraDistanciaReal | null> {
  // Contar huecos ANTES de gastar en Routes (cota de costo).
  let huecos = 0;
  for (let i = 1; i < pings.length; i++) {
    const desde = pings[i - 1];
    const hasta = pings[i];
    if (!desde || !hasta) {
      continue;
    }
    if ((hasta.tMs - desde.tMs) / 1000 >= CONTINUITY_GAP_S) {
      huecos++;
    }
  }
  if (huecos > MAX_HUECOS_ROUTES) {
    return null;
  }

  const hibrida = await calcularDistanciaHibrida(pings, estimarHuecoKm);
  return resolverEscrituraDistanciaReal(hibrida);
}
