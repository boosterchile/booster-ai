import { z } from 'zod';
import { tripRequestIdSchema } from '../primitives/ids.js';

/**
 * Método de precisión del cálculo GLEC v3.0:
 *   - exacto_canbus: telemetría real desde el bus del vehículo
 *   - modelado: estimación basada en distancia + factor por tipo
 *   - por_defecto: factor genérico cuando no hay vehículo declarado
 */
export const precisionMethodSchema = z.enum(['exacto_canbus', 'modelado', 'por_defecto']);
export type PrecisionMethod = z.infer<typeof precisionMethodSchema>;

/**
 * Origen del dato de combustible/distancia para cada cálculo. Sirve para
 * que el certificado declare provenance ("dato directo CANbus" vs "modelo").
 */
export const tripMetricsSourceSchema = z.enum(['modeled', 'canbus', 'driver_app']);
export type TripMetricsSource = z.infer<typeof tripMetricsSourceSchema>;

/**
 * Métricas ESG por viaje (1:1 con `viajes`). Separar de `trip_requests`
 * mantiene la tabla operacional limpia y permite que el carbon-calculator
 * actualice estimaciones sin tocar el lifecycle del viaje.
 *
 * Estimadas: calculadas al confirmar pickup, basadas en perfil del
 * vehículo + distancia planificada.
 *
 * Reales: actualizadas al confirmar entrega con telemetría/datos reales.
 */
export const tripMetricsSchema = z.object({
  trip_id: tripRequestIdSchema,
  distance_km_estimated: z.number().nonnegative().nullable(),
  distance_km_actual: z.number().nonnegative().nullable(),
  carbon_emissions_kgco2e_estimated: z.number().nonnegative().nullable(),
  carbon_emissions_kgco2e_actual: z.number().nonnegative().nullable(),
  fuel_consumed_l_estimated: z.number().nonnegative().nullable(),
  fuel_consumed_l_actual: z.number().nonnegative().nullable(),
  precision_method: precisionMethodSchema.nullable(),
  glec_version: z.string().nullable(),
  emission_factor_used: z.number().nonnegative().nullable(),
  source: tripMetricsSourceSchema.nullable(),
  calculated_at: z.string().datetime().nullable(),
  certificate_pdf_url: z.string().url().nullable(),
  certificate_sha256: z.string().length(64).nullable(),
  certificate_kms_key_version: z.string().nullable(),
  certificate_issued_at: z.string().datetime().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type TripMetrics = z.infer<typeof tripMetricsSchema>;
