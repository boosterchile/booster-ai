import { obtenerFactorEmision } from '../factores/sec-chile-2024.js';
import type { TipoCombustible } from '../tipos.js';
import { type CategoriaVehiculo, calcularFactorCorreccionPorCarga } from './factor-carga.js';

/**
 * Empty Backhaul Allocation — GLEC Framework v3.0 §6.4.
 *
 * **Por qué importa para Booster**: la propuesta comercial central de
 * Booster es ser un *marketplace que optimiza retornos vacíos*. Reportar
 * el ahorro de CO₂e que genera el matching de retorno es **el storytelling
 * que materializa esa promesa** — y es GLEC v3.0 §6.4 compliant.
 *
 * ## Conceptos
 *
 * Cuando un camión completa una entrega y **vuelve vacío** al punto de
 * origen (o sigue vacío hasta su próximo loaded leg), las emisiones del
 * leg vacío deben atribuirse a alguien. La regla por defecto GLEC:
 *
 * > "All empty trip emissions associated with a freight movement shall be
 * > allocated to the loaded leg(s) that they support, on a tonne-km
 * > weighted basis."  (GLEC v3.0 §6.4.2)
 *
 * En la práctica, hay dos extremos:
 *
 *   - **Sin matching** (peor caso): el camión vuelve 100% vacío. Toda la
 *     emisión del retorno se atribuye al shipment del leg cargado.
 *   - **Matching perfecto**: el camión sale loaded, hace una parada,
 *     toma otra carga en regreso, vuelve loaded. **Cero empty backhaul
 *     atribuible al primer shipment**.
 *
 * Booster opera en el medio: el matching engine encuentra cargas de
 * retorno cuando puede. El **factor de matching** es:
 *
 *     factorMatching = (km regreso loaded) / (km regreso totales)
 *     ratioVacio    = 1 − factorMatching
 *
 * Y la emisión empty backhaul atribuible al shipment es:
 *
 *     emisionesEmpty = consumoVacio × factorWtw × ratioVacio
 *
 * Donde `consumoVacio` es el consumo del leg vacío (camión vacío, distancia
 * de retorno) usando la corrección de carga para `cargaKg = 0`.
 *
 * ## API
 *
 * Función pura. No accede a DB ni hace fetch. La integración con el
 * servicio API (`apps/api/src/services/calcular-metricas-viaje.ts`) es
 * responsabilidad del caller — pasa el `factorMatching` que el matching
 * engine calculó para el viaje específico.
 *
 * ## Out of scope
 *
 * - Cómo se mide el factorMatching real: lo decide el matching engine
 *   leyendo el grafo de viajes consecutivos del transportista.
 * - Persistencia: el caller persiste `emisionesEmptyBackhaulKgco2eWtw`
 *   y `factorMatching` como nuevos campos de `trip_metrics`.
 */

/** Parámetros para el cálculo de empty backhaul allocation. */
export interface ParametrosEmptyBackhaul {
  /** Distancia del retorno (km), independiente de si va loaded o vacío. */
  distanciaRetornoKm: number;
  /**
   * Fracción del retorno que va loaded gracias al matching, en [0, 1].
   *   - 0   = el matching no encontró carga de retorno (worst case).
   *   - 1   = matching perfecto (mejor caso, no hay empty backhaul).
   */
  factorMatching: number;
  /** Consumo base del vehículo a "carga normal" (50%), L/100km u equiv. */
  consumoBasePor100km: number;
  /** Tipo de combustible — para lookup del factor WTW. */
  combustible: TipoCombustible;
  /**
   * Categoría del vehículo (LDV/MDV/HDV) para calibrar la sensibilidad
   * del consumo al factor de carga. Default 'MDV'.
   */
  categoria?: CategoriaVehiculo | undefined;
  /** Capacidad útil del vehículo (kg), para el cálculo del consumo vacío. */
  capacidadKg: number;
}

/** Resultado del cálculo de empty backhaul. */
export interface ResultadoEmptyBackhaul {
  /**
   * Emisiones WTW (kg CO₂e) atribuibles al shipment por el leg vacío
   * de retorno, ya descontando la fracción que el matching cubrió.
   */
  emisionesKgco2eWtw: number;
  /** Distancia efectiva vacía (km × ratioVacio). */
  distanciaVaciaKm: number;
  /** Combustible consumido en el leg vacío atribuible al shipment. */
  combustibleConsumido: number;
  /**
   * **Para storytelling comercial**: ahorro de CO₂e generado por el
   * matching de retorno comparado con el escenario "sin Booster"
   * (factorMatching = 0). Siempre ≥ 0.
   */
  ahorroVsSinMatchingKgco2e: number;
}

/**
 * Calcula la fracción de empty backhaul atribuible al shipment según
 * el matching real conseguido.
 *
 * Regla: el camión recorre `distanciaRetornoKm` para volver. La fracción
 * `(1 − factorMatching)` va vacía y sus emisiones se atribuyen al
 * shipment original. La fracción `factorMatching` va loaded para otro
 * shipment (esas emisiones son responsabilidad de aquel, no de éste).
 *
 * El consumo vacío usa el factor de corrección con `cargaKg = 0`, lo
 * que típicamente da entre 0.85 y 0.95 del consumo base según α.
 */
export function calcularEmptyBackhaul(opts: ParametrosEmptyBackhaul): ResultadoEmptyBackhaul {
  const { distanciaRetornoKm, factorMatching, consumoBasePor100km, combustible, capacidadKg } =
    opts;

  if (distanciaRetornoKm < 0) {
    throw new Error('distanciaRetornoKm debe ser >= 0');
  }
  if (factorMatching < 0 || factorMatching > 1) {
    throw new Error('factorMatching debe estar en [0, 1]');
  }
  if (consumoBasePor100km <= 0) {
    throw new Error('consumoBasePor100km debe ser > 0');
  }

  const factor = obtenerFactorEmision(combustible);
  const factorWtw = factor.ttwKgco2e + factor.wttKgco2e;

  // Consumo del camión vacío (cargaKg = 0). Corrección típica: ~0.95
  // para MDV (α = 0.10), ~0.92 para HDV (α = 0.15).
  const correccionVacio = calcularFactorCorreccionPorCarga({
    cargaKg: 0,
    capacidadKg,
    ...(opts.categoria !== undefined && { categoria: opts.categoria }),
  });
  const consumoVacioPor100km = consumoBasePor100km * correccionVacio;

  // Distancia efectivamente vacía atribuible al shipment.
  const ratioVacio = 1 - factorMatching;
  const distanciaVaciaKm = distanciaRetornoKm * ratioVacio;

  const consumoVacio = consumoVacioPor100km * (distanciaVaciaKm / 100);
  const emisionesKgco2eWtw = consumoVacio * factorWtw;

  // Worst case (sin matching): toda la distancia de retorno va vacía.
  const consumoSinMatching = consumoVacioPor100km * (distanciaRetornoKm / 100);
  const emisionesSinMatching = consumoSinMatching * factorWtw;
  const ahorroVsSinMatchingKgco2e = emisionesSinMatching - emisionesKgco2eWtw;

  return {
    emisionesKgco2eWtw: round3(emisionesKgco2eWtw),
    distanciaVaciaKm: round2(distanciaVaciaKm),
    combustibleConsumido: round2(consumoVacio),
    ahorroVsSinMatchingKgco2e: round3(ahorroVsSinMatchingKgco2e),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
