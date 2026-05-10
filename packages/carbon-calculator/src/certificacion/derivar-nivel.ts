import type { MetodoPrecision, NivelCertificacion, RouteDataSource } from '../tipos.js';

/**
 * Threshold de cobertura mínima para certificado primario verificable.
 * Documentado en ADR-028 §2 con fundamento ISO 14083 §5.2 (data quality
 * default tier) + GLEC v3 Annex B sample size guidance.
 *
 * El 5% de holgura desde 100% absorbe los huecos típicos de pérdida de
 * señal urbana (túneles, edificios) sin penalizar al carrier.
 */
export const THRESHOLD_PRIMARIO_PCT = 95;

/**
 * Threshold de cobertura mínima para que un trip con telemetría Teltonika
 * pueda mantener el nivel `secundario_modeled`. Por debajo, el trip cae
 * a `secundario_modeled` igual (no hay tier inferior aún), pero el factor
 * de incertidumbre aumenta proporcionalmente. Documentado en ADR-028 §3.
 */
export const THRESHOLD_SECUNDARIO_MODELED_PCT = 80;

/**
 * Deriva el nivel de certificación de un trip a partir de las tres
 * dimensiones ortogonales definidas en ADR-028 §1-§2:
 *
 *   1. `precisionMethod` (calidad de medición combustible/distancia)
 *   2. `routeDataSource` (origen del polyline real)
 *   3. `coveragePct` (% del viaje cubierto por la fuente principal)
 *
 * Función PURA — no accede a BD, no lee ENV. Implementa exactamente la
 * matriz de derivación documentada en el ADR.
 *
 * **Greenwashing prevention**: el resultado NO se persiste como
 * `certification_level` directamente desde input del cliente. El servicio
 * orquestador (apps/api) lee las tres dimensiones y llama a esta función;
 * el cliente nunca pasa `certification_level` directo.
 *
 * @example
 * ```ts
 * derivarNivelCertificacion({
 *   precisionMethod: 'exacto_canbus',
 *   routeDataSource: 'teltonika_gps',
 *   coveragePct: 98.7,
 * }); // → 'primario_verificable'
 *
 * derivarNivelCertificacion({
 *   precisionMethod: 'por_defecto',
 *   routeDataSource: 'maps_directions',
 *   coveragePct: 0,
 * }); // → 'secundario_modeled'
 * ```
 */
export function derivarNivelCertificacion(input: {
  precisionMethod: MetodoPrecision;
  routeDataSource: RouteDataSource;
  /** Fracción del viaje cubierta por la fuente principal, [0..100]. */
  coveragePct: number;
}): NivelCertificacion {
  const { precisionMethod, routeDataSource, coveragePct } = input;

  // Validación defensiva — si llegan inputs fuera de rango, fallar visible
  // en vez de retornar un nivel falso.
  if (coveragePct < 0 || coveragePct > 100 || Number.isNaN(coveragePct)) {
    throw new Error(`coveragePct debe estar en [0, 100], recibido ${coveragePct} (ADR-028 §1)`);
  }

  // Manual declared SIEMPRE es secundario_default — no hay polyline real
  // ni simulación calibrada, solo declaración del cliente.
  if (routeDataSource === 'manual_declared') {
    return 'secundario_default';
  }

  // Primario verificable requiere las tres condiciones simultáneas:
  // exacto_canbus + teltonika_gps + cobertura ≥ 95%.
  if (
    precisionMethod === 'exacto_canbus' &&
    routeDataSource === 'teltonika_gps' &&
    coveragePct >= THRESHOLD_PRIMARIO_PCT
  ) {
    return 'primario_verificable';
  }

  // Resto de combinaciones (incluido por_defecto + maps_directions) cae a
  // secundario_modeled. La existencia de un polyline simulado por Routes
  // API ya constituye una calibración mínima (red de calles real,
  // tráfico, vehicleInfo) que distingue de secundario_default.
  return 'secundario_modeled';
}
