import { z } from 'zod';
import { uuidSchema } from '../primitives/ids.js';

/**
 * RouteSuggestion = sugerencia de ruta alternativa emitida por el eco-routing-service
 * en tiempo real, persistida para trazabilidad del ciclo de vida completo:
 * emitida → entregada → evaluada (adoptada o rechazada).
 *
 * Naming bilingüe (ver CLAUDE.md): la tabla SQL es `sugerencias_ruta`,
 * el export TS es `routeSuggestions` / `RouteSuggestion`. Los campos SQL
 * van en español snake_case sin tildes; los identifiers TS van en camelCase.
 *
 * lat ∈ [-90, 90]; lng ∈ [-180, 180]. Los deltas pueden ser negativos
 * (la ruta alternativa es más rápida / emite menos CO2).
 *
 * El DDL Drizzle canónico vive en `apps/api/src/db/schema.ts` y debe tener
 * paridad 1:1 de campos/tipos con este schema.
 */

/**
 * Coordenada latitud como string decimal (numeric(9,6) en SQL).
 * Rango válido: [-90, 90].
 */
const latitudeSchema = z.string().refine((v) => {
  const n = Number(v);
  return !Number.isNaN(n) && n >= -90 && n <= 90;
}, 'latitud debe estar entre -90 y 90');

/**
 * Coordenada longitud como string decimal (numeric(9,6) en SQL).
 * Rango válido: [-180, 180].
 */
const longitudeSchema = z.string().refine((v) => {
  const n = Number(v);
  return !Number.isNaN(n) && n >= -180 && n <= 180;
}, 'longitud debe estar entre -180 y 180');

/**
 * Schema de dominio canónico de una sugerencia de ruta eco-óptima.
 * Paridad 1:1 con la tabla `sugerencias_ruta`.
 */
export const routeSuggestionSchema = z.object({
  /** UUID primario de la sugerencia. */
  id: uuidSchema,
  /** FK a `viajes` — el viaje en curso para el que se emitió la sugerencia. */
  viaje_id: uuidSchema,
  /** Timestamp de emisión de la sugerencia por el eco-routing-service. */
  emitida_en: z.string().datetime(),
  /** Polyline codificado de la ruta alternativa sugerida (Google Polyline format). */
  polyline_alternativa: z.string().min(1),
  /**
   * Diferencia de ETA en segundos vs. la ruta baseline.
   * Negativo = la ruta alternativa es más rápida.
   */
  delta_eta_segundos: z.number().int(),
  /**
   * Diferencia de emisiones CO2e en kg vs. la ruta baseline (numeric(10,3) en SQL).
   * Negativo = la ruta alternativa emite menos CO2.
   * Se almacena como string decimal para preservar precisión.
   */
  delta_co2e_kg: z.string(),
  /**
   * ETA de la ruta baseline en segundos (punto de referencia para el delta).
   * Siempre >= 0.
   */
  eta_baseline_segundos: z.number().int().min(0),
  /**
   * Posición del vehículo en el momento de emitir la sugerencia.
   * Latitud en string decimal numeric(9,6).
   */
  posicion_lat: latitudeSchema,
  /**
   * Posición del vehículo en el momento de emitir la sugerencia.
   * Longitud en string decimal numeric(9,6).
   */
  posicion_lng: longitudeSchema,
  /**
   * true = la sugerencia fue entregada al conductor vía canal WebSocket/push.
   * false = pendiente de entrega (default).
   */
  entregada: z.boolean(),
  /**
   * true = adoptada, false = rechazada, null = pendiente de evaluación.
   * Lo resuelve el adoption-resolver (Task 8).
   */
  adoptada: z.boolean().nullable(),
  /** Timestamp en que se evaluó la adopción (o rechazo). Null si aún pendiente. */
  evaluada_adopcion_en: z.string().datetime().nullable(),
  creado_en: z.string().datetime(),
  actualizado_en: z.string().datetime(),
});

export type RouteSuggestion = z.infer<typeof routeSuggestionSchema>;
