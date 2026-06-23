export interface DetectorInput {
  etaEnVivoSegundos: number;
  etaBaselineSegundos: number;
  segundosHastaProximaDivergencia: number;
}
export interface DetectorConfig {
  umbralDegradacionPct: number;
  leadTimeMinimoSegundos: number;
}
export type DetectorResult = { degradado: false } | { degradado: true; severidadPct: number };

const DEFAULTS: DetectorConfig = { umbralDegradacionPct: 0.15, leadTimeMinimoSegundos: 120 };

export function detectarDegradacion(
  input: DetectorInput,
  config: Partial<DetectorConfig> = {},
): DetectorResult {
  const cfg = { ...DEFAULTS, ...config };
  if (input.segundosHastaProximaDivergencia < cfg.leadTimeMinimoSegundos) {
    return { degradado: false };
  }
  if (input.etaBaselineSegundos <= 0) {
    return { degradado: false };
  }
  const severidadPct =
    (input.etaEnVivoSegundos - input.etaBaselineSegundos) / input.etaBaselineSegundos;
  return severidadPct > cfg.umbralDegradacionPct
    ? { degradado: true, severidadPct }
    : { degradado: false };
}
