/**
 * Factor de matching de retorno — input para empty backhaul allocation
 * (GLEC Framework v3.0 §6.4 + ISO 14083).
 *
 * **Por qué importa para Booster**: el diferenciador comercial es que el
 * matching engine encuentra cargas de retorno y reduce el "empty
 * backhaul" físico. Esa reducción se traduce en CO₂e ahorrado y aparece
 * en el certificado del shipper. Esta función calcula **cuánto del leg
 * de retorno fue cubierto por una carga del siguiente trip del mismo
 * transportista** — i.e., el `factorMatching ∈ [0, 1]` que el calculator
 * (`@booster-ai/carbon-calculator > calcularEmptyBackhaul`) consume.
 *
 * ## Diseño: dos señales con degradación gradual
 *
 * Booster usa direcciones en texto + región/comuna; no tiene lat/lng en
 * `viajes` (al 2026-05). Para no bloquear §1.3 esperando geocoding, la
 * función acepta dos niveles de precisión y elige automáticamente:
 *
 *   1. **`exacto`** — si el caller provee `distanciaPrevDestinoANextOrigenKm`
 *      (típicamente vía Google Distance Matrix, cacheado por par
 *      origen-destino), la función aplica el modelo literal GLEC §6.4:
 *
 *          factorMatching = max(0, 1 - distEmpty / distRetornoTotal)
 *
 *      Donde `distEmpty` es la distancia que el camión sí maneja vacío
 *      (destino del trip previo → origen del siguiente trip cargado).
 *
 *   2. **`comuna`** — si solo tiene comuna codes, evalúa identidad
 *      binaria: misma comuna → factor 1.0 (carrier no manejó vacío);
 *      otra comuna → factor 0 (no podemos afirmar matching).
 *
 *   3. **`sin_match`** — si no se cumplen las precondiciones (gap
 *      temporal > 4h, datos faltantes), retorna factor 0 sin atribuir.
 *
 * El campo `precision` en el resultado se persiste junto al factor para
 * que el certificado y el auditor sepan cuál señal se usó.
 *
 * ## Garantías
 *
 * - Función pura. Sin DB, sin fetch, sin side effects.
 * - Determinista. Mismo input → mismo output.
 * - Defendible ante GLEC: el modelo `exacto` es el formal del §6.4; el
 *   modelo `comuna` es un proxy declarado y reportado.
 *
 * ## Roadmap de upgrades
 *
 * - Cuando agreguemos lat/lng a `viajes` o cacheamos Distance Matrix por
 *   par comuna→comuna, el caller siempre pasa `distanciaPrevDestinoANextOrigenKm`
 *   y la API de la función no cambia.
 * - Si en el futuro queremos considerar matching parciales con comunas
 *   vecinas (sin lat/lng), la rama `comuna` puede extenderse con una
 *   tabla de adyacencia, sin tocar la rama `exacto`.
 */

/** Ventana temporal máxima entre la entrega del trip previo y la
 * recogida del siguiente para considerarlos parte de la misma "ronda" del
 * transportista. Más de eso y asumimos que el camión volvió a base /
 * descansó / hizo otra actividad — no aplica backhaul attribution.
 *
 * Valor inicial conservador (4h). Tunear con datos reales de operación. */
export const MATCHING_TIME_WINDOW_HORAS = 4;

const HORA_EN_MS = 60 * 60 * 1000;

/**
 * Tier de precisión con el que se evaluó el factor.
 *
 *   - `exacto`: factor calculado a partir de distancia ruteada (km).
 *   - `comuna`: factor calculado a partir de identidad de comunas
 *     (binario: 1.0 si match, 0 si no).
 *   - `sin_match`: precondiciones no cumplidas (gap temporal, datos
 *     faltantes); factor = 0 sin atribuir.
 */
export type PrecisionFactorMatching = 'exacto' | 'comuna' | 'sin_match';

export interface ParametrosFactorMatching {
  /** Comuna code (DPA Chile) del destino del trip previo. Null si la
   * dirección no se geocodificó a comuna en intake. */
  prevDestinoComunaCode: string | null;
  /** Comuna code (DPA Chile) del origen del trip siguiente del mismo
   * transportista. Null si la dirección no se geocodificó. */
  nextOrigenComunaCode: string | null;
  /** Cuándo se entregó el trip previo. Marca el inicio de la ventana
   * temporal donde un siguiente trip puede contar como "loaded backhaul". */
  prevEntregadoEn: Date;
  /** Cuándo se recogió la carga del siguiente trip. Si nextRecogidoEn -
   * prevEntregadoEn > MATCHING_TIME_WINDOW_HORAS, los trips no se
   * consideran encadenados. */
  nextRecogidoEn: Date;
  /**
   * Distancia total del leg de retorno geográfico — del destino del trip
   * previo al lugar donde el camión iría loaded de nuevo o volvería a
   * base. Se persiste en `metricas_viaje.distanciaKmEstimada` del trip
   * previo. Debe ser > 0 para que haya empty backhaul que atribuir.
   */
  distanciaRetornoTotalKm: number;
  /**
   * Opcional: distancia ruteada (Google Distance Matrix u otra fuente)
   * desde el destino del trip previo al origen del trip siguiente. Si se
   * provee, gatilla el cálculo `exacto` (modelo formal GLEC §6.4). Si se
   * omite, la función cae a la rama `comuna`.
   */
  distanciaPrevDestinoANextOrigenKm?: number;
}

