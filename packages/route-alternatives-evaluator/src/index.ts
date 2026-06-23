/**
 * @booster-ai/route-alternatives-evaluator
 *
 * Rankea alternativas de ruta por emisión CO₂e y elige la de mínima
 * emisión que respeta el guardrail de ETA (duración con tráfico).
 *
 * Diseño:
 *   - Si fuelLitros viene no-null (Routes API FUEL_CONSUMPTION), la
 *     emisión se calcula directamente: fuelLitros × factorWtw(fuelType).
 *   - Si fuelLitros es null, se estima vía calcularEmisionesViaje con
 *     metodo:'modelado' (distancia + perfil de combustible genérico).
 *   - El guardrail filtra alternativas cuya duración excede
 *     actual.duracionSegundos × (1 + guardrailEtaPct).
 *   - Entre las alternativas sobrevivientes (incluyendo la actual),
 *     se elige la de menor CO₂e.
 *   - Si la ganadora es la actual (índice 0): → ninguna_mejor.
 *   - Si es otra: → recomendada con deltas (alternativa − actual).
 */

import { calcularEmisionesViaje, factorWtw } from '@booster-ai/carbon-calculator';
import type { TipoCombustible } from '@booster-ai/carbon-calculator';
import { z } from 'zod';

// ─── Schemas de validación ────────────────────────────────────────────────────

const alternativaInputSchema = z.object({
  polyline: z.string().min(1),
  distanciaKm: z.number().positive(),
  duracionSegundos: z.number().positive(),
  fuelLitros: z.number().nonnegative().nullable(),
});

const evaluadorInputSchema = z.object({
  alternativas: z.array(alternativaInputSchema).min(1),
  fuelType: z.string().min(1),
  guardrailEtaPct: z.number().min(0).max(1),
});

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface AlternativaInput {
  polyline: string;
  distanciaKm: number;
  duracionSegundos: number;
  /** De Routes API FUEL_CONSUMPTION; null → estimar vía carbon-calculator */
  fuelLitros: number | null;
}

export interface EvaluadorInput {
  alternativas: AlternativaInput[]; // [0] = ruta actual (TRAFFIC_AWARE_OPTIMAL)
  fuelType: string;
  guardrailEtaPct: number; // default 0.10
}

export type EvaluadorResult =
  | { tipo: 'ninguna_mejor' }
  | {
      tipo: 'recomendada';
      polyline: string;
      deltaEtaSegundos: number;
      deltaCo2eKg: number;
    };

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface Candidato {
  index: number;
  polyline: string;
  duracionSegundos: number;
  emisionKgco2e: number;
}

// ─── Helpers privados ─────────────────────────────────────────────────────────

/**
 * Calcula la emisión en kgCO₂e para una alternativa dada.
 *
 * Estrategia:
 *   1. fuelLitros no-null → fuelLitros × factorWtw(fuelType) (más preciso).
 *   2. fuelLitros null → calcularEmisionesViaje metodo:'modelado'
 *      con perfil genérico (consumoBasePor100km=null, capacidadKg estándar).
 */
function resolverEmision(alt: AlternativaInput, fuelType: string): number {
  if (alt.fuelLitros !== null) {
    return alt.fuelLitros * factorWtw(fuelType as TipoCombustible);
  }
  const resultado = calcularEmisionesViaje({
    metodo: 'modelado',
    distanciaKm: alt.distanciaKm,
    cargaKg: 0,
    vehiculo: {
      combustible: fuelType as TipoCombustible,
      consumoBasePor100km: null,
      pesoVacioKg: null,
      capacidadKg: 25000,
    },
  });
  return resultado.emisionesKgco2eWtw;
}

// ─── Función pública ──────────────────────────────────────────────────────────

export function evaluarAlternativas(input: EvaluadorInput): EvaluadorResult {
  // Validar inputs con Zod al entrar
  const parsed = evaluadorInputSchema.parse(input);
  const { alternativas, fuelType, guardrailEtaPct } = parsed;

  // La validación de Zod garantiza alternativas.length >= 1
  // pero noUncheckedIndexedAccess obliga a chequear explícitamente.
  const actual = alternativas[0];
  if (actual === undefined) {
    // Imposible por el schema (min(1)), pero requerido por strictNullChecks.
    return { tipo: 'ninguna_mejor' };
  }

  const umbralDuracion = actual.duracionSegundos * (1 + guardrailEtaPct);
  const emisionActual = resolverEmision(actual, fuelType);

  // Iniciar candidatos con la ruta actual
  const candidatos: Candidato[] = [
    {
      index: 0,
      polyline: actual.polyline,
      duracionSegundos: actual.duracionSegundos,
      emisionKgco2e: emisionActual,
    },
  ];

  // Agregar alternativas que pasen el guardrail de ETA
  for (let i = 1; i < alternativas.length; i++) {
    const alt = alternativas[i];
    if (alt === undefined) {
      continue;
    }
    if (alt.duracionSegundos <= umbralDuracion) {
      candidatos.push({
        index: i,
        polyline: alt.polyline,
        duracionSegundos: alt.duracionSegundos,
        emisionKgco2e: resolverEmision(alt, fuelType),
      });
    }
  }

  // Elegir la de menor CO₂e entre candidatos (incluyendo actual)
  let ganador: Candidato | undefined = candidatos[0];
  for (const c of candidatos) {
    if (ganador === undefined || c.emisionKgco2e < ganador.emisionKgco2e) {
      ganador = c;
    }
  }

  // Imposible que ganador sea undefined (candidatos siempre tiene al menos actual)
  if (ganador === undefined || ganador.index === 0) {
    return { tipo: 'ninguna_mejor' };
  }

  return {
    tipo: 'recomendada',
    polyline: ganador.polyline,
    deltaEtaSegundos: ganador.duracionSegundos - actual.duracionSegundos,
    deltaCo2eKg: ganador.emisionKgco2e - emisionActual,
  };
}
