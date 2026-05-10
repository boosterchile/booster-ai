/**
 * Sub-módulo `certificacion` — derivación de nivel de certificación y
 * cálculo de factor de incertidumbre publicado en el cert PADES.
 *
 * Implementa ADR-028 §2 (matriz de derivación) y §3 (modificadores de
 * incertidumbre). Funciones puras, sin I/O.
 *
 * El servicio orquestador (`apps/api/src/services/calcular-metricas-viaje.ts`)
 * llama estas funciones al cierre del trip, persiste el resultado en
 * `trip_metrics.certification_level` + `uncertainty_factor`, y
 * `certificate-generator` los lee para elegir template (cert-primario vs
 * report-secundario) y para imprimir el ± en el PDF.
 */

export {
  derivarNivelCertificacion,
  THRESHOLD_PRIMARIO_PCT,
  THRESHOLD_SECUNDARIO_MODELED_PCT,
} from './derivar-nivel.js';
export { calcularFactorIncertidumbre } from './factor-incertidumbre.js';
