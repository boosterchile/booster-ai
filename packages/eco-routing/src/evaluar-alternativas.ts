import { type TipoCombustible, factorWtw } from '@booster-ai/carbon-calculator';

/**
 * Evaluación de rutas alternativas ante congestión (T10-23, ADR-012 Capa 1):
 * emisiones primero, con guardrail de ETA. Recomienda la alternativa de menor
 * kgCO2e (WTW, factores SEC Chile vía carbon-calculator) cuya duración no
 * supere la actual en más de `guardrailEtaPct`, y solo si la mejora es
 * material (> `mejoraMinimaPct` en CO2e o en tiempo, ADR-012 "cambio > 10 %").
 * Nunca recomienda una ruta que emita más que la actual.
 */
export interface RutaCandidata {
  duracionSegundos: number;
  distanciaKm: number;
  /** Litros estimados por Routes API (FUEL_CONSUMPTION); null si no vino. */
  combustibleL: number | null;
  polylineCodificada: string;
}

export interface ConfigEvaluador {
  guardrailEtaPct: number;
  mejoraMinimaPct: number;
}

export const DEFAULTS_EVALUADOR: ConfigEvaluador = {
  guardrailEtaPct: 0.1,
  mejoraMinimaPct: 0.1,
};

export interface EntradaEvaluacion {
  actual: RutaCandidata;
  alternativas: readonly RutaCandidata[];
  combustible: TipoCombustible;
  /** Consumo base declarado del vehículo, para estimar litros por distancia. */
  consumoBaseLPor100km: number | null;
  config?: Partial<ConfigEvaluador>;
}

export type ResultadoEvaluacion =
  | {
      tipo: 'recomendada';
      motivo: 'emisiones' | 'tiempo';
      alternativa: RutaCandidata;
      /** Positivo = la alternativa llega antes. */
      ahorroSegundos: number;
      kgco2eActual: number | null;
      kgco2eAlternativa: number | null;
      ahorroKgco2e: number | null;
    }
  | { tipo: 'ninguna'; razon: 'sin_alternativas' | 'sin_mejora_material' };

/** Combustibles medidos en litros: los únicos donde FUEL_CONSUMPTION aplica. */
const COMBUSTIBLES_LIQUIDOS: ReadonlySet<TipoCombustible> = new Set([
  'diesel',
  'gasolina',
  'gas_glp',
  'hibrido_diesel',
  'hibrido_gasolina',
]);

function kgco2e(ruta: RutaCandidata, entrada: EntradaEvaluacion): number | null {
  if (!COMBUSTIBLES_LIQUIDOS.has(entrada.combustible)) {
    return null;
  }
  const litros =
    ruta.combustibleL ??
    (entrada.consumoBaseLPor100km === null
      ? null
      : (ruta.distanciaKm * entrada.consumoBaseLPor100km) / 100);
  return litros === null ? null : litros * factorWtw(entrada.combustible);
}

export function evaluarAlternativas(entrada: EntradaEvaluacion): ResultadoEvaluacion {
  const cfg = { ...DEFAULTS_EVALUADOR, ...entrada.config };
  if (entrada.alternativas.length === 0) {
    return { tipo: 'ninguna', razon: 'sin_alternativas' };
  }
  const { actual } = entrada;
  const etaMax = actual.duracionSegundos * (1 + cfg.guardrailEtaPct);
  const co2Actual = kgco2e(actual, entrada);

  let mejor: { ruta: RutaCandidata; co2: number | null; motivo: 'emisiones' | 'tiempo' } | null =
    null;
  for (const ruta of entrada.alternativas) {
    const co2 = kgco2e(ruta, entrada);
    const ahorroSeg = actual.duracionSegundos - ruta.duracionSegundos;
    const mejoraTiempo = ahorroSeg / actual.duracionSegundos > cfg.mejoraMinimaPct;
    let motivo: 'emisiones' | 'tiempo' | null = null;
    if (co2Actual !== null && co2 !== null) {
      if (co2 > co2Actual) {
        continue; // nunca más emisiones
      }
      const mejoraCo2 = (co2Actual - co2) / co2Actual > cfg.mejoraMinimaPct;
      if (mejoraCo2 && ruta.duracionSegundos <= etaMax) {
        motivo = 'emisiones';
      } else if (mejoraTiempo) {
        motivo = 'tiempo';
      }
    } else if (mejoraTiempo) {
      motivo = 'tiempo';
    }
    if (motivo === null) {
      continue;
    }
    const esMejor =
      mejor === null ||
      (motivo === 'emisiones' && mejor.motivo === 'tiempo') ||
      (motivo === mejor.motivo &&
        (motivo === 'emisiones'
          ? (co2 as number) < (mejor.co2 as number)
          : ruta.duracionSegundos < mejor.ruta.duracionSegundos));
    if (esMejor) {
      mejor = { ruta, co2, motivo };
    }
  }

  if (mejor === null) {
    return { tipo: 'ninguna', razon: 'sin_mejora_material' };
  }
  return {
    tipo: 'recomendada',
    motivo: mejor.motivo,
    alternativa: mejor.ruta,
    ahorroSegundos: actual.duracionSegundos - mejor.ruta.duracionSegundos,
    kgco2eActual: co2Actual,
    kgco2eAlternativa: mejor.co2,
    ahorroKgco2e: co2Actual !== null && mejor.co2 !== null ? co2Actual - mejor.co2 : null,
  };
}
