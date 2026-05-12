/**
 * Tipos canónicos del algoritmo de matching v2 (ADR-033).
 *
 * Toda la lógica de scoring vive en función pura. El orquestador en
 * `apps/api/src/services/matching-v2.ts` (PR #2) hace los lookups SQL
 * para llenar estos tipos antes de invocar `scoreCandidateV2`.
 */

/**
 * Candidato a recibir una oferta. Todos los datos necesarios para
 * computar el score, ya pre-cargados por el orchestrator.
 */
export interface CarrierCandidateV2 {
  empresaId: string;
  vehicleId: string;
  /** Capacidad útil del vehículo en kg. Validado >0 SQL-side. */
  vehicleCapacityKg: number;
  /**
   * **Componente backhaul**: `true` si el carrier tiene actualmente un
   * trip activo (status ∈ {asignado, en_proceso}) cuyo destino está en
   * la misma región del origen del nuevo trip. Match perfecto.
   */
  tripActivoDestinoRegionMatch: boolean;
  /**
   * **Componente backhaul (fallback)**: estadísticas del histórico
   * reciente del carrier. El orchestrator computa esto desde
   * `trips` JOIN `assignments` WHERE `delivered_at > now() - 7 days`
   * y `empresa_carrier_id = carrier.id`.
   */
  tripsRecientes: {
    /** Total de trips entregados por este carrier en últimos 7d. */
    totalUltimos7d: number;
    /**
     * De esos, cuántos terminaron en la misma región del origen del
     * trip nuevo. Más matches → mayor probabilidad de retorno
     * "natural" en próximas semanas.
     */
    matchRegionalUltimos7d: number;
  };
  /**
   * **Componente reputación**: histórico de ofertas en últimos 90d.
   * Si totales < `N_MIN_OFFERS_FOR_REPUTATION`, se aplica floor neutro.
   */
  ofertasUltimos90d: {
    totales: number;
    aceptadas: number;
  };
  /**
   * **Componente tier**: priority boost ∈ [0, 1] derivado del tier de
   * membresía activa del carrier. Hardcoded por slug en
   * `tierBoostFromSlug()`. Si el carrier no tiene membresía activa →
   * `0` (free baseline).
   */
  tierBoost: number;
}

/**
 * Contexto del trip que se está matcheando. Inputs del scoring que
 * son fijos para todos los candidatos del mismo trip.
 */
export interface TripScoringContextV2 {
  /** Peso de la carga. Si 0 o null, capacidad no penaliza slack. */
  cargoWeightKg: number;
  /**
   * Región del origen del trip. NO usada por la función pura — viene
   * pre-procesada en los campos `*RegionMatch` y `matchRegional*` del
   * candidato. Persistida acá para auditoría / logging.
   */
  originRegionCode: string;
}

/**
 * Pesos relativos de los componentes del score. Suma debe ser ≈ 1.0
 * (validado por `validateWeights` en runtime).
 */
export interface WeightsV2 {
  capacidad: number;
  backhaul: number;
  reputacion: number;
  tier: number;
}

/**
 * Default weights del ADR-033 §1. Calibrados para favorecer la
 * señal de backhaul (diferenciación comercial Booster) sin
 * perder el filtro capacitario fundamental.
 *
 * Tunable vía env `MATCHING_V2_WEIGHTS_JSON` cuando el backtest
 * lo justifique.
 */
export const DEFAULT_WEIGHTS_V2: WeightsV2 = {
  capacidad: 0.4,
  backhaul: 0.35,
  reputacion: 0.15,
  tier: 0.1,
};

/**
 * Output del scoring. Incluye el score final + el desglose por
 * componente para observabilidad y debugging.
 */
export interface ScoredCandidateV2 {
  empresaId: string;
  vehicleId: string;
  vehicleCapacityKg: number;
  /** Score final ∈ [0, 1]. Determinístico por (candidate, trip, weights). */
  score: number;
  /**
   * Desglose por componente (cada uno ∈ [0, 1]) — para métricas custom,
   * logging y backtesting. NO se persiste en `offers.score` (eso es solo
   * el agregado escalado a 0..1000).
   */
  components: {
    capacidad: number;
    backhaul: number;
    reputacion: number;
    tier: number;
  };
  /**
   * Razón principal del componente backhaul. Útil para observabilidad
   * y debugging — permite responder "¿por qué este carrier recibió esta
   * oferta?".
   */
  backhaulSignal: 'active_trip_match' | 'recent_history_match' | 'no_signal';
}

/**
 * Hyperparámetros del scoring v2. Centralizados acá para que los
 * tests + el orchestrator usen los mismos valores. NO se cambian en
 * producción sin un nuevo ADR (o un ADR-033a si los pesos default
 * resultan suboptimos en backtest).
 */
export const SCORING_PARAMS_V2 = {
  /**
   * Penaliza vehículos sobredimensionados. v2 usa 0.5 (vs 0.1 en v1)
   * porque el peso del componente bajó a 0.40 — sin endurecer
   * la penalidad, un camión 10× más grande quedaría con
   * `s_capacidad ≈ 1.0` y dominaría el agregado.
   */
  CAPACITY_SLACK_PENALTY: 0.5,
  /**
   * Ventana en días para considerar trips "recientes" del carrier
   * en el componente backhaul.
   */
  N_DAYS_BACKHAUL_WINDOW: 7,
  /**
   * Mínimo de ofertas en últimos 90d para evaluar reputación. Si el
   * carrier tiene menos, se aplica un floor neutro de 0.5 para no
   * sesgar contra carriers nuevos.
   */
  N_MIN_OFFERS_FOR_REPUTATION: 10,
  /**
   * Score neutro para carriers sin suficiente historial de ofertas.
   * Onboarding-friendly. 0.5 mantiene al carrier competitivo sin
   * inflarlo artificialmente.
   */
  REPUTATION_FLOOR_NEW_CARRIER: 0.5,
} as const;

/**
 * Mapeo del slug del tier → boost ∈ [0, 1]. Estos valores
 * corresponden al campo `matching_priority_boost` de la tabla
 * `membership_tiers`. El orchestrator hace el lookup y pasa el valor;
 * acá solo está la default si el carrier no tiene membresía.
 */
export const DEFAULT_TIER_BOOSTS = {
  free: 0,
  standard: 0.3,
  pro: 0.6,
  premium: 1,
} as const;

export type TierSlug = keyof typeof DEFAULT_TIER_BOOSTS;

/**
 * Helper puro. Resuelve el boost del tier dado el slug. Usa
 * `DEFAULT_TIER_BOOSTS` como fuente de verdad. Si el slug no
 * está en el map → `0` (free).
 */
export function tierBoostFromSlug(slug: string | null | undefined): number {
  if (!slug) {
    return 0;
  }
  return DEFAULT_TIER_BOOSTS[slug as TierSlug] ?? 0;
}

/**
 * Valida que los pesos sumen ≈ 1.0 (tolerancia para floating point).
 * Lanza `Error` si no — failsafe contra config errors del operador.
 */
export function validateWeights(weights: WeightsV2): void {
  const sum = weights.capacidad + weights.backhaul + weights.reputacion + weights.tier;
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(
      `WeightsV2 inválidos: suma=${sum.toFixed(4)} pero debe ser ≈ 1.0. Recibido: ${JSON.stringify(weights)}`,
    );
  }
  for (const [name, value] of Object.entries(weights)) {
    if (value < 0 || value > 1) {
      throw new Error(`WeightsV2.${name}=${value} fuera de [0, 1]`);
    }
  }
}