export interface ResultadoFactorMatching {
  /** Factor ∈ [0, 1]. 0 = no hubo backhaul matching y todo el retorno se
   * atribuye al shipment; 1 = matching perfecto, no se atribuye empty
   * backhaul al shipment. */
  factor: number;
  /** Tier de precisión usado. Persistir junto al factor en
   * `metricas_viaje` para auditoría GLEC. */
  precision: PrecisionFactorMatching;
}

/**
 * Calcula el factor de matching de retorno entre dos viajes consecutivos
 * del mismo transportista. Ver el JSDoc del módulo para el contrato.
 *
 * @param params — Snapshot estructurado de los dos trips. El caller
 *   (`apps/api/src/services/calcular-metricas-viaje.ts`) hace las queries
 *   Drizzle y construye este objeto.
 *
 * @returns `{ factor, precision }`. El factor es 0 cuando no hay match;
 *   `precision` indica si la evaluación fue exacta, por comuna, o sin
 *   match.
 *
 * @example Matching exacto, 50% del retorno cubierto
 *   calcularFactorMatching({
 *     prevDestinoComunaCode: '13101',
 *     nextOrigenComunaCode: '13101',
 *     prevEntregadoEn: new Date('2026-05-05T10:00:00Z'),
 *     nextRecogidoEn: new Date('2026-05-05T11:30:00Z'),
 *     distanciaRetornoTotalKm: 100,
 *     distanciaPrevDestinoANextOrigenKm: 50,
 *   })
 *   // → { factor: 0.5, precision: 'exacto' }
 *
 * @example Matching por comuna, mismo destino y siguiente origen
 *   calcularFactorMatching({
 *     prevDestinoComunaCode: '13101',
 *     nextOrigenComunaCode: '13101',
 *     prevEntregadoEn: new Date('2026-05-05T10:00:00Z'),
 *     nextRecogidoEn: new Date('2026-05-05T12:00:00Z'),
 *     distanciaRetornoTotalKm: 100,
 *   })
 *   // → { factor: 1, precision: 'comuna' }
 */
export function calcularFactorMatching(params: ParametrosFactorMatching): ResultadoFactorMatching {
  const {
    prevDestinoComunaCode,
    nextOrigenComunaCode,
    prevEntregadoEn,
    nextRecogidoEn,
    distanciaRetornoTotalKm,
    distanciaPrevDestinoANextOrigenKm,
  } = params;

  // Sin retorno modelado, no hay empty backhaul que atribuir.
  if (!Number.isFinite(distanciaRetornoTotalKm) || distanciaRetornoTotalKm <= 0) {
    return { factor: 0, precision: 'sin_match' };
  }

  // Ventana temporal: si el siguiente pickup ocurre antes de la entrega
  // o más de N horas después, los trips no son una "ronda" del mismo
  // camión y no aplica matching.
  const tDiffMs = nextRecogidoEn.getTime() - prevEntregadoEn.getTime();
  if (
    !Number.isFinite(tDiffMs) ||
    tDiffMs < 0 ||
    tDiffMs > MATCHING_TIME_WINDOW_HORAS * HORA_EN_MS
  ) {
    return { factor: 0, precision: 'sin_match' };
  }

  // Rama EXACTA — modelo formal GLEC §6.4.
  if (
    distanciaPrevDestinoANextOrigenKm !== undefined &&
    Number.isFinite(distanciaPrevDestinoANextOrigenKm) &&
    distanciaPrevDestinoANextOrigenKm >= 0
  ) {
    const kmAhorrados = distanciaRetornoTotalKm - distanciaPrevDestinoANextOrigenKm;
    const factor = Math.max(0, Math.min(1, kmAhorrados / distanciaRetornoTotalKm));
    return { factor, precision: 'exacto' };
  }

  // Rama COMUNA — fallback binario.
  if (prevDestinoComunaCode != null && nextOrigenComunaCode != null) {
    const factor = prevDestinoComunaCode === nextOrigenComunaCode ? 1 : 0;
    return { factor, precision: 'comuna' };
  }

  // Sin distancia ruteada y sin comunas: no hay forma de evaluar.
  return { factor: 0, precision: 'sin_match' };
}
