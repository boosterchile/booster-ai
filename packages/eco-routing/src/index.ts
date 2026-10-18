/**
 * `@booster-ai/eco-routing` — lógica pura del eco-routing en tiempo real
 * (T10-23, ADR-012 Capa 1). La orquestación (posiciones, Routes API,
 * persistencia, push) vive en apps/api.
 */
export {
  DEFAULTS_DETECTOR,
  detectarCongestion,
  type ConfigDetector,
  type MuestraPosicion,
  type OpcionesDeteccion,
  type ResultadoDeteccion,
} from './detectar-congestion.js';
export {
  DEFAULTS_EVALUADOR,
  evaluarAlternativas,
  type ConfigEvaluador,
  type EntradaEvaluacion,
  type ResultadoEvaluacion,
  type RutaCandidata,
} from './evaluar-alternativas.js';
export { distanciaMetros, type Coordenada } from './geo.js';
