/**
 * Schemas Zod del input/output del motor de pricing baseline.
 */

import { z } from 'zod';

/**
 * Tipo de carga — espejo del enum del schema Drizzle. Cada uno tiene un
 * factor multiplicador específico (ver `multipliers.ts`).
 */
export const cargoTypeSchema = z.enum([
  'general',
  'frigorifica',
  'peligrosa',
  'frio',
  'liquidos',
  'graneles',
  'construccion',
  'agricola',
  'ganado',
  'otra',
]);
export type CargoType = z.infer<typeof cargoTypeSchema>;

/**
 * Urgencia del envío. Determina el factor temporal del precio.
 */
export const urgencySchema = z.enum([
  'flexible', // sin presión de fecha; descuento
  'standard', // entrega en 24-72h, baseline
  'express', // mismo día / siguiente; recargo
  'critical', // emergencia <6h, recargo alto
]);
export type Urgency = z.infer<typeof urgencySchema>;

/**
 * Input del motor de pricing.
 */
export const pricingInputSchema = z
  .object({
    /** Distancia estimada en km. */
    distanceKm: z.number().positive(),
    /** Peso de la carga en kg. */
    weightKg: z.number().positive(),
    /** Tipo de carga — afecta multiplier de operación + seguro. */
    cargoType: cargoTypeSchema,
    /** Urgencia — afecta factor temporal. */
    urgency: urgencySchema.default('standard'),
    /**
     * Volumen estimado en m³. Opcional — si está, se cobra max(peso/volumen)
     * según ratio de densidad típica del sector (200 kg/m³, factor de
     * estiba estándar).
     */
    volumeM3: z.number().positive().optional(),
    /**
     * Si `true`, el viaje regresa vacío (sin retorno). Aumenta el precio
     * porque el carrier no puede compensar el km de retorno con otro
     * viaje. Default `false` (asume marketplace optimiza retornos).
     */
    isOneWayEmpty: z.boolean().default(false),
    /**
     * Región de origen (código tipo 'XIII' Metropolitana). Sirve para
     * lookups de tarifas regionales si en el futuro se introduce
     * pricing por zona. Hoy no se usa en el cálculo, pero se acepta
     * para que el consumer lo pase always.
     */
    originRegion: z.string().min(1).max(20).optional(),
    destinationRegion: z.string().min(1).max(20).optional(),
  })
  .strict();
export type PricingInput = z.infer<typeof pricingInputSchema>;

/**
 * Breakdown del precio sugerido. El total es la suma de los componentes
 * después de aplicar multipliers — útil para mostrar al user "por qué"
 * sale ese precio (transparencia y trust).
 */
export interface PricingBreakdown {
  /** Cargo fijo de inicio (alistar vehículo + chofer). */
  baseFeeClp: number;
  /** Componente proporcional a km. */
  distanceClp: number;
  /** Componente proporcional a peso. */
  weightClp: number;
  /** Componente proporcional a volumen (si aplica). */
  volumeClp: number;
  /** Multiplicadores aplicados para llegar al total. */
  multipliers: {
    cargoType: number;
    urgency: number;
    oneWayEmpty: number;
  };
  /**
   * Total sin redondear. El `totalClp` final del result lo redondea
   * al múltiplo de 1000 más cercano (convención chilena).
   */
  subtotalClp: number;
}

export interface PricingSuggestion {
  /** Precio sugerido en CLP, redondeado al múltiplo de 1000. */
  totalClp: number;
  /** Desglose detallado de cómo se llegó al total. */
  breakdown: PricingBreakdown;
  /**
   * Confianza del modelo:
   * - `high`: input completo + tipo de carga conocido.
   * - `medium`: faltan campos opcionales (volumen).
   * - `low`: tipo de carga `otra` o input edge case.
   *
   * El frontend puede mostrar disclaimer "precio sugerido, valida con
   * el carrier" cuando confidence != high.
   */
  confidence: 'high' | 'medium' | 'low';
}
